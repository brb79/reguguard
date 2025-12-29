-- State Requirements Monitoring
-- Migration: 004_state_requirements_monitoring.sql

-- Table to track state requirements monitoring history
CREATE TABLE state_requirements_monitoring (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state_code TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'no_changes', 'changes_detected')),
    monitoring_type TEXT NOT NULL CHECK (monitoring_type IN ('scheduled', 'manual', 'initial')),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    sources_checked JSONB DEFAULT '[]', -- Array of URLs checked
    changes_detected JSONB, -- Detected changes
    impact_report_id UUID, -- Reference to impact report if changes detected
    metadata_snapshot JSONB, -- Snapshot of metadata before update
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table to track detected changes in state requirements
CREATE TABLE state_requirements_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    monitoring_id UUID NOT NULL REFERENCES state_requirements_monitoring(id) ON DELETE CASCADE,
    state_code TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('breaking', 'non_breaking', 'addition', 'removal', 'update')),
    field_path TEXT NOT NULL, -- JSON path to changed field (e.g., "license_types[0].renewal_period_months")
    old_value JSONB,
    new_value JSONB,
    description TEXT,
    severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table to store compliance impact reports
CREATE TABLE compliance_impact_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state_code TEXT NOT NULL,
    monitoring_id UUID NOT NULL REFERENCES state_requirements_monitoring(id) ON DELETE CASCADE,
    report_type TEXT NOT NULL CHECK (report_type IN ('change_summary', 'breaking_changes', 'full_analysis')),
    summary TEXT NOT NULL,
    breaking_changes JSONB DEFAULT '[]',
    non_breaking_changes JSONB DEFAULT '[]',
    affected_license_types TEXT[],
    estimated_impact TEXT, -- Human-readable impact description
    recommendations JSONB DEFAULT '[]',
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_monitoring_state ON state_requirements_monitoring(state_code);
CREATE INDEX idx_monitoring_status ON state_requirements_monitoring(status);
CREATE INDEX idx_monitoring_completed ON state_requirements_monitoring(completed_at);
CREATE INDEX idx_changes_monitoring ON state_requirements_changes(monitoring_id);
CREATE INDEX idx_changes_state ON state_requirements_changes(state_code);
CREATE INDEX idx_changes_type ON state_requirements_changes(change_type);
CREATE INDEX idx_changes_severity ON state_requirements_changes(severity);
CREATE INDEX idx_reports_state ON compliance_impact_reports(state_code);
CREATE INDEX idx_reports_monitoring ON compliance_impact_reports(monitoring_id);

-- Row Level Security
ALTER TABLE state_requirements_monitoring ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_requirements_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_impact_reports ENABLE ROW LEVEL SECURITY;

-- Policies (allow all for now - adjust based on your auth requirements)
CREATE POLICY "Allow all operations on monitoring" ON state_requirements_monitoring
    FOR ALL USING (true);

CREATE POLICY "Allow all operations on changes" ON state_requirements_changes
    FOR ALL USING (true);

CREATE POLICY "Allow all operations on reports" ON compliance_impact_reports
    FOR ALL USING (true);

