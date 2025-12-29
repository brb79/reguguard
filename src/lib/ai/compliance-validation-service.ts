/**
 * Compliance Validation Service - AI-Powered License Compliance Validation
 * 
 * Validates licenses against state-specific requirements, checks prerequisites,
 * detects anomalies, and generates compliance reports.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getEnv } from '@/lib/env';
import type { StateMetadata, LicenseType } from '../state-requirements/types';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { licenseMatchingService } from './matching-service';

// ============================================================================
// Types
// ============================================================================

export interface LicenseValidationRequest {
    licenseId: string;
    employeeId: string;
    description: string;
    expirationDate: string | null;
    licenseNumber: string | null;
    matchedState?: string | null;
    matchedLicenseType?: string | null;
    issueDate?: string | null;
    // Additional context
    employeeOtherLicenses?: EmployeeLicense[];
    employeeTrainingHours?: number;
    employeeLocation?: string | null;
}

export interface EmployeeLicense {
    id: string;
    description: string;
    expirationDate: string | null;
    matchedState?: string | null;
    matchedLicenseType?: string | null;
    licenseStage?: string | null;
}

export interface ComplianceValidationResult {
    isValid: boolean;
    licenseId: string;
    state: string | null;
    licenseType: string | null;
    issues: ComplianceIssue[];
    warnings: ComplianceWarning[];
    suggestions: ComplianceSuggestion[];
    prerequisites: PrerequisiteCheck[];
    anomalies: Anomaly[];
    validationScore: number; // 0-1, overall compliance score
    validatedAt: Date;
}

export interface ComplianceIssue {
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: 'expiration' | 'prerequisite' | 'training' | 'renewal_period' | 'fees' | 'requirements' | 'anomaly';
    title: string;
    description: string;
    requirement?: string; // Reference to state requirement
    correctiveAction?: string;
}

export interface ComplianceWarning {
    category: string;
    message: string;
    recommendation: string;
}

export interface ComplianceSuggestion {
    type: 'renewal' | 'training' | 'prerequisite' | 'documentation' | 'other';
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    actionItems: string[];
}

export interface PrerequisiteCheck {
    prerequisite: string; // e.g., "unarmed_security_officer"
    required: boolean;
    satisfied: boolean;
    foundLicense?: EmployeeLicense;
    message: string;
}

export interface Anomaly {
    type: 'expiration_date' | 'renewal_period' | 'training_hours' | 'license_type' | 'state_mismatch';
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    expected: string;
    actual: string;
    recommendation: string;
}

export interface ComplianceReport {
    employeeId: string;
    employeeName: string;
    licenses: ComplianceValidationResult[];
    overallScore: number;
    criticalIssues: number;
    warnings: number;
    suggestions: number;
    generatedAt: Date;
}

// ============================================================================
// Service
// ============================================================================

class ComplianceValidationService {
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
     * Check if validation service is configured
     */
    isConfigured(): boolean {
        return this.genAI !== null && this.model !== null;
    }

    /**
     * Validate a license against state requirements
     */
    async validateLicense(request: LicenseValidationRequest): Promise<ComplianceValidationResult> {
        const result: ComplianceValidationResult = {
            isValid: true,
            licenseId: request.licenseId,
            state: request.matchedState || null,
            licenseType: request.matchedLicenseType || null,
            issues: [],
            warnings: [],
            suggestions: [],
            prerequisites: [],
            anomalies: [],
            validationScore: 1.0,
            validatedAt: new Date(),
        };

        // If no state/license type matched, we can't validate
        if (!request.matchedState || !request.matchedLicenseType) {
            result.issues.push({
                severity: 'high',
                category: 'requirements',
                title: 'License Type Not Matched',
                description: 'Cannot validate license - state or license type not determined. Please ensure license is properly matched.',
                correctiveAction: 'Review license description and ensure it matches a known state license type.',
            });
            result.isValid = false;
            result.validationScore = 0.3;
            return result;
        }

        // Load state metadata
        const stateMetadata = await this.loadStateMetadata(request.matchedState);
        if (!stateMetadata) {
            result.issues.push({
                severity: 'high',
                category: 'requirements',
                title: 'State Metadata Not Found',
                description: `Cannot validate - metadata for state ${request.matchedState} not found.`,
                correctiveAction: 'Ensure state requirements are properly configured.',
            });
            result.isValid = false;
            result.validationScore = 0.2;
            return result;
        }

        // Find license type in metadata
        const licenseTypeMeta = stateMetadata.license_types.find(
            lt => lt.type === request.matchedLicenseType
        );

        if (!licenseTypeMeta) {
            result.issues.push({
                severity: 'critical',
                category: 'requirements',
                title: 'License Type Not Found',
                description: `License type ${request.matchedLicenseType} not found in ${request.matchedState} metadata.`,
                correctiveAction: 'Verify license type is correct or update state metadata.',
            });
            result.isValid = false;
            result.validationScore = 0.1;
            return result;
        }

        // Run validation checks
        await this.validateExpirationDate(request, licenseTypeMeta, result);
        await this.validateRenewalPeriod(request, licenseTypeMeta, result);
        await this.checkPrerequisites(request, stateMetadata, result);
        await this.detectAnomalies(request, licenseTypeMeta, stateMetadata, result);
        
        // Use AI to interpret complex requirements if available
        if (this.model) {
            await this.validateWithAI(request, licenseTypeMeta, stateMetadata, result);
        }

        // Calculate overall validation score
        result.validationScore = this.calculateValidationScore(result);
        result.isValid = result.validationScore >= 0.7 && result.issues.filter(i => i.severity === 'critical').length === 0;

        return result;
    }

    /**
     * Validate expiration date
     */
    private async validateExpirationDate(
        request: LicenseValidationRequest,
        licenseType: LicenseType,
        result: ComplianceValidationResult
    ): Promise<void> {
        if (!request.expirationDate) {
            result.issues.push({
                severity: 'high',
                category: 'expiration',
                title: 'Missing Expiration Date',
                description: 'License expiration date is not set.',
                correctiveAction: 'Update license with expiration date from license document.',
            });
            return;
        }

        const expirationDate = new Date(request.expirationDate);
        const today = new Date();
        const daysUntilExpiration = Math.floor(
            (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysUntilExpiration < 0) {
            result.issues.push({
                severity: 'critical',
                category: 'expiration',
                title: 'License Expired',
                description: `License expired ${Math.abs(daysUntilExpiration)} days ago.`,
                correctiveAction: 'Renew license immediately to maintain compliance.',
            });
        } else if (daysUntilExpiration <= 30) {
            result.warnings.push({
                category: 'expiration',
                message: `License expires in ${daysUntilExpiration} days.`,
                recommendation: 'Start renewal process immediately.',
            });
        }
    }

    /**
     * Validate renewal period
     */
    private async validateRenewalPeriod(
        request: LicenseValidationRequest,
        licenseType: LicenseType,
        result: ComplianceValidationResult
    ): Promise<void> {
        if (!request.expirationDate || !request.issueDate) {
            return; // Can't validate without both dates
        }

        const expirationDate = new Date(request.expirationDate);
        const issueDate = new Date(request.issueDate);
        const actualPeriodMonths = Math.floor(
            (expirationDate.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
        );
        const expectedPeriodMonths = licenseType.renewal_period_months;

        // Allow some tolerance (±1 month)
        if (Math.abs(actualPeriodMonths - expectedPeriodMonths) > 1) {
            result.anomalies.push({
                type: 'renewal_period',
                severity: 'medium',
                description: 'Renewal period does not match expected period for this license type.',
                expected: `${expectedPeriodMonths} months`,
                actual: `${actualPeriodMonths} months`,
                recommendation: `Verify license expiration date. Expected renewal period is ${expectedPeriodMonths} months.`,
            });
        }
    }

    /**
     * Check prerequisites (e.g., armed license needs unarmed first)
     */
    private async checkPrerequisites(
        request: LicenseValidationRequest,
        stateMetadata: StateMetadata,
        result: ComplianceValidationResult
    ): Promise<void> {
        const licenseTypeMeta = stateMetadata.license_types.find(
            lt => lt.type === request.matchedLicenseType
        );

        if (!licenseTypeMeta) return;

        // Common prerequisite: armed licenses often require unarmed first
        if (request.matchedLicenseType?.includes('armed')) {
            const unarmedType = stateMetadata.license_types.find(
                lt => lt.type.includes('unarmed') || lt.display_name.toLowerCase().includes('unarmed')
            );

            if (unarmedType) {
                const hasUnarmed = request.employeeOtherLicenses?.some(
                    lic => lic.matchedLicenseType === unarmedType.type &&
                           lic.expirationDate &&
                           new Date(lic.expirationDate) > new Date()
                );

                result.prerequisites.push({
                    prerequisite: unarmedType.type,
                    required: true, // Can be made configurable per state
                    satisfied: hasUnarmed || false,
                    foundLicense: request.employeeOtherLicenses?.find(
                        lic => lic.matchedLicenseType === unarmedType.type
                    ),
                    message: hasUnarmed
                        ? `Prerequisite satisfied: ${unarmedType.display_name}`
                        : `Prerequisite missing: ${unarmedType.display_name} may be required before ${licenseTypeMeta.display_name}`,
                });

                if (!hasUnarmed) {
                    result.issues.push({
                        severity: 'high',
                        category: 'prerequisite',
                        title: 'Missing Prerequisite License',
                        description: `${licenseTypeMeta.display_name} typically requires ${unarmedType.display_name} first.`,
                        requirement: `State requirement: ${unarmedType.display_name} prerequisite`,
                        correctiveAction: `Ensure employee has valid ${unarmedType.display_name} license before obtaining ${licenseTypeMeta.display_name}.`,
                    });
                }
            }
        }
    }

    /**
     * Detect anomalies in license data
     */
    private async detectAnomalies(
        request: LicenseValidationRequest,
        licenseType: LicenseType,
        stateMetadata: StateMetadata,
        result: ComplianceValidationResult
    ): Promise<void> {
        // Check if expiration date is too soon (less than expected renewal period)
        if (request.expirationDate && request.issueDate) {
            const expirationDate = new Date(request.expirationDate);
            const issueDate = new Date(request.issueDate);
            const monthsValid = Math.floor(
                (expirationDate.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
            );

            if (monthsValid < licenseType.renewal_period_months * 0.5) {
                result.anomalies.push({
                    type: 'expiration_date',
                    severity: 'high',
                    description: 'License expiration date seems unusually short.',
                    expected: `At least ${licenseType.renewal_period_months} months from issue date`,
                    actual: `${monthsValid} months from issue date`,
                    recommendation: 'Verify expiration date is correct. This may indicate an error or a temporary license.',
                });
            }
        }

        // Check for state mismatch if employee has other licenses
        if (request.employeeOtherLicenses && request.employeeOtherLicenses.length > 0) {
            const otherStates = new Set(
                request.employeeOtherLicenses
                    .map(lic => lic.matchedState)
                    .filter((state): state is string => state !== null && state !== undefined)
            );

            if (otherStates.size > 0 && !otherStates.has(request.matchedState || '')) {
                result.warnings.push({
                    category: 'state_mismatch',
                    message: `Employee has licenses from multiple states: ${Array.from(otherStates).join(', ')} and ${request.matchedState}`,
                    recommendation: 'Verify employee is authorized to work in all states where they hold licenses.',
                });
            }
        }
    }

    /**
     * Use AI to interpret complex requirements
     */
    private async validateWithAI(
        request: LicenseValidationRequest,
        licenseType: LicenseType,
        stateMetadata: StateMetadata,
        result: ComplianceValidationResult
    ): Promise<void> {
        if (!this.model) return;

        try {
            const prompt = this.buildAIValidationPrompt(request, licenseType, stateMetadata, result);

            const aiResult = await this.model.generateContent(prompt);
            const responseText = aiResult.response.text();
            const aiAnalysis = this.parseAIValidationResponse(responseText);

            // Merge AI findings into result
            if (aiAnalysis.additionalIssues) {
                result.issues.push(...aiAnalysis.additionalIssues);
            }
            if (aiAnalysis.additionalWarnings) {
                result.warnings.push(...aiAnalysis.additionalWarnings);
            }
            if (aiAnalysis.suggestions) {
                result.suggestions.push(...aiAnalysis.suggestions);
            }
        } catch (error) {
            console.error('AI validation error:', error);
            // Continue without AI - don't fail validation
        }
    }

    /**
     * Build AI validation prompt
     */
    private buildAIValidationPrompt(
        request: LicenseValidationRequest,
        licenseType: LicenseType,
        stateMetadata: StateMetadata,
        currentResult: ComplianceValidationResult
    ): string {
        return `You are a compliance expert validating security guard licenses against state requirements.

LICENSE INFORMATION:
- State: ${request.matchedState}
- License Type: ${licenseType.display_name} (${licenseType.type})
- Description: ${request.description}
- Expiration Date: ${request.expirationDate || 'Not set'}
- Issue Date: ${request.issueDate || 'Not set'}
- License Number: ${request.licenseNumber || 'Not set'}

STATE REQUIREMENTS:
${JSON.stringify(licenseType, null, 2)}

EMPLOYEE CONTEXT:
- Other Licenses: ${request.employeeOtherLicenses?.length || 0}
- Training Hours: ${request.employeeTrainingHours || 'Unknown'}

CURRENT VALIDATION FINDINGS:
- Issues: ${currentResult.issues.length}
- Warnings: ${currentResult.warnings.length}
- Anomalies: ${currentResult.anomalies.length}

Analyze this license for:
1. Compliance with state renewal requirements
2. Training hour requirements (if data available)
3. Fee requirements
4. Complex requirement interpretations
5. Additional compliance risks

Respond with JSON:
{
    "additionalIssues": [
        {
            "severity": "critical|high|medium|low",
            "category": "expiration|prerequisite|training|renewal_period|fees|requirements|anomaly",
            "title": "Issue title",
            "description": "Detailed description",
            "requirement": "State requirement reference",
            "correctiveAction": "What to do"
        }
    ],
    "additionalWarnings": [
        {
            "category": "category",
            "message": "Warning message",
            "recommendation": "Recommendation"
        }
    ],
    "suggestions": [
        {
            "type": "renewal|training|prerequisite|documentation|other",
            "title": "Suggestion title",
            "description": "Description",
            "priority": "high|medium|low",
            "actionItems": ["action 1", "action 2"]
        }
    ]
}`;
    }

    /**
     * Parse AI validation response
     */
    private parseAIValidationResponse(text: string): {
        additionalIssues?: ComplianceIssue[];
        additionalWarnings?: ComplianceWarning[];
        suggestions?: ComplianceSuggestion[];
    } {
        try {
            const parsed = this.parseJsonResponse<{
                additionalIssues?: ComplianceIssue[];
                additionalWarnings?: ComplianceWarning[];
                suggestions?: ComplianceSuggestion[];
            }>(text);

            return {
                additionalIssues: parsed.additionalIssues || [],
                additionalWarnings: parsed.additionalWarnings || [],
                suggestions: parsed.suggestions || [],
            };
        } catch (error) {
            console.error('Failed to parse AI validation response:', error);
            return {};
        }
    }

    /**
     * Calculate overall validation score
     */
    private calculateValidationScore(result: ComplianceValidationResult): number {
        let score = 1.0;

        // Deduct for issues
        for (const issue of result.issues) {
            switch (issue.severity) {
                case 'critical':
                    score -= 0.3;
                    break;
                case 'high':
                    score -= 0.2;
                    break;
                case 'medium':
                    score -= 0.1;
                    break;
                case 'low':
                    score -= 0.05;
                    break;
            }
        }

        // Deduct for anomalies
        for (const anomaly of result.anomalies) {
            switch (anomaly.severity) {
                case 'critical':
                    score -= 0.2;
                    break;
                case 'high':
                    score -= 0.15;
                    break;
                case 'medium':
                    score -= 0.1;
                    break;
                case 'low':
                    score -= 0.05;
                    break;
            }
        }

        // Deduct for unsatisfied prerequisites
        for (const prereq of result.prerequisites) {
            if (prereq.required && !prereq.satisfied) {
                score -= 0.15;
            }
        }

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Generate compliance report for an employee
     */
    async generateComplianceReport(
        employeeId: string,
        employeeName: string,
        licenses: LicenseValidationRequest[]
    ): Promise<ComplianceReport> {
        const validationResults: ComplianceValidationResult[] = [];

        // Validate each license
        for (const license of licenses) {
            const result = await this.validateLicense(license);
            validationResults.push(result);
        }

        // Calculate overall metrics
        const criticalIssues = validationResults.reduce(
            (sum, r) => sum + r.issues.filter(i => i.severity === 'critical').length,
            0
        );
        const warnings = validationResults.reduce((sum, r) => sum + r.warnings.length, 0);
        const suggestions = validationResults.reduce((sum, r) => sum + r.suggestions.length, 0);
        const overallScore = validationResults.length > 0
            ? validationResults.reduce((sum, r) => sum + r.validationScore, 0) / validationResults.length
            : 1.0;

        return {
            employeeId,
            employeeName,
            licenses: validationResults,
            overallScore,
            criticalIssues,
            warnings,
            suggestions,
            generatedAt: new Date(),
        };
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Load state metadata
     */
    private async loadStateMetadata(stateCode: string): Promise<StateMetadata | null> {
        // Check cache first
        if (this.stateMetadataCache.has(stateCode)) {
            return this.stateMetadataCache.get(stateCode)!;
        }

        try {
            const metadataPath = join(
                process.cwd(),
                'knowledge',
                'states',
                stateCode,
                'metadata.json'
            );

            if (!existsSync(metadataPath)) {
                return null;
            }

            const content = readFileSync(metadataPath, 'utf-8');
            const metadata = JSON.parse(content) as StateMetadata;
            this.stateMetadataCache.set(stateCode, metadata);
            return metadata;
        } catch (error) {
            console.error(`Error loading metadata for ${stateCode}:`, error);
            return null;
        }
    }

    /**
     * Parse JSON response
     */
    private parseJsonResponse<T>(text: string): T {
        try {
            return JSON.parse(text) as T;
        } catch {
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1].trim()) as T;
                } catch {
                    throw new Error('Failed to parse JSON from markdown');
                }
            }

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
}

// Export singleton
export const complianceValidationService = new ComplianceValidationService();

