/**
 * Compliance Impact Report Generator
 * 
 * Generates human-readable impact reports from detected changes
 */

import type { DetectedChange, ComplianceImpactReport, StateMetadata } from './types';

export class ComplianceImpactReporter {
    /**
     * Generate an impact report from detected changes
     */
    generateReport(
        stateCode: string,
        changes: DetectedChange[],
        oldMetadata: StateMetadata,
        newMetadata: StateMetadata
    ): ComplianceImpactReport {
        const breakingChanges = changes.filter(c =>
            c.change_type === 'breaking' || c.change_type === 'removal' || c.severity === 'critical'
        );
        const nonBreakingChanges = changes.filter(c =>
            c.change_type !== 'breaking' && c.change_type !== 'removal' && c.severity !== 'critical'
        );

        const affectedLicenseTypes = this.getAffectedLicenseTypes(changes, oldMetadata);

        const summary = this.generateSummary(stateCode, breakingChanges, nonBreakingChanges);
        const estimatedImpact = this.estimateImpact(breakingChanges, nonBreakingChanges, affectedLicenseTypes);
        const recommendations = this.generateRecommendations(breakingChanges, nonBreakingChanges);

        return {
            state_code: stateCode,
            summary,
            breaking_changes: breakingChanges,
            non_breaking_changes: nonBreakingChanges,
            affected_license_types: affectedLicenseTypes,
            estimated_impact: estimatedImpact,
            recommendations,
        };
    }

    /**
     * Generate summary text
     */
    private generateSummary(
        stateCode: string,
        breakingChanges: DetectedChange[],
        nonBreakingChanges: DetectedChange[]
    ): string {
        const totalChanges = breakingChanges.length + nonBreakingChanges.length;

        if (totalChanges === 0) {
            return `No changes detected in ${stateCode} state requirements.`;
        }

        let summary = `Detected ${totalChanges} change${totalChanges > 1 ? 's' : ''} in ${stateCode} state requirements. `;

        if (breakingChanges.length > 0) {
            summary += `${breakingChanges.length} breaking change${breakingChanges.length > 1 ? 's' : ''} requiring immediate attention. `;
        }

        if (nonBreakingChanges.length > 0) {
            summary += `${nonBreakingChanges.length} non-breaking change${nonBreakingChanges.length > 1 ? 's' : ''} (fees, contact info, etc.).`;
        }

        return summary.trim();
    }

    /**
     * Estimate impact on compliance operations
     */
    private estimateImpact(
        breakingChanges: DetectedChange[],
        nonBreakingChanges: DetectedChange[],
        affectedLicenseTypes: string[]
    ): string {
        if (breakingChanges.length === 0 && nonBreakingChanges.length === 0) {
            return 'No impact - no changes detected.';
        }

        const impacts: string[] = [];

        // Training hour changes
        const trainingChanges = breakingChanges.filter(c =>
            c.field_path.includes('training_hours')
        );
        if (trainingChanges.length > 0) {
            impacts.push(`Training requirements changed - ${trainingChanges.length} license type${trainingChanges.length > 1 ? 's' : ''} affected. Employees may need additional training.`);
        }

        // Renewal period changes
        const renewalChanges = breakingChanges.filter(c =>
            c.field_path.includes('renewal_period_months')
        );
        if (renewalChanges.length > 0) {
            impacts.push(`Renewal periods changed - license expiration tracking may need adjustment.`);
        }

        // Requirements changes
        const requirementChanges = breakingChanges.filter(c =>
            c.field_path.includes('requirements')
        );
        if (requirementChanges.length > 0) {
            impacts.push(`License requirements changed - new applicants must meet updated criteria.`);
        }

        // License type removals
        const removals = breakingChanges.filter(c => c.change_type === 'removal');
        if (removals.length > 0) {
            impacts.push(`${removals.length} license type${removals.length > 1 ? 's' : ''} removed - existing licenses may be affected.`);
        }

        // Fee changes
        const feeChanges = nonBreakingChanges.filter(c => c.field_path.includes('fees'));
        if (feeChanges.length > 0) {
            impacts.push(`Fee changes detected - budget planning may need updates.`);
        }

        if (impacts.length === 0) {
            return 'Minor changes detected with minimal operational impact.';
        }

        return impacts.join(' ');
    }

    /**
     * Generate actionable recommendations
     */
    private generateRecommendations(
        breakingChanges: DetectedChange[],
        nonBreakingChanges: DetectedChange[]
    ): string[] {
        const recommendations: string[] = [];

        if (breakingChanges.length > 0) {
            recommendations.push('Review and update compliance tracking systems immediately.');
            recommendations.push('Notify affected employees about requirement changes.');
            recommendations.push('Update training programs to meet new requirements.');
        }

        const trainingChanges = breakingChanges.filter(c =>
            c.field_path.includes('training_hours')
        );
        if (trainingChanges.length > 0) {
            recommendations.push('Schedule additional training for employees to meet new hour requirements.');
        }

        const renewalChanges = breakingChanges.filter(c =>
            c.field_path.includes('renewal_period_months')
        );
        if (renewalChanges.length > 0) {
            recommendations.push('Update license expiration tracking to reflect new renewal periods.');
        }

        const feeChanges = nonBreakingChanges.filter(c => c.field_path.includes('fees'));
        if (feeChanges.length > 0) {
            recommendations.push('Update budget allocations for license fees.');
        }

        if (recommendations.length === 0) {
            recommendations.push('Monitor changes and update documentation as needed.');
        }

        return recommendations;
    }

    /**
     * Get list of affected license types
     */
    private getAffectedLicenseTypes(
        changes: DetectedChange[],
        metadata: StateMetadata
    ): string[] {
        const affectedTypes = new Set<string>();

        for (const change of changes) {
            // Extract license type from field path (e.g., "license_types[armed_security_officer].renewal_period_months")
            const match = change.field_path.match(/license_types\[([^\]]+)\]/);
            if (match) {
                affectedTypes.add(match[1]);
            } else if (change.change_type === 'addition' || change.change_type === 'removal') {
                // For additions/removals, check the value
                const licenseType = change.new_value || change.old_value;
                if (licenseType && typeof licenseType === 'object' && 'type' in licenseType) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    affectedTypes.add((licenseType as any).type);
                }
            }
        }

        return Array.from(affectedTypes);
    }
}

export const complianceImpactReporter = new ComplianceImpactReporter();

