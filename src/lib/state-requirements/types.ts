/**
 * State Requirements Monitoring Types
 * 
 * Types for automated state requirements research and monitoring
 */

export interface StateMetadata {
    state_code: string;
    state_name: string;
    regulatory_body: {
        name: string;
        abbreviation?: string;
        website: string;
        licensing_portal?: string;
    };
    effective_date?: string;
    last_verified?: string;
    license_types: LicenseType[];
    training_topics?: {
        entry_level?: string[];
        firearms?: string[];
        in_service?: string[];
    };
    background_check?: {
        state_check_required?: boolean;
        fbi_check_required?: boolean;
        fingerprinting_required?: boolean;
        disqualifying_offenses?: string[];
    };
    reciprocity?: {
        accepts_from?: string[];
        notes?: string;
    };
    contact?: {
        phone?: string;
        email?: string;
        address?: string;
    };
    sources?: Array<{
        title: string;
        url: string;
        accessed_date: string;
    }>;
}

export interface LicenseType {
    type: string;
    display_name: string;
    renewal_period_months: number;
    initial_training_hours: number;
    renewal_training_hours: number;
    compliance_item_descriptions: string[];
    requirements: {
        initial: string[];
        renewal: string[];
    };
    fees?: {
        application?: number;
        renewal?: number;
        currency?: string;
    };
}

export interface MonitoringResult {
    success: boolean;
    state_code: string;
    status: 'running' | 'completed' | 'failed' | 'no_changes' | 'changes_detected';
    sources_checked: string[];
    changes_detected?: DetectedChange[];
    error?: string;
    metadata_snapshot?: StateMetadata;
}

export interface DetectedChange {
    change_type: 'breaking' | 'non_breaking' | 'addition' | 'removal' | 'update';
    field_path: string;
    old_value: unknown;
    new_value: unknown;
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface ComplianceImpactReport {
    state_code: string;
    summary: string;
    breaking_changes: DetectedChange[];
    non_breaking_changes: DetectedChange[];
    affected_license_types: string[];
    estimated_impact: string;
    recommendations: string[];
}

export interface WebScrapingResult {
    url: string;
    success: boolean;
    content: string;
    extracted_data?: unknown;
    error?: string;
}

export interface AIExtractionRequest {
    state_code: string;
    website_content: string;
    existing_metadata?: StateMetadata;
    sources: string[];
}

export interface AIExtractionResult {
    success: boolean;
    extracted_metadata?: StateMetadata;
    confidence: number;
    raw_response?: unknown;
    error?: string;
}

