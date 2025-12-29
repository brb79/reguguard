import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { WinTeamClient } from '@/lib/winteam';
import type { Client, EmployeeCache, SyncJob, ClientInsert, EmployeeCacheInsert, LicenseCacheInsert, SyncJobInsert, SyncJobUpdate } from '@/lib/supabase';
import { withErrorHandling } from '@/lib/errors';
import { requireClientAccess } from '@/lib/auth';
import { rateLimiters } from '@/lib/ratelimit';
import { syncRequestSchema, validateRequest } from '@/lib/validation';
import { getEnv } from '@/lib/env';
import { licenseMatchingService } from '@/lib/ai/matching-service';
import { complianceValidationService } from '@/lib/ai/compliance-validation-service';

export const POST = withErrorHandling(async (request: NextRequest) => {
    // Rate limiting (strict for sync operations)
    const rateLimitResponse = await rateLimiters.strict(request);
    if (rateLimitResponse) return rateLimitResponse;

    // Authentication & authorization
    const authResponse = await requireClientAccess()(request);
    if (authResponse) return authResponse;

    // Request validation
    const validation = await validateRequest(request, syncRequestSchema);
    if (validation.error) {
        return NextResponse.json(
            { error: 'Validation failed', details: validation.error.errors },
            { status: 400 }
        );
    }

    const { client_id } = validation.data;

    const supabase = await createServerClient();

    // Get client configuration
    const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', client_id)
        .single();

    if (clientError || !clientData) {
        return NextResponse.json(
            { error: 'Client not found' },
            { status: 404 }
        );
    }

    const client: Client = clientData;

    // Create sync job record
    const syncJobInsert: SyncJobInsert = {
        client_id,
        status: 'running',
    };

    const { data: syncJobData, error: syncJobError } = await supabase
        .from('sync_jobs')
        .insert(syncJobInsert as never)
        .select()
        .single();

    if (syncJobError || !syncJobData) {
        return NextResponse.json(
            { error: 'Failed to create sync job' },
            { status: 500 }
        );
    }

    const syncJob: SyncJob = syncJobData;

    // Initialize WinTeam client
    const env = getEnv();
    const winteam = new WinTeamClient({
        baseUrl: env.WINTEAM_API_URL || 'https://apim.myteamsoftware.com/wtnextgen/employees/v1',
        tenantId: client.winteam_tenant_id,
    });

    let totalEmployees = 0;
    let totalLicenses = 0;
    const errors: string[] = [];

    // Sync each location
    for (const locationId of client.location_ids || []) {
        try {
            const { employees, complianceItems } = await winteam.syncLocationCompliance(locationId);

            for (const emp of employees) {
                // Upsert employee
                const employeeInsert: EmployeeCacheInsert = {
                    client_id,
                    winteam_employee_number: emp.employeeNumber,
                    winteam_employee_id: emp.employeeId,
                    first_name: emp.firstName,
                    last_name: emp.lastName,
                    phone1: emp.phone1?.toString() || null,
                    email: emp.emailAddress,
                    status: emp.statusDescription,
                    location_id: emp.locationId,
                    last_synced: new Date().toISOString(),
                };

                const { data: cachedEmployeeData, error: empError } = await supabase
                    .from('employees_cache')
                    .upsert(employeeInsert as never, {
                        onConflict: 'client_id,winteam_employee_number',
                    })
                    .select()
                    .single();

                if (empError || !cachedEmployeeData) {
                    errors.push(`Employee ${emp.employeeNumber}: ${empError?.message || 'Unknown error'}`);
                    continue;
                }

                const cachedEmployee: EmployeeCache = cachedEmployeeData;
                totalEmployees++;

                // Upsert compliance items with AI-powered matching
                const items = complianceItems.get(emp.employeeNumber) || [];
                for (const item of items) {
                    // Use AI to match license description to state and license type
                    let matchedState: string | null = null;
                    let matchedLicenseType: string | null = null;
                    let matchedDisplayName: string | null = null;
                    let matchingConfidence: number | null = null;
                    let matchingReasoning: string | null = null;

                    if (licenseMatchingService.isConfigured()) {
                        try {
                            const matchResult = await licenseMatchingService.matchLicense({
                                description: item.description,
                                employeeLocation: emp.locationId?.toString() || null,
                                regulatoryBody: extractRegulatoryBody(item.description),
                            });

                            if (matchResult.success && matchResult.matchedState && matchResult.matchedLicenseType) {
                                matchedState = matchResult.matchedState;
                                matchedLicenseType = matchResult.matchedLicenseType;
                                matchedDisplayName = matchResult.matchedDisplayName;
                                matchingConfidence = matchResult.confidence;
                                matchingReasoning = matchResult.reasoning;

                                // Log matching results for monitoring
                                if (matchResult.confidence < 0.7) {
                                    console.warn(
                                        `Low confidence match for license "${item.description}": ` +
                                        `${matchResult.matchedState}/${matchResult.matchedLicenseType} ` +
                                        `(confidence: ${matchResult.confidence})`
                                    );
                                }
                            }
                        } catch (error) {
                            console.error(`Error matching license "${item.description}":`, error);
                            // Continue without matching - don't fail the sync
                        }
                    }

                    const licenseInsert: LicenseCacheInsert = {
                        employee_id: cachedEmployee.id,
                        winteam_compliance_id: item.id,
                        description: item.description,
                        license_number: item.licenseExpirationCode?.number || null,
                        expiration_date: item.expirationDate
                            ? item.expirationDate.split('T')[0]
                            : null,
                        license_stage: item.licenseExpirationCode?.licenseStage || null,
                        status: item.licenseExpirationCode?.status || null,
                        frequency: item.frequency,
                        last_synced: new Date().toISOString(),
                        // Add matched fields if available
                        ...(matchedState && { matched_state: matchedState }),
                        ...(matchedLicenseType && { matched_license_type: matchedLicenseType }),
                        ...(matchedDisplayName && { matched_display_name: matchedDisplayName }),
                        ...(matchingConfidence !== null && { matching_confidence: matchingConfidence }),
                        ...(matchingReasoning && { matching_reasoning: matchingReasoning }),
                    };
                    // Type for license upsert result
                    type LicenseUpsertResult = {
                        id: string;
                        expiration_date: string | null;
                        license_number: string | null;
                    };

                    const { error: licError, data: upsertedLicense } = await supabase
                        .from('licenses_cache')
                        .upsert(licenseInsert as never, {
                            onConflict: 'employee_id,winteam_compliance_id',
                        })
                        .select()
                        .single() as { error: unknown; data: LicenseUpsertResult | null };

                    if (licError) {
                        errors.push(`License ${item.id}: ${String(licError)}`);
                    } else {
                        totalLicenses++;

                        // Run compliance validation if license was matched
                        if (upsertedLicense && matchedState && matchedLicenseType && complianceValidationService.isConfigured()) {
                            try {
                                // Type for other licenses query
                                type OtherLicenseResult = {
                                    id: string;
                                    description: string;
                                    expiration_date: string | null;
                                    matched_state: string | null;
                                    matched_license_type: string | null;
                                    license_stage: string | null;
                                };

                                // Get employee's other licenses for prerequisite checking
                                const { data: otherLicenses } = await supabase
                                    .from('licenses_cache')
                                    .select('id, description, expiration_date, matched_state, matched_license_type, license_stage')
                                    .eq('employee_id', cachedEmployee.id)
                                    .neq('id', upsertedLicense.id) as { data: OtherLicenseResult[] | null; error: unknown };

                                const validationResult = await complianceValidationService.validateLicense({
                                    licenseId: upsertedLicense.id,
                                    employeeId: cachedEmployee.id,
                                    description: item.description,
                                    expirationDate: upsertedLicense.expiration_date,
                                    licenseNumber: upsertedLicense.license_number,
                                    matchedState,
                                    matchedLicenseType,
                                    employeeOtherLicenses: otherLicenses?.map(lic => ({
                                        id: lic.id,
                                        description: lic.description,
                                        expirationDate: lic.expiration_date,
                                        matchedState: lic.matched_state,
                                        matchedLicenseType: lic.matched_license_type || null,
                                        licenseStage: lic.license_stage,
                                    })) || [],
                                    employeeLocation: emp.locationId?.toString() || null,
                                });

                                // Store validation result
                                await supabase
                                    .from('compliance_validations')
                                    .insert({
                                        license_id: upsertedLicense.id,
                                        employee_id: cachedEmployee.id,
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
                                    } as never);

                                // Log critical issues
                                const criticalIssues = validationResult.issues.filter(i => i.severity === 'critical');
                                if (criticalIssues.length > 0) {
                                    console.warn(
                                        `Critical compliance issues for license ${item.description}: ` +
                                        criticalIssues.map(i => i.title).join(', ')
                                    );
                                }
                            } catch (validationError) {
                                console.error(`Error validating license ${item.description}:`, validationError);
                                // Don't fail sync if validation fails
                            }
                        }
                    }
                }
            }
        } catch (error) {
            errors.push(`Location ${locationId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Update sync job
    const syncJobUpdate: SyncJobUpdate = {
        status: 'completed',
        employees_synced: totalEmployees,
        licenses_synced: totalLicenses,
        errors: errors.length > 0 ? errors : null,
        completed_at: new Date().toISOString(),
    };

    await supabase
        .from('sync_jobs')
        .update(syncJobUpdate as never)
        .eq('id', syncJob.id);

    return NextResponse.json({
        success: true,
        sync_id: syncJob.id,
        employees_synced: totalEmployees,
        licenses_synced: totalLicenses,
        errors: errors.length > 0 ? errors : undefined,
    });
});

/**
 * Extract regulatory body abbreviation from license description
 */
function extractRegulatoryBody(description: string): string | null {
    const upperDesc = description.toUpperCase();

    // Common regulatory body abbreviations
    const abbreviations: Record<string, string> = {
        'DCJS': 'DCJS',
        'DPS': 'DPS',
        'FDACS': 'FDACS',
        'BSIS': 'BSIS',
        'MSPSL': 'MSPSL',
        'PSP': 'PSP',
        'IDFPR': 'IDFPR',
        'GBPDSA': 'GBPDSA',
    };

    for (const [abbr, value] of Object.entries(abbreviations)) {
        if (upperDesc.includes(abbr)) {
            return value;
        }
    }

    return null;
}
