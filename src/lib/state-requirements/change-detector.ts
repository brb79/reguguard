/**
 * Change Detection for State Requirements
 * 
 * Compares old and new metadata to detect changes and classify their severity
 */

import type { StateMetadata, DetectedChange, LicenseType } from './types';

export class StateRequirementsChangeDetector {
    /**
     * Detect changes between old and new metadata
     */
    detectChanges(oldMetadata: StateMetadata, newMetadata: StateMetadata): DetectedChange[] {
        const changes: DetectedChange[] = [];

        // Compare top-level fields
        changes.push(...this.compareRegulatoryBody(oldMetadata, newMetadata));
        changes.push(...this.compareLicenseTypes(oldMetadata, newMetadata));
        changes.push(...this.compareTrainingTopics(oldMetadata, newMetadata));
        changes.push(...this.compareBackgroundCheck(oldMetadata, newMetadata));
        changes.push(...this.compareFees(oldMetadata, newMetadata));
        changes.push(...this.compareContact(oldMetadata, newMetadata));

        return changes;
    }

    /**
     * Compare regulatory body information
     */
    private compareRegulatoryBody(old: StateMetadata, new_: StateMetadata): DetectedChange[] {
        const changes: DetectedChange[] = [];
        const oldBody = old.regulatory_body || {};
        const newBody = new_.regulatory_body || {};

        if (oldBody.website !== newBody.website) {
            changes.push({
                change_type: 'update',
                field_path: 'regulatory_body.website',
                old_value: oldBody.website,
                new_value: newBody.website,
                description: 'Regulatory body website URL changed',
                severity: 'medium',
            });
        }

        if (oldBody.name !== newBody.name) {
            changes.push({
                change_type: 'update',
                field_path: 'regulatory_body.name',
                old_value: oldBody.name,
                new_value: newBody.name,
                description: 'Regulatory body name changed',
                severity: 'high',
            });
        }

        return changes;
    }

    /**
     * Compare license types (most critical comparison)
     */
    private compareLicenseTypes(old: StateMetadata, new_: StateMetadata): DetectedChange[] {
        const changes: DetectedChange[] = [];
        const oldTypes = old.license_types || [];
        const newTypes = new_.license_types || [];

        // Create maps for easier comparison
        const oldTypeMap = new Map(oldTypes.map(lt => [lt.type, lt]));
        const newTypeMap = new Map(newTypes.map(lt => [lt.type, lt]));

        // Check for removed license types
        for (const [type, oldType] of oldTypeMap) {
            if (!newTypeMap.has(type)) {
                changes.push({
                    change_type: 'removal',
                    field_path: `license_types[${type}]`,
                    old_value: oldType,
                    new_value: null,
                    description: `License type "${oldType.display_name}" was removed`,
                    severity: 'critical',
                });
            }
        }

        // Check for added license types
        for (const [type, newType] of newTypeMap) {
            if (!oldTypeMap.has(type)) {
                changes.push({
                    change_type: 'addition',
                    field_path: `license_types[${type}]`,
                    old_value: null,
                    new_value: newType,
                    description: `New license type "${newType.display_name}" was added`,
                    severity: 'medium',
                });
            }
        }

        // Compare existing license types
        for (const [type, oldType] of oldTypeMap) {
            const newType = newTypeMap.get(type);
            if (!newType) continue;

            changes.push(...this.compareLicenseType(oldType, newType, type));
        }

        return changes;
    }

    /**
     * Compare individual license type fields
     */
    private compareLicenseType(old: LicenseType, new_: LicenseType, typeKey: string): DetectedChange[] {
        const changes: DetectedChange[] = [];

        // Renewal period changes (breaking)
        if (old.renewal_period_months !== new_.renewal_period_months) {
            changes.push({
                change_type: 'breaking',
                field_path: `license_types[${typeKey}].renewal_period_months`,
                old_value: old.renewal_period_months,
                new_value: new_.renewal_period_months,
                description: `Renewal period changed from ${old.renewal_period_months} to ${new_.renewal_period_months} months`,
                severity: 'critical',
            });
        }

        // Training hours changes (breaking)
        if (old.initial_training_hours !== new_.initial_training_hours) {
            changes.push({
                change_type: 'breaking',
                field_path: `license_types[${typeKey}].initial_training_hours`,
                old_value: old.initial_training_hours,
                new_value: new_.initial_training_hours,
                description: `Initial training hours changed from ${old.initial_training_hours} to ${new_.initial_training_hours} hours`,
                severity: 'critical',
            });
        }

        if (old.renewal_training_hours !== new_.renewal_training_hours) {
            changes.push({
                change_type: 'breaking',
                field_path: `license_types[${typeKey}].renewal_training_hours`,
                old_value: old.renewal_training_hours,
                new_value: new_.renewal_training_hours,
                description: `Renewal training hours changed from ${old.renewal_training_hours} to ${new_.renewal_training_hours} hours`,
                severity: 'high',
            });
        }

        // Requirements changes
        const oldInitialReqs = new Set(old.requirements.initial || []);
        const newInitialReqs = new Set(new_.requirements.initial || []);
        if (!this.setsEqual(oldInitialReqs, newInitialReqs)) {
            changes.push({
                change_type: 'breaking',
                field_path: `license_types[${typeKey}].requirements.initial`,
                old_value: old.requirements.initial,
                new_value: new_.requirements.initial,
                description: 'Initial requirements changed',
                severity: 'critical',
            });
        }

        const oldRenewalReqs = new Set(old.requirements.renewal || []);
        const newRenewalReqs = new Set(new_.requirements.renewal || []);
        if (!this.setsEqual(oldRenewalReqs, newRenewalReqs)) {
            changes.push({
                change_type: 'breaking',
                field_path: `license_types[${typeKey}].requirements.renewal`,
                old_value: old.requirements.renewal,
                new_value: new_.requirements.renewal,
                description: 'Renewal requirements changed',
                severity: 'high',
            });
        }

        // Fee changes (non-breaking but important)
        const oldAppFee = old.fees?.application;
        const newAppFee = new_.fees?.application;
        if (oldAppFee !== undefined && newAppFee !== undefined && oldAppFee !== newAppFee) {
            changes.push({
                change_type: 'non_breaking',
                field_path: `license_types[${typeKey}].fees.application`,
                old_value: oldAppFee,
                new_value: newAppFee,
                description: `Application fee changed from $${oldAppFee} to $${newAppFee}`,
                severity: 'medium',
            });
        }

        const oldRenewalFee = old.fees?.renewal;
        const newRenewalFee = new_.fees?.renewal;
        if (oldRenewalFee !== undefined && newRenewalFee !== undefined && oldRenewalFee !== newRenewalFee) {
            changes.push({
                change_type: 'non_breaking',
                field_path: `license_types[${typeKey}].fees.renewal`,
                old_value: oldRenewalFee,
                new_value: newRenewalFee,
                description: `Renewal fee changed from $${oldRenewalFee} to $${newRenewalFee}`,
                severity: 'medium',
            });
        }

        return changes;
    }

    /**
     * Compare training topics
     */
    private compareTrainingTopics(old: StateMetadata, new_: StateMetadata): DetectedChange[] {
        const changes: DetectedChange[] = [];
        const oldTopics = old.training_topics || {};
        const newTopics = new_.training_topics || {};

        const categories = ['entry_level', 'firearms', 'in_service'] as const;
        for (const category of categories) {
            const oldList = new Set(oldTopics[category] || []);
            const newList = new Set(newTopics[category] || []);

            if (!this.setsEqual(oldList, newList)) {
                changes.push({
                    change_type: 'non_breaking',
                    field_path: `training_topics.${category}`,
                    old_value: oldTopics[category],
                    new_value: newTopics[category],
                    description: `${category} training topics changed`,
                    severity: 'low',
                });
            }
        }

        return changes;
    }

    /**
     * Compare background check requirements
     */
    private compareBackgroundCheck(old: StateMetadata, new_: StateMetadata): DetectedChange[] {
        const changes: DetectedChange[] = [];
        const oldBg = old.background_check || {};
        const newBg = new_.background_check || {};

        if (oldBg.state_check_required !== newBg.state_check_required) {
            changes.push({
                change_type: 'breaking',
                field_path: 'background_check.state_check_required',
                old_value: oldBg.state_check_required,
                new_value: newBg.state_check_required,
                description: 'State background check requirement changed',
                severity: 'high',
            });
        }

        if (oldBg.fbi_check_required !== newBg.fbi_check_required) {
            changes.push({
                change_type: 'breaking',
                field_path: 'background_check.fbi_check_required',
                old_value: oldBg.fbi_check_required,
                new_value: newBg.fbi_check_required,
                description: 'FBI background check requirement changed',
                severity: 'high',
            });
        }

        return changes;
    }

    /**
     * Compare fees (aggregate)
     */
    private compareFees(old: StateMetadata, new_: StateMetadata): DetectedChange[] {
        // Fees are compared at the license type level
        return [];
    }

    /**
     * Compare contact information
     */
    private compareContact(old: StateMetadata, new_: StateMetadata): DetectedChange[] {
        const changes: DetectedChange[] = [];
        const oldContact = old.contact || {};
        const newContact = new_.contact || {};

        if (oldContact.phone !== newContact.phone) {
            changes.push({
                change_type: 'non_breaking',
                field_path: 'contact.phone',
                old_value: oldContact.phone,
                new_value: newContact.phone,
                description: 'Contact phone number changed',
                severity: 'low',
            });
        }

        if (oldContact.email !== newContact.email) {
            changes.push({
                change_type: 'non_breaking',
                field_path: 'contact.email',
                old_value: oldContact.email,
                new_value: newContact.email,
                description: 'Contact email changed',
                severity: 'low',
            });
        }

        return changes;
    }

    /**
     * Check if two sets are equal
     */
    private setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
        if (a.size !== b.size) return false;
        for (const item of a) {
            if (!b.has(item)) return false;
        }
        return true;
    }

    /**
     * Classify change severity based on impact
     */
    classifySeverity(change: DetectedChange): 'critical' | 'high' | 'medium' | 'low' {
        // Override if already set
        if (change.severity) return change.severity;

        // Default classification based on change type
        if (change.change_type === 'breaking' || change.change_type === 'removal') {
            return 'critical';
        }
        if (change.change_type === 'addition') {
            return 'medium';
        }
        return 'low';
    }
}

export const stateRequirementsChangeDetector = new StateRequirementsChangeDetector();

