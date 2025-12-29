-- ReguGuard Database Schema
-- Migration: 002_sms_conversations.sql
-- Purpose: Add tables for two-way SMS conversations and license renewal processing

-- ============================================================================
-- SMS Conversations Table
-- ============================================================================
-- Tracks the state of SMS conversations with employees for license renewals

CREATE TABLE sms_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees_cache(id) ON DELETE CASCADE,
    license_id UUID NOT NULL REFERENCES licenses_cache(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    
    -- Conversation state machine
    status TEXT NOT NULL DEFAULT 'awaiting_photo' CHECK (
        status IN (
            'awaiting_photo',       -- Initial state: waiting for employee to send photo
            'processing',           -- Photo received, AI is extracting data
            'awaiting_confirmation', -- Data extracted, waiting for YES/NO
            'confirmed',            -- Employee confirmed, syncing to WinTeam
            'completed',            -- Successfully synced to WinTeam
            'rejected',             -- Employee said NO, waiting for new photo
            'expired',              -- No response within timeout period
            'failed'                -- Sync to WinTeam failed
        )
    ),
    
    -- Tracking
    message_count INTEGER DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    alert_id UUID REFERENCES alerts(id), -- Link to the alert that started this conversation
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

-- ============================================================================
-- Pending Renewals Table
-- ============================================================================
-- Stores extracted license data pending employee confirmation

CREATE TABLE pending_renewals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES sms_conversations(id) ON DELETE CASCADE,
    
    -- Image data
    image_url TEXT NOT NULL,
    image_media_type TEXT, -- e.g., 'image/jpeg', 'image/png'
    
    -- Extracted data from AI vision
    extracted_expiration_date DATE,
    extracted_license_number TEXT,
    extracted_license_type TEXT,      -- 'armed', 'unarmed', etc.
    extracted_state TEXT,             -- 'VA', 'MD', etc.
    extracted_holder_name TEXT,
    extraction_confidence FLOAT,      -- 0-1 confidence score
    raw_extraction_response JSONB,    -- Full AI response for debugging
    
    -- Confirmation status
    confirmed BOOLEAN DEFAULT FALSE,
    confirmed_at TIMESTAMPTZ,
    
    -- WinTeam sync status
    synced_to_winteam BOOLEAN DEFAULT FALSE,
    synced_at TIMESTAMPTZ,
    sync_error TEXT,
    winteam_response JSONB,
    
    -- Supervisor approval (optional workflow)
    requires_supervisor_approval BOOLEAN DEFAULT FALSE,
    supervisor_approved BOOLEAN,
    supervisor_approved_at TIMESTAMPTZ,
    supervisor_id UUID,
    supervisor_notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SMS Message Log Table
-- ============================================================================
-- Audit trail of all SMS messages sent and received

CREATE TABLE sms_message_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES sms_conversations(id) ON DELETE SET NULL,
    
    -- Message details
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    body TEXT,
    media_urls TEXT[], -- Array of MMS media URLs
    
    -- Twilio metadata
    twilio_message_sid TEXT,
    twilio_status TEXT, -- 'queued', 'sent', 'delivered', 'failed', etc.
    twilio_error_code TEXT,
    twilio_error_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Conversation lookups
CREATE INDEX idx_sms_conversations_phone ON sms_conversations(phone_number);
CREATE INDEX idx_sms_conversations_status ON sms_conversations(status);
CREATE INDEX idx_sms_conversations_employee ON sms_conversations(employee_id);
CREATE INDEX idx_sms_conversations_expires ON sms_conversations(expires_at) 
    WHERE status IN ('awaiting_photo', 'awaiting_confirmation', 'rejected');

-- Pending renewals lookups
CREATE INDEX idx_pending_renewals_conversation ON pending_renewals(conversation_id);
CREATE INDEX idx_pending_renewals_unconfirmed ON pending_renewals(confirmed) 
    WHERE confirmed = FALSE;
CREATE INDEX idx_pending_renewals_unsynced ON pending_renewals(synced_to_winteam) 
    WHERE synced_to_winteam = FALSE AND confirmed = TRUE;

-- Message log lookups
CREATE INDEX idx_sms_message_log_conversation ON sms_message_log(conversation_id);
CREATE INDEX idx_sms_message_log_twilio_sid ON sms_message_log(twilio_message_sid);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE sms_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_message_log ENABLE ROW LEVEL SECURITY;

-- Policies (matching existing pattern - all for authenticated users)
CREATE POLICY "Allow all for authenticated users" ON sms_conversations
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all for authenticated users" ON pending_renewals
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all for authenticated users" ON sms_message_log
    FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================================
-- Triggers
-- ============================================================================

-- Auto-update updated_at on sms_conversations
CREATE TRIGGER update_sms_conversations_updated_at
    BEFORE UPDATE ON sms_conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Views
-- ============================================================================

-- Helpful view for dashboard: pending renewals with employee info
CREATE OR REPLACE VIEW pending_renewals_dashboard AS
SELECT 
    pr.id AS renewal_id,
    pr.image_url,
    pr.extracted_expiration_date,
    pr.extracted_license_number,
    pr.extraction_confidence,
    pr.confirmed,
    pr.synced_to_winteam,
    pr.requires_supervisor_approval,
    pr.supervisor_approved,
    pr.created_at AS renewal_created_at,
    sc.id AS conversation_id,
    sc.status AS conversation_status,
    sc.phone_number,
    sc.expires_at,
    e.id AS employee_id,
    e.first_name,
    e.last_name,
    e.winteam_employee_number,
    l.id AS license_id,
    l.description AS license_description,
    l.expiration_date AS current_expiration_date,
    l.winteam_compliance_id,
    c.id AS client_id,
    c.name AS client_name
FROM pending_renewals pr
JOIN sms_conversations sc ON pr.conversation_id = sc.id
JOIN employees_cache e ON sc.employee_id = e.id
JOIN licenses_cache l ON sc.license_id = l.id
JOIN clients c ON sc.client_id = c.id;

-- View for active conversations needing attention
CREATE OR REPLACE VIEW active_conversations AS
SELECT 
    sc.*,
    e.first_name,
    e.last_name,
    e.winteam_employee_number,
    l.description AS license_description,
    l.expiration_date,
    c.name AS client_name
FROM sms_conversations sc
JOIN employees_cache e ON sc.employee_id = e.id
JOIN licenses_cache l ON sc.license_id = l.id
JOIN clients c ON sc.client_id = c.id
WHERE sc.status NOT IN ('completed', 'expired', 'failed');
