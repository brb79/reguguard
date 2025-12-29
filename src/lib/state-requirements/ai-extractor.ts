/**
 * AI Extractor for State Requirements
 * 
 * Uses Google Gemini to extract structured requirements from web content
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getEnv } from '@/lib/env';
import type { StateMetadata, AIExtractionRequest, AIExtractionResult } from './types';

export class StateRequirementsAIExtractor {
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

    /**
     * Extract state requirements metadata from web content
     */
    async extractRequirements(request: AIExtractionRequest): Promise<AIExtractionResult> {
        if (!this.model) {
            return {
                success: false,
                confidence: 0,
                error: 'AI service not configured. Set GOOGLE_AI_API_KEY.',
            };
        }

        try {
            const prompt = this.buildExtractionPrompt(request);

            const result = await this.model.generateContent(prompt);
            const response = result.response;
            const text = response.text();

            // Parse JSON response
            const extracted = this.parseJsonResponse(text);
            if (!extracted) {
                return {
                    success: false,
                    confidence: 0,
                    raw_response: { text },
                    error: 'Failed to parse AI response as JSON',
                };
            }

            return {
                success: true,
                extracted_metadata: extracted.metadata,
                confidence: extracted.confidence || 0.7,
                raw_response: extracted,
            };
        } catch (error) {
            return {
                success: false,
                confidence: 0,
                error: error instanceof Error ? error.message : 'Unknown error during extraction',
            };
        }
    }

    /**
     * Build the extraction prompt for Gemini
     */
    private buildExtractionPrompt(request: AIExtractionRequest): string {
        const existingContext = request.existing_metadata
            ? `\n\nEXISTING METADATA (for reference - detect changes):\n${JSON.stringify(request.existing_metadata, null, 2)}`
            : '';

        return `You are an expert at analyzing state regulatory requirements for security guard licensing.

Your task is to extract structured information about security guard licensing requirements from the provided website content for ${request.state_code}.

SOURCES CHECKED:
${request.sources.map(url => `- ${url}`).join('\n')}

WEBSITE CONTENT:
${request.website_content.substring(0, 50000)}${existingContext}

Extract the following information and return it as a JSON object matching this exact schema:

{
    "metadata": {
        "state_code": "${request.state_code}",
        "state_name": "Full State Name",
        "regulatory_body": {
            "name": "Full Agency Name",
            "abbreviation": "ABBR",
            "website": "https://...",
            "licensing_portal": "https://..."
        },
        "effective_date": "YYYY-MM-DD",
        "last_verified": "${new Date().toISOString().split('T')[0]}",
        "license_types": [
            {
                "type": "snake_case_identifier",
                "display_name": "Human Readable Name",
                "renewal_period_months": 24,
                "initial_training_hours": 40,
                "renewal_training_hours": 8,
                "compliance_item_descriptions": ["Exact Match 1", "Exact Match 2"],
                "requirements": {
                    "initial": ["Requirement 1", "Requirement 2"],
                    "renewal": ["Renewal requirement 1"]
                },
                "fees": {
                    "application": 50,
                    "renewal": 25,
                    "currency": "USD"
                }
            }
        ],
        "training_topics": {
            "entry_level": ["Topic 1", "Topic 2"],
            "firearms": ["Topic 1", "Topic 2"],
            "in_service": ["Topic 1", "Topic 2"]
        },
        "background_check": {
            "state_check_required": true,
            "fbi_check_required": true,
            "fingerprinting_required": true,
            "disqualifying_offenses": ["Description"]
        },
        "reciprocity": {
            "accepts_from": ["STATE_CODE"],
            "notes": "Any special reciprocity agreements"
        },
        "contact": {
            "phone": "(XXX) XXX-XXXX",
            "email": "licensing@state.gov",
            "address": "Full mailing address"
        },
        "sources": [
            {
                "title": "Source Document Title",
                "url": "https://...",
                "accessed_date": "${new Date().toISOString().split('T')[0]}"
            }
        ]
    },
    "confidence": 0.0-1.0,
    "notes": "Any relevant observations or uncertainties"
}

IMPORTANT:
- Extract ONLY information that is explicitly stated in the content
- Use null for missing fields (don't make up data)
- Be precise with numbers (training hours, fees, renewal periods)
- If existing metadata is provided, note any changes you detect
- Confidence should reflect how complete and certain the extraction is

Respond ONLY with valid JSON, no markdown formatting.`;
    }

    /**
     * Parse JSON response from AI, handling markdown code blocks
     */
    private parseJsonResponse(text: string): { metadata?: StateMetadata; confidence?: number; notes?: string } | null {
        try {
            // Try direct parse first
            return JSON.parse(text);
        } catch {
            // Try extracting from markdown code block
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1].trim());
                } catch {
                    // Continue to next attempt
                }
            }

            // Try finding JSON object in text
            const objectMatch = text.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                try {
                    return JSON.parse(objectMatch[0]);
                } catch {
                    return null;
                }
            }

            return null;
        }
    }
}

export const stateRequirementsAIExtractor = new StateRequirementsAIExtractor();

