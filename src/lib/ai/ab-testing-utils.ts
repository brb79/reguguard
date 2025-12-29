/**
 * A/B Testing Utilities for Alert Personalization
 * 
 * Tracks and analyzes response rates for different message variants
 * to optimize alert effectiveness.
 */

import { createServerClient } from '@/lib/supabase';

// ============================================================================
// Types
// ============================================================================

export interface ABTestMetrics {
    variant: 'A' | 'B' | 'template';
    totalSent: number;
    totalAcknowledged: number;
    totalRenewed: number;
    averageResponseTime: number | null; // Days from alert to renewal
    responseRate: number; // Percentage
    renewalRate: number; // Percentage
}

export interface ABTestComparison {
    variantA: ABTestMetrics;
    variantB: ABTestMetrics;
    template: ABTestMetrics;
    winner: 'A' | 'B' | 'template' | 'inconclusive';
    confidence: number; // 0-1, statistical confidence in winner
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get A/B test metrics for a specific variant
 */
export async function getABTestMetrics(
    variant: 'A' | 'B' | 'template',
    dateRange?: { start: Date; end: Date }
): Promise<ABTestMetrics> {
    const supabase = await createServerClient();

    let query = supabase
        .from('alerts')
        .select(`
            id,
            status,
            sent_at,
            acknowledged_at,
            personalization_metadata,
            license:licenses_cache!inner (
                id
            )
        `)
        .eq('status', 'sent')
        .not('sent_at', 'is', null);

    // Filter by variant
    if (variant === 'template') {
        query = query.or('personalization_metadata.is.null');
    } else {
        query = query.contains('personalization_metadata', { variant });
    }

    // Filter by date range if provided
    if (dateRange) {
        query = query
            .gte('sent_at', dateRange.start.toISOString())
            .lte('sent_at', dateRange.end.toISOString());
    }

    // Type for alert query result
    type AlertQueryResult = {
        id: string;
        status: string;
        sent_at: string | null;
        acknowledged_at: string | null;
        personalization_metadata: unknown;
        license: unknown;
    };

    const { data: alerts } = await query as { data: AlertQueryResult[] | null; error: unknown };

    if (!alerts || alerts.length === 0) {
        return {
            variant,
            totalSent: 0,
            totalAcknowledged: 0,
            totalRenewed: 0,
            averageResponseTime: null,
            responseRate: 0,
            renewalRate: 0,
        };
    }

    const totalSent = alerts.length;
    const totalAcknowledged = alerts.filter(a => a.acknowledged_at).length;

    // Count renewals (completed conversations within 30 days of alert)
    const alertIds = alerts.map(a => a.id);
    const { data: renewals } = await supabase
        .from('sms_conversations')
        .select('alert_id, completed_at, created_at')
        .in('alert_id', alertIds)
        .eq('status', 'completed')
        .not('completed_at', 'is', null);

    const totalRenewed = renewals?.length || 0;

    // Calculate average response time
    let averageResponseTime: number | null = null;
    const responseTimes: number[] = [];

    for (const alert of alerts) {
        if (alert.sent_at && alert.acknowledged_at) {
            const days = Math.floor(
                (new Date(alert.acknowledged_at).getTime() -
                    new Date(alert.sent_at).getTime()) / (1000 * 60 * 60 * 24)
            );
            responseTimes.push(days);
        }
    }

    if (responseTimes.length > 0) {
        averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    }

    return {
        variant,
        totalSent,
        totalAcknowledged,
        totalRenewed,
        averageResponseTime,
        responseRate: totalSent > 0 ? (totalAcknowledged / totalSent) * 100 : 0,
        renewalRate: totalSent > 0 ? (totalRenewed / totalSent) * 100 : 0,
    };
}

/**
 * Compare A/B test variants and determine winner
 */
export async function compareABTestVariants(
    dateRange?: { start: Date; end: Date }
): Promise<ABTestComparison> {
    const [variantA, variantB, template] = await Promise.all([
        getABTestMetrics('A', dateRange),
        getABTestMetrics('B', dateRange),
        getABTestMetrics('template', dateRange),
    ]);

    // Determine winner based on renewal rate (primary metric)
    const metrics = [
        { key: 'A' as const, ...variantA },
        { key: 'B' as const, ...variantB },
        { key: 'template' as const, ...template },
    ];

    // Sort by renewal rate
    metrics.sort((a, b) => b.renewalRate - a.renewalRate);

    const winner = metrics[0].key;
    const secondBest = metrics[1];

    // Calculate confidence (simplified: based on difference and sample size)
    const difference = metrics[0].renewalRate - secondBest.renewalRate;
    const minSampleSize = Math.min(
        metrics[0].totalSent,
        secondBest.totalSent
    );

    // Higher confidence if:
    // - Larger difference in rates
    // - Larger sample size
    let confidence = 0.5; // Base confidence
    if (difference > 5) confidence += 0.2; // 5%+ difference
    if (difference > 10) confidence += 0.2; // 10%+ difference
    if (minSampleSize > 50) confidence += 0.1; // Good sample size
    if (minSampleSize > 100) confidence += 0.1; // Great sample size

    confidence = Math.min(confidence, 1.0);

    // If difference is very small or sample size is too small, mark as inconclusive
    if (difference < 2 || minSampleSize < 10) {
        return {
            variantA,
            variantB,
            template,
            winner: 'inconclusive',
            confidence: 0,
        };
    }

    return {
        variantA,
        variantB,
        template,
        winner,
        confidence,
    };
}

/**
 * Get personalized alert statistics
 */
export async function getPersonalizationStats(
    dateRange?: { start: Date; end: Date }
): Promise<{
    totalAlerts: number;
    personalizedAlerts: number;
    templateAlerts: number;
    personalizationRate: number;
    averagePersonalizationFactors: number;
}> {
    const supabase = await createServerClient();

    let query = supabase
        .from('alerts')
        .select('id, personalization_metadata')
        .eq('status', 'sent')
        .not('sent_at', 'is', null);

    if (dateRange) {
        query = query
            .gte('sent_at', dateRange.start.toISOString())
            .lte('sent_at', dateRange.end.toISOString());
    }

    // Type for personalization stats query
    type PersonalizationAlertResult = {
        id: string;
        personalization_metadata: unknown;
    };

    const { data: alerts } = await query as { data: PersonalizationAlertResult[] | null; error: unknown };

    if (!alerts || alerts.length === 0) {
        return {
            totalAlerts: 0,
            personalizedAlerts: 0,
            templateAlerts: 0,
            personalizationRate: 0,
            averagePersonalizationFactors: 0,
        };
    }

    const totalAlerts = alerts.length;
    const personalizedAlerts = alerts.filter(
        a => a.personalization_metadata &&
            typeof a.personalization_metadata === 'object' &&
            'variant' in (a.personalization_metadata as any)
    ).length;

    const templateAlerts = totalAlerts - personalizedAlerts;

    // Calculate average personalization factors
    const factorsCounts = alerts
        .filter(a => a.personalization_metadata)
        .map(a => {
            const metadata = a.personalization_metadata as any;
            return metadata?.personalizationFactors?.length || 0;
        });

    const averagePersonalizationFactors = factorsCounts.length > 0
        ? factorsCounts.reduce((a, b) => a + b, 0) / factorsCounts.length
        : 0;

    return {
        totalAlerts,
        personalizedAlerts,
        templateAlerts,
        personalizationRate: (personalizedAlerts / totalAlerts) * 100,
        averagePersonalizationFactors,
    };
}

