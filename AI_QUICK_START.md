# AI Quick Start Guide
## Implementing Intelligent SMS Conversations (Week 1)

This guide walks you through implementing the first high-impact AI feature: **Intelligent SMS Conversations**.

---

## 🎯 Goal

Replace rule-based command matching (HELP, YES, NO) with natural language understanding that can handle:
- "sure, that's right"
- "the date is wrong"
- "when does my license expire?"
- "I need help renewing"
- "that's not my license number"

---

## 📋 Prerequisites

1. Google Gemini API key (already configured for Vision)
2. Access to conversation service code
3. Test phone number for SMS testing

---

## 🏗️ Implementation Steps

### Step 1: Create NLP Service

Create `src/lib/ai/nlp-service.ts`:

```typescript
/**
 * NLP Service - Natural Language Processing for SMS conversations
 * Uses Google Gemini Pro to understand user intent and extract information
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getEnv } from '@/lib/env';

export interface IntentClassification {
    intent: 'confirm' | 'reject' | 'help' | 'question' | 'cancel' | 'unknown';
    confidence: number;
    extractedInfo?: {
        expirationDate?: string;
        licenseNumber?: string;
        correction?: string;
    };
    response?: string;
}

export interface ConversationContext {
    conversationId: string;
    status: string;
    employeeName: string;
    licenseName: string;
    extractedData?: {
        expirationDate: string;
        licenseNumber: string;
    };
    messageHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

class NLPService {
    private genAI: GoogleGenerativeAI | null = null;
    private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;

    constructor() {
        try {
            const env = getEnv();
            const apiKey = env.GOOGLE_AI_API_KEY;
            if (apiKey) {
                this.genAI = new GoogleGenerativeAI(apiKey);
                this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            }
        } catch (error) {
            const apiKey = process.env.GOOGLE_AI_API_KEY;
            if (apiKey) {
                this.genAI = new GoogleGenerativeAI(apiKey);
                this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            }
        }
    }

    isConfigured(): boolean {
        return this.genAI !== null && this.model !== null;
    }

    /**
     * Classify user intent from SMS message
     */
    async classifyIntent(
        message: string,
        context: ConversationContext
    ): Promise<IntentClassification> {
        if (!this.model) {
            return {
                intent: 'unknown',
                confidence: 0,
            };
        }

        const prompt = this.buildClassificationPrompt(message, context);

        try {
            const result = await this.model.generateContent(prompt);
            const response = result.response.text();
            return this.parseClassificationResponse(response);
        } catch (error) {
            console.error('NLP classification error:', error);
            return {
                intent: 'unknown',
                confidence: 0,
            };
        }
    }

    /**
     * Generate contextual response for user
     */
    async generateResponse(
        intent: IntentClassification,
        context: ConversationContext
    ): Promise<string> {
        if (!this.model) {
            return "I'm having trouble understanding. Please reply with YES, NO, or HELP.";
        }

        const prompt = this.buildResponsePrompt(intent, context);

        try {
            const result = await this.model.generateContent(prompt);
            return result.response.text().trim();
        } catch (error) {
            console.error('NLP response generation error:', error);
            return this.getFallbackResponse(intent.intent);
        }
    }

    private buildClassificationPrompt(
        message: string,
        context: ConversationContext
    ): string {
        return `You are an AI assistant helping security guards renew their licenses via SMS.

CONVERSATION CONTEXT:
- Employee: ${context.employeeName}
- License: ${context.licenseName}
- Current Status: ${context.status}
${context.extractedData ? `- Extracted Expiration: ${context.extractedData.expirationDate}` : ''}
${context.extractedData ? `- Extracted License #: ${context.extractedData.licenseNumber}` : ''}

RECENT MESSAGES:
${context.messageHistory.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n')}

USER'S CURRENT MESSAGE: "${message}"

Classify the user's intent. They might be:
1. CONFIRMING the extracted data is correct (yes, correct, that's right, looks good)
2. REJECTING the extracted data (no, wrong, incorrect, that's not right)
3. ASKING FOR HELP (help, info, what do I do, how do I renew)
4. ASKING A QUESTION (when does it expire, what's my license number, etc.)
5. CANCELLING the process (stop, cancel, nevermind)
6. UNKNOWN (unclear or unrelated)

Respond with ONLY a JSON object in this exact format:
{
    "intent": "confirm|reject|help|question|cancel|unknown",
    "confidence": 0.0-1.0,
    "extractedInfo": {
        "expirationDate": "YYYY-MM-DD or null",
        "licenseNumber": "string or null",
        "correction": "what the user is correcting or null"
    },
    "response": "brief suggested response or null"
}`;
    }

    private buildResponsePrompt(
        intent: IntentClassification,
        context: ConversationContext
    ): string {
        const basePrompt = `You are ReguGuard, an SMS assistant helping security guards renew licenses.

CONTEXT:
- Employee: ${context.employeeName}
- License: ${context.licenseName}
- Status: ${context.status}
${context.extractedData ? `- Extracted: ${context.extractedData.expirationDate}, #${context.extractedData.licenseNumber}` : ''}

USER INTENT: ${intent.intent} (confidence: ${intent.confidence})

Generate a helpful, concise SMS response (max 160 characters). Be friendly but professional.`;

        switch (intent.intent) {
            case 'confirm':
                return `${basePrompt}

The user confirmed the extracted license data is correct. Thank them and let them know it's being updated.`;
            case 'reject':
                return `${basePrompt}

The user said the extracted data is wrong. Ask them to send a new, clearer photo of their license.`;
            case 'help':
                return `${basePrompt}

The user needs help. Provide clear instructions based on their current status:
- If awaiting photo: explain how to send a photo
- If awaiting confirmation: explain how to confirm or reject
- Include contact info for supervisor if needed`;
            case 'question':
                return `${basePrompt}

The user asked a question. Answer helpfully based on the context. If you don't know, suggest they contact their supervisor.`;
            case 'cancel':
                return `${basePrompt}

The user wants to cancel. Acknowledge and provide next steps (contact supervisor).`;
            default:
                return `${basePrompt}

The user's message was unclear. Politely ask them to reply with YES, NO, or HELP.`;
        }
    }

    private parseClassificationResponse(response: string): IntentClassification {
        try {
            // Try direct JSON parse
            const parsed = JSON.parse(response);
            return {
                intent: parsed.intent || 'unknown',
                confidence: parsed.confidence || 0,
                extractedInfo: parsed.extractedInfo,
                response: parsed.response,
            };
        } catch {
            // Try extracting JSON from markdown
            const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1].trim());
                } catch {
                    // Fall through to default
                }
            }

            // Try finding JSON object
            const objectMatch = response.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                try {
                    return JSON.parse(objectMatch[0]);
                } catch {
                    // Fall through to default
                }
            }

            // Default fallback
            return {
                intent: 'unknown',
                confidence: 0,
            };
        }
    }

    private getFallbackResponse(intent: string): string {
        switch (intent) {
            case 'confirm':
                return '✅ Got it! Your license is being updated.';
            case 'reject':
                return 'No problem! Please send a new, clearer photo of your license.';
            case 'help':
                return 'ReguGuard Help: Send a PHOTO of your license, reply YES to confirm, NO to retry, or contact your supervisor.';
            case 'question':
                return 'For questions, please contact your supervisor or reply HELP for more info.';
            case 'cancel':
                return 'Your renewal request has been cancelled. Contact your supervisor if you need assistance.';
            default:
                return "I didn't understand that. Reply YES to confirm, NO to retry, or HELP for assistance.";
        }
    }
}

export const nlpService = new NLPService();
```

---

### Step 2: Update Conversation Service

Modify `src/lib/conversations/service.ts` to use AI:

```typescript
// Add import at top
import { nlpService } from '../ai/nlp-service';

// Replace handleTextCommand method:
async handleTextCommand(
    conversationId: string,
    command: string
): Promise<{ handled: boolean; response?: string }> {
    const context = await this.getConversationContext(conversationId);
    if (!context) {
        return { handled: false };
    }

    // Get conversation history
    const { data: messages } = await this.supabase
        .from('sms_message_log')
        .select('direction, body')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(10);

    const messageHistory = (messages || []).map(m => ({
        role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
        content: m.body || '',
    }));

    // Get pending renewal if exists
    const { data: renewal } = await this.supabase
        .from('pending_renewals')
        .select('extracted_expiration_date, extracted_license_number')
        .eq('conversation_id', conversationId)
        .eq('confirmed', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    // Build AI context
    const aiContext = {
        conversationId,
        status: context.status || 'awaiting_photo',
        employeeName: context.employeeName,
        licenseName: context.licenseName,
        extractedData: renewal ? {
            expirationDate: renewal.extracted_expiration_date || '',
            licenseNumber: renewal.extracted_license_number || '',
        } : undefined,
        messageHistory,
    };

    // Classify intent using AI
    const classification = await nlpService.classifyIntent(command, aiContext);

    // Handle based on intent
    switch (classification.intent) {
        case 'confirm':
            await this.handleConfirmation(conversationId, true);
            // Generate AI response
            const confirmResponse = await nlpService.generateResponse(classification, aiContext);
            await smsService.send({
                to: context.phoneNumber,
                body: confirmResponse,
            });
            return { handled: true, response: 'confirmed' };

        case 'reject':
            await this.handleConfirmation(conversationId, false);
            const rejectResponse = await nlpService.generateResponse(classification, aiContext);
            await smsService.send({
                to: context.phoneNumber,
                body: rejectResponse,
            });
            return { handled: true, response: 'rejected' };

        case 'help':
            const helpResponse = await nlpService.generateResponse(classification, aiContext);
            await smsService.send({
                to: context.phoneNumber,
                body: helpResponse,
            });
            return { handled: true, response: 'help' };

        case 'question':
            const questionResponse = await nlpService.generateResponse(classification, aiContext);
            await smsService.send({
                to: context.phoneNumber,
                body: questionResponse,
            });
            return { handled: true, response: 'question' };

        case 'cancel':
            await this.updateConversationStatus(conversationId, 'expired');
            const cancelResponse = await nlpService.generateResponse(classification, aiContext);
            await smsService.send({
                to: context.phoneNumber,
                body: cancelResponse,
            });
            return { handled: true, response: 'cancelled' };

        default:
            // Fallback to rule-based for unknown
            return this.handleTextCommandFallback(conversationId, command);
    }
}

// Keep old rule-based as fallback
private async handleTextCommandFallback(
    conversationId: string,
    command: string
): Promise<{ handled: boolean; response?: string }> {
    const normalized = command.trim().toUpperCase();
    const context = await this.getConversationContext(conversationId);

    if (!context) {
        return { handled: false };
    }

    // Original rule-based logic here...
    switch (normalized) {
        case 'HELP':
        case 'INFO':
            await smsService.send({
                to: context.phoneNumber,
                body: messageTemplates.help(),
            });
            return { handled: true, response: 'help' };
        // ... rest of original logic
    }
}
```

---

### Step 3: Add Message Logging

Ensure messages are logged for context. Update `src/app/api/sms/webhook/route.ts`:

```typescript
// After logging the message (around line 156), ensure conversation_id is set
await logMessage(supabase, {
    conversationId: conversation?.id || null,
    direction: 'inbound',
    from: fromNumber,
    to: twilioBody.To,
    body: messageBody || null,
    mediaUrls,
    twilioSid: twilioBody.MessageSid,
});
```

---

### Step 4: Testing

Create a test script `scripts/test-nlp.ts`:

```typescript
import { nlpService } from '../src/lib/ai/nlp-service';

const testCases = [
    { message: "yes that's correct", expected: 'confirm' },
    { message: "sure, looks good", expected: 'confirm' },
    { message: "no that's wrong", expected: 'reject' },
    { message: "the date is incorrect", expected: 'reject' },
    { message: "help me", expected: 'help' },
    { message: "when does it expire?", expected: 'question' },
    { message: "stop", expected: 'cancel' },
];

const mockContext = {
    conversationId: 'test-123',
    status: 'awaiting_confirmation',
    employeeName: 'John Doe',
    licenseName: 'Armed Security Officer',
    extractedData: {
        expirationDate: '2025-12-31',
        licenseNumber: 'ABC123',
    },
    messageHistory: [],
};

for (const test of testCases) {
    const result = await nlpService.classifyIntent(test.message, mockContext);
    console.log(`"${test.message}" -> ${result.intent} (expected: ${test.expected})`);
    console.log(`  Confidence: ${result.confidence}`);
    console.log(`  Response: ${result.response || 'N/A'}\n`);
}
```

---

## 🧪 Testing Checklist

- [ ] Test confirmation phrases ("yes", "correct", "that's right")
- [ ] Test rejection phrases ("no", "wrong", "incorrect")
- [ ] Test help requests ("help", "what do I do")
- [ ] Test questions ("when does it expire?")
- [ ] Test cancellation ("stop", "cancel")
- [ ] Test edge cases (typos, mixed case, slang)
- [ ] Verify fallback to rule-based when AI fails
- [ ] Check response times (< 2 seconds)
- [ ] Verify message length (SMS-friendly)

---

## 📊 Monitoring

Add logging to track:
- Intent classification accuracy
- Response generation time
- Fallback usage rate
- User satisfaction (if measurable)

---

## 🚀 Next Steps

After implementing this:
1. Deploy to staging
2. Test with real users
3. Collect feedback
4. Iterate on prompts
5. Move to next feature (License Matching)

---

## 💡 Tips

- **Start simple**: Begin with basic intents, add complexity later
- **Monitor costs**: Track API usage (Gemini Flash is cheap)
- **Cache responses**: Cache common queries to reduce API calls
- **A/B test**: Compare AI vs. rule-based for effectiveness
- **Iterate prompts**: Refine prompts based on real user interactions

---

**Ready to implement?** Start with Step 1 and work through each step. The entire implementation should take 2-3 days.

