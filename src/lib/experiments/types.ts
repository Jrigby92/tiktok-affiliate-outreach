/**
 * A/B Testing Framework Types
 *
 * Three experiments:
 * 1. Commission Tiers — 15% vs 10% flat rate
 * 2. Pitch Messages — template variants for Target Collaboration invitations
 * 3. Sample Approval Thresholds — exposure vs. waste balance
 */

/**
 * Experiment types supported by the framework.
 */
export type ExperimentType =
  | "commission_tier"
  | "pitch_message"
  | "sample_threshold";

/**
 * Status of an experiment.
 */
export type ExperimentStatus = "draft" | "running" | "paused" | "completed";

/**
 * An experiment definition.
 */
export interface Experiment {
  id: string;
  name: string;
  type: ExperimentType;
  status: ExperimentStatus;
  /** Experiment variants */
  variants: ExperimentVariant[];
  /** Traffic allocation per variant (must sum to 1.0) */
  trafficSplit: Record<string, number>;
  /** When the experiment started */
  startedAt?: Date;
  /** When the experiment ended */
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A variant within an experiment.
 */
export interface ExperimentVariant {
  id: string;
  name: string;
  /** Variant-specific configuration */
  config: VariantConfig;
  /** Whether this is the control group */
  isControl: boolean;
}

/**
 * Variant configuration — varies by experiment type.
 */
export type VariantConfig =
  | CommissionTierVariant
  | PitchMessageVariant
  | SampleThresholdVariant;

export interface CommissionTierVariant {
  type: "commission_tier";
  /** Commission rate as percentage */
  commissionPercent: number;
}

export interface PitchMessageVariant {
  type: "pitch_message";
  /** Message template (supports {creatorName}, {productName}) */
  template: string;
}

export interface SampleThresholdVariant {
  type: "sample_threshold";
  /** Minimum engagement rate for auto-approval */
  autoApproveThreshold: number;
}

/**
 * A variant assignment for a specific subject (creator/product pair).
 */
export interface VariantAssignment {
  experimentId: string;
  variantId: string;
  /** Subject key (e.g., creatorId or creatorId:productId) */
  subjectKey: string;
  assignedAt: Date;
}

/**
 * An outcome event recorded for an assignment.
 */
export interface ExperimentOutcome {
  experimentId: string;
  variantId: string;
  subjectKey: string;
  /** Metric name (e.g., "acceptance_rate", "conversion_rate", "sample_waste") */
  metric: string;
  /** Metric value */
  value: number;
  /** Additional context */
  metadata?: Record<string, unknown>;
  recordedAt: Date;
}

/**
 * Aggregated results for a variant.
 */
export interface VariantResults {
  variantId: string;
  variantName: string;
  isControl: boolean;
  /** Number of subjects assigned to this variant */
  sampleSize: number;
  /** Aggregated metrics */
  metrics: Record<
    string,
    {
      mean: number;
      count: number;
      sum: number;
    }
  >;
}

/**
 * Full experiment results.
 */
export interface ExperimentResults {
  experimentId: string;
  experimentName: string;
  status: ExperimentStatus;
  variantResults: VariantResults[];
  totalSubjects: number;
  totalOutcomes: number;
}
