-- ReguGuard Database Schema
-- Migration: 011_compliance_qa_cache.sql
-- Purpose: Add caching for compliance Q&A responses to reduce API costs and improve response speed

-- ============================================================================
-- Tables
-- ============================================================================

CREATE TABLE compliance_qa_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Cache key components
    question_fingerprint TEXT NOT NULL,  -- Hash of normalized question
    state_code TEXT NOT NULL,            -- Two-letter state code (e.g., "VA", "TX")
    license_type TEXT,                   -- Optional: armed/unarmed/etc

    -- Cached response
    answer TEXT NOT NULL,                -- The generated answer text
    sources JSONB NOT NULL DEFAULT '[]', -- Array of citation URLs
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

    -- Cache metadata
    hit_count INTEGER DEFAULT 0,         -- Track how many times cache was used
    last_accessed_at TIMESTAMPTZ,        -- Last time cache was accessed (for LRU)
    expires_at TIMESTAMPTZ NOT NULL,     -- TTL expiration timestamp

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Unique indexes on cache key (split by NULL/NOT NULL license_type)
-- This ensures uniqueness while handling NULL properly
CREATE UNIQUE INDEX idx_qa_cache_unique_with_license
ON compliance_qa_cache(question_fingerprint, state_code, license_type)
WHERE license_type IS NOT NULL;

CREATE UNIQUE INDEX idx_qa_cache_unique_without_license
ON compliance_qa_cache(question_fingerprint, state_code)
WHERE license_type IS NULL;

-- Primary lookup index for cache retrieval
CREATE INDEX idx_qa_cache_lookup
ON compliance_qa_cache(question_fingerprint, state_code, license_type);

-- Index for expiration cleanup queries
CREATE INDEX idx_qa_cache_expires
ON compliance_qa_cache(expires_at);

-- Analytics index for most popular cached questions
CREATE INDEX idx_qa_cache_hits
ON compliance_qa_cache(hit_count DESC, last_accessed_at DESC);

-- State-based lookup for analytics
CREATE INDEX idx_qa_cache_state
ON compliance_qa_cache(state_code, created_at DESC);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE compliance_qa_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON compliance_qa_cache
    FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE compliance_qa_cache IS 'Caches high-confidence compliance Q&A responses to reduce API costs and improve response speed';
COMMENT ON COLUMN compliance_qa_cache.question_fingerprint IS 'SHA-256 hash (first 16 chars) of normalized question text';
COMMENT ON COLUMN compliance_qa_cache.state_code IS 'Two-letter state code the question is about';
COMMENT ON COLUMN compliance_qa_cache.license_type IS 'Optional license type context (armed, unarmed, etc)';
COMMENT ON COLUMN compliance_qa_cache.answer IS 'The cached answer text (SMS-friendly format)';
COMMENT ON COLUMN compliance_qa_cache.sources IS 'JSONB array of citation URLs';
COMMENT ON COLUMN compliance_qa_cache.confidence IS 'AI confidence score (0.0-1.0), only >= 0.6 are cached';
COMMENT ON COLUMN compliance_qa_cache.hit_count IS 'Number of times this cached response was returned (analytics)';
COMMENT ON COLUMN compliance_qa_cache.last_accessed_at IS 'Last access timestamp for LRU cache eviction';
COMMENT ON COLUMN compliance_qa_cache.expires_at IS 'TTL expiration timestamp (typically 7 days from creation)';

-- ============================================================================
-- Analyze Table for Query Planner
-- ============================================================================

ANALYZE compliance_qa_cache;
