/**
 * A/B Testing Analytics API
 * 
 * Provides analytics on alert personalization effectiveness,
 * comparing variants A, B, and template-based messages.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandling } from '@/lib/errors';
import { requireClientAccess } from '@/lib/auth';
import { rateLimiters } from '@/lib/ratelimit';
import { compareABTestVariants, getPersonalizationStats } from '@/lib/ai/ab-testing-utils';

export const GET = withErrorHandling(async (request: NextRequest) => {
    // Rate limiting
    const rateLimitResponse = await rateLimiters.standard(request);
    if (rateLimitResponse) return rateLimitResponse;

    // Authentication & authorization
    const authResponse = await requireClientAccess()(request);
    if (authResponse) return authResponse;

    // Parse query parameters for date range
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    let dateRange: { start: Date; end: Date } | undefined;
    if (startDate && endDate) {
        dateRange = {
            start: new Date(startDate),
            end: new Date(endDate),
        };
    } else {
        // Default to last 30 days
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        dateRange = { start, end };
    }

    try {
        // Get A/B test comparison
        const comparison = await compareABTestVariants(dateRange);

        // Get personalization stats
        const stats = await getPersonalizationStats(dateRange);

        return NextResponse.json({
            success: true,
            dateRange: {
                start: dateRange.start.toISOString(),
                end: dateRange.end.toISOString(),
            },
            comparison,
            stats,
        });
    } catch (error) {
        console.error('A/B testing analytics error:', error);
        return NextResponse.json(
            { error: 'Failed to generate analytics', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
});

