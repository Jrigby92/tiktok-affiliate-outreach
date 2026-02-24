-- 001_extensions.sql
-- Enable required PostgreSQL extensions

-- pgvector: vector similarity search for regulatory RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_trgm: trigram matching for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
