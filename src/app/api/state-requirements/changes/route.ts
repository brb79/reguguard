/**
 * Get State Requirements Changes
 * 
 * Returns detected changes for a state
 * 
 * GET /api/state-requirements/changes?state=VA&limit=20
 */

import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/errors';
import { stateRequirementsMonitoringService } from '@/lib/state-requirements';

export const GET = withErrorHandling(async (request: Request) => {
    const url = new URL(request.url);
    const stateCode = url.searchParams.get('state');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    if (!stateCode) {
        return NextResponse.json(
            { error: 'State code is required' },
            { status: 400 }
        );
    }

    const changes = await stateRequirementsMonitoringService.getLatestChanges(
        stateCode,
        limit
    );

    return NextResponse.json({
        success: true,
        state_code: stateCode,
        changes,
    });
});

