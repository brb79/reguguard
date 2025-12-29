-- Migration: 007_alert_personalization.sql
-- Add personalization metadata tracking for AI-generated alert messages

-- Add personalization_metadata JSONB field to alerts table
ALTER TABLE alerts 
ADD COLUMN IF NOT EXISTS personalization_metadata JSONB;

-- Add index for querying personalization metadata
CREATE INDEX IF NOT EXISTS idx_alerts_personalization_metadata 
ON alerts USING GIN (personalization_metadata);

-- Add comment explaining the metadata structure
COMMENT ON COLUMN alerts.personalization_metadata IS 
'Stores metadata about AI-generated personalized messages including variant (A/B testing), language, tone, and personalization factors used';

