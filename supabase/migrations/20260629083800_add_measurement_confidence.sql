-- Migration: Add ML confidence fields to user_measurements

-- Add columns for storing pose estimation confidence scores
ALTER TABLE user_measurements
ADD COLUMN scan_confidence real DEFAULT 0,
ADD COLUMN per_field_confidence jsonb;

-- Comment on columns for schema clarity
COMMENT ON COLUMN user_measurements.scan_confidence IS 'Overall confidence score (0-1) of the AI body scan';
COMMENT ON COLUMN user_measurements.per_field_confidence IS 'JSON mapping of individual measurement keys to their confidence scores (0-1)';
