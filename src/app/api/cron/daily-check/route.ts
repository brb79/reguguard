import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { Client, LicenseCache, AlertInsert } from '@/lib/supabase';
import { withErrorHandling } from '@/lib/errors';
import { requireAuth } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { isAlertConfig, extractSingle } from '@/lib/supabase/query-types';
import { complianceValidationService } from '@/lib/ai/compliance-validation-service';

// Type for license with employee relationship from query
type LicenseWithEmployeeQuery = LicenseCache & {
    employee: { client_id: string } | { client_id: string }[];
};

/**
 * Daily compliance check cron job
 * Configure in Vercel: cron: '0 8 * * *' (8 AM daily)
 * 
 * This endpoint:
 * 1. Identifies licenses expiring within alert thresholds
 * 2. Creates alert records for new expirations
 * 
 * Optimized to use batch queries and proper type safety
 */
export const GET = withErrorHandling(async () => {
    // Optional: Require API key for cron jobs (set REGUGUARD_API_KEY env var)
    const env = getEnv();
    const supabase = await createServerClient();

    // Types for queries
    type ClientQueryResult = {
        id: string;
        name: string;
        alert_config: unknown;
    };

    type LicenseQueryResult = {
        id: string;
        description: string;
        expiration_date: string | null;
        employee_id: string;
        license_number?: string | null;
        matched_state?: string | null;
        matched_license_type?: string | null;
        employee: { client_id: string } | { client_id: string }[];
    };

    type OtherLicenseResult = {
        id: string;
        description: string;
        expiration_date: string | null;
        matched_state: string | null;
        matched_license_type: string | null;
        license_stage: string | null;
    };

    // Get all active clients
    const { data: clients, error: clientsError } = await supabase
        .from('clients')
        .select('id, name, alert_config') as { data: ClientQueryResult[] | null; error: unknown };

    if (clientsError || !clients) {
        throw new Error(`Failed to fetch clients: ${String(clientsError)}`);
    }

    const results = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Process each client
    for (const client of clients) {
        // Type-safe alert config extraction
        const alertConfig = isAlertConfig(client.alert_config)
            ? client.alert_config
            : { thresholds: [30, 14, 7] };
        const thresholds = alertConfig.thresholds || [30, 14, 7];

        // Calculate date ranges for efficient querying
        const maxDays = Math.max(...thresholds, 30);
        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + maxDays);

        // Get licenses expiring within threshold window (optimized query)
        const { data: licenses, error: licensesError } = await supabase
            .from('licenses_cache')
            .select(`
                id,
                description,
                expiration_date,
                employee_id,
                license_number,
                matched_state,
                matched_license_type,
                employee:employees_cache!inner (
                    client_id
                )
            `)
            .eq('employee.client_id', client.id)
            .not('expiration_date', 'is', null)
            .lte('expiration_date', futureDate.toISOString().split('T')[0])
            .gte('expiration_date', today.toISOString().split('T')[0]) as { data: LicenseQueryResult[] | null; error: unknown };

        if (licensesError) {
            results.push({
                client_id: client.id,
                client_name: client.name,
                error: String(licensesError),
            });
            continue;
        }

        if (!licenses || licenses.length === 0) {
            results.push({
                client_id: client.id,
                client_name: client.name,
                licenses_checked: 0,
                alerts_created: 0,
            });
            continue;
        }

        // Get existing alerts in batch to avoid N+1 queries
        const licenseIds = licenses.map((l) => l.id);
        const { data: existingAlerts } = await supabase
            .from('alerts')
            .select('license_id, alert_type')
            .in('license_id', licenseIds)
            .in('status', ['pending', 'sent']) as { data: { license_id: string; alert_type: string }[] | null; error: unknown };

        const existingAlertKeys = new Set(
            (existingAlerts || []).map((a) => `${a.license_id}:${a.alert_type}`)
        );

        // Prepare batch insert for new alerts
        const newAlerts: AlertInsert[] = [];

        for (const license of licenses) {
            // Type-safe extraction of employee relationship
            const employee = extractSingle((license as LicenseWithEmployeeQuery).employee);

            if (!employee || !license.expiration_date) continue;

            const expirationDate = new Date(license.expiration_date);
            const daysRemaining = Math.floor(
                (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
            );

            // Determine alert type based on thresholds
            let alertType: string | null = null;

            if (daysRemaining < 0) {
                alertType = 'expired';
            } else if (daysRemaining <= 7 && thresholds.includes(7)) {
                alertType = 'expiring_7d';
            } else if (daysRemaining <= 14 && thresholds.includes(14)) {
                alertType = 'expiring_14d';
            } else if (daysRemaining <= 30 && thresholds.includes(30)) {
                alertType = 'expiring_30d';
            }

            if (!alertType) continue;

            // Check if alert already exists
            const alertKey = `${license.id}:${alertType}`;
            if (existingAlertKeys.has(alertKey)) continue;

            // Add to batch insert
            const alertInsert: AlertInsert = {
                license_id: license.id,
                employee_id: license.employee_id,
                client_id: client.id,
                alert_type: alertType,
                status: 'pending',
            };
            newAlerts.push(alertInsert);
        }

        // Batch insert all new alerts
        let alertsCreated = 0;
        if (newAlerts.length > 0) {
            const { error: insertError } = await supabase
                .from('alerts')
                .insert(newAlerts as never[]);

            if (!insertError) {
                alertsCreated = newAlerts.length;
            }
        }

        // Run compliance validation for licenses with matched types
        let validationsRun = 0;
        let complianceIssuesFound = 0;

        if (complianceValidationService.isConfigured()) {
            const licensesToValidate = licenses.filter(
                lic => lic.matched_state && lic.matched_license_type
            );

            for (const license of licensesToValidate.slice(0, 50)) { // Limit to 50 per client to avoid timeout
                try {
                    // Get employee's other licenses
                    const { data: otherLicenses } = await supabase
                        .from('licenses_cache')
                        .select('id, description, expiration_date, matched_state, matched_license_type, license_stage')
                        .eq('employee_id', license.employee_id)
                        .neq('id', license.id) as { data: OtherLicenseResult[] | null; error: unknown };

                    const validationResult = await complianceValidationService.validateLicense({
                        licenseId: license.id,
                        employeeId: license.employee_id,
                        description: license.description,
                        expirationDate: license.expiration_date,
                        licenseNumber: license.license_number || null,
                        matchedState: license.matched_state || null,
                        matchedLicenseType: license.matched_license_type || null,
                        employeeOtherLicenses: otherLicenses?.map(lic => ({
                            id: lic.id,
                            description: lic.description,
                            expirationDate: lic.expiration_date,
                            matchedState: lic.matched_state,
                            matchedLicenseType: lic.matched_license_type || null,
                            licenseStage: lic.license_stage,
                        })) || [],
                    });

                    // Store validation result (upsert to update existing)
                    await supabase
                        .from('compliance_validations')
                        .upsert({
                            license_id: license.id,
                            employee_id: license.employee_id,
                            is_valid: validationResult.isValid,
                            validation_score: validationResult.validationScore,
                            state_code: validationResult.state,
                            license_type: validationResult.licenseType,
                            issues: validationResult.issues as unknown,
                            warnings: validationResult.warnings as unknown,
                            suggestions: validationResult.suggestions as unknown,
                            prerequisites: validationResult.prerequisites as unknown,
                            anomalies: validationResult.anomalies as unknown,
                            validated_at: validationResult.validatedAt.toISOString(),
                        } as never, {
                            onConflict: 'license_id',
                        });

                    validationsRun++;
                    if (!validationResult.isValid || validationResult.issues.length > 0) {
                        complianceIssuesFound += validationResult.issues.length;
                    }
                } catch (error) {
                    console.error(`Error validating license ${license.id}:`, error);
                    // Continue with other licenses
                }
            }
        }

        results.push({
            client_id: client.id,
            client_name: client.name,
            licenses_checked: licenses.length,
            alerts_created: alertsCreated,
            validations_run: validationsRun,
            compliance_issues_found: complianceIssuesFound,
        });
    }

    return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        clients_processed: clients.length,
        results,
    });
});
