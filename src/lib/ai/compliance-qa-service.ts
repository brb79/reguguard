/**
 * Compliance Q&A Service - Metadata-based compliance answers
 *
 * Uses Gemini AI with structured state metadata to answer licensing questions.
 * Provides concise, SMS-friendly guidance with official source citations.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getEnv } from '@/lib/env';
import type { StateMetadata } from '@/lib/state-requirements/types';
import type { ConversationContext } from '@/lib/conversations/types';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { qaCacheService } from './qa-cache-service';

// ============================================================================
// Types
// ============================================================================

export interface ComplianceQARequest {
    question: string;
    context: ConversationContext;
    stateCode?: string | null;
    licenseType?: string | null;
}

export interface ComplianceQAResult {
    success: boolean;
    answer: string;
    sources: string[];
    confidence: number;
    followUpQuestion?: string;
    stateCode?: string | null;
    error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const STATE_NAME_TO_CODE: Record<string, string> = {
    'alabama': 'AL',
    'alaska': 'AK',
    'arizona': 'AZ',
    'arkansas': 'AR',
    'california': 'CA',
    'colorado': 'CO',
    'connecticut': 'CT',
    'delaware': 'DE',
    'district of columbia': 'DC',
    'florida': 'FL',
    'georgia': 'GA',
    'hawaii': 'HI',
    'idaho': 'ID',
    'illinois': 'IL',
    'indiana': 'IN',
    'iowa': 'IA',
    'kansas': 'KS',
    'kentucky': 'KY',
    'louisiana': 'LA',
    'maine': 'ME',
    'maryland': 'MD',
    'massachusetts': 'MA',
    'michigan': 'MI',
    'minnesota': 'MN',
    'mississippi': 'MS',
    'missouri': 'MO',
    'montana': 'MT',
    'nebraska': 'NE',
    'nevada': 'NV',
    'new hampshire': 'NH',
    'new jersey': 'NJ',
    'new mexico': 'NM',
    'new york': 'NY',
    'north carolina': 'NC',
    'north dakota': 'ND',
    'ohio': 'OH',
    'oklahoma': 'OK',
    'oregon': 'OR',
    'pennsylvania': 'PA',
    'rhode island': 'RI',
    'south carolina': 'SC',
    'south dakota': 'SD',
    'tennessee': 'TN',
    'texas': 'TX',
    'utah': 'UT',
    'vermont': 'VT',
    'virginia': 'VA',
    'washington': 'WA',
    'west virginia': 'WV',
    'wisconsin': 'WI',
    'wyoming': 'WY',
};
const STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

// ============================================================================
// Service
// ============================================================================

class ComplianceQAService {
    private genAI: GoogleGenerativeAI | null = null;
    private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;
    private stateMetadataCache: Map<string, StateMetadata | null> = new Map();

    constructor() {
        try {
            const env = getEnv();
            const apiKey = env.GOOGLE_AI_API_KEY;
            if (apiKey) {
                this.genAI = new GoogleGenerativeAI(apiKey);
                this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
            }
        } catch (error) {
            const apiKey = process.env.GOOGLE_AI_API_KEY;
            if (apiKey) {
                this.genAI = new GoogleGenerativeAI(apiKey);
                this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
            }
        }
    }

    isConfigured(): boolean {
        return this.model !== null;
    }

    async answerQuestion(request: ComplianceQARequest): Promise<ComplianceQAResult> {
        if (!this.model) {
            return {
                success: false,
                answer: '',
                sources: [],
                confidence: 0,
                error: 'AI model not configured.',
            };
        }

        try {
            const stateCode = this.resolveStateCode(request);
            if (!stateCode) {
                return {
                    success: false,
                    answer: '',
                    sources: [],
                    confidence: 0,
                    followUpQuestion: 'Which state are you asking about? For example: "TN unarmed guard renewal".',
                };
            }

            // Check cache before expensive operations
            const cached = await qaCacheService.get(
                request.question,
                stateCode,
                request.licenseType || undefined
            );
            if (cached) {
                return {
                    success: true,
                    answer: cached.answer,
                    sources: cached.sources,
                    confidence: cached.confidence,
                    stateCode,
                };
            }

            const stateMetadata = this.loadStateMetadata(stateCode);

            // Try to answer using Gemini with metadata context
            const answer = await this.generateAnswerWithMetadata({
                question: request.question,
                stateCode,
                stateName: stateMetadata?.state_name,
                licenseType: request.licenseType || null,
                metadata: stateMetadata,
            });

            // If Gemini couldn't answer confidently, try metadata fallback
            if (!answer.success || answer.confidence < 0.4) {
                const metadataAnswer = await this.answerFromMetadata({
                    question: request.question,
                    stateCode,
                    metadata: stateMetadata,
                    licenseType: request.licenseType,
                });

                if (metadataAnswer.success && metadataAnswer.confidence > 0.3) {
                    return metadataAnswer;
                }

                // Final fallback
                const fallback = stateMetadata?.regulatory_body?.website
                    ? `Try the official site: ${stateMetadata.regulatory_body.website}`
                    : 'Please check the official state regulator site for current rules.';

                return {
                    success: false,
                    answer: `I couldn't find a reliable answer for that question. ${fallback}`,
                    sources: stateMetadata?.regulatory_body?.website ? [stateMetadata.regulatory_body.website] : [],
                    confidence: 0.2,
                    stateCode,
                };
            }

            const result: ComplianceQAResult = {
                success: true,
                answer: answer.answer,
                sources: answer.sources,
                confidence: answer.confidence,
                stateCode,
            };

            // Cache high-confidence responses
            if (answer.confidence >= 0.6) {
                await qaCacheService.set(
                    request.question,
                    stateCode,
                    result,
                    request.licenseType || undefined
                );
            }

            return result;
        } catch (error) {
            return {
                success: false,
                answer: 'I could not reach official sources right now. Please try again later.',
                sources: [],
                confidence: 0,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    // ========================================================================
    // Answer generation with metadata
    // ========================================================================

    /**
     * Generate answer using Gemini with state metadata context
     * Uses structured metadata to provide accurate answers about licensing requirements
     */
    private async generateAnswerWithMetadata(params: {
        question: string;
        stateCode: string;
        stateName?: string;
        licenseType?: string | null;
        metadata: StateMetadata | null;
    }): Promise<{ success: boolean; answer: string; sources: string[]; confidence: number }> {
        if (!this.model || !params.metadata) {
            return {
                success: false,
                answer: '',
                sources: [],
                confidence: 0,
            };
        }

        // Build context from metadata
        const metadataContext = {
            state: params.metadata.state_name,
            stateCode: params.stateCode,
            regulatoryBody: params.metadata.regulatory_body,
            licenseTypes: params.metadata.license_types,
            trainingTopics: params.metadata.training_topics,
            backgroundCheck: params.metadata.background_check,
            reciprocity: params.metadata.reciprocity,
            sources: params.metadata.sources || [],
        };

        const prompt = `You are ReguGuard's compliance Q&A expert for security guard licensing.

Question: ${params.question}
State: ${params.stateName || params.stateCode} (${params.stateCode})
${params.licenseType ? `License Type: ${params.licenseType}` : ''}

Official State Licensing Information:
${JSON.stringify(metadataContext, null, 2)}

Instructions:
- Answer the question using the official metadata provided above
- Be concise and SMS-friendly (< 300 characters if possible)
- Include specific numbers (hours, fees, months, renewal periods) when available
- If the answer requires information not in the metadata, set foundInMetadata to false
- Cite official sources from the metadata.sources array when relevant
- Do not provide legal advice

Respond ONLY with valid JSON:
{
  "answer": "concise answer text",
  "sources": ["url1", "url2"],
  "confidence": 0.0-1.0,
  "foundInMetadata": true/false
}`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();
            const parsed = this.parseJsonResponse<{
                answer: string;
                sources: string[];
                confidence: number;
                foundInMetadata: boolean;
            }>(text);

            if (!parsed.foundInMetadata) {
                return {
                    success: false,
                    answer: parsed.answer || '',
                    sources: parsed.sources || [],
                    confidence: 0.3,
                };
            }

            // Add regulatory body website if no sources provided
            const sources = parsed.sources && parsed.sources.length > 0
                ? parsed.sources
                : (params.metadata.regulatory_body?.website ? [params.metadata.regulatory_body.website] : []);

            return {
                success: true,
                answer: parsed.answer,
                sources: sources.slice(0, 2),
                confidence: Math.min(parsed.confidence, 0.9), // Cap confidence at 0.9
            };
        } catch (error) {
            console.error('[ComplianceQA] Error generating answer:', error);
            return {
                success: false,
                answer: '',
                sources: [],
                confidence: 0,
            };
        }
    }

    // ========================================================================
    // State + Sources
    // ========================================================================

    private resolveStateCode(request: ComplianceQARequest): string | null {
        const rawState = request.stateCode || request.context.matchedState || null;
        if (rawState) {
            const normalized = rawState.trim();
            if (normalized.length === 2 && STATE_CODES.has(normalized.toUpperCase())) {
                return normalized.toUpperCase();
            }
            const mapped = STATE_NAME_TO_CODE[normalized.toLowerCase()];
            if (mapped) return mapped;
        }

        const text = request.question.toLowerCase();
        const codeMatch = request.question.match(/\b([A-Za-z]{2})\b/);
        if (codeMatch) {
            const candidate = codeMatch[1].toUpperCase();
            if (STATE_CODES.has(candidate)) {
                return candidate;
            }
        }

        for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
            if (text.includes(name)) {
                return code;
            }
        }

        return null;
    }

    private loadStateMetadata(stateCode: string): StateMetadata | null {
        const key = stateCode.toUpperCase();
        if (this.stateMetadataCache.has(key)) {
            return this.stateMetadataCache.get(key) || null;
        }

        const metadataPath = join(process.cwd(), 'knowledge', 'states', key, 'metadata.json');
        if (!existsSync(metadataPath)) {
            this.stateMetadataCache.set(key, null);
            return null;
        }

        try {
            const raw = readFileSync(metadataPath, 'utf-8');
            const parsed = JSON.parse(raw) as StateMetadata;
            this.stateMetadataCache.set(key, parsed);
            return parsed;
        } catch (error) {
            console.error(`Failed to load metadata for ${key}:`, error);
            this.stateMetadataCache.set(key, null);
            return null;
        }
    }

    /**
     * Answer question from local state metadata when web search fails
     * Uses AI to generate answers from structured metadata
     */
    private async answerFromMetadata(params: {
        question: string;
        stateCode: string;
        metadata: StateMetadata | null;
        licenseType?: string | null;
    }): Promise<ComplianceQAResult> {
        // Validate metadata exists
        if (!this.model || !params.metadata) {
            return {
                success: false,
                answer: 'No local knowledge available.',
                sources: [],
                confidence: 0,
            };
        }

        // Extract relevant metadata fields
        const metadataContext = {
            state: params.metadata.state_name,
            regulatoryBody: params.metadata.regulatory_body,
            licenseTypes: params.metadata.license_types,
            trainingTopics: params.metadata.training_topics,
            backgroundCheck: params.metadata.background_check,
            sources: params.metadata.sources || [],
        };

        // Build prompt for Gemini
        const prompt = `You are answering a security guard licensing question using ONLY the official metadata provided below.

Question: ${params.question}
State: ${params.metadata.state_name} (${params.stateCode})
${params.licenseType ? `License Type: ${params.licenseType}` : ''}

Official Metadata:
${JSON.stringify(metadataContext, null, 2)}

Instructions:
- Answer the question using ONLY the metadata provided
- Be concise (SMS-friendly, < 300 characters if possible)
- If the answer is not in the metadata, say "I don't have that specific information in my records."
- Include specific numbers (hours, fees, months) when available
- Cite sources from the metadata.sources array if relevant

Respond in JSON format:
{
    "answer": "your concise answer",
    "citations": ["url1", "url2"],
    "confidence": 0.0-1.0,
    "foundInMetadata": true/false
}`;

        // Call Gemini AI
        try {
            const response = await this.model.generateContent(prompt);
            const parsed = this.parseJsonResponse<{
                answer: string;
                citations: string[];
                confidence: number;
                foundInMetadata: boolean;
            }>(response.response.text());

            if (!parsed.foundInMetadata) {
                return {
                    success: false,
                    answer: "I don't have that specific information in my records. Try the official site: " + params.metadata.regulatory_body.website,
                    sources: [params.metadata.regulatory_body.website],
                    confidence: 0.2,
                    stateCode: params.stateCode,
                };
            }

            return {
                success: true,
                answer: parsed.answer + ' (from local knowledge base)',
                sources: parsed.citations || (params.metadata.sources?.map(s => s.url) || []),
                confidence: Math.min(parsed.confidence, 0.6), // Cap at 0.6 for metadata-only
                stateCode: params.stateCode,
            };
        } catch (error) {
            return {
                success: false,
                answer: 'Could not generate answer from local knowledge.',
                sources: [],
                confidence: 0,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    private parseJsonResponse<T>(text: string): T {
        try {
            return JSON.parse(text) as T;
        } catch {
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1].trim()) as T;
            }
            const objectMatch = text.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                return JSON.parse(objectMatch[0]) as T;
            }
            throw new Error('No JSON found in response');
        }
    }
}

export const complianceQAService = new ComplianceQAService();
