import { Pool } from "pg";
import { EmbeddingPipeline } from "../embedding/pipeline";
import { RegulatoryChunk } from "../scrapers/types";

/** Default number of chunks to retrieve for each query. */
const DEFAULT_TOP_K = 5;

export interface RagResult {
  chunk: RegulatoryChunk;
  score: number;
}

/**
 * Flattened chunk format used by the judge and compliance engine.
 * Combines chunk content with its similarity score.
 */
export interface RetrievedChunk {
  regulationText: string;
  sourceAuthority: "MHRA" | "ASA" | "CAP";
  ruleNumber: string;
  similarityScore: number;
}

export class RagRetrieval {
  private db: Pool;
  private embeddingPipeline: EmbeddingPipeline;

  constructor(db: Pool, embeddingPipeline: EmbeddingPipeline) {
    this.db = db;
    this.embeddingPipeline = embeddingPipeline;
  }

  /**
   * Semantic search against the regulations table using pgvector cosine similarity.
   *
   * @param query - The natural language query (e.g. "Can I say Vitamin D boosts immunity?")
   * @param topK - Number of most relevant chunks to return (default 5)
   * @returns Array of { chunk, score } sorted by similarity (highest first)
   */
  async search(query: string, topK: number = DEFAULT_TOP_K, minScore?: number): Promise<RagResult[]> {
    // Generate embedding for the query
    const queryEmbedding = await this.embeddingPipeline.embed(query);
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    // Cosine similarity: 1 - (embedding_vector <=> query_vector)
    // pgvector's <=> operator returns cosine distance, so 1 - distance = similarity
    const result = await this.db.query(
      `SELECT
        regulation_text,
        source_authority,
        last_updated,
        1 - (embedding_vector <=> $1::vector) AS similarity_score
      FROM regulations
      ORDER BY embedding_vector <=> $1::vector
      LIMIT $2`,
      [vectorStr, topK]
    );

    const results = result.rows.map((row) => ({
      chunk: {
        text: row.regulation_text as string,
        sourceAuthority: row.source_authority as "MHRA" | "ASA" | "CAP",
        lastAccessed: new Date(row.last_updated as string),
      },
      score: parseFloat(row.similarity_score as string),
    }));

    if (minScore !== undefined) {
      return results.filter((r) => r.score >= minScore);
    }
    return results;
  }
}
