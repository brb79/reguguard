/**
 * NLP Service - Natural Language Processing for SMS Conversations
 * 
 * Uses Google Gemini Pro to understand natural language in SMS conversations,
 * classify intents, analyze sentiment, and generate context-aware responses.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getEnv } from '@/lib/env';
import type { ConversationContext } from '../conversations/types';

// ============================================================================
// Types
// ============================================================================

export interface IntentClassification {
    intent: ConversationIntent;
    confidence: number; // 0-1
    entities?: ExtractedEntity[];
    language?: string; // Detected language code (e.g., 'en', 'es')
}

export type ConversationIntent =
    | 'confirm'           // User confirms extracted data ("yes", "correct", "that's right")
    | 'reject'            // User rejects extracted data ("no", "wrong", "incorrect")
    | 'question'          // User asks a question ("when does it expire?", "what do I need?")
    | 'help'              // User needs help ("help", "what can I do?")
    | 'cancel'            // User wants to cancel ("stop", "cancel")
    | 'retry'             // User wants to retry ("send another", "new photo")
    | 'greeting'          // Greeting ("hi", "hello")
    | 'frustration'       // User is frustrated ("this is taking too long", "why is this so hard")
    | 'urgency'           // User expresses urgency ("need this done today", "urgent")
    | 'unknown';          // Could not classify

export interface ExtractedEntity {
    type: 'date' | 'license_number' | 'state' | 'phone' | 'email' | 'name';
    value: string;
    confidence: number;
}

export interface SentimentAnalysis {
    sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated' | 'urgent';
    score: number; // -1 (very negative) to 1 (very positive)
    urgency: number; // 0-1, how urgent the message is
    frustration: number; // 0-1, how frustrated the user seems
}

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export interface NLPAnalysis {
    intent: IntentClassification;
    sentiment: SentimentAnalysis;
    suggestedAction?: SuggestedAction;
    response?: string; // AI-generated contextual response
}

export interface SuggestedAction {
    action: 'confirm' | 'reject' | 'request_photo' | 'provide_help' | 'escalate' | 'acknowledge';
    reason: string;
    priority: 'low' | 'medium' | 'high';
}

// ============================================================================
// Prompts
// ============================================================================

const INTENT_CLASSIFICATION_PROMPT = `You are an expert at understanding SMS messages in the context of security guard license renewal conversations.

The user is an employee who received an SMS alert about their expiring license. They may:
- Confirm or reject extracted license data
- Ask questions about their license or renewal process
- Request help
- Express frustration or urgency
- Send greetings or casual messages

Analyze the following message and classify the intent. Consider:
- Natural language variations ("sure", "that's correct", "yep", "nope", "wrong date", "I'll send another")
- Questions ("when does it expire?", "what do I need?", "how do I renew?")
- Multi-language support (Spanish, etc.)
- Sentiment and emotional tone

Current conversation context:
- Status: {status}
- License: {licenseName}
- Employee: {employeeName}

Recent conversation history:
{history}

User message: "{message}"

Respond with ONLY a valid JSON object in this exact format:
{
    "intent": "confirm|reject|question|help|cancel|retry|greeting|frustration|urgency|unknown",
    "confidence": 0.0-1.0,
    "language": "en|es|other",
    "entities": [
        {
            "type": "date|license_number|state|phone|email|name",
            "value": "extracted value",
            "confidence": 0.0-1.0
        }
    ],
    "sentiment": {
        "sentiment": "positive|neutral|negative|frustrated|urgent",
        "score": -1.0 to 1.0,
        "urgency": 0.0-1.0,
        "frustration": 0.0-1.0
    },
    "reasoning": "brief explanation of classification"
}`;

const RESPONSE_GENERATION_PROMPT = `You are a helpful SMS assistant for ReguGuard, a compliance platform for security guard license renewals.

Context:
- Employee: {employeeName}
- License: {licenseName}
- Current Status: {status}
- Detected Intent: {intent}
- Sentiment: {sentiment}

Recent conversation:
{history}

User just said: "{message}"

Generate a helpful, friendly, and concise SMS response (max 160 characters, SMS-friendly). 
- Be empathetic if user is frustrated
- Answer questions clearly
- Provide actionable next steps
- Match the user's language if not English
- Keep it professional but warm

Respond with ONLY a JSON object:
{
    "response": "your SMS response text",
    "suggestedAction": {
        "action": "confirm|reject|request_photo|provide_help|escalate|acknowledge",
        "reason": "why this action",
        "priority": "low|medium|high"
    }
}`;

// ============================================================================
// Service
// ============================================================================

class NLPService {
    private genAI: GoogleGenerativeAI | null = null;
    private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;

    constructor() {
        try {
            const env = getEnv();
            const apiKey = env.GOOGLE_AI_API_KEY;
            if (apiKey) {
                this.genAI = new GoogleGenerativeAI(apiKey);
                // Use gemini-1.5-pro for better understanding, fallback to flash
                this.model = this.genAI.getGenerativeModel({ 
                    model: 'gemini-1.5-pro',
                    // Use flash for faster responses if needed
                    // model: 'gemini-1.5-flash',
                });
            }
        } catch (error) {
            // Environment not validated yet, use process.env as fallback
            const apiKey = process.env.GOOGLE_AI_API_KEY;
            if (apiKey) {
                this.genAI = new GoogleGenerativeAI(apiKey);
                this.model = this.genAI.getGenerativeModel({ 
                    model: 'gemini-1.5-pro',
                });
            }
        }
    }

    /**
     * Check if NLP service is configured
     */
    isConfigured(): boolean {
        return this.genAI !== null && this.model !== null;
    }

    /**
     * Analyze a user message with full NLP capabilities
     */
    async analyzeMessage(
        message: string,
        context: ConversationContext,
        conversationHistory: ConversationMessage[] = [],
        currentStatus: string
    ): Promise<NLPAnalysis> {
        if (!this.model) {
            return this.getFallbackAnalysis(message);
        }

        try {
            // Build conversation history string
            const historyText = this.formatHistory(conversationHistory);

            // Build classification prompt
            const classificationPrompt = INTENT_CLASSIFICATION_PROMPT
                .replace('{status}', currentStatus)
                .replace('{licenseName}', context.licenseName)
                .replace('{employeeName}', context.employeeName)
                .replace('{history}', historyText || 'No previous messages')
                .replace('{message}', message);

            // Classify intent and sentiment
            const classificationResult = await this.model.generateContent(classificationPrompt);
            const classificationText = classificationResult.response.text();
            const classification = this.parseClassificationResponse(classificationText);

            // Generate contextual response
            const responsePrompt = RESPONSE_GENERATION_PROMPT
                .replace('{employeeName}', context.employeeName)
                .replace('{licenseName}', context.licenseName)
                .replace('{status}', currentStatus)
                .replace('{intent}', classification.intent.intent)
                .replace('{sentiment}', classification.intent.sentiment?.sentiment || 'neutral')
                .replace('{history}', historyText || 'No previous messages')
                .replace('{message}', message);

            const responseResult = await this.model.generateContent(responsePrompt);
            const responseText = responseResult.response.text();
            const response = this.parseResponseGeneration(responseText);

            return {
                intent: classification.intent,
                sentiment: classification.sentiment,
                suggestedAction: response.suggestedAction,
                response: response.response,
            };
        } catch (error) {
            console.error('NLP analysis error:', error);
            return this.getFallbackAnalysis(message);
        }
    }

    /**
     * Classify intent from a message (simpler, faster version)
     */
    async classifyIntent(
        message: string,
        context: ConversationContext,
        conversationHistory: ConversationMessage[] = [],
        currentStatus: string
    ): Promise<IntentClassification> {
        if (!this.model) {
            return this.getFallbackIntent(message);
        }

        try {
            const historyText = this.formatHistory(conversationHistory);
            const prompt = INTENT_CLASSIFICATION_PROMPT
                .replace('{status}', currentStatus)
                .replace('{licenseName}', context.licenseName)
                .replace('{employeeName}', context.employeeName)
                .replace('{history}', historyText || 'No previous messages')
                .replace('{message}', message);

            const result = await this.model.generateContent(prompt);
            const text = result.response.text();
            const parsed = this.parseClassificationResponse(text);

            return parsed.intent;
        } catch (error) {
            console.error('Intent classification error:', error);
            return this.getFallbackIntent(message);
        }
    }

    /**
     * Analyze sentiment from a message
     */
    async analyzeSentiment(message: string): Promise<SentimentAnalysis> {
        if (!this.model) {
            return {
                sentiment: 'neutral',
                score: 0,
                urgency: 0,
                frustration: 0,
            };
        }

        try {
            const prompt = `Analyze the sentiment of this SMS message. Respond with JSON:
{
    "sentiment": "positive|neutral|negative|frustrated|urgent",
    "score": -1.0 to 1.0,
    "urgency": 0.0-1.0,
    "frustration": 0.0-1.0
}

Message: "${message}"`;

            const result = await this.model.generateContent(prompt);
            const text = result.response.text();
            const parsed = this.parseJsonResponse<{ sentiment: SentimentAnalysis }>(text);

            return parsed.sentiment || {
                sentiment: 'neutral',
                score: 0,
                urgency: 0,
                frustration: 0,
            };
        } catch (error) {
            console.error('Sentiment analysis error:', error);
            return {
                sentiment: 'neutral',
                score: 0,
                urgency: 0,
                frustration: 0,
            };
        }
    }

    /**
     * Generate a contextual response based on intent and conversation history
     */
    async generateResponse(
        intent: IntentClassification,
        context: ConversationContext,
        conversationHistory: ConversationMessage[] = [],
        currentStatus: string,
        additionalContext?: Record<string, string>
    ): Promise<string> {
        if (!this.model) {
            return this.getFallbackResponse(intent.intent, currentStatus);
        }

        try {
            const historyText = this.formatHistory(conversationHistory);
            let prompt = RESPONSE_GENERATION_PROMPT
                .replace('{employeeName}', context.employeeName)
                .replace('{licenseName}', context.licenseName)
                .replace('{status}', currentStatus)
                .replace('{intent}', intent.intent)
                .replace('{sentiment}', 'neutral')
                .replace('{history}', historyText || 'No previous messages')
                .replace('{message}', 'User message');

            if (additionalContext) {
                prompt += `\n\nAdditional context:\n${JSON.stringify(additionalContext, null, 2)}`;
            }

            const result = await this.model.generateContent(prompt);
            const text = result.response.text();
            const parsed = this.parseResponseGeneration(text);

            return parsed.response || this.getFallbackResponse(intent.intent, currentStatus);
        } catch (error) {
            console.error('Response generation error:', error);
            return this.getFallbackResponse(intent.intent, currentStatus);
        }
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Format conversation history for prompts
     */
    private formatHistory(history: ConversationMessage[]): string {
        if (history.length === 0) return '';

        // Take last 5 messages for context (to stay within token limits)
        const recent = history.slice(-5);
        return recent
            .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
            .join('\n');
    }

    /**
     * Parse classification response from AI
     */
    private parseClassificationResponse(text: string): {
        intent: IntentClassification;
        sentiment: SentimentAnalysis;
    } {
        try {
            const parsed = this.parseJsonResponse<{
                intent: ConversationIntent;
                confidence: number;
                language?: string;
                entities?: ExtractedEntity[];
                sentiment: SentimentAnalysis;
                reasoning?: string;
            }>(text);

            return {
                intent: {
                    intent: parsed.intent || 'unknown',
                    confidence: parsed.confidence || 0,
                    language: parsed.language,
                    entities: parsed.entities,
                },
                sentiment: parsed.sentiment || {
                    sentiment: 'neutral',
                    score: 0,
                    urgency: 0,
                    frustration: 0,
                },
            };
        } catch (error) {
            console.error('Failed to parse classification response:', error);
            return {
                intent: { intent: 'unknown', confidence: 0 },
                sentiment: {
                    sentiment: 'neutral',
                    score: 0,
                    urgency: 0,
                    frustration: 0,
                },
            };
        }
    }

    /**
     * Parse response generation from AI
     */
    private parseResponseGeneration(text: string): {
        response: string;
        suggestedAction?: SuggestedAction;
    } {
        try {
            const parsed = this.parseJsonResponse<{
                response: string;
                suggestedAction?: SuggestedAction;
            }>(text);

            return {
                response: parsed.response || '',
                suggestedAction: parsed.suggestedAction,
            };
        } catch (error) {
            console.error('Failed to parse response generation:', error);
            return { response: '' };
        }
    }

    /**
     * Parse JSON response, handling markdown code blocks
     */
    private parseJsonResponse<T>(text: string): T {
        try {
            // Try direct parse first
            return JSON.parse(text) as T;
        } catch {
            // Try extracting from markdown code block
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1].trim()) as T;
                } catch {
                    throw new Error('Failed to parse JSON from markdown');
                }
            }

            // Try finding JSON object in text
            const objectMatch = text.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                try {
                    return JSON.parse(objectMatch[0]) as T;
                } catch {
                    throw new Error('Failed to parse JSON object');
                }
            }

            throw new Error('No JSON found in response');
        }
    }

    /**
     * Fallback analysis when AI is not available
     */
    private getFallbackAnalysis(message: string): NLPAnalysis {
        const normalized = message.trim().toUpperCase();
        let intent: ConversationIntent = 'unknown';
        let confidence = 0.5;

        if (normalized.match(/^(YES|Y|YEP|YEAH|SURE|OK|OKAY|CORRECT|THAT'S RIGHT|THATS RIGHT|RIGHT|CONFIRM)$/)) {
            intent = 'confirm';
            confidence = 0.9;
        } else if (normalized.match(/^(NO|N|NOPE|WRONG|INCORRECT|NOT RIGHT|THAT'S WRONG|THATS WRONG)$/)) {
            intent = 'reject';
            confidence = 0.9;
        } else if (normalized.match(/^(HELP|INFO|ASSISTANCE|SUPPORT)$/)) {
            intent = 'help';
            confidence = 0.9;
        } else if (normalized.match(/^(STOP|CANCEL|END)$/)) {
            intent = 'cancel';
            confidence = 0.9;
        } else if (normalized.match(/(SEND|RESEND|NEW|ANOTHER|RETRY|TRY AGAIN)/)) {
            intent = 'retry';
            confidence = 0.8;
        }

        return {
            intent: { intent, confidence },
            sentiment: {
                sentiment: 'neutral',
                score: 0,
                urgency: 0,
                frustration: 0,
            },
        };
    }

    /**
     * Fallback intent classification
     */
    private getFallbackIntent(message: string): IntentClassification {
        const analysis = this.getFallbackAnalysis(message);
        return analysis.intent;
    }

    /**
     * Fallback response generation
     */
    private getFallbackResponse(intent: ConversationIntent, status: string): string {
        switch (intent) {
            case 'confirm':
                return 'Thank you for confirming! Your license is being updated.';
            case 'reject':
                return 'No problem! Please send a new photo of your license.';
            case 'help':
                return 'ReguGuard Help: Send a photo of your renewed license, reply YES to confirm, or NO to retry.';
            case 'question':
                return 'I can help! What would you like to know about your license renewal?';
            default:
                return 'I didn\'t understand that. Reply with a photo, YES to confirm, NO to retry, or HELP for assistance.';
        }
    }
}

// Export singleton
export const nlpService = new NLPService();

