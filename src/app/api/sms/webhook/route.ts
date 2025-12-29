/**
 * Twilio SMS Webhook Handler
 * 
 * Receives incoming SMS/MMS messages from Twilio and routes them
 * to the conversation service for processing.
 */

import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { conversationService, messageTemplates } from '@/lib/conversations/service';
import { smsService } from '@/lib/sms/service';
import { Database } from '@/lib/supabase/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/errors';
import { rateLimiters } from '@/lib/ratelimit';
import { getEnv } from '@/lib/env';

// ============================================================================
// Types
// ============================================================================

interface TwilioWebhookBody {
    MessageSid: string;
    AccountSid: string;
    From: string;
    To: string;
    Body?: string;
    NumMedia?: string;
    MediaUrl0?: string;
    MediaContentType0?: string;
    MediaUrl1?: string;
    MediaContentType1?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate Twilio webhook signature
 */
function validateTwilioSignature(
    req: NextRequest,
    body: Record<string, string>
): boolean {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
        console.warn('TWILIO_AUTH_TOKEN not set, skipping signature validation');
        return true; // Allow in development
    }

    const signature = req.headers.get('x-twilio-signature');
    if (!signature) {
        console.error('Missing Twilio signature header');
        return false;
    }

    const url = process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/api/sms/webhook`
        : req.url;

    return twilio.validateRequest(authToken, signature, url, body);
}

/**
 * Log incoming message to database
 */
async function logMessage(
    supabase: ReturnType<typeof createAdminClient>,
    params: {
        conversationId: string | null;
        direction: 'inbound' | 'outbound';
        from: string;
        to: string;
        body: string | null;
        mediaUrls: string[];
        twilioSid: string;
    }
) {
    await supabase.from('sms_message_log').insert({
        conversation_id: params.conversationId,
        direction: params.direction,
        from_number: params.from,
        to_number: params.to,
        body: params.body,
        media_urls: params.mediaUrls.length > 0 ? params.mediaUrls : null,
        twilio_message_sid: params.twilioSid,
        twilio_status: 'received',
    } as never);
}

// ============================================================================
// Route Handler
// ============================================================================

export const POST = withErrorHandling(async (req: NextRequest) => {
    // Rate limiting (webhook-specific, more lenient)
    const rateLimitResponse = await rateLimiters.webhook(req);
    if (rateLimitResponse) return rateLimitResponse;
    // Parse form data from Twilio
    const formData = await req.formData();
    const body: Record<string, string> = {};
    formData.forEach((value, key) => {
        body[key] = value.toString();
    });

    // Type-safe parsing of Twilio webhook body
    const twilioBody: TwilioWebhookBody = {
        MessageSid: body.MessageSid || '',
        AccountSid: body.AccountSid || '',
        From: body.From || '',
        To: body.To || '',
        Body: body.Body,
        NumMedia: body.NumMedia,
        MediaUrl0: body.MediaUrl0,
        MediaContentType0: body.MediaContentType0,
        MediaUrl1: body.MediaUrl1,
        MediaContentType1: body.MediaContentType1,
    };

    // Validate signature in production
    const env = getEnv();
    if (env.NODE_ENV === 'production') {
        if (!validateTwilioSignature(req, body)) {
            console.error('Invalid Twilio signature');
            return new NextResponse('Forbidden', { status: 403 });
        }
    }

    // Initialize Supabase admin client
    const supabase = createAdminClient();

    // Extract message details
    const fromNumber = twilioBody.From;
    const messageBody = twilioBody.Body?.trim() || '';
    const numMedia = parseInt(twilioBody.NumMedia || '0', 10);

    // Collect media URLs
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
        const urlKey = `MediaUrl${i}` as keyof TwilioWebhookBody;
        const url = twilioBody[urlKey];
        if (url) {
            mediaUrls.push(url);
        }
    }

    console.log(`Incoming SMS from ${fromNumber}: "${messageBody}" with ${numMedia} media`);

    // Find active conversation for this phone number
    const conversation = await conversationService.getActiveConversationByPhone(fromNumber);

    // Log the incoming message
    await logMessage(supabase, {
        conversationId: conversation?.id || null,
        direction: 'inbound',
        from: fromNumber,
        to: twilioBody.To,
        body: messageBody || null,
        mediaUrls,
        twilioSid: twilioBody.MessageSid,
    });

    // If no active conversation, check if this is a known employee
    if (!conversation) {
        console.log(`No active conversation found for ${fromNumber}, checking if known employee...`);

        // Look up employee by phone number
        const employee = await conversationService.findEmployeeByPhone(fromNumber);

        if (employee) {
            console.log(`Found employee: ${employee.firstName} ${employee.lastName} (${employee.id})`);

            // Create a general inquiry conversation
            const result = await conversationService.startGeneralConversation({
                clientId: employee.clientId,
                employeeId: employee.id,
                phoneNumber: fromNumber,
            });

            if (result.success && result.conversationId) {
                console.log(`Created general conversation: ${result.conversationId}`);

                // Process the user's original message instead of sending a generic welcome
                if (messageBody) {
                    await conversationService.handleTextCommand(result.conversationId, messageBody);
                } else {
                    // Only send welcome if they didn't include a message
                    const welcomeMessage =
                        `👋 Hi ${employee.firstName}! I'm the ReguGuard Compliance Assistant.\n\n` +
                        `I can help you with:\n` +
                        `• License renewals - send a 📸 photo\n` +
                        `• Compliance questions\n` +
                        `• Expiration dates & requirements\n\n` +
                        `How can I assist you today?`;

                    await smsService.send({
                        to: fromNumber,
                        body: welcomeMessage,
                    });

                    // Log the outbound message
                    await logMessage(supabase, {
                        conversationId: result.conversationId,
                        direction: 'outbound',
                        from: twilioBody.To,
                        to: fromNumber,
                        body: welcomeMessage,
                        mediaUrls: [],
                        twilioSid: 'welcome_auto',
                    });
                }
            }
        } else {
            console.log(`Unknown phone number: ${fromNumber}`);

            // Send a response even for unknown numbers
            await smsService.send({
                to: fromNumber,
                body: `ReguGuard: We don't have your phone number in our system. Please contact your supervisor to update your contact information.`,
            });
        }

        // Return empty TwiML - responses sent via smsService
        return new NextResponse(
            '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
            {
                headers: { 'Content-Type': 'application/xml' },
            }
        );
    }

    // Handle based on conversation state and message content
    const conversationId = conversation.id;

    // Priority 1: Handle media (photos)
    if (numMedia > 0 && mediaUrls.length > 0) {
        // Process the first image
        const imageUrl = mediaUrls[0];
        const mediaType = twilioBody.MediaContentType0;

        console.log(`Processing photo for conversation ${conversationId}`);
        await conversationService.handlePhoto(conversationId, imageUrl, mediaType);

        // Return empty TwiML - we send responses via the conversation service
        return new NextResponse(
            '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
            {
                headers: { 'Content-Type': 'application/xml' },
            }
        );
    }

    // Priority 2: Handle text commands with AI-powered natural language understanding
    if (messageBody) {
        const result = await conversationService.handleTextCommand(conversationId, messageBody);

        // If not handled, the conversation service's fallback should have already sent a response
        // This is just a safety net - most cases should be handled by AI now
        if (!result.handled) {
            console.log(`Unhandled message in conversation ${conversationId}: "${messageBody}"`);
            // The conversation service's fallback handler should have already sent a response
            // but we log it for monitoring
        }
    }

    // Return empty TwiML
    return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        {
            headers: { 'Content-Type': 'application/xml' },
        }
    );
});

// Handle GET for webhook verification
export async function GET() {
    return NextResponse.json({
        status: 'ok',
        message: 'ReguGuard SMS Webhook',
        timestamp: new Date().toISOString(),
    });
}
