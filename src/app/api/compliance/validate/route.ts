/**
 * Compliance Validation API Endpoint
 * 
 * Validates licenses against state requirements and returns compliance results
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { complianceValidationService } from '@/lib/ai/compliance-validation-service';
import { withErrorHandling } from '@/lib/errors';
import { requireClientAccess } from '@/lib/auth';

export const POST = withErrorHandling(async (request: NextRequest) => {
    const authResponse = await requireClientAccess()(request);
    if (authResponse) return authResponse;

    const supabase = await createServerClient();
    const body = await request.json();
    const { license_id, employee_id } = body;

    if (!license_id) {
        return NextResponse.json(
            { error: 'license_id is required' },
            { status: 400 }
        );
    }

    // Types for queries
    type LicenseQueryResult = {
        id: string;
        employee_id: string;
        description: string;
        license_number: string | null;
        expiration_date: string | null;
        license_stage: string | null;
        matched_state: string | null;
        matched_license_type: string | null;
        employee: {
            id: string;
            first_name: string | null;
            last_name: string | null;
            client_id: string | null;
        } | {
            id: string;
            first_name: string | null;
            last_name: string | null;
            client_id: string | null;
        }[];
    };

    type OtherLicenseResult = {
        id: string;
        description: string;
        expiration_date: string | null;
        matched_state: string | null;
        matched_license_type: string | null;
        license_stage: string | null;
    };

    // Get license data
    const { data: license, error: licenseError } = await supabase
        .from('licenses_cache')
        .select(`
            *,
            employee:employees_cache!inner (
                id,
                first_name,
                last_name,
                client_id
            )
        `)
        .eq('id', license_id)
        .single() as { data: LicenseQueryResult | null; error: unknown };

    if (licenseError || !license) {
        return NextResponse.json(
            { error: 'License not found' },
            { status: 404 }
        );
    }

    // Get employee's other licenses for prerequisite checking
    const { data: otherLicenses } = await supabase
        .from('licenses_cache')
        .select('id, description, expiration_date, matched_state, matched_license_type, license_stage')
        .eq('employee_id', license.employee_id)
        .neq('id', license_id) as { data: OtherLicenseResult[] | null; error: unknown };

    // Run validation
    const validationResult = await complianceValidationService.validateLicense({
        licenseId: license.id,
        employeeId: license.employee_id,
        description: license.description,
        expirationDate: license.expiration_date,
        licenseNumber: license.license_number,
        matchedState: license.matched_state,
        matchedLicenseType: license.matched_license_type,
        employeeOtherLicenses: otherLicenses?.map(lic => ({
            id: lic.id,
            description: lic.description,
            expirationDate: lic.expiration_date,
            matchedState: lic.matched_state,
            matchedLicenseType: lic.matched_license_type || null,
            licenseStage: lic.license_stage,
        })) || [],
    });

    // Store validation result
    await supabase
        .from('compliance_validations')
        .insert({
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
        } as never);

    return NextResponse.json({
        success: true,
        validation: validationResult,
    });
});

/**
 * Get validation results for a license
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
    const authResponse = await requireClientAccess()(request);
    if (authResponse) return authResponse;

    const supabase = await createServerClient();
    const { searchParams } = new URL(request.url);
    const licenseId = searchParams.get('license_id');
    const employeeId = searchParams.get('employee_id');

    if (!licenseId && !employeeId) {
        return NextResponse.json(
            { error: 'license_id or employee_id is required' },
            { status: 400 }
        );
    }

    let query = supabase
        .from('compliance_validations')
        .select('*')
        .order('validated_at', { ascending: false });

    if (licenseId) {
        query = query.eq('license_id', licenseId);
    }
    if (employeeId) {
        query = query.eq('employee_id', employeeId);
    }

    const { data, error } = await query.limit(10);

    if (error) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        validations: data || [],
    });
});

