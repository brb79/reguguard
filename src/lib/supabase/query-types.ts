/**
 * Type-Safe Supabase Query Helpers
 * 
 * Provides type-safe utilities for Supabase queries with relationships.
 * Eliminates the need for type assertions.
 */

import { Database } from './types';

// Base table types
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TableInserts<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TableUpdates<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];

// ============================================================================
// Query Result Types with Relationships
// ============================================================================

/**
 * License with employee relationship
 */
export type LicenseWithEmployee = Tables<'licenses_cache'> & {
    employee: Tables<'employees_cache'>;
};

/**
 * License with employee and client
 */
export type LicenseWithEmployeeAndClient = LicenseWithEmployee & {
    employee: Tables<'employees_cache'> & {
        client: Tables<'clients'>;
    };
};

/**
 * Alert with license and employee
 */
export type AlertWithLicense = Tables<'alerts'> & {
    license: Tables<'licenses_cache'> & {
        employee: Tables<'employees_cache'>;
    };
};

/**
 * Pending renewal with conversation and related data
 */
export type PendingRenewalWithConversation = Tables<'pending_renewals'> & {
    sms_conversations: Tables<'sms_conversations'> & {
        employees_cache: Tables<'employees_cache'>;
        licenses_cache: Tables<'licenses_cache'>;
        clients: Tables<'clients'>;
    };
};

/**
 * SMS conversation with employee and license
 */
export type ConversationWithRelations = Tables<'sms_conversations'> & {
    employees_cache: Tables<'employees_cache'>;
    licenses_cache: Tables<'licenses_cache'>;
};

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if employee relationship is a single object
 */
export function isSingleEmployee(
    employee: Tables<'employees_cache'> | Tables<'employees_cache'>[]
): employee is Tables<'employees_cache'> {
    return !Array.isArray(employee);
}

/**
 * Type guard to check if license relationship is a single object
 */
export function isSingleLicense(
    license: Tables<'licenses_cache'> | Tables<'licenses_cache'>[]
): license is Tables<'licenses_cache'> {
    return !Array.isArray(license);
}

/**
 * Type guard for alert config
 */
export function isAlertConfig(config: unknown): config is { thresholds: number[] } {
    return (
        typeof config === 'object' &&
        config !== null &&
        'thresholds' in config &&
        Array.isArray((config as { thresholds: unknown }).thresholds)
    );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely extract single relationship from Supabase query result
 */
export function extractSingle<T>(value: T | T[]): T | null {
    if (Array.isArray(value)) {
        return value[0] || null;
    }
    return value;
}

/**
 * Safely extract array relationship from Supabase query result
 */
export function extractArray<T>(value: T | T[]): T[] {
    if (Array.isArray(value)) {
        return value;
    }
    return value ? [value] : [];
}

