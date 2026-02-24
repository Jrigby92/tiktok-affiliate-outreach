/**
 * A/B Testing Framework
 *
 * Manages experiment definitions, variant assignments, and outcome tracking.
 * Supports three experiment types:
 * 1. Commission Tiers — does 15% attract better creators than 10%?
 * 2. Pitch Messages — which templates get the highest acceptance rate?
 * 3. Sample Approval Thresholds — brand exposure vs. wasted samples
 *
 * Results feed the reinforcement learning loop via getExperimentResults().
 */

import { Pool } from "pg";
import * as crypto from "crypto";
import { traced } from "@/lib/llm/langsmith";
import {
  Experiment,
  ExperimentVariant,
  ExperimentType,
  ExperimentStatus,
  VariantAssignment,
  ExperimentOutcome,
  ExperimentResults,
  VariantResults,
  VariantConfig,
} from "./types";

export class ABTestingFramework {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Initialize the experiments tables if they don't exist.
   */
  async initTables(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        variants JSONB NOT NULL DEFAULT '[]'::jsonb,
        traffic_split JSONB NOT NULL DEFAULT '{}'::jsonb,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS variant_assignments (
        id SERIAL PRIMARY KEY,
        experiment_id TEXT NOT NULL REFERENCES experiments(id),
        variant_id TEXT NOT NULL,
        subject_key TEXT NOT NULL,
        assigned_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(experiment_id, subject_key)
      );

      CREATE TABLE IF NOT EXISTS experiment_outcomes (
        id SERIAL PRIMARY KEY,
        experiment_id TEXT NOT NULL REFERENCES experiments(id),
        variant_id TEXT NOT NULL,
        subject_key TEXT NOT NULL,
        metric TEXT NOT NULL,
        value NUMERIC NOT NULL,
        metadata JSONB,
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_assignments_experiment ON variant_assignments(experiment_id);
      CREATE INDEX IF NOT EXISTS idx_assignments_subject ON variant_assignments(subject_key);
      CREATE INDEX IF NOT EXISTS idx_outcomes_experiment ON experiment_outcomes(experiment_id);
      CREATE INDEX IF NOT EXISTS idx_outcomes_variant ON experiment_outcomes(variant_id);
    `);
  }

  /**
   * Create a new experiment.
   */
  async createExperiment(
    name: string,
    type: ExperimentType,
    variants: ExperimentVariant[],
    trafficSplit?: Record<string, number>
  ): Promise<Experiment> {
    const id = `exp_${crypto.randomUUID()}`;

    // Default even split if not provided
    const split =
      trafficSplit ||
      Object.fromEntries(
        variants.map((v) => [v.id, 1 / variants.length])
      );

    // Validate split sums to ~1.0
    const splitTotal = Object.values(split).reduce((sum, v) => sum + v, 0);
    if (Math.abs(splitTotal - 1.0) > 0.01) {
      throw new Error(
        `Traffic split must sum to 1.0, got ${splitTotal.toFixed(3)}`
      );
    }

    const experiment: Experiment = {
      id,
      name,
      type,
      status: "draft",
      variants,
      trafficSplit: split,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.query(
      `INSERT INTO experiments (id, name, type, status, variants, traffic_split)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name, type, "draft", JSON.stringify(variants), JSON.stringify(split)]
    );

    return experiment;
  }

  /**
   * Start an experiment (set status to running).
   */
  async startExperiment(experimentId: string): Promise<void> {
    await this.db.query(
      `UPDATE experiments SET status = 'running', started_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [experimentId]
    );
  }

  /**
   * Pause an experiment.
   */
  async pauseExperiment(experimentId: string): Promise<void> {
    await this.db.query(
      `UPDATE experiments SET status = 'paused', updated_at = NOW()
       WHERE id = $1`,
      [experimentId]
    );
  }

  /**
   * Complete an experiment.
   */
  async completeExperiment(experimentId: string): Promise<void> {
    await this.db.query(
      `UPDATE experiments SET status = 'completed', ended_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [experimentId]
    );
  }

  /**
   * Get an experiment by ID.
   */
  async getExperiment(experimentId: string): Promise<Experiment | null> {
    const result = await this.db.query(
      `SELECT * FROM experiments WHERE id = $1`,
      [experimentId]
    );

    if (result.rows.length === 0) return null;
    return this.rowToExperiment(result.rows[0]);
  }

  /**
   * List experiments, optionally filtered by type and/or status.
   */
  async listExperiments(filters?: {
    type?: ExperimentType;
    status?: ExperimentStatus;
  }): Promise<Experiment[]> {
    let query = "SELECT * FROM experiments WHERE 1=1";
    const params: unknown[] = [];

    if (filters?.type) {
      params.push(filters.type);
      query += ` AND type = $${params.length}`;
    }
    if (filters?.status) {
      params.push(filters.status);
      query += ` AND status = $${params.length}`;
    }

    query += " ORDER BY created_at DESC";

    const result = await this.db.query(query, params);
    return result.rows.map((row) => this.rowToExperiment(row));
  }

  /**
   * Assign a subject to a variant using deterministic hashing.
   * This ensures the same subject always gets the same variant.
   */
  async assignVariant(
    experimentId: string,
    subjectKey: string
  ): Promise<VariantAssignment> {
    const tracedAssign = traced(
      async (
        expId: string,
        key: string
      ): Promise<VariantAssignment> => {
        // Check for existing assignment
        const existing = await this.db.query(
          `SELECT * FROM variant_assignments
           WHERE experiment_id = $1 AND subject_key = $2`,
          [expId, key]
        );

        if (existing.rows.length > 0) {
          return {
            experimentId: existing.rows[0].experiment_id,
            variantId: existing.rows[0].variant_id,
            subjectKey: existing.rows[0].subject_key,
            assignedAt: existing.rows[0].assigned_at,
          };
        }

        // Get experiment
        const experiment = await this.getExperiment(expId);
        if (!experiment) {
          throw new Error(`Experiment not found: ${expId}`);
        }
        if (experiment.status !== "running") {
          throw new Error(
            `Experiment ${expId} is not running (status: ${experiment.status})`
          );
        }

        // Deterministic variant selection via hash
        const variantId = this.selectVariant(experiment, key);

        // Persist assignment
        await this.db.query(
          `INSERT INTO variant_assignments (experiment_id, variant_id, subject_key)
           VALUES ($1, $2, $3)
           ON CONFLICT (experiment_id, subject_key) DO NOTHING`,
          [expId, variantId, key]
        );

        return {
          experimentId: expId,
          variantId,
          subjectKey: key,
          assignedAt: new Date(),
        };
      },
      {
        name: "ab-assign-variant",
        runType: "tool",
        metadata: { experimentId, subjectKey },
      }
    );

    return tracedAssign(experimentId, subjectKey);
  }

  /**
   * Record an outcome event for a subject.
   */
  async recordOutcome(
    experimentId: string,
    subjectKey: string,
    metric: string,
    value: number,
    metadata?: Record<string, unknown>
  ): Promise<ExperimentOutcome> {
    // Look up the variant assignment
    const assignment = await this.db.query(
      `SELECT variant_id FROM variant_assignments
       WHERE experiment_id = $1 AND subject_key = $2`,
      [experimentId, subjectKey]
    );

    if (assignment.rows.length === 0) {
      throw new Error(
        `No variant assignment found for ${subjectKey} in experiment ${experimentId}`
      );
    }

    const variantId = assignment.rows[0].variant_id;

    await this.db.query(
      `INSERT INTO experiment_outcomes
       (experiment_id, variant_id, subject_key, metric, value, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        experimentId,
        variantId,
        subjectKey,
        metric,
        value,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    return {
      experimentId,
      variantId,
      subjectKey,
      metric,
      value,
      metadata,
      recordedAt: new Date(),
    };
  }

  /**
   * Get aggregated results for an experiment.
   */
  async getExperimentResults(
    experimentId: string
  ): Promise<ExperimentResults> {
    const tracedResults = traced(
      async (expId: string): Promise<ExperimentResults> => {
        const experiment = await this.getExperiment(expId);
        if (!experiment) {
          throw new Error(`Experiment not found: ${expId}`);
        }

        // Get assignment counts per variant
        const assignmentCounts = await this.db.query(
          `SELECT variant_id, COUNT(*) as count
           FROM variant_assignments
           WHERE experiment_id = $1
           GROUP BY variant_id`,
          [expId]
        );

        // Get aggregated outcomes per variant per metric
        const outcomes = await this.db.query(
          `SELECT variant_id, metric,
                  COUNT(*) as count,
                  SUM(value) as sum,
                  AVG(value) as mean
           FROM experiment_outcomes
           WHERE experiment_id = $1
           GROUP BY variant_id, metric`,
          [expId]
        );

        // Get total counts
        const totalSubjects = await this.db.query(
          `SELECT COUNT(DISTINCT subject_key) as count
           FROM variant_assignments
           WHERE experiment_id = $1`,
          [expId]
        );

        const totalOutcomes = await this.db.query(
          `SELECT COUNT(*) as count
           FROM experiment_outcomes
           WHERE experiment_id = $1`,
          [expId]
        );

        // Build variant results
        const countMap = new Map<string, number>();
        for (const row of assignmentCounts.rows) {
          countMap.set(row.variant_id, parseInt(row.count));
        }

        const metricsMap = new Map<
          string,
          Record<string, { mean: number; count: number; sum: number }>
        >();
        for (const row of outcomes.rows) {
          if (!metricsMap.has(row.variant_id)) {
            metricsMap.set(row.variant_id, {});
          }
          metricsMap.get(row.variant_id)![row.metric] = {
            mean: parseFloat(row.mean),
            count: parseInt(row.count),
            sum: parseFloat(row.sum),
          };
        }

        const variantResults: VariantResults[] = experiment.variants.map(
          (v) => ({
            variantId: v.id,
            variantName: v.name,
            isControl: v.isControl,
            sampleSize: countMap.get(v.id) || 0,
            metrics: metricsMap.get(v.id) || {},
          })
        );

        return {
          experimentId: expId,
          experimentName: experiment.name,
          status: experiment.status,
          variantResults,
          totalSubjects: parseInt(totalSubjects.rows[0]?.count || "0"),
          totalOutcomes: parseInt(totalOutcomes.rows[0]?.count || "0"),
        };
      },
      {
        name: "ab-get-results",
        runType: "tool",
        metadata: { experimentId },
      }
    );

    return tracedResults(experimentId);
  }

  /**
   * Get the variant config for a subject's assignment.
   * Useful for applying the correct treatment.
   */
  async getSubjectVariantConfig(
    experimentId: string,
    subjectKey: string
  ): Promise<VariantConfig | null> {
    const assignment = await this.assignVariant(experimentId, subjectKey);

    const experiment = await this.getExperiment(experimentId);
    if (!experiment) return null;

    const variant = experiment.variants.find(
      (v) => v.id === assignment.variantId
    );
    return variant?.config || null;
  }

  // ─── Private Helpers ───

  /**
   * Deterministic variant selection using hash-based assignment.
   */
  private selectVariant(
    experiment: Experiment,
    subjectKey: string
  ): string {
    // Hash the subject key + experiment ID for deterministic assignment
    const hash = crypto
      .createHash("sha256")
      .update(`${experiment.id}:${subjectKey}`)
      .digest();

    // Convert first 4 bytes to a number between 0 and 1
    const hashValue = hash.readUInt32BE(0) / 0xffffffff;

    // Walk through traffic split to find which variant this falls into
    let cumulative = 0;
    for (const variant of experiment.variants) {
      cumulative += experiment.trafficSplit[variant.id] || 0;
      if (hashValue < cumulative) {
        return variant.id;
      }
    }

    // Fallback: last variant
    return experiment.variants[experiment.variants.length - 1].id;
  }

  private rowToExperiment(row: Record<string, unknown>): Experiment {
    return {
      id: row.id as string,
      name: row.name as string,
      type: row.type as ExperimentType,
      status: row.status as ExperimentStatus,
      variants:
        typeof row.variants === "string"
          ? JSON.parse(row.variants)
          : (row.variants as ExperimentVariant[]),
      trafficSplit:
        typeof row.traffic_split === "string"
          ? JSON.parse(row.traffic_split)
          : (row.traffic_split as Record<string, number>),
      startedAt: row.started_at
        ? new Date(row.started_at as string)
        : undefined,
      endedAt: row.ended_at ? new Date(row.ended_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
