-- ReguGuard Database Schema
-- Migration: 006_compliance_validation.sql
-- Purpose: Add tables for compliance validation results

-- Compliance validation results table
CREATE TABLE compliance_validations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    license_id UUID NOT NULL REFERENCES licenses_cache(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees_cache(id) ON DELETE CASCADE,
    
    -- Validation results
    is_valid BOOLEAN NOT NULL,
    validation_score FLOAT NOT NULL CHECK (validation_score >= 0 AND validation_score <= 1),
    state_code TEXT,
    license_type TEXT,
    
    -- Issues and findings (stored as JSONB for flexibility)
    issues JSONB DEFAULT '[]'::jsonb,
    warnings JSONB DEFAULT '[]'::jsonb,
    suggestions JSONB DEFAULT '[]'::jsonb,
    prerequisites JSONB DEFAULT '[]'::jsonb,
    anomalies JSONB DEFAULT '[]'::jsonb,
    
    -- Metadata
    validated_at TIMESTAMPTZ DEFAULT NOW(),
    validation_method TEXT DEFAULT 'automated', -- 'automated', 'manual', 'ai_assisted'
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Compliance reports table (aggregated reports for employees)
CREATE TABLE compliance_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees_cache(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Report metrics
    overall_score FLOAT NOT NULL CHECK (overall_score >= 0 AND overall_score <= 1),
    critical_issues_count INTEGER DEFAULT 0,
    warnings_count INTEGER DEFAULT 0,
    suggestions_count INTEGER DEFAULT 0,
    
    -- Report data
    report_data JSONB NOT NULL, -- Full compliance report JSON
    
    -- Metadata
    report_type TEXT DEFAULT 'full', -- 'full', 'summary', 'issue_only'
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_compliance_validations_license ON compliance_validations(license_id);
CREATE INDEX idx_compliance_validations_employee ON compliance_validations(employee_id);
CREATE INDEX idx_compliance_validations_valid ON compliance_validations(is_valid) WHERE is_valid = FALSE;
CREATE INDEX idx_compliance_validations_score ON compliance_validations(validation_score) WHERE validation_score < 0.7;
CREATE INDEX idx_compliance_validations_validated_at ON compliance_validations(validated_at DESC);

CREATE INDEX idx_compliance_reports_employee ON compliance_reports(employee_id);
CREATE INDEX idx_compliance_reports_client ON compliance_reports(client_id);
CREATE INDEX idx_compliance_reports_score ON compliance_reports(overall_score) WHERE overall_score < 0.7;
CREATE INDEX idx_compliance_reports_generated_at ON compliance_reports(generated_at DESC);

-- Row Level Security
ALTER TABLE compliance_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON compliance_validations
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all for authenticated users" ON compliance_reports
    FOR ALL USING (auth.role() = 'authenticated');

-- Comments for documentation
COMMENT ON TABLE compliance_validations IS 'Stores compliance validation results for individual licenses';
COMMENT ON TABLE compliance_reports IS 'Stores aggregated compliance reports for employees';
COMMENT ON COLUMN compliance_validations.validation_score IS 'Overall compliance score (0.0-1.0)';
COMMENT ON COLUMN compliance_validations.issues IS 'Array of compliance issues found';
COMMENT ON COLUMN compliance_validations.anomalies IS 'Array of anomalies detected';

