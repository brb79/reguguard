/**
 * State Requirements Monitoring Cron Job
 * 
 * Scheduled job to monitor state regulatory websites for changes
 * Configure in Vercel: cron: '0 2 * * 0' (2 AM every Sunday)
 * 
 * This endpoint:
 * 1. Scrapes state regulatory websites
 * 2. Extracts requirements using AI
 * 3. Detects changes from existing metadata
 * 4. Updates metadata.json files
 * 5. Generates impact reports for breaking changes
 */

import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/errors';
import { stateRequirementsMonitoringService } from '@/lib/state-requirements';

export const GET = withErrorHandling(async (request: Request) => {
    const url = new URL(request.url);
    const stateCode = url.searchParams.get('state'); // Optional: monitor specific state
    const monitoringType = url.searchParams.get('type') as 'scheduled' | 'manual' | 'initial' || 'scheduled';
    const updateMetadata = url.searchParams.get('update') !== 'false'; // Default true

    // Monitor requirements
    const results = await stateRequirementsMonitoringService.monitorRequirements({
        stateCode: stateCode || undefined,
        monitoringType,
        updateMetadata,
    });

    // Count results by status
    const summary = {
        total: results.length,
        completed: results.filter(r => r.status === 'completed' || r.status === 'no_changes').length,
        changes_detected: results.filter(r => r.status === 'changes_detected').length,
        failed: results.filter(r => r.status === 'failed').length,
    };

    return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        summary,
        results,
    });
});

