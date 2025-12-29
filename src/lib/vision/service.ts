/**
 * Vision Service - Gemini Vision integration for license document extraction
 * 
 * Extracts expiration dates, license numbers, and other relevant data
 * from photos of security guard licenses sent via MMS.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { envChecks, getEnv } from '@/lib/env';

// ============================================================================
// Types
// ============================================================================

export interface LicenseExtractionResult {
    success: boolean;
    expirationDate: string | null;       // ISO date format (YYYY-MM-DD)
    licenseNumber: string | null;
    licenseType: string | null;          // 'armed', 'unarmed', 'private_investigator', etc.
    state: string | null;                // State code: 'VA', 'MD', 'DC', etc.
    holderName: string | null;           // Name on the license
    issuingAuthority: string | null;     // e.g., 'Virginia DCJS'
    issueDate: string | null;            // ISO date format
    confidence: number;                  // 0-1 confidence score
    rawResponse: object;                 // Full AI response for debugging
    error?: string;
}

export interface ExtractionRequest {
    imageUrl: string;
    employeeName?: string;      // For validation
    expectedState?: string;     // For validation
    expectedLicenseType?: string; // For validation
}

// Shape of the data extracted from AI response
interface ExtractedLicenseData {
    expirationDate?: string | null;
    licenseNumber?: string | null;
    licenseType?: string | null;
    state?: string | null;
    holderName?: string | null;
    issuingAuthority?: string | null;
    issueDate?: string | null;
    confidence?: number;
    notes?: string;
}

// ============================================================================
// Prompts
// ============================================================================

const EXTRACTION_PROMPT = `You are an expert at analyzing security guard license documents and credentials. 
Your task is to extract key information from the provided image of a security guard license, registration card, or credential.

Common document types you may encounter:
- Virginia DCJS (Department of Criminal Justice Services) Registration Cards
- State-issued armed/unarmed security guard licenses
- Private security officer credentials
- Firearms permits for security personnel
- Training completion certificates with expiration dates

Please extract the following information from the image:

1. **Expiration Date**: The date when this license/credential expires. Look for fields labeled "Expires", "Expiration", "Valid Until", "Exp", etc.

2. **License Number**: The unique identifier for this license. Look for fields labeled "License #", "Registration #", "ID", "Number", "Certificate #", etc.

3. **License Type**: Classify as one of:
   - "armed" (armed security officer, armed guard)
   - "unarmed" (unarmed security officer, security guard)
   - "supervisor" (security supervisor, shift lead)
   - "private_investigator"
   - "firearms_permit"
   - "training_certificate"
   - "other"

4. **State**: The issuing state (two-letter code, e.g., "VA", "MD", "DC")

5. **Holder Name**: The full name of the person on the credential

6. **Issuing Authority**: The organization that issued this (e.g., "Virginia DCJS", "Maryland State Police")

7. **Issue Date**: When the license was issued, if visible

8. **Confidence**: Your confidence level (0.0 to 1.0) in the accuracy of the extraction

Respond ONLY with a valid JSON object in this exact format:
{
    "expirationDate": "YYYY-MM-DD or null",
    "licenseNumber": "string or null",
    "licenseType": "armed|unarmed|supervisor|private_investigator|firearms_permit|training_certificate|other",
    "state": "XX or null",
    "holderName": "string or null",
    "issuingAuthority": "string or null",
    "issueDate": "YYYY-MM-DD or null",
    "confidence": 0.0-1.0,
    "notes": "any relevant observations about the document quality or extraction"
}

If you cannot read the document or it's not a valid security credential, respond with:
{
    "expirationDate": null,
    "licenseNumber": null,
    "licenseType": null,
    "state": null,
    "holderName": null,
    "issuingAuthority": null,
    "issueDate": null,
    "confidence": 0.0,
    "notes": "explanation of why extraction failed"
}`;

// ============================================================================
// Service
// ============================================================================

class VisionService {
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
            // Environment not validated yet, use process.env as fallback
            const apiKey = process.env.GOOGLE_AI_API_KEY;
            if (apiKey) {
                this.genAI = new GoogleGenerativeAI(apiKey);
                this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            }
        }
    }

    /**
     * Check if the vision service is configured
     */
    isConfigured(): boolean {
        return envChecks.isVisionConfigured() && this.genAI !== null && this.model !== null;
    }

    /**
     * Extract license information from an image URL
     */
    async extractLicenseData(request: ExtractionRequest): Promise<LicenseExtractionResult> {
        if (!this.model) {
            return {
                success: false,
                expirationDate: null,
                licenseNumber: null,
                licenseType: null,
                state: null,
                holderName: null,
                issuingAuthority: null,
                issueDate: null,
                confidence: 0,
                rawResponse: {},
                error: 'Vision service not configured. Set GOOGLE_AI_API_KEY.',
            };
        }

        try {
            // Fetch the image and convert to base64
            const imageData = await this.fetchImageAsBase64(request.imageUrl);
            if (!imageData) {
                return {
                    success: false,
                    expirationDate: null,
                    licenseNumber: null,
                    licenseType: null,
                    state: null,
                    holderName: null,
                    issuingAuthority: null,
                    issueDate: null,
                    confidence: 0,
                    rawResponse: {},
                    error: 'Failed to fetch image from URL',
                };
            }

            // Build enhanced prompt with validation context
            let prompt = EXTRACTION_PROMPT;
            if (request.employeeName) {
                prompt += `\n\nNote: The expected holder name is "${request.employeeName}". Flag if the name on the document doesn't match.`;
            }
            if (request.expectedState) {
                prompt += `\n\nNote: The expected state is "${request.expectedState}". Flag if the document is from a different state.`;
            }

            // Call Gemini Vision
            const result = await this.model.generateContent([
                {
                    inlineData: {
                        mimeType: imageData.mimeType,
                        data: imageData.base64,
                    },
                },
                prompt,
            ]);

            const response = result.response;
            const text = response.text();

            // Parse the JSON response
            const extracted = this.parseJsonResponse(text);
            if (!extracted) {
                return {
                    success: false,
                    expirationDate: null,
                    licenseNumber: null,
                    licenseType: null,
                    state: null,
                    holderName: null,
                    issuingAuthority: null,
                    issueDate: null,
                    confidence: 0,
                    rawResponse: { text },
                    error: 'Failed to parse AI response as JSON',
                };
            }

            // Validate and normalize dates
            const normalizedExpDate = this.normalizeDate(extracted.expirationDate);
            const normalizedIssueDate = this.normalizeDate(extracted.issueDate);

            return {
                success: true,
                expirationDate: normalizedExpDate,
                licenseNumber: extracted.licenseNumber || null,
                licenseType: extracted.licenseType || null,
                state: extracted.state?.toUpperCase() || null,
                holderName: extracted.holderName || null,
                issuingAuthority: extracted.issuingAuthority || null,
                issueDate: normalizedIssueDate,
                confidence: extracted.confidence || 0,
                rawResponse: extracted,
            };
        } catch (error) {
            console.error('Vision extraction error:', error);
            return {
                success: false,
                expirationDate: null,
                licenseNumber: null,
                licenseType: null,
                state: null,
                holderName: null,
                issuingAuthority: null,
                issueDate: null,
                confidence: 0,
                rawResponse: {},
                error: error instanceof Error ? error.message : 'Unknown error during extraction',
            };
        }
    }

    /**
     * Fetch an image from URL and convert to base64
     */
    private async fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`Failed to fetch image: ${response.status} ${response.statusText}`);
                return null;
            }

            const contentType = response.headers.get('content-type') || 'image/jpeg';
            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');

            return {
                base64,
                mimeType: contentType,
            };
        } catch (error) {
            console.error('Error fetching image:', error);
            return null;
        }
    }

    /**
     * Parse JSON response from AI, handling markdown code blocks
     */
    private parseJsonResponse(text: string): ExtractedLicenseData | null {
        try {
            // Try direct parse first
            return JSON.parse(text) as ExtractedLicenseData;
        } catch {
            // Try extracting from markdown code block
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1].trim()) as ExtractedLicenseData;
                } catch {
                    return null;
                }
            }

            // Try finding JSON object in text
            const objectMatch = text.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                try {
                    return JSON.parse(objectMatch[0]) as ExtractedLicenseData;
                } catch {
                    return null;
                }
            }

            return null;
        }
    }

    /**
     * Normalize various date formats to ISO format (YYYY-MM-DD)
     */
    private normalizeDate(dateStr: string | null | undefined): string | null {
        if (!dateStr || dateStr === 'null') return null;

        try {
            // Already ISO format
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                return dateStr;
            }

            // Common US formats: MM/DD/YYYY, MM-DD-YYYY
            const usMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (usMatch) {
                const [, month, day, year] = usMatch;
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }

            // Try parsing with Date
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString().split('T')[0];
            }

            return null;
        } catch {
            return null;
        }
    }
}

// Export singleton
export const visionService = new VisionService();
