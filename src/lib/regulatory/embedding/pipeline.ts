import { Pool } from "pg";
import OpenAI from "openai";
import { RegulatoryChunk } from "../scrapers/types";

/**
 * Embedding model: OpenAI text-embedding-3-small (1536 dimensions).
 * Chosen for strong performance on regulatory/legal text at reasonable cost.
 */
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };

export class EmbeddingPipeline {
  private db: Pool;
  private openai: OpenAI;

  constructor(db: Pool, openaiApiKey?: string) {
    this.db = db;
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generate a semantic embedding for a single text string.
   * Returns a float array of length 1536.
   */
  async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    return response.data[0].embedding;
  }

  /**
   * Embeds and upserts an array of RegulatoryChunks into the `regulations` table.
   * Uses ON CONFLICT to update existing rows matching (source_authority, regulation_text).
   *
   * @returns The number of chunks successfully embedded and stored.
   */
  async embedAndStore(chunks: RegulatoryChunk[]): Promise<number> {
    if (chunks.length === 0) return 0;

    let storedCount = 0;

    // Process in batches to avoid overwhelming the embedding API
    const BATCH_SIZE = 20;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.text);

      // Batch embed
      const response = await this.openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
      });

      // Upsert each chunk into the regulations table
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const embedding = response.data[j].embedding;
        const vectorStr = `[${embedding.join(",")}]`;

        await this.db.query(
          `INSERT INTO regulations (
            regulation_text,
            embedding_vector,
            source_authority,
            last_updated,
            created_at,
            updated_at
          ) VALUES ($1, $2::vector, $3, $4, NOW(), NOW())
          ON CONFLICT (source_authority, regulation_text)
          DO UPDATE SET
            embedding_vector = EXCLUDED.embedding_vector,
            last_updated = EXCLUDED.last_updated,
            updated_at = NOW()`,
          [
            chunk.text,
            vectorStr,
            chunk.sourceAuthority,
            chunk.lastAccessed,
          ]
        );

        storedCount++;
      }
    }

    return storedCount;
  }
}
