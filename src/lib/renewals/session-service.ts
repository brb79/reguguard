/**
 * Renewal Session Service
 *
 * Manages multi-day license renewal workflows with state persistence.
 * Enables autonomous agents to resume workflows after days/weeks with full context.
 */

import { createServiceClient } from '@/lib/supabase/server';

// ============================================================================
// Types
// ============================================================================

export type RenewalSessionStatus =
  | 'active'
  | 'awaiting_photo'
  | 'photo_uploaded'
  | 'photo_validated'
  | 'awaiting_training'
  | 'training_uploaded'
  | 'training_validated'
  | 'ready_for_portal_submission'
  | 'awaiting_portal_submission'
  | 'portal_submitted'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'escalated';

export type RenewalEventType =
  | 'photo_uploaded'
  | 'certificate_uploaded'
  | 'employee_message'
  | 'timeout_reminder'
  | 'supervisor_intervention'
  | 'portal_submitted'
  | 'verify_approval_status'
  | 'workflow_started'
  | 'workflow_completed'
  | 'workflow_failed'
  | 'workflow_cancelled'
  | 'step_completed'
  | 'agent_action';

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'function';
  content: string;
  timestamp: string;
  toolCalls?: Array<{
    name: string;
    args: any;
    result: any;
  }>;
}

export interface RenewalSession {
  session_id: string;
  employee_id: string;
  license_id?: string;
  status: RenewalSessionStatus;
  current_step?: string;
  conversation_history: ConversationTurn[];
  completed_steps: string[];
  pending_actions: string[];
  metadata: Record<string, any>;
  submission_package?: SubmissionPackage;
  confirmation_number?: string;
  submitted_at?: string;
  submitted_by?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface SubmissionPackage {
  portalUrl: string;
  instructions: string[];
  documents: Array<{
    type: string;
    url: string;
    filename: string;
    validated: boolean;
  }>;
  formData: Record<string, any>;
  estimatedTime: string;
  screenshots?: Array<{
    name: string;
    url: string;
  }>;
}

export interface RenewalEvent {
  event_id: string;
  session_id: string;
  event_type: RenewalEventType;
  event_data: Record<string, any>;
  triggered_by?: string;
  created_at: string;
  processed_at?: string;
}

export interface CreateSessionInput {
  employee_id: string;
  license_id?: string;
  initial_message?: string;
  metadata?: Record<string, any>;
}

export interface UpdateSessionInput {
  status?: RenewalSessionStatus;
  current_step?: string;
  conversation_history?: ConversationTurn[];
  completed_steps?: string[];
  pending_actions?: string[];
  metadata?: Record<string, any>;
  submission_package?: SubmissionPackage;
  confirmation_number?: string;
  submitted_at?: string;
  submitted_by?: string;
}

// ============================================================================
// Renewal Session Service
// ============================================================================

class RenewalSessionService {
  /**
   * Create a new renewal session
   */
  async createSession(input: CreateSessionInput): Promise<RenewalSession> {
    const supabase = createServiceClient();

    const initialHistory: ConversationTurn[] = input.initial_message
      ? [
          {
            role: 'user',
            content: input.initial_message,
            timestamp: new Date().toISOString(),
          },
        ]
      : [];

    const { data, error } = await (supabase
      .from('renewal_sessions') as any)
      .insert({
        employee_id: input.employee_id,
        license_id: input.license_id,
        status: 'active',
        conversation_history: initialHistory,
        metadata: input.metadata || {},
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create renewal session: ${error.message}`);
    }

    // Log workflow started event
    await this.logEvent({
      session_id: data.session_id,
      event_type: 'workflow_started',
      event_data: {
        employee_id: input.employee_id,
        license_id: input.license_id,
      },
      triggered_by: 'employee',
    });

    return data as RenewalSession;
  }

  /**
   * Get a renewal session by ID
   */
  async getSession(session_id: string): Promise<RenewalSession | null> {
    const supabase = createServiceClient();

    const { data, error } = await (supabase
      .from('renewal_sessions') as any)
      .select('*')
      .eq('session_id', session_id)
      .single();

    if (error || !data) {
      return null;
    }

    return data as RenewalSession;
  }

  /**
   * Update a renewal session
   */
  async updateSession(
    session_id: string,
    updates: UpdateSessionInput
  ): Promise<RenewalSession> {
    const supabase = createServiceClient();

    const { data, error } = await (supabase
      .from('renewal_sessions') as any)
      .update(updates)
      .eq('session_id', session_id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update renewal session: ${error.message}`);
    }

    return data as RenewalSession;
  }

  /**
   * Append conversation turn to session history
   */
  async appendConversation(
    session_id: string,
    turn: ConversationTurn
  ): Promise<void> {
    const session = await this.getSession(session_id);
    if (!session) {
      throw new Error(`Session ${session_id} not found`);
    }

    const updatedHistory = [...session.conversation_history, turn];

    await this.updateSession(session_id, {
      conversation_history: updatedHistory,
    });
  }

  /**
   * Get active sessions for an employee
   */
  async getActiveSessions(employee_id: string): Promise<RenewalSession[]> {
    const supabase = createServiceClient();

    const { data, error } = await (supabase
      .from('renewal_sessions') as any)
      .select('*')
      .eq('employee_id', employee_id)
      .not('status', 'in', '(completed,failed,cancelled)')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching active sessions:', error);
      return [];
    }

    return (data as RenewalSession[]) || [];
  }

  /**
   * Get stale sessions for timeout reminders
   */
  async getStaleSessions(
    status: RenewalSessionStatus,
    hours_threshold: number = 72
  ): Promise<RenewalSession[]> {
    const supabase = createServiceClient();

    const thresholdDate = new Date();
    thresholdDate.setHours(thresholdDate.getHours() - hours_threshold);

    const { data, error } = await (supabase
      .from('renewal_sessions') as any)
      .select('*')
      .eq('status', status)
      .lt('updated_at', thresholdDate.toISOString())
      .order('updated_at', { ascending: true });

    if (error) {
      console.error('Error fetching stale sessions:', error);
      return [];
    }

    return (data as RenewalSession[]) || [];
  }

  /**
   * Mark step as completed
   */
  async completeStep(session_id: string, step: string): Promise<void> {
    const session = await this.getSession(session_id);
    if (!session) {
      throw new Error(`Session ${session_id} not found`);
    }

    const completed = [...session.completed_steps, step];
    const pending = session.pending_actions.filter((a) => a !== step);

    await this.updateSession(session_id, {
      completed_steps: completed,
      pending_actions: pending,
    });

    await this.logEvent({
      session_id,
      event_type: 'step_completed',
      event_data: { step },
      triggered_by: 'agent',
    });
  }

  /**
   * Log an event
   */
  async logEvent(event: {
    session_id: string;
    event_type: RenewalEventType;
    event_data: Record<string, any>;
    triggered_by?: string;
  }): Promise<RenewalEvent> {
    const supabase = createServiceClient();

    const { data, error } = await (supabase
      .from('renewal_events') as any)
      .insert(event)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to log event: ${error.message}`);
    }

    return data as RenewalEvent;
  }

  /**
   * Get events for a session
   */
  async getSessionEvents(session_id: string): Promise<RenewalEvent[]> {
    const supabase = createServiceClient();

    const { data, error } = await (supabase
      .from('renewal_events') as any)
      .select('*')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching session events:', error);
      return [];
    }

    return (data as RenewalEvent[]) || [];
  }

  /**
   * Mark event as processed
   */
  async markEventProcessed(event_id: string): Promise<void> {
    const supabase = createServiceClient();

    await (supabase
      .from('renewal_events') as any)
      .update({ processed_at: new Date().toISOString() })
      .eq('event_id', event_id);
  }

  /**
   * Complete a renewal session
   */
  async completeSession(session_id: string): Promise<void> {
    await this.updateSession(session_id, {
      status: 'completed',
    });

    await this.logEvent({
      session_id,
      event_type: 'workflow_completed',
      event_data: { completed_at: new Date().toISOString() },
      triggered_by: 'agent',
    });
  }

  /**
   * Fail a renewal session
   */
  async failSession(session_id: string, reason: string): Promise<void> {
    await this.updateSession(session_id, {
      status: 'failed',
      metadata: { failure_reason: reason },
    });

    await this.logEvent({
      session_id,
      event_type: 'workflow_failed',
      event_data: { reason },
      triggered_by: 'agent',
    });
  }

  /**
   * Cancel a renewal session
   */
  async cancelSession(session_id: string): Promise<void> {
    await this.updateSession(session_id, {
      status: 'cancelled',
    });

    await this.logEvent({
      session_id,
      event_type: 'workflow_cancelled',
      event_data: { cancelled_at: new Date().toISOString() },
      triggered_by: 'employee',
    });
  }
}

// Export singleton
export const renewalSessionService = new RenewalSessionService();
