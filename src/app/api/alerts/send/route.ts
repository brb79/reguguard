import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { smsService, alertTemplates } from '@/lib/sms';
import type { AlertWithLicense, AlertUpdate } from '@/lib/supabase';
import { extractSingle } from '@/lib/supabase/query-types';
import { withErrorHandling } from '@/lib/errors';
import { requireClientAccess } from '@/lib/auth';
import { rateLimiters } from '@/lib/ratelimit';
import { sendAlertsSchema, validateRequest } from '@/lib/validation';
import { alertPersonalizationService } from '@/lib/ai';


export const POST = withErrorHandling(async (request: NextRequest) => {
    // Rate limiting
    const rateLimitResponse = await rateLimiters.standard(request);
    if (rateLimitResponse) return rateLimitResponse;

    // Authentication & authorization
    const authResponse = await requireClientAccess()(request);
    if (authResponse) return authResponse;

    // Request validation
    const validation = await validateRequest(request, sendAlertsSchema);
    if (validation.error) {
        return NextResponse.json(
            { error: 'Validation failed', details: validation.error.errors },
            { status: 400 }
        );
    }

    const { client_id, alert_ids, dry_run } = validation.data;

    const supabase = await createServerClient();

    if (!client_id) {
        return NextResponse.json(
            { error: 'client_id is required' },
            { status: 400 }
        );
    }

    // Check if SMS is configured
    if (!smsService.isConfigured() && !dry_run) {
        return NextResponse.json(
            { error: 'SMS service not configured' },
            { status: 503 }
        );
    }

    // Type for the complex nested query
    type AlertQueryResult = {
        id: string;
        alert_type: string | null;
        license: {
            id: string;
            description: string | null;
            expiration_date: string | null;
            license_number: string | null;
            matched_state: string | null;
            matched_license_type: string | null;
            employee: {
                id: string;
                first_name: string | null;
                last_name: string | null;
                phone1: string | null;
                location_id: string | null;
            } | {
                id: string;
                first_name: string | null;
                last_name: string | null;
                phone1: string | null;
                location_id: string | null;
            }[];
        } | {
            id: string;
            description: string | null;
            expiration_date: string | null;
            license_number: string | null;
            matched_state: string | null;
            matched_license_type: string | null;
            employee: {
                id: string;
                first_name: string | null;
                last_name: string | null;
                phone1: string | null;
                location_id: string | null;
            } | {
                id: string;
                first_name: string | null;
                last_name: string | null;
                phone1: string | null;
                location_id: string | null;
            }[];
        }[];
    };

    // Get pending alerts (or specific ones if alert_ids provided)
    // Include additional fields needed for personalization
    let query = supabase
        .from('alerts')
        .select(`
        id,
        alert_type,
        license:licenses_cache!inner (
          id,
          description,
          expiration_date,
          license_number,
          matched_state,
          matched_license_type,
          employee:employees_cache!inner (
            id,
            first_name,
            last_name,
            phone1,
            location_id
          )
        )
      `)
        .eq('client_id', client_id)
        .eq('status', 'pending');

    if (alert_ids && alert_ids.length > 0) {
        query = query.in('id', alert_ids);
    }

    const { data: alerts, error } = await query as { data: AlertQueryResult[] | null; error: unknown };

    if (error) {
        return NextResponse.json(
            { error: 'Failed to fetch alerts' },
            { status: 500 }
        );
    }

    const results = [];

    for (const alert of alerts || []) {
        // Type-safe extraction of relationships
        const license = extractSingle(alert.license);
        if (!license) {
            results.push({
                alert_id: alert.id,
                success: false,
                error: 'License not found',
            });
            continue;
        }

        const employee = extractSingle(license.employee);

        if (!employee?.phone1) {
            results.push({
                alert_id: alert.id,
                success: false,
                error: 'No phone number available',
            });
            continue;
        }

        // Format phone number
        const phone = employee.phone1.startsWith('+')
            ? employee.phone1
            : `+1${employee.phone1.replace(/\D/g, '')}`;

        // Calculate days remaining
        const expirationDate = new Date(license.expiration_date || new Date());
        const today = new Date();
        const daysRemaining = Math.floor(
            (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Generate personalized message using AI (with fallback to templates)
        let message = '';
        let personalizationMetadata: Record<string, any> | null = null;
        let messageVariant = 'template';

        // Try to generate personalized message if AI is configured
        if (alertPersonalizationService.isConfigured()) {
            try {
                const personalized = await alertPersonalizationService.generatePersonalizedMessage({
                    alertType: alert.alert_type as 'expiring_30d' | 'expiring_14d' | 'expiring_7d' | 'expired',
                    employeeContext: {
                        employeeId: employee.id,
                        employeeName: `${employee.first_name} ${employee.last_name}`,
                        firstName: employee.first_name || '',
                        lastName: employee.last_name || '',
                        phoneNumber: phone,
                        locationId: employee.location_id ? parseInt(employee.location_id, 10) : null,
                    },
                    licenseContext: {
                        licenseId: license.id || '',
                        licenseName: license.description || 'License',
                        licenseNumber: license.license_number || null,
                        expirationDate: license.expiration_date || new Date().toISOString(),
                        daysRemaining,
                        stateCode: license.matched_state || null,
                        licenseType: license.matched_license_type || null,
                    },
                    enableABTesting: true,
                });

                message = personalized.message;
                messageVariant = personalized.variant;
                personalizationMetadata = {
                    language: personalized.language,
                    tone: personalized.tone,
                    variant: personalized.variant,
                    personalizationFactors: personalized.metadata.personalizationFactors,
                    stateRequirementsIncluded: personalized.metadata.stateRequirementsIncluded,
                    employeeHistoryUsed: personalized.metadata.employeeHistoryUsed,
                };
            } catch (error) {
                console.error('Error generating personalized message, falling back to template:', error);
                // Fall through to template-based message
            }
        }

        // Fallback to template-based message if personalization failed or is not configured
        if (!message) {
            const templateData = {
                licenseName: license.description || 'License',
                days: Math.abs(daysRemaining),
                expirationDate: expirationDate.toLocaleDateString(),
            };

            switch (alert.alert_type) {
                case 'expiring_30d':
                    message = alertTemplates.expiring_30d(templateData);
                    break;
                case 'expiring_14d':
                    message = alertTemplates.expiring_14d(templateData);
                    break;
                case 'expiring_7d':
                    message = alertTemplates.expiring_7d(templateData);
                    break;
                case 'expired':
                    message = alertTemplates.expired(templateData);
                    break;
                default:
                    message = `ReguGuard: Your ${license.description} requires attention.`;
            }
        }

        if (dry_run) {
            results.push({
                alert_id: alert.id,
                success: true,
                dry_run: true,
                phone,
                message,
            });
            continue;
        }

        // Send SMS
        const smsResult = await smsService.send({
            to: phone,
            body: message,
        });

        // Update alert status with personalization metadata
        const alertUpdate: AlertUpdate = {
            status: smsResult.success ? 'sent' : 'failed',
            message,
            sent_at: new Date().toISOString(),
            delivery_status: smsResult.messageSid || smsResult.error || null,
            personalization_metadata: personalizationMetadata || null,
        };

        await supabase
            .from('alerts')
            .update(alertUpdate as never)
            .eq('id', alert.id);

        results.push({
            alert_id: alert.id,
            success: smsResult.success,
            messageSid: smsResult.messageSid,
            error: smsResult.error,
            personalized: !!personalizationMetadata,
            variant: messageVariant,
            metadata: personalizationMetadata || undefined,
        });
    }

    return NextResponse.json({
        success: true,
        total: results.length,
        sent: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
    });
});
