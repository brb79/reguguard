-- ReguGuard Database Schema
-- Migration: 001_initial_schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Clients table (your consulting clients who use WinTeam)
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    winteam_tenant_id TEXT NOT NULL UNIQUE,
    location_ids INTEGER[] DEFAULT '{}',
    alert_config JSONB DEFAULT '{"thresholds": [30, 14, 7], "escalationEmails": [], "reminderFrequency": "daily"}',
    sms_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Employees cache (synced from WinTeam)
CREATE TABLE employees_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    winteam_employee_number INTEGER NOT NULL,
    winteam_employee_id TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone1 TEXT,
    email TEXT,
    status TEXT DEFAULT 'Active',
    location_id INTEGER,
    last_synced TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, winteam_employee_number)
);

-- Licenses/Compliance items cache (synced from WinTeam)
CREATE TABLE licenses_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees_cache(id) ON DELETE CASCADE,
    winteam_compliance_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    license_number TEXT,
    expiration_date DATE,
    license_stage TEXT, -- 'Active', 'Expired'
    status TEXT, -- 'Issued', 'Pending', 'Revoked'
    frequency TEXT, -- 'Annually', etc.
    last_synced TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, winteam_compliance_id)
);

-- Computed column for days until expiration (as a view for convenience)
CREATE OR REPLACE VIEW licenses_with_expiry AS
SELECT 
    l.*,
    e.first_name,
    e.last_name,
    e.phone1,
    e.client_id,
    CASE 
        WHEN l.expiration_date IS NULL THEN NULL
        ELSE l.expiration_date - CURRENT_DATE
    END AS days_until_expiration
FROM licenses_cache l
JOIN employees_cache e ON l.employee_id = e.id;

-- Alerts table
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    license_id UUID NOT NULL REFERENCES licenses_cache(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees_cache(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('expiring_30d', 'expiring_14d', 'expiring_7d', 'expired')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'acknowledged', 'failed')),
    message TEXT,
    sent_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    delivery_status TEXT, -- Twilio delivery status
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync jobs table
CREATE TABLE sync_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    employees_synced INTEGER DEFAULT 0,
    licenses_synced INTEGER DEFAULT 0,
    errors JSONB,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX idx_employees_client ON employees_cache(client_id);
CREATE INDEX idx_employees_number ON employees_cache(winteam_employee_number);
CREATE INDEX idx_licenses_employee ON licenses_cache(employee_id);
CREATE INDEX idx_licenses_expiration ON licenses_cache(expiration_date);
CREATE INDEX idx_alerts_client ON alerts(client_id);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_sync_jobs_client ON sync_jobs(client_id);

-- Row Level Security (RLS)
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies (assuming auth.uid() corresponds to client management)
-- For now, allow authenticated users to see all data (can be refined later)
CREATE POLICY "Allow all for authenticated users" ON clients
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all for authenticated users" ON employees_cache
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all for authenticated users" ON licenses_cache
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all for authenticated users" ON alerts
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all for authenticated users" ON sync_jobs
    FOR ALL USING (auth.role() = 'authenticated');

-- Trigger for updated_at on clients
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
