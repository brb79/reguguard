-- ============================================================================
-- Migration: Renewal Sessions for Autonomous Renewal Agent
-- Description: Tables and functions for managing multi-day license renewal workflows
-- ============================================================================

-- ============================================================================
-- renewal_sessions table - Core state persistence for renewal workflows
-- ============================================================================

CREATE TABLE IF NOT EXISTS renewal_sessions (
    -- Identity
    session_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    employee_id TEXT NOT NULL,
    license_id TEXT,

    -- Workflow state
    status TEXT NOT NULL DEFAULT 'active',
    current_step TEXT,

    -- CRITICAL: Full conversation history with all AI tool calls and responses
    -- This enables the agent to resume with complete context after days/weeks
    conversation_history JSONB NOT NULL DEFAULT '[]'::JSONB,

    -- Workflow tracking
    completed_steps TEXT[] DEFAULT ARRAY[]::TEXT[],
    pending_actions TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- Additional context and data
    metadata JSONB DEFAULT '{}'::JSONB,

    -- Portal submission tracking
    submission_package JSONB,
    confirmation_number TEXT,
    submitted_at TIMESTAMPTZ,
    submitted_by TEXT, -- 'employee_self_service', 'supervisor', 'agent_automation'

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- Optional expiration for cleanup

    -- Constraints
    CONSTRAINT valid_status CHECK (status IN (
        'active',
        'awaiting_photo',
        'photo_uploaded',
        'photo_validated',
        'awaiting_training',
        'training_uploaded',
        'training_validated',
        'ready_for_portal_submission',
        'awaiting_portal_submission',
        'portal_submitted',
        'awaiting_approval',
        'completed',
        'failed',
        'cancelled',
        'escalated'
    ))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_renewal_sessions_employee_id ON renewal_sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_renewal_sessions_status ON renewal_sessions(status);
CREATE INDEX IF NOT EXISTS idx_renewal_sessions_created_at ON renewal_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_renewal_sessions_updated_at ON renewal_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_renewal_sessions_active ON renewal_sessions(employee_id, status) WHERE status NOT IN ('completed', 'failed', 'cancelled');

-- GIN index for searching conversation history
CREATE INDEX IF NOT EXISTS idx_renewal_sessions_conversation_history ON renewal_sessions USING GIN (conversation_history);

-- ============================================================================
-- renewal_events table - Event log for workflow events and resumption triggers
-- ============================================================================

CREATE TABLE IF NOT EXISTS renewal_events (
    event_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    session_id TEXT NOT NULL REFERENCES renewal_sessions(session_id) ON DELETE CASCADE,

    -- Event details
    event_type TEXT NOT NULL,
    event_data JSONB DEFAULT '{}'::JSONB,

    -- Who/what triggered this event
    triggered_by TEXT, -- 'employee', 'agent', 'cron', 'supervisor', 'system'

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT valid_event_type CHECK (event_type IN (
        'photo_uploaded',
        'certificate_uploaded',
        'employee_message',
        'timeout_reminder',
        'supervisor_intervention',
        'portal_submitted',
        'verify_approval_status',
        'workflow_started',
        'workflow_completed',
        'workflow_failed',
        'workflow_cancelled',
        'step_completed',
        'agent_action'
    ))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_renewal_events_session_id ON renewal_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_renewal_events_type ON renewal_events(event_type);
CREATE INDEX IF NOT EXISTS idx_renewal_events_unprocessed ON renewal_events(session_id, processed_at) WHERE processed_at IS NULL;

-- ============================================================================
-- renewal_documents table - Track uploaded documents for renewals
-- ============================================================================

CREATE TABLE IF NOT EXISTS renewal_documents (
    document_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    session_id TEXT NOT NULL REFERENCES renewal_sessions(session_id) ON DELETE CASCADE,

    -- Document details
    document_type TEXT NOT NULL, -- 'photo', 'training_certificate', 'other'
    file_url TEXT NOT NULL,
    file_name TEXT,
    file_size_bytes INTEGER,
    mime_type TEXT,

    -- Validation status
    validated BOOLEAN DEFAULT FALSE,
    validation_result JSONB,
    validated_at TIMESTAMPTZ,

    -- AI extraction results (for photos/certificates)
    extracted_data JSONB,

    -- Timestamps
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    uploaded_by TEXT, -- employee_id or 'supervisor'

    CONSTRAINT valid_document_type CHECK (document_type IN (
        'license_photo',
        'training_certificate',
        'firearms_qualification',
        'cpr_certification',
        'background_check',
        'other'
    ))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_renewal_documents_session_id ON renewal_documents(session_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_renewal_documents_type ON renewal_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_renewal_documents_validated ON renewal_documents(validated, validated_at);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_renewal_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_renewal_session_updated_at ON renewal_sessions;
CREATE TRIGGER trigger_update_renewal_session_updated_at
    BEFORE UPDATE ON renewal_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_renewal_session_updated_at();

-- Function to get active sessions for an employee
CREATE OR REPLACE FUNCTION get_active_renewal_sessions(p_employee_id TEXT)
RETURNS TABLE (
    session_id TEXT,
    license_id TEXT,
    status TEXT,
    current_step TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        rs.session_id,
        rs.license_id,
        rs.status,
        rs.current_step,
        rs.created_at,
        rs.updated_at
    FROM renewal_sessions rs
    WHERE rs.employee_id = p_employee_id
      AND rs.status NOT IN ('completed', 'failed', 'cancelled')
    ORDER BY rs.updated_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to get stale sessions (for timeout reminders)
CREATE OR REPLACE FUNCTION get_stale_renewal_sessions(
    p_status TEXT,
    p_hours_threshold INTEGER DEFAULT 72
)
RETURNS TABLE (
    session_id TEXT,
    employee_id TEXT,
    license_id TEXT,
    status TEXT,
    hours_since_update NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        rs.session_id,
        rs.employee_id,
        rs.license_id,
        rs.status,
        EXTRACT(EPOCH FROM (NOW() - rs.updated_at)) / 3600 AS hours_since_update
    FROM renewal_sessions rs
    WHERE rs.status = p_status
      AND rs.updated_at < NOW() - (p_hours_threshold || ' hours')::INTERVAL
    ORDER BY rs.updated_at ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS
ALTER TABLE renewal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_documents ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access
CREATE POLICY "Service role has full access to renewal_sessions"
    ON renewal_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to renewal_events"
    ON renewal_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role has full access to renewal_documents"
    ON renewal_documents
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE renewal_sessions IS 'Multi-day license renewal workflow sessions with full conversation history for agent state persistence';
COMMENT ON COLUMN renewal_sessions.conversation_history IS 'CRITICAL: Complete AI conversation history including all tool calls and responses. Enables agent to resume workflows after days/weeks with full context.';
COMMENT ON COLUMN renewal_sessions.submission_package IS 'Portal submission package with instructions, pre-filled data, and document links';

COMMENT ON TABLE renewal_events IS 'Event log for renewal workflow triggers (uploads, messages, timeouts, etc.)';
COMMENT ON TABLE renewal_documents IS 'Uploaded documents for license renewals with validation status';
