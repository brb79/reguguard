/**
 * Pending Renewals API
 * 
 * Dashboard API for viewing and managing pending license renewals
 * submitted via SMS.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/lib/supabase/types';
import { conversationService } from '@/lib/conversations/service';
import type { PendingRenewalWithConversation } from '@/lib/supabase';
import { extractSingle } from '@/lib/supabase/query-types';

// ============================================================================
// GET /api/renewals/pending
// List all pending renewals
// ============================================================================

export async function GET(req: NextRequest) {
    try {
        const supabase = createClient<Database>(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // Parse query parameters
        const { searchParams } = new URL(req.url);
        const clientId = searchParams.get('client_id');
        const status = searchParams.get('status'); // 'pending', 'confirmed', 'synced', 'all'
        const limit = parseInt(searchParams.get('limit') || '50', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        // Types for query results
        type RenewalQueryResult = {
            id: string;
            conversation_id: string;
            image_url: string;
            extracted_expiration_date: string | null;
            extracted_license_number: string | null;
            extracted_license_type: string | null;
            extracted_state: string | null;
            extracted_holder_name: string | null;
            extraction_confidence: number | null;
            confirmed: boolean;
            confirmed_at: string | null;
            synced_to_winteam: boolean;
            synced_at: string | null;
            sync_error: string | null;
            requires_supervisor_approval: boolean;
            supervisor_approved: boolean | null;
            created_at: string;
            sms_conversations: {
                id: string;
                status: string;
                phone_number: string;
                created_at: string;
                expires_at: string;
                employees_cache: {
                    id: string;
                    first_name: string;
                    last_name: string;
                    winteam_employee_number: number;
                } | {
                    id: string;
                    first_name: string;
                    last_name: string;
                    winteam_employee_number: number;
                }[];
                licenses_cache: {
                    id: string;
                    description: string;
                    expiration_date: string | null;
                    winteam_compliance_id: number;
                } | {
                    id: string;
                    description: string;
                    expiration_date: string | null;
                    winteam_compliance_id: number;
                }[];
                clients: {
                    id: string;
                    name: string;
                } | {
                    id: string;
                    name: string;
                }[];
            } | {
                id: string;
                status: string;
                phone_number: string;
                created_at: string;
                expires_at: string;
                employees_cache: {
                    id: string;
                    first_name: string;
                    last_name: string;
                    winteam_employee_number: number;
                } | {
                    id: string;
                    first_name: string;
                    last_name: string;
                    winteam_employee_number: number;
                }[];
                licenses_cache: {
                    id: string;
                    description: string;
                    expiration_date: string | null;
                    winteam_compliance_id: number;
                } | {
                    id: string;
                    description: string;
                    expiration_date: string | null;
                    winteam_compliance_id: number;
                }[];
                clients: {
                    id: string;
                    name: string;
                } | {
                    id: string;
                    name: string;
                }[];
            }[];
        };

        // Build query using the dashboard view
        let query = supabase
            .from('pending_renewals')
            .select(`
                *,
                sms_conversations!inner (
                    id,
                    status,
                    phone_number,
                    created_at,
                    expires_at,
                    employees_cache!inner (
                        id,
                        first_name,
                        last_name,
                        winteam_employee_number
                    ),
                    licenses_cache!inner (
                        id,
                        description,
                        expiration_date,
                        winteam_compliance_id
                    ),
                    clients!inner (
                        id,
                        name
                    )
                )
            `)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        // Filter by client if specified
        if (clientId) {
            query = query.eq('sms_conversations.client_id', clientId);
        }

        // Filter by status
        switch (status) {
            case 'pending':
                query = query.eq('confirmed', false);
                break;
            case 'confirmed':
                query = query.eq('confirmed', true).eq('synced_to_winteam', false);
                break;
            case 'synced':
                query = query.eq('synced_to_winteam', true);
                break;
            // 'all' or default: no additional filter
        }

        const { data, error, count } = await query as { data: RenewalQueryResult[] | null; error: unknown; count: number | null };

        if (error) {
            console.error('Error fetching pending renewals:', error);
            return NextResponse.json(
                { success: false, error: String(error) },
                { status: 500 }
            );
        }

        // Transform data for easier frontend consumption
        const renewals = (data || []).map((renewal) => {
            // Type-safe extraction
            const conversationData = extractSingle(renewal.sms_conversations);
            if (!conversationData) {
                throw new Error('Conversation data missing');
            }

            const employee = extractSingle(conversationData.employees_cache);
            const license = extractSingle(conversationData.licenses_cache);
            const client = extractSingle(conversationData.clients);

            if (!employee || !license || !client) {
                throw new Error('Missing required relationship data');
            }

            return {
                id: renewal.id,
                conversationId: conversationData.id,
                conversationStatus: conversationData.status,
                phoneNumber: conversationData.phone_number,
                imageUrl: renewal.image_url,
                extractedData: {
                    expirationDate: renewal.extracted_expiration_date,
                    licenseNumber: renewal.extracted_license_number,
                    licenseType: renewal.extracted_license_type,
                    state: renewal.extracted_state,
                    holderName: renewal.extracted_holder_name,
                    confidence: renewal.extraction_confidence,
                },
                confirmed: renewal.confirmed,
                confirmedAt: renewal.confirmed_at,
                syncedToWinTeam: renewal.synced_to_winteam,
                syncedAt: renewal.synced_at,
                syncError: renewal.sync_error,
                requiresSupervisorApproval: renewal.requires_supervisor_approval,
                supervisorApproved: renewal.supervisor_approved,
                employee: {
                    id: employee.id,
                    name: `${employee.first_name} ${employee.last_name}`,
                    employeeNumber: employee.winteam_employee_number,
                },
                license: {
                    id: license.id,
                    description: license.description,
                    currentExpirationDate: license.expiration_date,
                    complianceId: license.winteam_compliance_id,
                },
                client: {
                    id: client.id,
                    name: client.name,
                },
                createdAt: renewal.created_at,
                expiresAt: conversationData.expires_at,
            };
        });

        return NextResponse.json({
            success: true,
            data: renewals,
            pagination: {
                limit,
                offset,
                total: count || renewals.length,
            },
        });
    } catch (error) {
        console.error('Pending renewals API error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// ============================================================================
// POST /api/renewals/pending
// Supervisor actions: approve, reject, or retry sync
// ============================================================================

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { renewalId, action, notes } = body as {
            renewalId: string;
            action: 'approve' | 'reject' | 'retry_sync';
            notes?: string;
        };

        if (!renewalId || !action) {
            return NextResponse.json(
                { success: false, error: 'renewalId and action are required' },
                { status: 400 }
            );
        }

        const supabase = createClient<Database>(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // Type for POST query
        type RenewalPostQueryResult = {
            id: string;
            confirmed: boolean;
            sms_conversations: {
                id: string;
                phone_number: string;
            } | {
                id: string;
                phone_number: string;
            }[];
        };

        // Get the renewal and conversation
        const { data: renewal } = await supabase
            .from('pending_renewals')
            .select('*, sms_conversations(*)')
            .eq('id', renewalId)
            .single() as { data: RenewalPostQueryResult | null; error: unknown };

        if (!renewal) {
            return NextResponse.json(
                { success: false, error: 'Renewal not found' },
                { status: 404 }
            );
        }

        const conversation = extractSingle(renewal.sms_conversations);
        if (!conversation) {
            return NextResponse.json(
                { success: false, error: 'Conversation not found' },
                { status: 404 }
            );
        }

        switch (action) {
            case 'approve': {
                // Mark as supervisor approved and trigger sync
                await supabase
                    .from('pending_renewals')
                    .update({
                        supervisor_approved: true,
                        supervisor_approved_at: new Date().toISOString(),
                        supervisor_notes: notes || null,
                        confirmed: true,
                        confirmed_at: new Date().toISOString(),
                    } as never)
                    .eq('id', renewalId);

                // Get context and sync
                const context = await conversationService.getConversationContext(conversation.id);
                if (context) {
                    // The sync will happen via the conversation service
                    await conversationService.handleConfirmation(conversation.id, true);
                }

                return NextResponse.json({
                    success: true,
                    message: 'Renewal approved and sync initiated',
                });
            }

            case 'reject': {
                // Mark as rejected
                await supabase
                    .from('pending_renewals')
                    .update({
                        supervisor_approved: false,
                        supervisor_approved_at: new Date().toISOString(),
                        supervisor_notes: notes || null,
                    } as never)
                    .eq('id', renewalId);

                // Update conversation status
                await supabase
                    .from('sms_conversations')
                    .update({ status: 'rejected' } as never)
                    .eq('id', conversation.id);

                // Notify employee
                const { smsService } = await import('@/lib/sms/service');
                await smsService.send({
                    to: conversation.phone_number,
                    body: `ReguGuard: Your license photo was not accepted. ${notes ? `Reason: ${notes}` : ''} Please submit a new photo.`,
                });

                return NextResponse.json({
                    success: true,
                    message: 'Renewal rejected and employee notified',
                });
            }

            case 'retry_sync': {
                // Retry WinTeam sync for failed syncs
                if (!renewal.confirmed) {
                    return NextResponse.json(
                        { success: false, error: 'Cannot retry sync for unconfirmed renewal' },
                        { status: 400 }
                    );
                }

                const context = await conversationService.getConversationContext(conversation.id);
                if (context) {
                    await conversationService.handleConfirmation(conversation.id, true);
                }

                return NextResponse.json({
                    success: true,
                    message: 'Sync retry initiated',
                });
            }

            default:
                return NextResponse.json(
                    { success: false, error: `Unknown action: ${action}` },
                    { status: 400 }
                );
        }
    } catch (error) {
        console.error('Pending renewals action error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
