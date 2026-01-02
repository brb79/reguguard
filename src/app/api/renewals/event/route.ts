/**
 * Renewal Event Handler API
 *
 * POST /api/renewals/event
 *
 * Handles events that resume autonomous renewal workflows:
 * - Photo uploads
 * - Training certificate uploads
 * - Employee messages
 * - Portal submission confirmations
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { renewalSessionService } from '@/lib/renewals/session-service';
import { autonomousRenewalAgent } from '@/lib/renewals/autonomous-agent';

// Request schema
const requestSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required'),
  event_type: z.enum([
    'photo_uploaded',
    'certificate_uploaded',
    'employee_message',
    'portal_submitted',
    'timeout_reminder',
    'supervisor_intervention',
  ]),
  event_data: z.record(z.any()).optional(),
  triggered_by: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Parse and validate request
    const body = await req.json();
    const validationResult = requestSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const { session_id, event_type, event_data, triggered_by } = validationResult.data;

    // Verify session exists
    const session = await renewalSessionService.getSession(session_id);
    if (!session) {
      return NextResponse.json(
        {
          error: 'Session not found',
          message: `No renewal session found with ID: ${session_id}`,
        },
        { status: 404 }
      );
    }

    // Check if session is already completed/failed/cancelled
    if (['completed', 'failed', 'cancelled'].includes(session.status)) {
      return NextResponse.json(
        {
          error: 'Session not active',
          message: `Session is in ${session.status} state and cannot process events`,
        },
        { status: 400 }
      );
    }

    // Log the event
    await renewalSessionService.logEvent({
      session_id,
      event_type,
      event_data: event_data || {},
      triggered_by: triggered_by || 'system',
    });

    // Execute autonomous agent to handle event
    const agentResult = await autonomousRenewalAgent.execute({
      session_id,
      newEvent: {
        type: event_type,
        data: event_data,
      },
    });

    return NextResponse.json({
      session_id,
      event_type,
      status: 'processed',
      response: agentResult.response,
      next_status: agentResult.nextStatus,
      next_step: agentResult.nextStep,
      actions: agentResult.actions,
    });
  } catch (error) {
    console.error('Error processing renewal event:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}

// GET to check endpoint status
export async function GET() {
  return NextResponse.json({
    status: 'online',
    endpoint: '/api/renewals/event',
    method: 'POST',
    description: 'Handle renewal workflow events',
    supported_events: [
      'photo_uploaded',
      'certificate_uploaded',
      'employee_message',
      'portal_submitted',
      'timeout_reminder',
      'supervisor_intervention',
    ],
  });
}
