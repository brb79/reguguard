// Database Types for Supabase

// Conversation status enum type
export type ConversationStatus =
    | 'awaiting_photo'
    | 'processing'
    | 'awaiting_confirmation'
    | 'confirmed'
    | 'completed'
    | 'rejected'
    | 'expired'
    | 'failed'

export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            clients: {
                Row: {
                    id: string
                    name: string
                    winteam_tenant_id: string
                    location_ids: number[]
                    alert_config: Json
                    sms_enabled: boolean
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    winteam_tenant_id: string
                    location_ids?: number[]
                    alert_config?: Json
                    sms_enabled?: boolean
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    winteam_tenant_id?: string
                    location_ids?: number[]
                    alert_config?: Json
                    sms_enabled?: boolean
                    updated_at?: string
                }
            }
            employees_cache: {
                Row: {
                    id: string
                    client_id: string
                    winteam_employee_number: number
                    winteam_employee_id: string | null
                    first_name: string
                    last_name: string
                    phone1: string | null
                    email: string | null
                    status: string
                    location_id: number | null
                    last_synced: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    client_id: string
                    winteam_employee_number: number
                    winteam_employee_id?: string | null
                    first_name: string
                    last_name: string
                    phone1?: string | null
                    email?: string | null
                    status?: string
                    location_id?: number | null
                    last_synced?: string
                    created_at?: string
                }
                Update: {
                    client_id?: string
                    winteam_employee_number?: number
                    winteam_employee_id?: string | null
                    first_name?: string
                    last_name?: string
                    phone1?: string | null
                    email?: string | null
                    status?: string
                    location_id?: number | null
                    last_synced?: string
                }
            }
            licenses_cache: {
                Row: {
                    id: string
                    employee_id: string
                    winteam_compliance_id: number
                    description: string
                    license_number: string | null
                    expiration_date: string | null
                    license_stage: string | null
                    status: string | null
                    frequency: string | null
                    last_synced: string
                    created_at: string
                    matched_state: string | null
                    matched_license_type: string | null
                    matched_display_name: string | null
                    matching_confidence: number | null
                    matching_reasoning: string | null
                    matched_at: string | null
                }
                Insert: {
                    id?: string
                    employee_id: string
                    winteam_compliance_id: number
                    description: string
                    license_number?: string | null
                    expiration_date?: string | null
                    license_stage?: string | null
                    status?: string | null
                    frequency?: string | null
                    last_synced?: string
                    created_at?: string
                    matched_state?: string | null
                    matched_license_type?: string | null
                    matched_display_name?: string | null
                    matching_confidence?: number | null
                    matching_reasoning?: string | null
                    matched_at?: string | null
                }
                Update: {
                    employee_id?: string
                    winteam_compliance_id?: number
                    description?: string
                    license_number?: string | null
                    expiration_date?: string | null
                    license_stage?: string | null
                    status?: string | null
                    frequency?: string | null
                    last_synced?: string
                    matched_state?: string | null
                    matched_license_type?: string | null
                    matched_display_name?: string | null
                    matching_confidence?: number | null
                    matching_reasoning?: string | null
                    matched_at?: string | null
                }
            }
            alerts: {
                Row: {
                    id: string
                    license_id: string
                    employee_id: string
                    client_id: string
                    alert_type: string
                    status: string
                    message: string | null
                    sent_at: string | null
                    acknowledged_at: string | null
                    delivery_status: string | null
                    personalization_metadata: Json | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    license_id: string
                    employee_id: string
                    client_id: string
                    alert_type: string
                    status?: string
                    message?: string | null
                    sent_at?: string | null
                    acknowledged_at?: string | null
                    delivery_status?: string | null
                    personalization_metadata?: Json | null
                    created_at?: string
                }
                Update: {
                    license_id?: string
                    employee_id?: string
                    client_id?: string
                    alert_type?: string
                    status?: string
                    message?: string | null
                    sent_at?: string | null
                    acknowledged_at?: string | null
                    delivery_status?: string | null
                    personalization_metadata?: Json | null
                }
            }
            sync_jobs: {
                Row: {
                    id: string
                    client_id: string
                    status: string
                    employees_synced: number
                    licenses_synced: number
                    errors: Json | null
                    started_at: string
                    completed_at: string | null
                }
                Insert: {
                    id?: string
                    client_id: string
                    status?: string
                    employees_synced?: number
                    licenses_synced?: number
                    errors?: Json | null
                    started_at?: string
                    completed_at?: string | null
                }
                Update: {
                    status?: string
                    employees_synced?: number
                    licenses_synced?: number
                    errors?: Json | null
                    completed_at?: string | null
                }
            }
            sms_conversations: {
                Row: {
                    id: string
                    client_id: string
                    employee_id: string
                    license_id: string
                    phone_number: string
                    status: ConversationStatus
                    message_count: number
                    last_message_at: string | null
                    alert_id: string | null
                    created_at: string
                    updated_at: string
                    expires_at: string
                }
                Insert: {
                    id?: string
                    client_id: string
                    employee_id: string
                    license_id: string
                    phone_number: string
                    status?: ConversationStatus
                    message_count?: number
                    last_message_at?: string | null
                    alert_id?: string | null
                    created_at?: string
                    updated_at?: string
                    expires_at?: string
                }
                Update: {
                    status?: ConversationStatus
                    message_count?: number
                    last_message_at?: string | null
                    updated_at?: string
                    expires_at?: string
                }
            }
            pending_renewals: {
                Row: {
                    id: string
                    conversation_id: string
                    image_url: string
                    image_media_type: string | null
                    extracted_expiration_date: string | null
                    extracted_license_number: string | null
                    extracted_license_type: string | null
                    extracted_state: string | null
                    extracted_holder_name: string | null
                    extraction_confidence: number | null
                    raw_extraction_response: Json | null
                    confirmed: boolean
                    confirmed_at: string | null
                    synced_to_winteam: boolean
                    synced_at: string | null
                    sync_error: string | null
                    winteam_response: Json | null
                    requires_supervisor_approval: boolean
                    supervisor_approved: boolean | null
                    supervisor_approved_at: string | null
                    supervisor_id: string | null
                    supervisor_notes: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    conversation_id: string
                    image_url: string
                    image_media_type?: string | null
                    extracted_expiration_date?: string | null
                    extracted_license_number?: string | null
                    extracted_license_type?: string | null
                    extracted_state?: string | null
                    extracted_holder_name?: string | null
                    extraction_confidence?: number | null
                    raw_extraction_response?: Json | null
                    confirmed?: boolean
                    confirmed_at?: string | null
                    synced_to_winteam?: boolean
                    synced_at?: string | null
                    sync_error?: string | null
                    winteam_response?: Json | null
                    requires_supervisor_approval?: boolean
                    supervisor_approved?: boolean | null
                    supervisor_approved_at?: string | null
                    supervisor_id?: string | null
                    supervisor_notes?: string | null
                    created_at?: string
                }
                Update: {
                    extracted_expiration_date?: string | null
                    extracted_license_number?: string | null
                    extracted_license_type?: string | null
                    extracted_state?: string | null
                    extracted_holder_name?: string | null
                    extraction_confidence?: number | null
                    raw_extraction_response?: Json | null
                    confirmed?: boolean
                    confirmed_at?: string | null
                    synced_to_winteam?: boolean
                    synced_at?: string | null
                    sync_error?: string | null
                    winteam_response?: Json | null
                    supervisor_approved?: boolean | null
                    supervisor_approved_at?: string | null
                    supervisor_id?: string | null
                    supervisor_notes?: string | null
                }
            }
            sms_message_log: {
                Row: {
                    id: string
                    conversation_id: string | null
                    direction: 'inbound' | 'outbound'
                    from_number: string
                    to_number: string
                    body: string | null
                    media_urls: string[] | null
                    twilio_message_sid: string | null
                    twilio_status: string | null
                    twilio_error_code: string | null
                    twilio_error_message: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    conversation_id?: string | null
                    direction: 'inbound' | 'outbound'
                    from_number: string
                    to_number: string
                    body?: string | null
                    media_urls?: string[] | null
                    twilio_message_sid?: string | null
                    twilio_status?: string | null
                    twilio_error_code?: string | null
                    twilio_error_message?: string | null
                    created_at?: string
                }
                Update: {
                    twilio_status?: string | null
                    twilio_error_code?: string | null
                    twilio_error_message?: string | null
                }
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            alert_type: 'expiring_30d' | 'expiring_14d' | 'expiring_7d' | 'expired'
            alert_status: 'pending' | 'sent' | 'acknowledged' | 'failed'
            sync_status: 'running' | 'completed' | 'failed'
            conversation_status: ConversationStatus
        }
    }
}

// Convenience type aliases
export type Client = Database['public']['Tables']['clients']['Row']
export type EmployeeCache = Database['public']['Tables']['employees_cache']['Row']
export type LicenseCache = Database['public']['Tables']['licenses_cache']['Row']
export type Alert = Database['public']['Tables']['alerts']['Row']
export type SyncJob = Database['public']['Tables']['sync_jobs']['Row']
export type SmsConversation = Database['public']['Tables']['sms_conversations']['Row']
export type PendingRenewal = Database['public']['Tables']['pending_renewals']['Row']
export type SmsMessageLog = Database['public']['Tables']['sms_message_log']['Row']

// Insert types
export type ClientInsert = Database['public']['Tables']['clients']['Insert']
export type EmployeeCacheInsert = Database['public']['Tables']['employees_cache']['Insert']
export type LicenseCacheInsert = Database['public']['Tables']['licenses_cache']['Insert']
export type AlertInsert = Database['public']['Tables']['alerts']['Insert']
export type SyncJobInsert = Database['public']['Tables']['sync_jobs']['Insert']
export type SmsConversationInsert = Database['public']['Tables']['sms_conversations']['Insert']
export type PendingRenewalInsert = Database['public']['Tables']['pending_renewals']['Insert']
export type SmsMessageLogInsert = Database['public']['Tables']['sms_message_log']['Insert']

// Update types
export type ClientUpdate = Database['public']['Tables']['clients']['Update']
export type EmployeeCacheUpdate = Database['public']['Tables']['employees_cache']['Update']
export type LicenseCacheUpdate = Database['public']['Tables']['licenses_cache']['Update']
export type AlertUpdate = Database['public']['Tables']['alerts']['Update']
export type SyncJobUpdate = Database['public']['Tables']['sync_jobs']['Update']
export type SmsConversationUpdate = Database['public']['Tables']['sms_conversations']['Update']
export type PendingRenewalUpdate = Database['public']['Tables']['pending_renewals']['Update']
export type SmsMessageLogUpdate = Database['public']['Tables']['sms_message_log']['Update']

// Alert configuration type
export interface AlertConfig {
    thresholds: number[]  // Days before expiration to alert (e.g., [30, 14, 7])
    escalationEmails: string[]
    reminderFrequency: 'daily' | 'weekly'
}
