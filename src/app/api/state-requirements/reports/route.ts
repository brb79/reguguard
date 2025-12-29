/**
 * Get Compliance Impact Reports
 * 
 * Returns impact reports for a state
 * 
 * GET /api/state-requirements/reports?state=VA&limit=10
 */

import { NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/errors';
import { stateRequirementsMonitoringService } from '@/lib/state-requirements';

export const GET = withErrorHandling(async (request: Request) => {
    const url = new URL(request.url);
    const stateCode = url.searchParams.get('state');
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);

    if (!stateCode) {
        return NextResponse.json(
            { error: 'State code is required' },
            { status: 400 }
        );
    }

    const reports = await stateRequirementsMonitoringService.getImpactReports(
        stateCode,
        limit
    );

    return NextResponse.json({
        success: true,
        state_code: stateCode,
        reports,
    });
});

