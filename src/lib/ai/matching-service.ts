/**
 * License Matching Service - AI-Powered License-to-State Matching
 * 
 * Intelligently matches vague license descriptions to specific state license types
 * using Google Gemini Pro with state requirements knowledge base as context.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getEnv } from '@/lib/env';
import type { StateMetadata, LicenseType } from '../state-requirements/types';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface LicenseMatchRequest {
    description: string;                    // License description from WinTeam (e.g., "Gun License", "Security Card")
    stateCode?: string | null;               // Optional: known state code
    employeeLocation?: string | null;        // Optional: employee location/state
    extractedState?: string | null;          // Optional: state extracted from license photo
    extractedLicenseType?: string | null;    // Optional: license type extracted from photo
    regulatoryBody?: string | null;          // Optional: regulatory body abbreviation (DCJS, DPS, etc.)
}

export interface LicenseMatchResult {
    success: boolean;
    matchedState: string | null;             // Two-letter state code
    matchedLicenseType: string | null;        // License type identifier (e.g., "armed_security_officer")
    matchedDisplayName: string | null;        // Human-readable license name
    confidence: number;                      // 0-1 confidence score
    alternatives: LicenseMatchAlternative[]; // Alternative matches if ambiguous
    validation: LicenseValidation;           // Validation against state requirements
    reasoning: string;                       // AI explanation of the match
    error?: string;
}

export interface LicenseMatchAlternative {
    state: string;
    licenseType: string;
    displayName: string;
    confidence: number;
    reasoning: string;
}

export interface LicenseValidation {
    isValid: boolean;
    issues: string[];
    warnings: string[];
    suggestions: string[];
}

// ============================================================================
// Service
// ============================================================================

class LicenseMatchingService {
    private genAI: GoogleGenerativeAI | null = null;
    private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;
    private stateMetadataCache: Map<string, StateMetadata> = new Map();

    constructor() {
        try {
            const env = getEnv();
            const apiKey = env.GOOGLE_AI_API_KEY;
            if (apiKey) {
                this.genAI = new GoogleGenerativeAI(apiKey);
                this.model = this.genAI.getGenerativeModel({ 
                    model: 'gemini-1.5-pro',
                });
            }
        } catch (error) {
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
     * Check if matching service is configured
     */
    isConfigured(): boolean {
        return this.genAI !== null && this.model !== null;
    }

    /**
     * Match a license description to a specific state license type
     */
    async matchLicense(request: LicenseMatchRequest): Promise<LicenseMatchResult> {
        if (!this.model) {
            return this.getFallbackMatch(request);
        }

        try {
            // Determine which states to consider
            const candidateStates = this.getCandidateStates(request);
            
            // Load state metadata for candidate states
            const stateMetadata = await this.loadStateMetadata(candidateStates);
            
            if (stateMetadata.length === 0) {
                return {
                    success: false,
                    matchedState: null,
                    matchedLicenseType: null,
                    matchedDisplayName: null,
                    confidence: 0,
                    alternatives: [],
                    validation: { isValid: false, issues: ['No state metadata available'], warnings: [], suggestions: [] },
                    reasoning: 'No state metadata found for candidate states',
                };
            }

            // Build matching prompt with all relevant state metadata
            const prompt = this.buildMatchingPrompt(request, stateMetadata);

            // Call Gemini Pro for intelligent matching
            const result = await this.model.generateContent(prompt);
            const responseText = result.response.text();
            const parsed = this.parseMatchResponse(responseText);

            // Validate the match against state requirements
            const validation = await this.validateMatch(
                parsed.matchedState,
                parsed.matchedLicenseType,
                stateMetadata
            );

            return {
                success: parsed.success,
                matchedState: parsed.matchedState,
                matchedLicenseType: parsed.matchedLicenseType,
                matchedDisplayName: parsed.matchedDisplayName,
                confidence: parsed.confidence,
                alternatives: parsed.alternatives || [],
                validation,
                reasoning: parsed.reasoning || '',
            };
        } catch (error) {
            console.error('License matching error:', error);
            return {
                success: false,
                matchedState: null,
                matchedLicenseType: null,
                matchedDisplayName: null,
                confidence: 0,
                alternatives: [],
                validation: { 
                    isValid: false, 
                    issues: [error instanceof Error ? error.message : 'Unknown error'], 
                    warnings: [], 
                    suggestions: [] 
                },
                reasoning: 'Error during matching',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Get candidate states to consider for matching
     */
    private getCandidateStates(request: LicenseMatchRequest): string[] {
        const states = new Set<string>();

        // Add explicitly provided state
        if (request.stateCode) {
            states.add(request.stateCode.toUpperCase());
        }

        // Add state from employee location
        if (request.employeeLocation) {
            const locationState = this.extractStateFromLocation(request.employeeLocation);
            if (locationState) {
                states.add(locationState);
            }
        }

        // Add state from extracted license data
        if (request.extractedState) {
            states.add(request.extractedState.toUpperCase());
        }

        // If no states found, consider all states with metadata
        if (states.size === 0) {
            // Load all available states
            const allStates = this.getAvailableStates();
            allStates.forEach(state => states.add(state));
        }

        return Array.from(states);
    }

    /**
     * Extract state code from location string
     */
    private extractStateFromLocation(location: string): string | null {
        // Try to match common state patterns
        const stateMatch = location.match(/\b([A-Z]{2})\b/);
        if (stateMatch) {
            return stateMatch[1];
        }

        // Try to match state names
        const stateNames: Record<string, string> = {
            'virginia': 'VA',
            'texas': 'TX',
            'florida': 'FL',
            'california': 'CA',
            'new york': 'NY',
            'pennsylvania': 'PA',
            'illinois': 'IL',
            'georgia': 'GA',
            'maryland': 'MD',
            'district of columbia': 'DC',
            'washington dc': 'DC',
            'dc': 'DC',
        };

        const lowerLocation = location.toLowerCase();
        for (const [name, code] of Object.entries(stateNames)) {
            if (lowerLocation.includes(name)) {
                return code;
            }
        }

        return null;
    }

    /**
     * Get list of available states with metadata
     */
    private getAvailableStates(): string[] {
        try {
            const indexPath = join(process.cwd(), 'knowledge', 'states', 'index.json');
            if (!existsSync(indexPath)) {
                console.warn(`State index not found at ${indexPath}`);
                return ['VA', 'TX', 'FL', 'CA', 'NY', 'PA', 'IL', 'GA', 'MD', 'DC'];
            }
            const indexContent = readFileSync(indexPath, 'utf-8');
            const index = JSON.parse(indexContent);
            
            return Object.keys(index.states || {})
                .filter(state => index.states[state].status === 'complete');
        } catch (error) {
            console.error('Error loading state index:', error);
            return ['VA', 'TX', 'FL', 'CA', 'NY', 'PA', 'IL', 'GA', 'MD', 'DC']; // Fallback to known states
        }
    }

    /**
     * Load state metadata for given state codes
     */
    private async loadStateMetadata(stateCodes: string[]): Promise<StateMetadata[]> {
        const metadata: StateMetadata[] = [];

        for (const stateCode of stateCodes) {
            try {
                // Check cache first
                if (this.stateMetadataCache.has(stateCode)) {
                    metadata.push(this.stateMetadataCache.get(stateCode)!);
                    continue;
                }

                // Load from file
                const metadataPath = join(
                    process.cwd(),
                    'knowledge',
                    'states',
                    stateCode,
                    'metadata.json'
                );

                if (existsSync(metadataPath)) {
                    const content = readFileSync(metadataPath, 'utf-8');
                    const stateMetadata = JSON.parse(content) as StateMetadata;
                    this.stateMetadataCache.set(stateCode, stateMetadata);
                    metadata.push(stateMetadata);
                }
            } catch (error) {
                console.warn(`Failed to load metadata for ${stateCode}:`, error);
            }
        }

        return metadata;
    }

    /**
     * Build matching prompt for Gemini Pro
     */
    private buildMatchingPrompt(
        request: LicenseMatchRequest,
        stateMetadata: StateMetadata[]
    ): string {
        // Build context about available license types
        const licenseTypesContext = stateMetadata.map(state => {
            const types = state.license_types.map(lt => ({
                state: state.state_code,
                stateName: state.state_name,
                regulatoryBody: state.regulatory_body.abbreviation || state.regulatory_body.name,
                type: lt.type,
                displayName: lt.display_name,
                descriptions: lt.compliance_item_descriptions,
            }));

            return {
                state: state.state_code,
                stateName: state.state_name,
                regulatoryBody: state.regulatory_body,
                licenseTypes: types,
            };
        });

        return `You are an expert at matching security guard license descriptions to specific state license types.

TASK: Match the license description "${request.description}" to the correct state and license type.

CONTEXT:
${JSON.stringify(licenseTypesContext, null, 2)}

ADDITIONAL CLUES:
${request.stateCode ? `- Known state: ${request.stateCode}` : ''}
${request.employeeLocation ? `- Employee location: ${request.employeeLocation}` : ''}
${request.extractedState ? `- State from license photo: ${request.extractedState}` : ''}
${request.extractedLicenseType ? `- License type from photo: ${request.extractedLicenseType}` : ''}
${request.regulatoryBody ? `- Regulatory body: ${request.regulatoryBody}` : ''}

INSTRUCTIONS:
1. Match the description to the most likely state and license type
2. Consider abbreviations (DCJS = Virginia, DPS = Texas, etc.)
3. Handle variations ("Gun License" = armed, "Security Card" = unarmed, etc.)
4. If ambiguous, provide alternatives with confidence scores
5. Consider all context clues (state, location, regulatory body)

Respond with ONLY a valid JSON object:
{
    "success": true/false,
    "matchedState": "XX" or null,
    "matchedLicenseType": "snake_case_type" or null,
    "matchedDisplayName": "Human Readable Name" or null,
    "confidence": 0.0-1.0,
    "alternatives": [
        {
            "state": "XX",
            "licenseType": "snake_case_type",
            "displayName": "Human Readable Name",
            "confidence": 0.0-1.0,
            "reasoning": "why this is an alternative"
        }
    ],
    "reasoning": "explanation of the match"
}`;
    }

    /**
     * Validate match against state requirements
     */
    private async validateMatch(
        stateCode: string | null,
        licenseType: string | null,
        stateMetadata: StateMetadata[]
    ): Promise<LicenseValidation> {
        if (!stateCode || !licenseType) {
            return {
                isValid: false,
                issues: ['State or license type not determined'],
                warnings: [],
                suggestions: [],
            };
        }

        const stateMeta = stateMetadata.find(s => s.state_code === stateCode);
        if (!stateMeta) {
            return {
                isValid: false,
                issues: [`No metadata found for state ${stateCode}`],
                warnings: [],
                suggestions: [],
            };
        }

        const licenseTypeMeta = stateMeta.license_types.find(lt => lt.type === licenseType);
        if (!licenseTypeMeta) {
            return {
                isValid: false,
                issues: [`License type ${licenseType} not found in ${stateCode} metadata`],
                warnings: [],
                suggestions: [`Available types: ${stateMeta.license_types.map(lt => lt.type).join(', ')}`],
            };
        }

        // All validations passed
        return {
            isValid: true,
            issues: [],
            warnings: [],
            suggestions: [],
        };
    }

    /**
     * Parse match response from AI
     */
    private parseMatchResponse(text: string): {
        success: boolean;
        matchedState: string | null;
        matchedLicenseType: string | null;
        matchedDisplayName: string | null;
        confidence: number;
        alternatives?: LicenseMatchAlternative[];
        reasoning?: string;
    } {
        try {
            const parsed = this.parseJsonResponse<{
                success: boolean;
                matchedState?: string | null;
                matchedLicenseType?: string | null;
                matchedDisplayName?: string | null;
                confidence?: number;
                alternatives?: LicenseMatchAlternative[];
                reasoning?: string;
            }>(text);

            return {
                success: parsed.success ?? false,
                matchedState: parsed.matchedState?.toUpperCase() || null,
                matchedLicenseType: parsed.matchedLicenseType || null,
                matchedDisplayName: parsed.matchedDisplayName || null,
                confidence: parsed.confidence ?? 0,
                alternatives: parsed.alternatives || [],
                reasoning: parsed.reasoning || '',
            };
        } catch (error) {
            console.error('Failed to parse match response:', error);
            return {
                success: false,
                matchedState: null,
                matchedLicenseType: null,
                matchedDisplayName: null,
                confidence: 0,
            };
        }
    }

    /**
     * Parse JSON response, handling markdown code blocks
     */
    private parseJsonResponse<T>(text: string): T {
        try {
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
     * Fallback matching when AI is not available
     */
    private getFallbackMatch(request: LicenseMatchRequest): LicenseMatchResult {
        // Simple keyword-based fallback
        const description = request.description.toLowerCase();
        let matchedState = request.stateCode || request.extractedState || null;
        let matchedLicenseType: string | null = null;
        let confidence = 0.5;

        // Try to determine state
        if (!matchedState && request.employeeLocation) {
            matchedState = this.extractStateFromLocation(request.employeeLocation);
        }

        // Simple keyword matching
        if (description.includes('armed') || description.includes('gun') || description.includes('firearm')) {
            matchedLicenseType = 'armed_security_officer';
            confidence = 0.7;
        } else if (description.includes('unarmed') || description.includes('security')) {
            matchedLicenseType = 'unarmed_security_officer';
            confidence = 0.7;
        }

        return {
            success: matchedState !== null && matchedLicenseType !== null,
            matchedState,
            matchedLicenseType,
            matchedDisplayName: matchedLicenseType ? matchedLicenseType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : null,
            confidence,
            alternatives: [],
            validation: {
                isValid: matchedState !== null && matchedLicenseType !== null,
                issues: matchedState === null || matchedLicenseType === null ? ['Could not determine state or license type'] : [],
                warnings: ['Using fallback matching - AI not available'],
                suggestions: [],
            },
            reasoning: 'Fallback keyword-based matching (AI not available)',
        };
    }
}

// Export singleton
export const licenseMatchingService = new LicenseMatchingService();

