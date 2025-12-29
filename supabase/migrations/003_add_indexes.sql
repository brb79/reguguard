-- ReguGuard Database Schema
-- Migration: 003_add_indexes.sql
-- Purpose: Add missing indexes for common query patterns to improve performance

-- ============================================================================
-- Composite Indexes for Common Queries
-- ============================================================================

-- Alerts: Frequently queried by client_id, status, and created_at
CREATE INDEX IF NOT EXISTS idx_alerts_client_status_created 
ON alerts(client_id, status, created_at DESC);

-- Alerts: Query by license_id and alert_type (for duplicate prevention)
CREATE INDEX IF NOT EXISTS idx_alerts_license_type 
ON alerts(license_id, alert_type);

-- SMS Conversations: Active conversations by phone and status
CREATE INDEX IF NOT EXISTS idx_sms_conversations_phone_status 
ON sms_conversations(phone_number, status) 
WHERE status IN ('awaiting_photo', 'awaiting_confirmation', 'processing', 'rejected');

-- SMS Conversations: Expiring conversations
CREATE INDEX IF NOT EXISTS idx_sms_conversations_expires_status 
ON sms_conversations(expires_at, status) 
WHERE status IN ('awaiting_photo', 'awaiting_confirmation', 'rejected');

-- Licenses: Expiration queries with employee relationship
CREATE INDEX IF NOT EXISTS idx_licenses_expiration_employee 
ON licenses_cache(expiration_date, employee_id) 
WHERE expiration_date IS NOT NULL;

-- Licenses: Query by employee and compliance ID (for upserts)
CREATE INDEX IF NOT EXISTS idx_licenses_employee_compliance 
ON licenses_cache(employee_id, winteam_compliance_id);

-- Employees: Query by client and employee number
CREATE INDEX IF NOT EXISTS idx_employees_client_number 
ON employees_cache(client_id, winteam_employee_number);

-- Employees: Active employees by client
CREATE INDEX IF NOT EXISTS idx_employees_client_status 
ON employees_cache(client_id, status) 
WHERE status = 'Active';

-- Pending Renewals: Unconfirmed renewals
CREATE INDEX IF NOT EXISTS idx_pending_renewals_unconfirmed 
ON pending_renewals(confirmed, created_at DESC) 
WHERE confirmed = FALSE;

-- Pending Renewals: Confirmed but not synced
CREATE INDEX IF NOT EXISTS idx_pending_renewals_unsynced 
ON pending_renewals(confirmed, synced_to_winteam, created_at DESC) 
WHERE confirmed = TRUE AND synced_to_winteam = FALSE;

-- Sync Jobs: Recent jobs by client
CREATE INDEX IF NOT EXISTS idx_sync_jobs_client_created 
ON sync_jobs(client_id, started_at DESC);

-- SMS Message Log: Query by conversation and timestamp
CREATE INDEX IF NOT EXISTS idx_sms_message_log_conversation_created 
ON sms_message_log(conversation_id, created_at DESC) 
WHERE conversation_id IS NOT NULL;

-- ============================================================================
-- Partial Indexes for Performance
-- ============================================================================

-- Only index active alerts
CREATE INDEX IF NOT EXISTS idx_alerts_pending 
ON alerts(client_id, created_at DESC) 
WHERE status = 'pending';

-- Only index active conversations
CREATE INDEX IF NOT EXISTS idx_sms_conversations_active 
ON sms_conversations(client_id, created_at DESC) 
WHERE status NOT IN ('completed', 'expired', 'failed');

-- ============================================================================
-- Analyze Tables for Query Planner
-- ============================================================================

ANALYZE alerts;
ANALYZE sms_conversations;
ANALYZE licenses_cache;
ANALYZE employees_cache;
ANALYZE pending_renewals;
ANALYZE sync_jobs;
ANALYZE sms_message_log;

