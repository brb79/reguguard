/**
 * Health Check Endpoint
 * 
 * Returns the health status of the application and its dependencies.
 * Useful for monitoring and load balancer health checks.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { envChecks } from '@/lib/env';
import { smsService } from '@/lib/sms';
import { visionService } from '@/lib/vision';

export async function GET() {
    const health: {
        status: 'healthy' | 'degraded' | 'unhealthy';
        timestamp: string;
        services: Record<string, { status: 'ok' | 'error'; message?: string }>;
    } = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {},
    };

    // Check Supabase
    try {
        const supabase = await createServerClient();
        const { error } = await supabase.from('clients').select('id').limit(1);
        if (error) throw error;
        health.services.supabase = { status: 'ok' };
    } catch (error) {
        health.services.supabase = {
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
        };
        health.status = 'unhealthy';
    }

    // Check Twilio
    if (envChecks.isTwilioConfigured()) {
        health.services.twilio = smsService.isConfigured()
            ? { status: 'ok' }
            : { status: 'error', message: 'Not configured' };
    } else {
        health.services.twilio = { status: 'ok', message: 'Not required' };
    }

    // Check Vision Service
    if (envChecks.isVisionConfigured()) {
        health.services.vision = visionService.isConfigured()
            ? { status: 'ok' }
            : { status: 'error', message: 'Not configured' };
    } else {
        health.services.vision = { status: 'ok', message: 'Not required' };
    }

    // Determine overall status
    const hasErrors = Object.values(health.services).some((s) => s.status === 'error');
    if (hasErrors && health.services.supabase.status === 'error') {
        health.status = 'unhealthy';
    } else if (hasErrors) {
        health.status = 'degraded';
    }

    const statusCode = health.status === 'unhealthy' ? 503 : health.status === 'degraded' ? 200 : 200;

    return NextResponse.json(health, { status: statusCode });
}

