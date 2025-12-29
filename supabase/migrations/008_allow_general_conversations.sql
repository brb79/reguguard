-- ReguGuard Database Schema
-- Migration: 008_allow_general_conversations.sql
-- Purpose: Allow user-initiated conversations without a specific license

-- ============================================================================
-- Make license_id optional for general inquiry conversations
-- ============================================================================

ALTER TABLE sms_conversations 
    ALTER COLUMN license_id DROP NOT NULL;

-- ============================================================================
-- Update status constraint to include 'general_inquiry'
-- ============================================================================

-- Drop existing constraint
ALTER TABLE sms_conversations 
    DROP CONSTRAINT IF EXISTS sms_conversations_status_check;

-- Add updated constraint with general_inquiry status
ALTER TABLE sms_conversations 
    ADD CONSTRAINT sms_conversations_status_check CHECK (
        status IN (
            'general_inquiry',       -- Open AI conversation, no specific license
            'awaiting_photo',        -- Initial state: waiting for employee to send photo
            'processing',            -- Photo received, AI is extracting data
            'awaiting_confirmation', -- Data extracted, waiting for YES/NO
            'confirmed',             -- Employee confirmed, syncing to WinTeam
            'completed',             -- Successfully synced to WinTeam
            'rejected',              -- Employee said NO, waiting for new photo
            'expired',               -- No response within timeout period
            'failed'                 -- Sync to WinTeam failed
        )
    );

-- ============================================================================
-- Add index for phone number lookups on employees
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_employees_phone1 ON employees_cache(phone1);
