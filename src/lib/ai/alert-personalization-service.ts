/**
 * Alert Personalization Service - AI-Powered Personalized Alert Messages
 * 
 * Generates personalized SMS alert messages using Google Gemini Pro based on:
 * - Employee history and past behavior
 * - State-specific renewal requirements
 * - Urgency level and days remaining
 * - Multi-language support
 * - A/B testing capabilities
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getEnv } from '@/lib/env';
import { createServerClient } from '@/lib/supabase';
import { extractSingle } from '@/lib/supabase/query-types';
import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface EmployeeContext {
    employeeId: string;
    employeeName: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    locationId: number | null;
    preferredLanguage?: string; // Detected from past conversations
}

export interface LicenseContext {
    licenseId: string;
    licenseName: string;
    licenseNumber: string | null;
    expirationDate: string;
    daysRemaining: number;
    stateCode: string | null;
    licenseType: string | null;
}

export interface EmployeeHistory {
    totalAlerts: number;
    totalRenewals: number;
    averageResponseTime: number | null; // Days from alert to renewal
    lastRenewalDate: string | null;
    pastLateRenewals: number;
    pastOnTimeRenewals: number;
    preferredCommunicationStyle: 'formal' | 'casual' | 'friendly' | null;
    lastAlertResponse: 'responded' | 'ignored' | 'unknown' | null;
    lastAlertDate: string | null;
}

export interface StateRequirements {
    stateCode: string;
    stateName: string;
    regulatoryBody: {
        name: string;
        website: string;
    };
    licenseType: {
        type: string;
        displayName: string;
        renewalPeriodMonths: number;
        renewalTrainingHours: number;
        requirements: {
            renewal: string[];
        };
    } | null;
    contact: {
        phone: string;
        email: string;
    };
}

export interface PersonalizedMessage {
    message: string;
    language: string;
    tone: 'formal' | 'casual' | 'friendly' | 'urgent';
    variant: string; // For A/B testing
    metadata: {
        personalizationFactors: string[];
        stateRequirementsIncluded: boolean;
        employeeHistoryUsed: boolean;
    };
}

export interface AlertPersonalizationOptions {
    alertType: 'expiring_30d' | 'expiring_14d' | 'expiring_7d' | 'expired';
    employeeContext: EmployeeContext;
    licenseContext: LicenseContext;
    employeeHistory?: EmployeeHistory;
    stateRequirements?: StateRequirements;
    enableABTesting?: boolean;
    preferredLanguage?: string;
}

// ============================================================================
// Prompts
// ============================================================================

const PERSONALIZATION_PROMPT = `You are an expert at writing personalized SMS alert messages for security guard license renewals.

Context:
- Employee: {employeeName} ({firstName} {lastName})
- License: {licenseName} (License #: {licenseNumber})
- Expiration: {expirationDate} ({daysRemaining} days remaining)
- Alert Type: {alertType}
- State: {stateName} ({stateCode})
- Regulatory Body: {regulatoryBody}

Employee History:
{employeeHistory}

State Requirements:
{stateRequirements}

Instructions:
1. Generate a personalized SMS message (max 160 characters, SMS-friendly)
2. Adjust tone based on:
   - Urgency: {urgencyLevel} (30d = friendly reminder, 14d = important, 7d = urgent, expired = critical)
   - Employee history: {behaviorPattern}
   - Past response patterns: {responsePattern}
3. Include state-specific renewal instructions if available
4. Add helpful context (training requirements, fees, deadlines) if relevant
5. Match the employee's preferred communication style: {communicationStyle}
6. Use language: {language}
7. Be empathetic and professional
8. Include clear next steps

Generate ONLY a JSON object:
{
    "message": "your personalized SMS message",
    "tone": "formal|casual|friendly|urgent",
    "variant": "A|B",
    "personalizationFactors": ["factor1", "factor2"],
    "reasoning": "brief explanation of personalization choices"
}`;

// ============================================================================
// Service
// ============================================================================

class AlertPersonalizationService {
    private genAI: GoogleGenerativeAI | null = null;
    private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;
    private stateRequirementsCache: Map<string, StateRequirements | null> = new Map();

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
     * Check if personalization service is configured
     */
    isConfigured(): boolean {
        return this.genAI !== null && this.model !== null;
    }

    /**
     * Generate a personalized alert message
     */
    async generatePersonalizedMessage(
        options: AlertPersonalizationOptions
    ): Promise<PersonalizedMessage> {
        if (!this.model) {
            return this.getFallbackMessage(options);
        }

        try {
            // Gather employee history if not provided
            const employeeHistory = options.employeeHistory ||
                await this.gatherEmployeeHistory(options.employeeContext.employeeId, options.licenseContext.licenseId);

            // Detect preferred language if not provided
            const preferredLanguage = options.preferredLanguage ||
                await this.detectPreferredLanguage(options.employeeContext.employeeId) || 'en';

            // Load state requirements if not provided
            const stateRequirements = options.stateRequirements ||
                await this.loadStateRequirements(options.licenseContext.stateCode || null, options.licenseContext.licenseType || null);

            // Build prompt with detected language
            const prompt = this.buildPersonalizationPrompt(
                { ...options, preferredLanguage },
                employeeHistory,
                stateRequirements
            );

            // Generate message
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();
            const parsed = this.parsePersonalizationResponse(text);

            // Determine variant for A/B testing
            const variant = options.enableABTesting
                ? (Math.random() < 0.5 ? 'A' : 'B')
                : 'A';

            return {
                message: parsed.message,
                language: preferredLanguage,
                tone: parsed.tone || this.determineTone(options.alertType),
                variant,
                metadata: {
                    personalizationFactors: parsed.personalizationFactors || [],
                    stateRequirementsIncluded: !!stateRequirements,
                    employeeHistoryUsed: !!employeeHistory,
                },
            };
        } catch (error) {
            console.error('Alert personalization error:', error);
            return this.getFallbackMessage(options);
        }
    }

    /**
     * Detect preferred language from past conversations
     */
    async detectPreferredLanguage(employeeId: string): Promise<string | null> {
        try {
            const supabase = await createServerClient();

            // Type for conversation query
            type ConversationIdResult = { id: string };

            // Get past SMS conversations for this employee
            const { data: conversations } = await supabase
                .from('sms_conversations')
                .select('id')
                .eq('employee_id', employeeId)
                .order('created_at', { ascending: false })
                .limit(5) as { data: ConversationIdResult[] | null; error: unknown };

            if (!conversations || conversations.length === 0) {
                return null;
            }

            // Type for message query
            type MessageResult = { body: string | null; direction: string };

            // Get messages from these conversations
            const conversationIds = conversations.map(c => c.id);
            const { data: messages } = await supabase
                .from('sms_message_log')
                .select('body, direction')
                .in('conversation_id', conversationIds)
                .eq('direction', 'inbound')
                .order('created_at', { ascending: false })
                .limit(10) as { data: MessageResult[] | null; error: unknown };

            if (!messages || messages.length === 0) {
                return null;
            }

            // Simple language detection based on common Spanish words/phrases
            // In production, this could use a proper language detection library
            const spanishIndicators = [
                'hola', 'gracias', 'si', 'no', 'por favor', 'ayuda',
                'cuando', 'donde', 'como', 'que', 'es', 'esta'
            ];

            const messageText = messages.map(m => m.body?.toLowerCase() || '').join(' ');
            const spanishCount = spanishIndicators.filter(word =>
                messageText.includes(word)
            ).length;

            // If significant Spanish indicators found, assume Spanish preference
            if (spanishCount >= 2) {
                return 'es';
            }

            return 'en'; // Default to English
        } catch (error) {
            console.error('Error detecting preferred language:', error);
            return null;
        }
    }

    /**
     * Gather employee history from database
     */
    async gatherEmployeeHistory(
        employeeId: string,
        licenseId: string
    ): Promise<EmployeeHistory | null> {
        try {
            const supabase = await createServerClient();

            // Get past alerts for this employee/license
            const { data: pastAlerts } = await supabase
                .from('alerts')
                .select('alert_type, status, sent_at, acknowledged_at, created_at')
                .eq('employee_id', employeeId)
                .eq('license_id', licenseId)
                .order('created_at', { ascending: false })
                .limit(20);

            // Get past renewals (completed conversations)
            const { data: pastConversations } = await supabase
                .from('sms_conversations')
                .select('status, created_at, completed_at')
                .eq('employee_id', employeeId)
                .eq('license_id', licenseId)
                .in('status', ['completed', 'expired', 'failed'])
                .order('created_at', { ascending: false })
                .limit(10);

            // Get license history to calculate renewal timing
            const { data: licenseHistory } = await supabase
                .from('licenses_cache')
                .select('expiration_date, last_synced')
                .eq('employee_id', employeeId)
                .order('last_synced', { ascending: false })
                .limit(5);

            // Calculate metrics
            const totalAlerts = pastAlerts?.length || 0;
            const totalRenewals = pastConversations?.filter(c => c.status === 'completed').length || 0;

            // Calculate average response time (days from alert to renewal)
            let averageResponseTime: number | null = null;
            if (pastAlerts && pastConversations) {
                const responseTimes: number[] = [];
                for (const alert of pastAlerts) {
                    if (alert.sent_at) {
                        const matchingRenewal = pastConversations.find(
                            c => c.created_at && new Date(c.created_at) > new Date(alert.sent_at)
                        );
                        if (matchingRenewal?.completed_at) {
                            const days = Math.floor(
                                (new Date(matchingRenewal.completed_at).getTime() -
                                    new Date(alert.sent_at).getTime()) / (1000 * 60 * 60 * 24)
                            );
                            responseTimes.push(days);
                        }
                    }
                }
                if (responseTimes.length > 0) {
                    averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
                }
            }

            // Determine last renewal date
            const lastRenewal = pastConversations?.find(c => c.status === 'completed');
            const lastRenewalDate = lastRenewal?.completed_at || null;

            // Count late vs on-time renewals (simplified: if response time > 14 days, consider late)
            const lateRenewals = pastConversations?.filter(c => {
                if (c.status !== 'completed' || !c.completed_at) return false;
                const matchingAlert = pastAlerts?.find(a =>
                    a.sent_at && new Date(a.sent_at) < new Date(c.completed_at!)
                );
                if (!matchingAlert?.sent_at) return false;
                const days = Math.floor(
                    (new Date(c.completed_at).getTime() - new Date(matchingAlert.sent_at).getTime()) /
                    (1000 * 60 * 60 * 24)
                );
                return days > 14;
            }).length || 0;

            const onTimeRenewals = totalRenewals - lateRenewals;

            // Determine communication style from past alert responses (simplified)
            const lastAlert = pastAlerts?.[0];
            const lastAlertResponse = lastAlert?.acknowledged_at
                ? 'responded'
                : (lastAlert?.sent_at && new Date(lastAlert.sent_at) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
                    ? 'ignored'
                    : 'unknown';

            return {
                totalAlerts,
                totalRenewals,
                averageResponseTime,
                lastRenewalDate,
                pastLateRenewals: lateRenewals,
                pastOnTimeRenewals: onTimeRenewals,
                preferredCommunicationStyle: null, // Could be enhanced with NLP analysis
                lastAlertResponse,
                lastAlertDate: lastAlert?.sent_at || null,
            };
        } catch (error) {
            console.error('Error gathering employee history:', error);
            return null;
        }
    }

    /**
     * Load state requirements from knowledge base
     */
    async loadStateRequirements(
        stateCode: string | null,
        licenseType: string | null
    ): Promise<StateRequirements | null> {
        if (!stateCode) return null;

        // Check cache first
        const cacheKey = `${stateCode}:${licenseType || 'default'}`;
        if (this.stateRequirementsCache.has(cacheKey)) {
            return this.stateRequirementsCache.get(cacheKey) || null;
        }

        try {
            const metadataPath = path.join(
                process.cwd(),
                'knowledge',
                'states',
                stateCode.toUpperCase(),
                'metadata.json'
            );

            if (!fs.existsSync(metadataPath)) {
                this.stateRequirementsCache.set(cacheKey, null);
                return null;
            }

            const metadataContent = fs.readFileSync(metadataPath, 'utf-8');
            const metadata = JSON.parse(metadataContent);

            // Find matching license type
            let matchedLicenseType = null;
            if (licenseType && metadata.license_types) {
                matchedLicenseType = metadata.license_types.find(
                    (lt: any) => lt.type === licenseType ||
                        lt.display_name.toLowerCase().includes(licenseType.toLowerCase())
                );
            }

            const requirements: StateRequirements = {
                stateCode: metadata.state_code,
                stateName: metadata.state_name,
                regulatoryBody: {
                    name: metadata.regulatory_body?.name || 'State Regulatory Body',
                    website: metadata.regulatory_body?.website || '',
                },
                licenseType: matchedLicenseType ? {
                    type: matchedLicenseType.type,
                    displayName: matchedLicenseType.display_name,
                    renewalPeriodMonths: matchedLicenseType.renewal_period_months,
                    renewalTrainingHours: matchedLicenseType.renewal_training_hours,
                    requirements: {
                        renewal: matchedLicenseType.requirements?.renewal || [],
                    },
                } : null,
                contact: {
                    phone: metadata.contact?.phone || '',
                    email: metadata.contact?.email || '',
                },
            };

            this.stateRequirementsCache.set(cacheKey, requirements);
            return requirements;
        } catch (error) {
            console.error(`Error loading state requirements for ${stateCode}:`, error);
            this.stateRequirementsCache.set(cacheKey, null);
            return null;
        }
    }

    /**
     * Build personalization prompt
     */
    private buildPersonalizationPrompt(
        options: AlertPersonalizationOptions,
        employeeHistory: EmployeeHistory | null,
        stateRequirements: StateRequirements | null
    ): string {
        const urgencyLevel = this.getUrgencyLevel(options.alertType);
        const behaviorPattern = this.getBehaviorPattern(employeeHistory);
        const responsePattern = this.getResponsePattern(employeeHistory);
        const communicationStyle = employeeHistory?.preferredCommunicationStyle || 'friendly';

        let prompt = PERSONALIZATION_PROMPT
            .replace('{employeeName}', options.employeeContext.employeeName)
            .replace('{firstName}', options.employeeContext.firstName)
            .replace('{lastName}', options.employeeContext.lastName)
            .replace('{licenseName}', options.licenseContext.licenseName)
            .replace('{licenseNumber}', options.licenseContext.licenseNumber || 'N/A')
            .replace('{expirationDate}', new Date(options.licenseContext.expirationDate).toLocaleDateString())
            .replace('{daysRemaining}', options.licenseContext.daysRemaining.toString())
            .replace('{alertType}', options.alertType)
            .replace('{stateName}', stateRequirements?.stateName || 'Unknown State')
            .replace('{stateCode}', stateRequirements?.stateCode || options.licenseContext.stateCode || 'N/A')
            .replace('{regulatoryBody}', stateRequirements?.regulatoryBody.name || 'State Regulatory Body')
            .replace('{urgencyLevel}', urgencyLevel)
            .replace('{behaviorPattern}', behaviorPattern)
            .replace('{responsePattern}', responsePattern)
            .replace('{communicationStyle}', communicationStyle)
            .replace('{language}', options.preferredLanguage || 'en');

        // Add employee history section
        if (employeeHistory) {
            const historyText = `
- Total alerts received: ${employeeHistory.totalAlerts}
- Total renewals completed: ${employeeHistory.totalRenewals}
- Average response time: ${employeeHistory.averageResponseTime ? `${employeeHistory.averageResponseTime.toFixed(1)} days` : 'N/A'}
- Past late renewals: ${employeeHistory.pastLateRenewals}
- Past on-time renewals: ${employeeHistory.pastOnTimeRenewals}
- Last renewal: ${employeeHistory.lastRenewalDate ? new Date(employeeHistory.lastRenewalDate).toLocaleDateString() : 'Never'}
- Last alert response: ${employeeHistory.lastAlertResponse || 'Unknown'}
`;
            prompt = prompt.replace('{employeeHistory}', historyText);
        } else {
            prompt = prompt.replace('{employeeHistory}', 'No previous history available (new employee or first alert)');
        }

        // Add state requirements section
        if (stateRequirements?.licenseType) {
            const requirementsText = `
- License Type: ${stateRequirements.licenseType.displayName}
- Renewal Period: ${stateRequirements.licenseType.renewalPeriodMonths} months
- Renewal Training Required: ${stateRequirements.licenseType.renewalTrainingHours} hours
- Renewal Requirements: ${stateRequirements.licenseType.requirements.renewal.join(', ')}
- Regulatory Body: ${stateRequirements.regulatoryBody.name} (${stateRequirements.regulatoryBody.website})
- Contact: ${stateRequirements.contact.phone || stateRequirements.contact.email || 'N/A'}
`;
            prompt = prompt.replace('{stateRequirements}', requirementsText);
        } else {
            prompt = prompt.replace('{stateRequirements}', 'State-specific requirements not available');
        }

        return prompt;
    }

    /**
     * Parse personalization response from AI
     */
    private parsePersonalizationResponse(text: string): {
        message: string;
        tone: 'formal' | 'casual' | 'friendly' | 'urgent';
        variant: string;
        personalizationFactors: string[];
        reasoning?: string;
    } {
        try {
            // Try direct parse
            const parsed = JSON.parse(text);
            return {
                message: parsed.message || '',
                tone: parsed.tone || 'friendly',
                variant: parsed.variant || 'A',
                personalizationFactors: parsed.personalizationFactors || [],
                reasoning: parsed.reasoning,
            };
        } catch {
            // Try extracting from markdown code block
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[1].trim());
                    return {
                        message: parsed.message || '',
                        tone: parsed.tone || 'friendly',
                        variant: parsed.variant || 'A',
                        personalizationFactors: parsed.personalizationFactors || [],
                        reasoning: parsed.reasoning,
                    };
                } catch {
                    // Fall through
                }
            }

            // Try finding JSON object in text
            const objectMatch = text.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                try {
                    const parsed = JSON.parse(objectMatch[0]);
                    return {
                        message: parsed.message || '',
                        tone: parsed.tone || 'friendly',
                        variant: parsed.variant || 'A',
                        personalizationFactors: parsed.personalizationFactors || [],
                        reasoning: parsed.reasoning,
                    };
                } catch {
                    // Fall through
                }
            }

            // If all parsing fails, extract message from text
            const messageMatch = text.match(/"message"\s*:\s*"([^"]+)"/);
            if (messageMatch) {
                return {
                    message: messageMatch[1],
                    tone: 'friendly',
                    variant: 'A',
                    personalizationFactors: [],
                };
            }

            throw new Error('Could not parse personalization response');
        }
    }

    /**
     * Get urgency level description
     */
    private getUrgencyLevel(alertType: string): string {
        switch (alertType) {
            case 'expiring_30d':
                return 'Low (friendly reminder)';
            case 'expiring_14d':
                return 'Medium (important)';
            case 'expiring_7d':
                return 'High (urgent)';
            case 'expired':
                return 'Critical (immediate action required)';
            default:
                return 'Medium';
        }
    }

    /**
     * Get behavior pattern description
     */
    private getBehaviorPattern(history: EmployeeHistory | null): string {
        if (!history) return 'Unknown (new employee)';

        if (history.pastLateRenewals > history.pastOnTimeRenewals) {
            return 'Tends to renew late - needs early reminders';
        } else if (history.pastOnTimeRenewals > history.pastLateRenewals) {
            return 'Usually renews on time - reliable';
        } else if (history.totalRenewals === 0) {
            return 'No renewal history - first time';
        } else {
            return 'Mixed renewal history';
        }
    }

    /**
     * Get response pattern description
     */
    private getResponsePattern(history: EmployeeHistory | null): string {
        if (!history) return 'Unknown';

        if (history.lastAlertResponse === 'responded') {
            return 'Responds to alerts promptly';
        } else if (history.lastAlertResponse === 'ignored') {
            return 'May ignore alerts - needs more attention';
        } else {
            return 'Unknown response pattern';
        }
    }

    /**
     * Determine tone from alert type
     */
    private determineTone(alertType: string): 'formal' | 'casual' | 'friendly' | 'urgent' {
        switch (alertType) {
            case 'expiring_30d':
                return 'friendly';
            case 'expiring_14d':
                return 'friendly';
            case 'expiring_7d':
                return 'urgent';
            case 'expired':
                return 'urgent';
            default:
                return 'friendly';
        }
    }

    /**
     * Get fallback message when AI is not available
     */
    private getFallbackMessage(options: AlertPersonalizationOptions): PersonalizedMessage {
        // Use basic template as fallback
        const days = Math.abs(options.licenseContext.daysRemaining);
        const expirationDate = new Date(options.licenseContext.expirationDate).toLocaleDateString();

        let message = '';
        switch (options.alertType) {
            case 'expiring_30d':
                message = `ReguGuard Alert: Your ${options.licenseContext.licenseName} expires in ${days} days (${expirationDate}). Start your renewal process now to avoid lapses. Reply HELP for renewal steps.`;
                break;
            case 'expiring_14d':
                message = `ReguGuard REMINDER: Your ${options.licenseContext.licenseName} expires in ${days} days (${expirationDate}). Please contact your supervisor to complete renewal. Reply HELP for assistance.`;
                break;
            case 'expiring_7d':
                message = `URGENT ReguGuard: Your ${options.licenseContext.licenseName} expires in ${days} days! Contact your supervisor IMMEDIATELY to complete renewal. Reply HELP for assistance.`;
                break;
            case 'expired':
                message = `ALERT ReguGuard: Your ${options.licenseContext.licenseName} has EXPIRED as of ${expirationDate}. You cannot work until renewed. Contact HR immediately.`;
                break;
        }

        return {
            message,
            language: options.preferredLanguage || 'en',
            tone: this.determineTone(options.alertType),
            variant: 'A',
            metadata: {
                personalizationFactors: ['fallback_template'],
                stateRequirementsIncluded: false,
                employeeHistoryUsed: false,
            },
        };
    }
}

// Export singleton
export const alertPersonalizationService = new AlertPersonalizationService();

