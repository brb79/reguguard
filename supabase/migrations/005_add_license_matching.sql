-- ReguGuard Database Schema
-- Migration: 005_add_license_matching.sql
-- Purpose: Add fields for AI-powered license-to-state matching

-- Add matching fields to licenses_cache
ALTER TABLE licenses_cache
ADD COLUMN IF NOT EXISTS matched_state TEXT,
ADD COLUMN IF NOT EXISTS matched_license_type TEXT,
ADD COLUMN IF NOT EXISTS matched_display_name TEXT,
ADD COLUMN IF NOT EXISTS matching_confidence FLOAT,
ADD COLUMN IF NOT EXISTS matching_reasoning TEXT,
ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ;

-- Add index for state-based queries
CREATE INDEX IF NOT EXISTS idx_licenses_matched_state 
ON licenses_cache(matched_state) 
WHERE matched_state IS NOT NULL;

-- Add index for license type queries
CREATE INDEX IF NOT EXISTS idx_licenses_matched_type 
ON licenses_cache(matched_license_type) 
WHERE matched_license_type IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN licenses_cache.matched_state IS 'Two-letter state code matched by AI (e.g., VA, TX)';
COMMENT ON COLUMN licenses_cache.matched_license_type IS 'License type identifier matched by AI (e.g., armed_security_officer)';
COMMENT ON COLUMN licenses_cache.matched_display_name IS 'Human-readable license name from state metadata';
COMMENT ON COLUMN licenses_cache.matching_confidence IS 'AI confidence score (0.0-1.0) for the match';
COMMENT ON COLUMN licenses_cache.matching_reasoning IS 'AI explanation of why this match was made';

