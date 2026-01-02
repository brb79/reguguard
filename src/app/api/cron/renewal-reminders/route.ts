/**
 * Renewal Timeout Reminders Cron Job
 *
 * GET /api/cron/renewal-reminders
 *
 * Daily cron job that:
 * 1. Finds stale renewal sessions (no activity for 72+ hours)
 * 2. Triggers autonomous agent to send reminders
 * 3. Escalates to supervisor if needed
 */

import { NextRequest, NextResponse } from 'next/server';
import { renewalSessionService, type RenewalSessionStatus } from '@/lib/renewals/session-service';
import { autonomousRenewalAgent } from '@/lib/renewals/autonomous-agent';

export async function GET(req: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.CRON_SECRET;

    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const results = {
      checked: 0,
      reminded: 0,
      escalated: 0,
      errors: [] as string[],
    };

    // Check different statuses for stale sessions
    const statusesToCheck: RenewalSessionStatus[] = [
      'awaiting_photo',
      'awaiting_training',
      'awaiting_portal_submission',
    ];

    for (const status of statusesToCheck) {
      // Find stale sessions (no activity for 72 hours)
      const staleSessions = await renewalSessionService.getStaleSessions(status, 72);

      results.checked += staleSessions.length;

      for (const session of staleSessions) {
        try {
          // Calculate days since last update
          const hoursSinceUpdate =
            (Date.now() - new Date(session.updated_at).getTime()) / (1000 * 60 * 60);
          const daysSinceUpdate = Math.floor(hoursSinceUpdate / 24);

          // Escalate if more than 7 days
          if (daysSinceUpdate > 7) {
            await renewalSessionService.updateSession(session.session_id, {
              status: 'escalated',
            });

            await renewalSessionService.logEvent({
              session_id: session.session_id,
              event_type: 'supervisor_intervention',
              event_data: {
                reason: 'No activity for more than 7 days',
                daysSinceUpdate,
              },
              triggered_by: 'cron',
            });

            results.escalated++;
          } else {
            // Trigger agent to send reminder
            await autonomousRenewalAgent.execute({
              session_id: session.session_id,
              newEvent: {
                type: 'timeout_reminder',
                data: { daysSinceUpdate },
              },
            });

            results.reminded++;
          }
        } catch (error) {
          console.error(`Error processing session ${session.session_id}:`, error);
          results.errors.push(
            `${session.session_id}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('Error in renewal reminders cron job:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
