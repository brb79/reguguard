/**
 * Conversation Service - Orchestrates SMS conversation flow for license renewals
 * 
 * Manages the state machine for two-way SMS conversations where employees
 * submit photos of renewed licenses and the system extracts/syncs data.
 */

import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '../supabase/admin';
import { Database, ConversationStatus, SmsConversation, PendingRenewal } from '../supabase/types';
import { visionService } from '../vision/service';
import { getWinTeamClient } from '../winteam/client';
import { smsService } from '../sms/service';
import { ConversationContext, ProcessPhotoResult, SyncResult, VALID_TRANSITIONS, ConversationMessage } from './types';
import { getEnv } from '@/lib/env';
import { extractSingle } from '../supabase/query-types';
import { nlpService } from '../ai/nlp-service';
import { licenseMatchingService } from '../ai/matching-service';
import { complianceQAService } from '../ai/compliance-qa-service';

// ============================================================================
// Message Templates
// ============================================================================

export const messageTemplates = {
    requestPhoto: (data: { licenseName: string; expirationDate: string }) =>
        `ReguGuard: Your ${data.licenseName} expires ${data.expirationDate}. ` +
        `📸 Reply with a PHOTO of your renewed license to update our records. ` +
        `Reply HELP for assistance.`,

    confirmExtraction: (data: { expirationDate: string; licenseNumber: string; confidence: number }) => {
        const confidenceEmoji = data.confidence >= 0.8 ? '✅' : '⚠️';
        return (
            `ReguGuard: Got your license photo! ${confidenceEmoji}\n\n` +
            `📅 New Expiration: ${data.expirationDate}\n` +
            `🔢 License #: ${data.licenseNumber}\n\n` +
            `Reply YES to confirm or NO to submit a new photo.`
        );
    },

    updateSuccess: () =>
        `✅ ReguGuard: Your license has been updated! Thank you for keeping your credentials current.`,

    extractionFailed: () =>
        `❌ ReguGuard: We couldn't read your license photo. ` +
        `Please send a clearer image with good lighting.`,

    photoReceived: () =>
        `📥 ReguGuard: Photo received! Processing... We'll text you shortly with the extracted info.`,

    conversationExpired: () =>
        `ReguGuard: Your license renewal request has expired. ` +
        `Please contact your supervisor for assistance.`,

    syncFailed: () =>
        `⚠️ ReguGuard: There was an issue updating your license. ` +
        `Our team has been notified and will resolve this shortly.`,

    help: () =>
        `ReguGuard Help:\n` +
        `• Send a PHOTO of your renewed license\n` +
        `• Reply YES to confirm extracted info\n` +
        `• Reply NO to submit a new photo\n` +
        `• Ask a compliance question (state/license)\n` +
        `• Contact your supervisor for other issues`,

    unknownCommand: () =>
        `ReguGuard: I didn't understand that. ` +
        `Reply with a photo of your license, YES to confirm, NO to retry, or HELP for assistance.`,
};

// ============================================================================
// Service
// ============================================================================

class ConversationService {
    private supabase;

    constructor() {
        try {
            this.supabase = createAdminClient();
        } catch (error) {
            console.error('Failed to initialize Supabase admin client:', error);
            // Fallback for development if service role key is missing
            const env = getEnv();
            this.supabase = createClient<Database>(
                env.NEXT_PUBLIC_SUPABASE_URL,
                env.NEXT_PUBLIC_SUPABASE_ANON_KEY
            );
        }
    }

    // ========================================================================
    // Conversation Lifecycle
    // ========================================================================

    /**
     * Start a new conversation when an expiration alert is sent
     */
    async startConversation(params: {
        clientId: string;
        employeeId: string;
        licenseId: string;
        phoneNumber: string;
        alertId?: string;
    }): Promise<{ conversationId: string; success: boolean; error?: string }> {
        try {
            // Type for existing conversation query
            type ExistingConversationResult = { id: string };

            // Check for existing active conversation
            const { data: existing } = await this.supabase
                .from('sms_conversations')
                .select('id')
                .eq('employee_id', params.employeeId)
                .eq('license_id', params.licenseId)
                .in('status', ['awaiting_photo', 'awaiting_confirmation', 'processing', 'rejected'])
                .single() as { data: ExistingConversationResult | null; error: unknown };

            if (existing) {
                return {
                    conversationId: existing.id,
                    success: true,
                    error: 'Active conversation already exists',
                };
            }

            // Create new conversation
            const { data, error } = await this.supabase
                .from('sms_conversations')
                .insert({
                    client_id: params.clientId,
                    employee_id: params.employeeId,
                    license_id: params.licenseId,
                    phone_number: params.phoneNumber,
                    alert_id: params.alertId,
                    status: 'awaiting_photo' as ConversationStatus,
                } as never)
                .select('id')
                .single() as { data: { id: string } | null; error: unknown };

            if (error || !data) {
                console.error('Failed to create conversation:', error);
                return { conversationId: '', success: false, error: String(error) };
            }

            return { conversationId: data.id, success: true };
        } catch (error) {
            console.error('Error starting conversation:', error);
            return {
                conversationId: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Get conversation by phone number (for incoming SMS routing)
     */
    async getActiveConversationByPhone(phoneNumber: string): Promise<SmsConversation | null> {
        // Normalize phone number
        const normalized = this.normalizePhoneNumber(phoneNumber);

        const { data } = await this.supabase
            .from('sms_conversations')
            .select('*')
            .eq('phone_number', normalized)
            .in('status', ['general_inquiry', 'awaiting_photo', 'awaiting_confirmation', 'processing', 'rejected'])
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        return data;
    }

    /**
     * Find employee by phone number (for user-initiated conversations)
     */
    async findEmployeeByPhone(phoneNumber: string): Promise<{
        id: string;
        clientId: string;
        firstName: string;
        lastName: string;
    } | null> {
        // Normalize phone number for matching
        const normalized = this.normalizePhoneNumber(phoneNumber);

        // Try to find by normalized phone, also try without +1 prefix for flexibility
        const variants = [
            normalized,
            normalized.replace(/^\+1/, ''),
            phoneNumber.replace(/\D/g, ''),
        ];

        for (const variant of variants) {
            // Type for employee lookup
            type EmployeeLookupResult = {
                id: string;
                client_id: string;
                first_name: string;
                last_name: string;
                phone1: string;
            };

            const { data } = await this.supabase
                .from('employees_cache')
                .select('id, client_id, first_name, last_name, phone1')
                .or(`phone1.ilike.%${variant}%`)
                .limit(1)
                .single() as { data: EmployeeLookupResult | null; error: unknown };

            if (data) {
                return {
                    id: data.id,
                    clientId: data.client_id,
                    firstName: data.first_name,
                    lastName: data.last_name,
                };
            }
        }

        return null;
    }

    /**
     * Start a general inquiry conversation (user-initiated, no specific license)
     */
    async startGeneralConversation(params: {
        clientId: string;
        employeeId: string;
        phoneNumber: string;
    }): Promise<{ conversationId: string; success: boolean; error?: string }> {
        try {
            // Check for existing active general conversation
            const normalized = this.normalizePhoneNumber(params.phoneNumber);

            type ExistingConversationResult = { id: string };

            const { data: existing } = await this.supabase
                .from('sms_conversations')
                .select('id')
                .eq('phone_number', normalized)
                .eq('status', 'general_inquiry')
                .single() as { data: ExistingConversationResult | null; error: unknown };

            if (existing) {
                return {
                    conversationId: existing.id,
                    success: true,
                };
            }

            // Create new general inquiry conversation (no license_id)
            const { data, error } = await this.supabase
                .from('sms_conversations')
                .insert({
                    client_id: params.clientId,
                    employee_id: params.employeeId,
                    license_id: null, // No specific license for general inquiries
                    phone_number: normalized,
                    status: 'general_inquiry',
                } as never)
                .select('id')
                .single() as { data: { id: string } | null; error: unknown };

            if (error || !data) {
                console.error('Failed to create general conversation:', error);
                return { conversationId: '', success: false, error: String(error) };
            }

            return { conversationId: data.id, success: true };
        } catch (error) {
            console.error('Error starting general conversation:', error);
            return {
                conversationId: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Get full conversation context for processing
     */
    async getConversationContext(conversationId: string): Promise<ConversationContext | null> {
        // Type for context query with relationships (license is optional for general inquiries)
        type ContextQueryResult = {
            id: string;
            phone_number: string;
            employee_id: string;
            license_id: string | null;
            client_id: string;
            employees_cache: { first_name: string; last_name: string; winteam_employee_number: string };
            licenses_cache: {
                description: string;
                winteam_compliance_id: string;
                matched_state: string | null;
                matched_license_type: string | null;
            } | null;
        };

        const { data } = await this.supabase
            .from('sms_conversations')
            .select(`
                id,
                phone_number,
                employee_id,
                license_id,
                client_id,
                employees_cache!inner (
                    first_name,
                    last_name,
                    winteam_employee_number
                ),
                licenses_cache (
                    description,
                    winteam_compliance_id,
                    matched_state,
                    matched_license_type
                )
            `)
            .eq('id', conversationId)
            .single() as { data: ContextQueryResult | null; error: unknown };

        if (!data) return null;

        // Type-safe extraction of relationships
        const employee = extractSingle(data.employees_cache);
        if (!employee) return null;

        // License is optional for general inquiry conversations
        const license = data.licenses_cache ? extractSingle(data.licenses_cache) : null;

        return {
            conversationId: data.id,
            employeeId: data.employee_id,
            licenseId: data.license_id,
            clientId: data.client_id,
            phoneNumber: data.phone_number,
            employeeName: `${employee.first_name} ${employee.last_name}`,
            licenseName: license?.description || null,
            matchedState: license?.matched_state || null,
            matchedLicenseType: license?.matched_license_type || null,
            winteamEmployeeNumber: parseInt(employee.winteam_employee_number, 10),
            winteamComplianceId: license ? parseInt(license.winteam_compliance_id, 10) : null,
        };
    }

    /**
     * Get conversation history from message log
     */
    async getConversationHistory(conversationId: string, limit: number = 10): Promise<ConversationMessage[]> {
        // Type for message log query
        type MessageLogResult = { direction: string; body: string | null; created_at: string };

        const { data } = await this.supabase
            .from('sms_message_log')
            .select('direction, body, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })
            .limit(limit) as { data: MessageLogResult[] | null; error: unknown };

        if (!data) return [];

        return data.map((msg) => ({
            role: msg.direction === 'inbound' ? 'user' : 'assistant',
            content: msg.body || '',
            timestamp: new Date(msg.created_at),
        }));
    }

    // ========================================================================
    // Message Handlers
    // ========================================================================

    /**
     * Handle incoming photo (MMS)
     */
    async handlePhoto(
        conversationId: string,
        imageUrl: string,
        mediaType?: string
    ): Promise<ProcessPhotoResult> {
        const context = await this.getConversationContext(conversationId);
        if (!context) {
            return { success: false, expirationDate: null, licenseNumber: null, confidence: 0, error: 'Conversation not found' };
        }

        // Update status to processing
        await this.updateConversationStatus(conversationId, 'processing');

        // Send acknowledgment (can be enhanced with AI later if needed)
        await smsService.send({
            to: context.phoneNumber,
            body: messageTemplates.photoReceived(),
        });

        // Extract data using vision service
        const extraction = await visionService.extractLicenseData({
            imageUrl,
            employeeName: context.employeeName,
        });

        if (!extraction.success || !extraction.expirationDate) {
            // Extraction failed - go to rejected state for retry
            await this.updateConversationStatus(conversationId, 'rejected');
            await smsService.send({
                to: context.phoneNumber,
                body: messageTemplates.extractionFailed(),
            });
            return {
                success: false,
                expirationDate: null,
                licenseNumber: null,
                confidence: 0,
                error: extraction.error || 'Could not extract expiration date',
            };
        }

        // Use AI matching service to match license to state and license type
        let matchedState: string | null = extraction.state;
        let matchedLicenseType: string | null = extraction.licenseType;
        let matchedDisplayName: string | null = null;
        let matchingConfidence: number | null = null;

        if (licenseMatchingService.isConfigured()) {
            try {
                // Type for employee location query
                type EmployeeLocationResult = { location_id: number | null };

                // Get employee location for context
                const { data: employee } = await this.supabase
                    .from('employees_cache')
                    .select('location_id')
                    .eq('id', context.employeeId)
                    .single() as { data: EmployeeLocationResult | null; error: unknown };

                const matchResult = await licenseMatchingService.matchLicense({
                    description: context.licenseName || '',
                    stateCode: extraction.state,
                    extractedState: extraction.state,
                    extractedLicenseType: extraction.licenseType,
                    employeeLocation: employee?.location_id?.toString() || null,
                });

                if (matchResult.success) {
                    matchedState = matchResult.matchedState || extraction.state;
                    matchedLicenseType = matchResult.matchedLicenseType || extraction.licenseType;
                    matchedDisplayName = matchResult.matchedDisplayName;
                    matchingConfidence = matchResult.confidence;

                    // Validate the match
                    if (!matchResult.validation.isValid) {
                        console.warn(
                            `License match validation failed for ${context.licenseName}: ` +
                            matchResult.validation.issues.join(', ')
                        );
                    }
                }
            } catch (error) {
                console.error('Error matching license from photo:', error);
                // Continue with extraction data even if matching fails
            }
        }

        // Store pending renewal with matched license type
        const { error: insertError } = await this.supabase
            .from('pending_renewals')
            .insert({
                conversation_id: conversationId,
                image_url: imageUrl,
                image_media_type: mediaType,
                extracted_expiration_date: extraction.expirationDate,
                extracted_license_number: extraction.licenseNumber,
                extracted_license_type: matchedLicenseType || extraction.licenseType,
                extracted_state: matchedState || extraction.state,
                extracted_holder_name: extraction.holderName,
                extraction_confidence: extraction.confidence,
                raw_extraction_response: extraction.rawResponse as unknown,
            } as never);

        if (insertError) {
            console.error('Failed to store pending renewal:', insertError);
        }

        // Update to awaiting confirmation
        await this.updateConversationStatus(conversationId, 'awaiting_confirmation');

        // Format the date for display
        const displayDate = this.formatDateForDisplay(extraction.expirationDate);

        // Send confirmation request
        await smsService.send({
            to: context.phoneNumber,
            body: messageTemplates.confirmExtraction({
                expirationDate: displayDate,
                licenseNumber: extraction.licenseNumber || 'Not detected',
                confidence: extraction.confidence,
            }),
        });

        return {
            success: true,
            expirationDate: extraction.expirationDate,
            licenseNumber: extraction.licenseNumber,
            confidence: extraction.confidence,
        };
    }

    /**
     * Handle confirmation (YES/NO) - can be called with boolean or use AI to determine
     */
    async handleConfirmation(conversationId: string, confirmed: boolean): Promise<SyncResult> {
        const context = await this.getConversationContext(conversationId);
        if (!context) {
            return { success: false, error: 'Conversation not found' };
        }

        if (!confirmed) {
            // User wants to retry - go back to awaiting photo
            await this.updateConversationStatus(conversationId, 'rejected');

            // Get conversation history for context-aware response
            const history = await this.getConversationHistory(conversationId);
            let response = `ReguGuard: No problem! Please send a new photo of your license.`;

            // Use AI to generate empathetic response if available
            if (nlpService.isConfigured()) {
                try {
                    const aiResponse = await nlpService.generateResponse(
                        { intent: 'reject', confidence: 1.0 },
                        context,
                        history,
                        'rejected'
                    );
                    if (aiResponse) {
                        response = aiResponse;
                    }
                } catch (error) {
                    console.error('Error generating AI response:', error);
                }
            }

            await smsService.send({
                to: context.phoneNumber,
                body: response,
            });
            return { success: true };
        }

        // Type for pending renewal query
        type PendingRenewalResult = {
            id: string;
            extracted_expiration_date: string | null;
            extracted_license_number: string | null;
            extracted_license_type: string | null;
            extracted_state: string | null;
        };

        // Get the pending renewal
        const { data: renewal } = await this.supabase
            .from('pending_renewals')
            .select('*')
            .eq('conversation_id', conversationId)
            .eq('confirmed', false)
            .order('created_at', { ascending: false })
            .limit(1)
            .single() as { data: PendingRenewalResult | null; error: unknown };

        if (!renewal) {
            return { success: false, error: 'No pending renewal found' };
        }

        // Mark as confirmed
        await this.supabase
            .from('pending_renewals')
            .update({
                confirmed: true,
                confirmed_at: new Date().toISOString(),
            } as never)
            .eq('id', renewal.id);

        // Update conversation status
        await this.updateConversationStatus(conversationId, 'confirmed');

        // Sync to WinTeam
        const syncResult = await this.syncToWinTeam(renewal.id, context);

        if (syncResult.success) {
            await this.updateConversationStatus(conversationId, 'completed');

            // Get conversation history for personalized success message
            const history = await this.getConversationHistory(conversationId);
            let successMessage = messageTemplates.updateSuccess();

            // Use AI to generate personalized success message if available
            if (nlpService.isConfigured()) {
                try {
                    const aiResponse = await nlpService.generateResponse(
                        { intent: 'confirm', confidence: 1.0 },
                        context,
                        history,
                        'completed',
                        { action: 'license_updated' }
                    );
                    if (aiResponse && aiResponse.length > 0) {
                        successMessage = aiResponse;
                    }
                } catch (error) {
                    console.error('Error generating AI success message:', error);
                }
            }

            await smsService.send({
                to: context.phoneNumber,
                body: successMessage,
            });
        } else {
            await this.updateConversationStatus(conversationId, 'failed');

            // Get conversation history for empathetic error message
            const history = await this.getConversationHistory(conversationId);
            let errorMessage = messageTemplates.syncFailed();

            // Use AI to generate empathetic error message if available
            if (nlpService.isConfigured()) {
                try {
                    const aiResponse = await nlpService.generateResponse(
                        { intent: 'frustration', confidence: 0.8 },
                        context,
                        history,
                        'failed',
                        { error: 'sync_failed' }
                    );
                    if (aiResponse && aiResponse.length > 0) {
                        errorMessage = aiResponse;
                    }
                } catch (error) {
                    console.error('Error generating AI error message:', error);
                }
            }

            await smsService.send({
                to: context.phoneNumber,
                body: errorMessage,
            });
        }

        return syncResult;
    }

    /**
     * Handle text commands using AI-powered natural language understanding
     */
    async handleTextCommand(
        conversationId: string,
        message: string
    ): Promise<{ handled: boolean; response?: string; intent?: string }> {
        const context = await this.getConversationContext(conversationId);
        if (!context) {
            return { handled: false };
        }

        // Type for status query
        type ConversationStatusResult = { status: string };

        // Get current conversation status
        const { data: conversation } = await this.supabase
            .from('sms_conversations')
            .select('status')
            .eq('id', conversationId)
            .single() as { data: ConversationStatusResult | null; error: unknown };

        const currentStatus = conversation?.status || 'awaiting_photo';

        // Get conversation history for context
        const history = await this.getConversationHistory(conversationId);

        // Use NLP service to understand the message
        if (nlpService.isConfigured()) {
            try {
                const analysis = await nlpService.analyzeMessage(
                    message,
                    context,
                    history,
                    currentStatus
                );

                const intent = analysis.intent.intent;
                const confidence = analysis.intent.confidence;

                // Handle based on intent (only if confidence is high enough)
                if (confidence >= 0.7) {
                    switch (intent) {
                        case 'confirm':
                            // Handle confirmation
                            await this.handleConfirmation(conversationId, true);
                            return { handled: true, response: 'confirmed', intent };

                        case 'reject':
                            // Handle rejection
                            await this.handleConfirmation(conversationId, false);
                            return { handled: true, response: 'rejected', intent };

                        case 'help':
                            // Send help message
                            const helpResponse = analysis.response || messageTemplates.help();
                            await smsService.send({
                                to: context.phoneNumber,
                                body: helpResponse,
                            });
                            return { handled: true, response: 'help', intent };

                        case 'cancel':
                            // Cancel conversation
                            await this.updateConversationStatus(conversationId, 'expired');
                            const cancelResponse = analysis.response ||
                                `ReguGuard: Your renewal request has been cancelled. Contact your supervisor if you need assistance.`;
                            await smsService.send({
                                to: context.phoneNumber,
                                body: cancelResponse,
                            });
                            return { handled: true, response: 'cancelled', intent };

                        case 'retry':
                            // Request new photo
                            await this.updateConversationStatus(conversationId, 'rejected');
                            const retryResponse = analysis.response ||
                                `ReguGuard: No problem! Please send a new photo of your license.`;
                            await smsService.send({
                                to: context.phoneNumber,
                                body: retryResponse,
                            });
                            return { handled: true, response: 'retry', intent };

                        case 'question':
                            // Answer compliance questions using web-grounded QA
                            const stateEntity = analysis.intent.entities?.find((entity) => entity.type === 'state');
                            const licenseTypeEntity = analysis.intent.entities?.find((entity) => entity.type === 'license_type');
                            const qaResult = await complianceQAService.answerQuestion({
                                question: message,
                                context,
                                stateCode: stateEntity?.value,
                                licenseType: licenseTypeEntity?.value || context.matchedLicenseType || null,
                            });

                            if (qaResult.followUpQuestion) {
                                await smsService.send({
                                    to: context.phoneNumber,
                                    body: qaResult.followUpQuestion,
                                });
                                return { handled: true, response: 'question_clarification', intent };
                            }

                            if (qaResult.answer) {
                                const citations = qaResult.sources.slice(0, 2);
                                const responseBody = citations.length > 0
                                    ? `${qaResult.answer} Sources: ${citations.join(' ')}`
                                    : qaResult.answer;

                                await smsService.sendLong({
                                    to: context.phoneNumber,
                                    body: responseBody,
                                });
                                return { handled: true, response: 'question_answered', intent };
                            }

                            // Fallback to AI-generated response if QA fails
                            const fallbackResponse = analysis.response ||
                                await nlpService.generateResponse(
                                    analysis.intent,
                                    context,
                                    history,
                                    currentStatus,
                                    { question: message }
                                );
                            await smsService.send({
                                to: context.phoneNumber,
                                body: fallbackResponse,
                            });
                            return { handled: true, response: 'question_answered', intent };

                        case 'frustration':
                        case 'urgency':
                            // Acknowledge frustration/urgency with empathetic response
                            const empatheticResponse = analysis.response ||
                                `ReguGuard: I understand this is important. Let me help you get this resolved quickly. ` +
                                `Please send a photo of your license, or reply HELP for assistance.`;
                            await smsService.send({
                                to: context.phoneNumber,
                                body: empatheticResponse,
                            });
                            return { handled: true, response: 'acknowledged', intent };

                        case 'greeting':
                            // Friendly greeting response
                            const greetingResponse = analysis.response ||
                                `Hi! I'm here to help with your ${context.licenseName} renewal. ` +
                                `Please send a photo of your renewed license.`;
                            await smsService.send({
                                to: context.phoneNumber,
                                body: greetingResponse,
                            });
                            return { handled: true, response: 'greeting', intent };

                        default:
                            // Unknown intent - use AI-generated response if available
                            if (analysis.response) {
                                await smsService.send({
                                    to: context.phoneNumber,
                                    body: analysis.response,
                                });
                                return { handled: true, response: 'ai_response', intent };
                            }
                            break;
                    }
                }
            } catch (error) {
                console.error('NLP processing error:', error);
                // Fall through to fallback handling
            }
        }

        // Fallback to rule-based matching if AI is not available or failed
        return this.handleTextCommandFallback(conversationId, message, context, currentStatus);
    }

    /**
     * Fallback rule-based command handling (when AI is unavailable)
     */
    private async handleTextCommandFallback(
        conversationId: string,
        message: string,
        context: ConversationContext,
        currentStatus: string
    ): Promise<{ handled: boolean; response?: string }> {
        const normalized = message.trim().toUpperCase();

        switch (normalized) {
            case 'HELP':
            case 'INFO':
                await smsService.send({
                    to: context.phoneNumber,
                    body: messageTemplates.help(),
                });
                return { handled: true, response: 'help' };

            case 'YES':
            case 'Y':
            case 'CONFIRM':
                await this.handleConfirmation(conversationId, true);
                return { handled: true, response: 'confirmed' };

            case 'NO':
            case 'N':
            case 'RETRY':
                await this.handleConfirmation(conversationId, false);
                return { handled: true, response: 'rejected' };

            case 'STOP':
            case 'CANCEL':
                await this.updateConversationStatus(conversationId, 'expired');
                await smsService.send({
                    to: context.phoneNumber,
                    body: `ReguGuard: Your renewal request has been cancelled. Contact your supervisor if you need assistance.`,
                });
                return { handled: true, response: 'cancelled' };

            default:
                // Send context-aware unknown command message
                if (currentStatus === 'awaiting_photo' || currentStatus === 'rejected') {
                    await smsService.send({
                        to: context.phoneNumber,
                        body: messageTemplates.requestPhoto({
                            licenseName: context.licenseName || 'your license',
                            expirationDate: 'soon',
                        }),
                    });
                } else if (currentStatus === 'awaiting_confirmation') {
                    await smsService.send({
                        to: context.phoneNumber,
                        body: `ReguGuard: Please reply YES to confirm your license info, or NO to submit a new photo.`,
                    });
                } else {
                    await smsService.send({
                        to: context.phoneNumber,
                        body: messageTemplates.unknownCommand(),
                    });
                }
                return { handled: false };
        }
    }

    // ========================================================================
    // WinTeam Sync
    // ========================================================================

    /**
     * Sync confirmed renewal to WinTeam
     */
    private async syncToWinTeam(renewalId: string, context: ConversationContext): Promise<SyncResult> {
        try {
            // Type for renewal in syncToWinTeam
            type SyncRenewalResult = {
                extracted_expiration_date: string | null;
                extracted_license_number: string | null;
                extracted_license_type: string | null;
                extracted_state: string | null;
            };

            // Get the renewal data
            const { data: renewal } = await this.supabase
                .from('pending_renewals')
                .select('*')
                .eq('id', renewalId)
                .single() as { data: SyncRenewalResult | null; error: unknown };

            if (!renewal) {
                return { success: false, error: 'Renewal not found' };
            }

            // Get WinTeam client
            const winTeamClient = getWinTeamClient({
                baseUrl: process.env.WINTEAM_API_URL || 'https://apim.myteamsoftware.com/wtnextgen/employees/v1',
                tenantId: process.env.WINTEAM_TENANT_ID || '',
            });

            // Build update payload
            const updates: {
                expirationDate?: string;
                licenseNumber?: string;
                licenseStageId?: number;
                notes?: string;
            } = {};

            if (renewal.extracted_expiration_date) {
                updates.expirationDate = renewal.extracted_expiration_date;
                updates.licenseStageId = 1; // Set to Active
            }

            if (renewal.extracted_license_number) {
                updates.licenseNumber = renewal.extracted_license_number;
            }

            updates.notes = `Updated via ReguGuard SMS on ${new Date().toISOString().split('T')[0]}`;

            // Can only sync if we have the WinTeam IDs
            if (context.winteamComplianceId === null) {
                return { success: false, error: 'No license associated with this conversation' };
            }

            // Call WinTeam API
            const result = await winTeamClient.updateComplianceItem(
                context.winteamEmployeeNumber,
                context.winteamComplianceId,
                updates
            );

            // Update renewal record
            await this.supabase
                .from('pending_renewals')
                .update({
                    synced_to_winteam: result.success,
                    synced_at: new Date().toISOString(),
                    sync_error: result.error || null,
                } as never)
                .eq('id', renewalId);

            // Also update our local license cache with matched license type
            if (result.success && renewal.extracted_expiration_date) {
                const updateData: {
                    expiration_date: string;
                    license_number: string | null;
                    license_stage: string;
                    last_synced: string;
                    matched_state?: string | null;
                    matched_license_type?: string | null;
                    matched_display_name?: string | null;
                    matching_confidence?: number | null;
                    matched_at?: string;
                } = {
                    expiration_date: renewal.extracted_expiration_date,
                    license_number: renewal.extracted_license_number || null,
                    license_stage: 'Active',
                    last_synced: new Date().toISOString(),
                };

                // Add matched fields if available from pending renewal
                if (renewal.extracted_state) {
                    updateData.matched_state = renewal.extracted_state;
                }
                if (renewal.extracted_license_type) {
                    updateData.matched_license_type = renewal.extracted_license_type;
                    updateData.matched_at = new Date().toISOString();
                }

                if (context.licenseId) {
                    await this.supabase
                        .from('licenses_cache')
                        .update(updateData as never)
                        .eq('id', context.licenseId);
                }
            }

            return {
                success: result.success,
                error: result.error,
            };
        } catch (error) {
            console.error('WinTeam sync error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown sync error',
            };
        }
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    /**
     * Update conversation status with validation
     */
    private async updateConversationStatus(
        conversationId: string,
        newStatus: ConversationStatus
    ): Promise<boolean> {
        // Type for status query
        type StatusQueryResult = { status: string };

        const { data: current } = await this.supabase
            .from('sms_conversations')
            .select('status')
            .eq('id', conversationId)
            .single() as { data: StatusQueryResult | null; error: unknown };

        if (!current) return false;

        const currentStatus = current.status as ConversationStatus;
        const validTransitions = VALID_TRANSITIONS[currentStatus];

        if (!validTransitions.includes(newStatus)) {
            console.warn(`Invalid state transition: ${currentStatus} -> ${newStatus}`);
            // Allow it anyway for flexibility, but log warning
        }

        const { error } = await this.supabase
            .from('sms_conversations')
            .update({
                status: newStatus,
                last_message_at: new Date().toISOString(),
            } as never)
            .eq('id', conversationId);

        return !error;
    }

    /**
     * Expire stale conversations (called by cron)
     */
    async expireStaleConversations(): Promise<number> {
        // Type for expire result
        type ExpireResult = { id: string };

        const { data, error } = await this.supabase
            .from('sms_conversations')
            .update({ status: 'expired' as ConversationStatus } as never)
            .in('status', ['awaiting_photo', 'awaiting_confirmation', 'rejected'])
            .lt('expires_at', new Date().toISOString())
            .select('id') as { data: ExpireResult[] | null; error: unknown };

        if (error) {
            console.error('Error expiring conversations:', error);
            return 0;
        }

        // Send expiration messages
        for (const conv of data || []) {
            const context = await this.getConversationContext(conv.id);
            if (context) {
                await smsService.send({
                    to: context.phoneNumber,
                    body: messageTemplates.conversationExpired(),
                });
            }
        }

        return data?.length || 0;
    }

    /**
     * Normalize phone number to E.164 format
     */
    private normalizePhoneNumber(phone: string): string {
        // Remove all non-digit characters
        const digits = phone.replace(/\D/g, '');

        // If 10 digits, assume US and add +1
        if (digits.length === 10) {
            return `+1${digits}`;
        }

        // If 11 digits starting with 1, add +
        if (digits.length === 11 && digits.startsWith('1')) {
            return `+${digits}`;
        }

        // Otherwise, add + if not present
        return phone.startsWith('+') ? phone : `+${digits}`;
    }

    /**
     * Format date for SMS display
     */
    private formatDateForDisplay(isoDate: string): string {
        try {
            const date = new Date(isoDate);
            return date.toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            });
        } catch {
            return isoDate;
        }
    }
}

// Export singleton
export const conversationService = new ConversationService();
