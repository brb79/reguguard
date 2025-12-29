/**
 * State Requirements Monitoring Service
 * 
 * Main service that orchestrates web scraping, AI extraction, change detection,
 * and metadata updates
 */

import { createServerClient } from '@/lib/supabase';
import { stateRequirementsScraper } from './scraper';
import { stateRequirementsAIExtractor } from './ai-extractor';
import { stateRequirementsChangeDetector } from './change-detector';
import { complianceImpactReporter } from './impact-reporter';
import { metadataUpdater } from './metadata-updater';
import type { StateMetadata, MonitoringResult, DetectedChange, ComplianceImpactReport } from './types';

export interface MonitoringOptions {
    stateCode?: string; // If provided, only monitor this state
    monitoringType?: 'scheduled' | 'manual' | 'initial';
    updateMetadata?: boolean; // Whether to automatically update metadata.json files
}

export class StateRequirementsMonitoringService {
    /**
     * Monitor state requirements for one or all states
     */
    async monitorRequirements(options: MonitoringOptions = {}): Promise<MonitoringResult[]> {
        const { stateCode, monitoringType = 'scheduled', updateMetadata = true } = options;

        // Get list of states to monitor
        const statesToMonitor = stateCode 
            ? [stateCode.toUpperCase()]
            : await this.getAllStatesWithMetadata();

        const results: MonitoringResult[] = [];

        for (const state of statesToMonitor) {
            try {
                const result = await this.monitorSingleState(state, monitoringType, updateMetadata);
                results.push(result);
            } catch (error) {
                results.push({
                    success: false,
                    state_code: state,
                    status: 'failed',
                    sources_checked: [],
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        }

        return results;
    }

    /**
     * Monitor a single state's requirements
     */
    private async monitorSingleState(
        stateCode: string,
        monitoringType: 'scheduled' | 'manual' | 'initial',
        updateMetadata: boolean
    ): Promise<MonitoringResult> {
        const supabase = await createServerClient();

        // Create monitoring record
        const { data: monitoringRecord, error: monitoringError } = await supabase
            .from('state_requirements_monitoring')
            .insert({
                state_code: stateCode,
                status: 'running',
                monitoring_type: monitoringType,
            })
            .select()
            .single();

        if (monitoringError || !monitoringRecord) {
            throw new Error(`Failed to create monitoring record: ${monitoringError?.message}`);
        }

        try {
            // Read existing metadata
            const existingMetadata = await metadataUpdater.readMetadata(stateCode);
            if (!existingMetadata) {
                throw new Error(`No existing metadata found for ${stateCode}`);
            }

            // Get sources to check
            const sources = stateRequirementsScraper.getSourcesForState(existingMetadata);
            if (sources.length === 0) {
                throw new Error(`No sources found for ${stateCode}`);
            }

            // Scrape websites
            const scrapingResults = await stateRequirementsScraper.scrapeUrls(sources);
            const successfulScrapes = scrapingResults.filter(r => r.success);
            
            if (successfulScrapes.length === 0) {
                throw new Error('Failed to scrape any sources');
            }

            // Combine scraped content
            const combinedContent = successfulScrapes
                .map(r => r.content)
                .join('\n\n---\n\n');

            // Extract requirements using AI
            const extractionResult = await stateRequirementsAIExtractor.extractRequirements({
                state_code: stateCode,
                website_content: combinedContent,
                existing_metadata: existingMetadata,
                sources: successfulScrapes.map(r => r.url),
            });

            if (!extractionResult.success || !extractionResult.extracted_metadata) {
                throw new Error(`AI extraction failed: ${extractionResult.error}`);
            }

            const newMetadata = extractionResult.extracted_metadata;

            // Detect changes
            const changes = stateRequirementsChangeDetector.detectChanges(
                existingMetadata,
                newMetadata
            );

            // Update monitoring record with sources checked
            await supabase
                .from('state_requirements_monitoring')
                .update({
                    sources_checked: successfulScrapes.map(r => r.url),
                    metadata_snapshot: existingMetadata as any,
                })
                .eq('id', monitoringRecord.id);

            let status: MonitoringResult['status'] = 'no_changes';
            let impactReportId: string | null = null;

            if (changes.length > 0) {
                status = 'changes_detected';

                // Generate impact report
                const impactReport = complianceImpactReporter.generateReport(
                    stateCode,
                    changes,
                    existingMetadata,
                    newMetadata
                );

                // Save changes to database
                const changeInserts = changes.map(change => ({
                    monitoring_id: monitoringRecord.id,
                    state_code: stateCode,
                    change_type: change.change_type,
                    field_path: change.field_path,
                    old_value: change.old_value,
                    new_value: change.new_value,
                    description: change.description,
                    severity: change.severity,
                }));

                await supabase
                    .from('state_requirements_changes')
                    .insert(changeInserts);

                // Save impact report
                const { data: reportRecord } = await supabase
                    .from('compliance_impact_reports')
                    .insert({
                        state_code: stateCode,
                        monitoring_id: monitoringRecord.id,
                        report_type: impactReport.breaking_changes.length > 0 ? 'breaking_changes' : 'change_summary',
                        summary: impactReport.summary,
                        breaking_changes: impactReport.breaking_changes as any,
                        non_breaking_changes: impactReport.non_breaking_changes as any,
                        affected_license_types: impactReport.affected_license_types,
                        estimated_impact: impactReport.estimated_impact,
                        recommendations: impactReport.recommendations,
                    })
                    .select()
                    .single();

                impactReportId = reportRecord?.id || null;

                // Update metadata if requested
                if (updateMetadata) {
                    await metadataUpdater.writeMetadata(stateCode, newMetadata);
                }
            } else {
                // No changes - just update last_verified if updating metadata
                if (updateMetadata) {
                    const updatedMetadata = { ...existingMetadata };
                    updatedMetadata.last_verified = new Date().toISOString().split('T')[0];
                    await metadataUpdater.writeMetadata(stateCode, updatedMetadata);
                }
            }

            // Update monitoring record as completed
            await supabase
                .from('state_requirements_monitoring')
                .update({
                    status,
                    completed_at: new Date().toISOString(),
                    changes_detected: changes.length > 0 ? changes as any : null,
                    impact_report_id: impactReportId,
                })
                .eq('id', monitoringRecord.id);

            return {
                success: true,
                state_code: stateCode,
                status,
                sources_checked: successfulScrapes.map(r => r.url),
                changes_detected: changes.length > 0 ? changes : undefined,
                metadata_snapshot: existingMetadata,
            };
        } catch (error) {
            // Update monitoring record as failed
            await supabase
                .from('state_requirements_monitoring')
                .update({
                    status: 'failed',
                    completed_at: new Date().toISOString(),
                    error_message: error instanceof Error ? error.message : 'Unknown error',
                })
                .eq('id', monitoringRecord.id);

            throw error;
        }
    }

    /**
     * Get all states that have metadata files
     */
    private async getAllStatesWithMetadata(): Promise<string[]> {
        // Try to read from index.json first, fallback to hardcoded list
        try {
            const { readFile } = await import('fs/promises');
            const { join } = await import('path');
            const indexPath = join(process.cwd(), 'knowledge', 'states', 'index.json');
            const indexContent = await readFile(indexPath, 'utf-8');
            const index = JSON.parse(indexContent);
            
            // Extract states with "complete" status
            const states: string[] = [];
            if (index.states) {
                for (const [stateCode, stateData] of Object.entries(index.states)) {
                    if (typeof stateData === 'object' && stateData !== null && 'status' in stateData) {
                        if ((stateData as { status: string }).status === 'complete') {
                            states.push(stateCode);
                        }
                    }
                }
            }
            
            return states.length > 0 ? states : this.getDefaultStates();
        } catch {
            // Fallback to hardcoded list if index.json doesn't exist or can't be read
            return this.getDefaultStates();
        }
    }

    /**
     * Get default list of states with metadata
     */
    private getDefaultStates(): string[] {
        return [
            'VA', 'DC', 'MD', 'TX', 'FL', 'CA', 'NY', 'PA', 'IL', 'GA'
        ];
    }

    /**
     * Get monitoring history for a state
     */
    async getMonitoringHistory(stateCode: string, limit: number = 10) {
        const supabase = await createServerClient();
        
        const { data, error } = await supabase
            .from('state_requirements_monitoring')
            .select('*')
            .eq('state_code', stateCode.toUpperCase())
            .order('started_at', { ascending: false })
            .limit(limit);

        if (error) {
            throw new Error(`Failed to fetch monitoring history: ${error.message}`);
        }

        return data;
    }

    /**
     * Get latest changes for a state
     */
    async getLatestChanges(stateCode: string, limit: number = 20) {
        const supabase = await createServerClient();
        
        const { data, error } = await supabase
            .from('state_requirements_changes')
            .select('*')
            .eq('state_code', stateCode.toUpperCase())
            .order('detected_at', { ascending: false })
            .limit(limit);

        if (error) {
            throw new Error(`Failed to fetch changes: ${error.message}`);
        }

        return data;
    }

    /**
     * Get impact reports for a state
     */
    async getImpactReports(stateCode: string, limit: number = 10) {
        const supabase = await createServerClient();
        
        const { data, error } = await supabase
            .from('compliance_impact_reports')
            .select('*')
            .eq('state_code', stateCode.toUpperCase())
            .order('generated_at', { ascending: false })
            .limit(limit);

        if (error) {
            throw new Error(`Failed to fetch impact reports: ${error.message}`);
        }

        return data;
    }
}

export const stateRequirementsMonitoringService = new StateRequirementsMonitoringService();

