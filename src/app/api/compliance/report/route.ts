/**
 * Compliance Report API Endpoint
 * 
 * Generates compliance reports for employees
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
    const { employee_id } = body;

    if (!employee_id) {
        return NextResponse.json(
            { error: 'employee_id is required' },
            { status: 400 }
        );
    }

    // Get employee data
    type EmployeeQueryResult = {
        id: string;
        first_name: string | null;
        last_name: string | null;
        client_id: string | null;
    };

    const { data: employee, error: employeeError } = await supabase
        .from('employees_cache')
        .select('id, first_name, last_name, client_id')
        .eq('id', employee_id)
        .single() as { data: EmployeeQueryResult | null; error: unknown };

    if (employeeError || !employee) {
        return NextResponse.json(
            { error: 'Employee not found' },
            { status: 404 }
        );
    }

    // Type for license query
    type LicenseQueryResult = {
        id: string;
        employee_id: string;
        description: string;
        license_number: string | null;
        expiration_date: string | null;
        license_stage: string | null;
        matched_state: string | null;
        matched_license_type: string | null;
    };

    // Get all licenses for employee
    const { data: licenses, error: licensesError } = await supabase
        .from('licenses_cache')
        .select('*')
        .eq('employee_id', employee_id) as { data: LicenseQueryResult[] | null; error: unknown };

    if (licensesError) {
        return NextResponse.json(
            { error: String(licensesError) },
            { status: 500 }
        );
    }

    if (!licenses || licenses.length === 0) {
        return NextResponse.json({
            success: true,
            report: {
                employeeId: employee_id,
                employeeName: `${employee.first_name} ${employee.last_name}`,
                licenses: [],
                overallScore: 1.0,
                criticalIssues: 0,
                warnings: 0,
                suggestions: 0,
                generatedAt: new Date().toISOString(),
            },
        });
    }

    // Generate compliance report
    const report = await complianceValidationService.generateComplianceReport(
        employee_id,
        `${employee.first_name} ${employee.last_name}`,
        licenses.map(lic => ({
            licenseId: lic.id,
            employeeId: lic.employee_id,
            description: lic.description,
            expirationDate: lic.expiration_date,
            licenseNumber: lic.license_number,
            matchedState: lic.matched_state,
            matchedLicenseType: lic.matched_license_type,
            employeeOtherLicenses: licenses
                .filter(l => l.id !== lic.id)
                .map(l => ({
                    id: l.id,
                    description: l.description,
                    expirationDate: l.expiration_date,
                    matchedState: l.matched_state,
                    matchedLicenseType: l.matched_license_type || null,
                    licenseStage: l.license_stage,
                })),
        }))
    );

    // Store report
    await supabase
        .from('compliance_reports')
        .insert({
            employee_id: employee_id,
            client_id: employee.client_id,
            overall_score: report.overallScore,
            critical_issues_count: report.criticalIssues,
            warnings_count: report.warnings,
            suggestions_count: report.suggestions,
            report_data: report as unknown,
            generated_at: report.generatedAt.toISOString(),
        } as never);

    return NextResponse.json({
        success: true,
        report,
    });
});

/**
 * Get compliance reports for an employee
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
    const authResponse = await requireClientAccess()(request);
    if (authResponse) return authResponse;

    const supabase = await createServerClient();
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employee_id');
    const clientId = searchParams.get('client_id');

    if (!employeeId && !clientId) {
        return NextResponse.json(
            { error: 'employee_id or client_id is required' },
            { status: 400 }
        );
    }

    let query = supabase
        .from('compliance_reports')
        .select('*')
        .order('generated_at', { ascending: false });

    if (employeeId) {
        query = query.eq('employee_id', employeeId);
    }
    if (clientId) {
        query = query.eq('client_id', clientId);
    }

    const { data, error } = await query.limit(20);

    if (error) {
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        reports: data || [],
    });
});

