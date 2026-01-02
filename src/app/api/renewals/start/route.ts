/**
 * Start Renewal Workflow API
 *
 * POST /api/renewals/start
 *
 * Initiates an autonomous renewal workflow for an employee's license.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { renewalSessionService } from '@/lib/renewals/session-service';
import { autonomousRenewalAgent } from '@/lib/renewals/autonomous-agent';

// Request schema
const requestSchema = z.object({
  employee_id: z.string().min(1, 'Employee ID is required'),
  license_id: z.string().optional(),
  initial_message: z.string().optional(),
  metadata: z.record(z.any()).optional(),
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

    const { employee_id, license_id, initial_message, metadata } = validationResult.data;

    // Check if employee already has an active renewal session
    const activeSessions = await renewalSessionService.getActiveSessions(employee_id);

    if (activeSessions.length > 0) {
      // Resume existing session instead of creating new one
      const existingSession = activeSessions[0];

      return NextResponse.json({
        session_id: existingSession.session_id,
        status: 'resumed',
        message: 'Resumed existing renewal session',
        current_status: existingSession.status,
        current_step: existingSession.current_step,
      });
    }

    // Create new renewal session
    const session = await renewalSessionService.createSession({
      employee_id,
      license_id,
      initial_message: initial_message || 'I want to renew my license',
      metadata,
    });

    // Execute autonomous agent to start workflow
    const agentResult = await autonomousRenewalAgent.execute({
      session_id: session.session_id,
    });

    return NextResponse.json({
      session_id: session.session_id,
      status: 'started',
      message: agentResult.response,
      next_status: agentResult.nextStatus,
      next_step: agentResult.nextStep,
      actions: agentResult.actions,
    });
  } catch (error) {
    console.error('Error starting renewal workflow:', error);

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
    endpoint: '/api/renewals/start',
    method: 'POST',
    description: 'Start autonomous license renewal workflow',
  });
}
