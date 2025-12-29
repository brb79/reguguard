/**
 * Manual State Requirements Monitoring Endpoint
 * 
 * Allows manual triggering of state requirements monitoring
 * 
 * GET /api/state-requirements/monitor?state=VA&type=manual
 */

import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/errors';
import { stateRequirementsMonitoringService } from '@/lib/state-requirements';

export const GET = withErrorHandling(async (request: Request) => {
    const url = new URL(request.url);
    const stateCode = url.searchParams.get('state'); // Optional: monitor specific state
    const monitoringType = url.searchParams.get('type') as 'scheduled' | 'manual' | 'initial' || 'manual';
    const updateMetadata = url.searchParams.get('update') !== 'false'; // Default true

    // Monitor requirements
    const results = await stateRequirementsMonitoringService.monitorRequirements({
        stateCode: stateCode || undefined,
        monitoringType,
        updateMetadata,
    });

    return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        results,
    });
});

