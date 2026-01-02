/**
 * Autonomous Renewal Agent
 *
 * Orchestrates multi-day license renewal workflows.
 * Resumes workflows after days/weeks using conversation history from sessions.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  renewalSessionService,
  type RenewalSession,
  type ConversationTurn,
  type RenewalSessionStatus,
} from './session-service';
import { createServiceClient } from '@/lib/supabase/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { smsService } from '@/lib/sms';
import { emailService } from '@/lib/email';

// ============================================================================
// Types
// ============================================================================

export interface AgentInput {
  session_id: string;
  newEvent?: {
    type: string;
    data?: any;
  };
}

export interface AgentOutput {
  response: string;
  nextStatus: RenewalSessionStatus;
  nextStep: string;
  actions: Array<{
    type: string;
    data: any;
  }>;
  updatedHistory: ConversationTurn[];
}

// ============================================================================
// Autonomous Renewal Agent
// ============================================================================

class AutonomousRenewalAgent {
  private genAI: GoogleGenerativeAI;

  constructor() {
    const apiKey = process.env.GOOGLE_AI_API_KEY || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Main entry point - execute the agent with a renewal session
   */
  async execute(input: AgentInput): Promise<AgentOutput> {
    // Load session
    const session = await renewalSessionService.getSession(input.session_id);
    if (!session) {
      throw new Error(`Session ${input.session_id} not found`);
    }

    // Get employee and license data
    const employeeData = await this.getEmployeeData(session.employee_id);
    const licenseData = session.license_id
      ? await this.getLicenseData(session.license_id)
      : null;

    // Build context for AI
    const context = this.buildContext(session, employeeData, licenseData, input.newEvent);

    // Call AI to decide next actions
    const decision = await this.getAIDecision(context);

    // Execute actions
    const actionResults = await this.executeActions(session, decision.actions);

    // Build updated conversation history
    const updatedHistory = [
      ...session.conversation_history,
      ...(input.newEvent
        ? [
            {
              role: 'user' as const,
              content: this.formatEventAsMessage(input.newEvent),
              timestamp: new Date().toISOString(),
            },
          ]
        : []),
      {
        role: 'assistant' as const,
        content: decision.response,
        timestamp: new Date().toISOString(),
        toolCalls: decision.actions.map((action) => ({
          name: action.type,
          args: action.data,
          result: actionResults[action.type] || null,
        })),
      },
    ];

    // Update session
    await renewalSessionService.updateSession(session.session_id, {
      status: decision.nextStatus,
      current_step: decision.nextStep,
      conversation_history: updatedHistory,
      pending_actions: decision.pendingActions,
    });

    return {
      response: decision.response,
      nextStatus: decision.nextStatus,
      nextStep: decision.nextStep,
      actions: decision.actions,
      updatedHistory,
    };
  }

  /**
   * Build context for AI decision making
   */
  private buildContext(
    session: RenewalSession,
    employeeData: any,
    licenseData: any,
    newEvent?: any
  ): string {
    let context = '';

    // Session info
    context += `## Current Session\n`;
    context += `Status: ${session.status}\n`;
    context += `Current Step: ${session.current_step || 'None'}\n`;
    context += `Completed Steps: ${session.completed_steps.join(', ') || 'None'}\n`;
    context += `Pending Actions: ${session.pending_actions.join(', ') || 'None'}\n\n`;

    // Employee info
    context += `## Employee Information\n`;
    context += `Name: ${employeeData.name}\n`;
    context += `Employee ID: ${session.employee_id}\n\n`;

    // License info
    if (licenseData) {
      context += `## License Information\n`;
      context += `Type: ${licenseData.type}\n`;
      context += `State: ${licenseData.state}\n`;
      context += `Expires: ${licenseData.expirationDate}\n`;
      context += `Status: ${licenseData.status}\n\n`;

      // Load state requirements
      const stateReqs = this.loadStateRequirements(licenseData.state);
      if (stateReqs) {
        context += `## State Requirements (${licenseData.state})\n`;
        context += stateReqs + '\n\n';
      }
    }

    // Conversation history (last 10 turns for context)
    if (session.conversation_history.length > 0) {
      const recentHistory = session.conversation_history.slice(-10);
      context += `## Recent Conversation History\n`;
      for (const turn of recentHistory) {
        context += `${turn.role === 'user' ? 'Employee' : 'Agent'}: ${turn.content}\n`;
      }
      context += '\n';
    }

    // New event
    if (newEvent) {
      context += `## New Event\n`;
      context += `Type: ${newEvent.type}\n`;
      context += `Data: ${JSON.stringify(newEvent.data, null, 2)}\n\n`;
    }

    return context;
  }

  /**
   * Get AI decision on what to do next
   */
  private async getAIDecision(context: string): Promise<{
    response: string;
    nextStatus: RenewalSessionStatus;
    nextStep: string;
    actions: Array<{ type: string; data: any }>;
    pendingActions: string[];
  }> {
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
    });

    const prompt = `You are an autonomous renewal agent helping employees renew their security guard licenses.

${context}

Based on the current state and any new events, decide what to do next. You should:
1. Analyze the current workflow state
2. Determine the next logical step in the renewal process
3. Generate a conversational response to the employee
4. Specify any actions to take (e.g., request documents, validate data, send emails)

The renewal workflow typically follows these steps:
1. Start: Employee initiates renewal
2. Request Photo: Ask for license photo
3. Validate Photo: Check photo meets requirements
4. Request Training: Ask for training certificate
5. Validate Training: Check training certificate
6. Prepare Submission: Generate portal submission package
7. Send Instructions: Email employee with portal instructions
8. Await Confirmation: Wait for employee to submit and provide confirmation number
9. Complete: Mark renewal as complete

Respond with ONLY a JSON object in this format:
{
  "response": "your conversational response to the employee",
  "nextStatus": "the next status from the valid status list",
  "nextStep": "brief description of next step",
  "actions": [
    {
      "type": "action_name",
      "data": { "key": "value" }
    }
  ],
  "pendingActions": ["list", "of", "pending", "actions"]
}

Valid statuses: active, awaiting_photo, photo_uploaded, photo_validated, awaiting_training, training_uploaded, training_validated, ready_for_portal_submission, awaiting_portal_submission, portal_submitted, completed

Valid action types:
- request_document: Ask employee for a document
- validate_document: Validate an uploaded document
- send_email: Send email with instructions
- send_sms: Send SMS notification
- generate_submission_package: Create portal submission package
- escalate: Escalate to supervisor
- complete_workflow: Mark as completed

Keep responses conversational, SMS-friendly (under 300 chars), and never use commands like "Reply DONE".`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Parse JSON response
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        const objectMatch = responseText.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          parsed = JSON.parse(objectMatch[0]);
        } else {
          throw new Error('Failed to parse AI response');
        }
      }
    }

    return {
      response: parsed.response || '',
      nextStatus: parsed.nextStatus || 'active',
      nextStep: parsed.nextStep || '',
      actions: parsed.actions || [],
      pendingActions: parsed.pendingActions || [],
    };
  }

  /**
   * Execute actions determined by AI
   */
  private async executeActions(
    session: RenewalSession,
    actions: Array<{ type: string; data: any }>
  ): Promise<Record<string, any>> {
    const results: Record<string, any> = {};

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'request_document':
            results[action.type] = await this.requestDocument(session, action.data);
            break;

          case 'validate_document':
            results[action.type] = await this.validateDocument(session, action.data);
            break;

          case 'send_email':
            results[action.type] = await this.sendEmail(session, action.data);
            break;

          case 'send_sms':
            results[action.type] = await this.sendSMS(session, action.data);
            break;

          case 'generate_submission_package':
            results[action.type] = await this.generateSubmissionPackage(session, action.data);
            break;

          case 'complete_workflow':
            results[action.type] = await renewalSessionService.completeSession(
              session.session_id
            );
            break;

          default:
            console.warn(`Unknown action type: ${action.type}`);
        }
      } catch (error) {
        console.error(`Error executing action ${action.type}:`, error);
        results[action.type] = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    return results;
  }

  /**
   * Action: Request document from employee
   */
  private async requestDocument(session: RenewalSession, data: any): Promise<any> {
    // Log pending action
    await renewalSessionService.updateSession(session.session_id, {
      pending_actions: [...session.pending_actions, `upload_${data.documentType}`],
    });

    return { requested: data.documentType };
  }

  /**
   * Action: Validate uploaded document
   */
  private async validateDocument(session: RenewalSession, data: any): Promise<any> {
    // In a real implementation, this would use Vision AI to validate the document
    // For now, just mark as validated
    return { validated: true, documentType: data.documentType };
  }

  /**
   * Action: Send email
   */
  private async sendEmail(session: RenewalSession, data: any): Promise<any> {
    const result = await emailService.send({
      to: data.to,
      subject: data.subject,
      html: data.html,
      text: data.text || data.body,
      attachments: data.attachments,
    });

    if (!result.success) {
      console.error(`Failed to send email: ${result.error}`);
    }

    return result;
  }

  /**
   * Action: Send SMS
   */
  private async sendSMS(session: RenewalSession, data: any): Promise<any> {
    const result = await smsService.send({
      to: data.to,
      body: data.message || data.body,
    });

    if (!result.success) {
      console.error(`Failed to send SMS: ${result.error}`);
    }

    return result;
  }

  /**
   * Action: Generate submission package
   */
  private async generateSubmissionPackage(session: RenewalSession, data: any): Promise<any> {
    // Generate portal submission instructions
    const submissionPackage = {
      portalUrl: 'https://example-state-portal.gov/renewals',
      instructions: [
        'Log into the state portal with your credentials',
        'Navigate to "License Renewals"',
        'Upload your validated license photo',
        'Upload your training certificate',
        'Fill out the renewal form',
        'Submit and save your confirmation number',
      ],
      documents: [],
      formData: {},
      estimatedTime: '10-15 minutes',
    };

    await renewalSessionService.updateSession(session.session_id, {
      submission_package: submissionPackage,
    });

    return submissionPackage;
  }

  /**
   * Helper: Get employee data
   */
  private async getEmployeeData(employee_id: string): Promise<any> {
    const supabase = createServiceClient();

    const { data: employee } = await supabase
      .from('employees_cache')
      .select('first_name, last_name, email, phone')
      .eq('id', employee_id)
      .single();

    if (!employee) {
      return { name: 'Unknown', email: '', phone: '' };
    }

    return {
      name: `${(employee as any).first_name} ${(employee as any).last_name}`,
      email: (employee as any).email,
      phone: (employee as any).phone,
    };
  }

  /**
   * Helper: Get license data
   */
  private async getLicenseData(license_id: string): Promise<any> {
    const supabase = createServiceClient();

    const { data: license } = await supabase
      .from('licenses_cache')
      .select('description, matched_state, expiration_date, license_stage')
      .eq('id', license_id)
      .single();

    if (!license) {
      return null;
    }

    return {
      type: (license as any).description,
      state: (license as any).matched_state,
      expirationDate: (license as any).expiration_date,
      status: (license as any).license_stage,
    };
  }

  /**
   * Helper: Load state requirements
   */
  private loadStateRequirements(stateCode: string): string | null {
    try {
      const metadataPath = join(process.cwd(), 'knowledge', 'states', stateCode, 'metadata.json');
      const content = readFileSync(metadataPath, 'utf-8');
      const metadata = JSON.parse(content);

      let reqs = '';
      const licenseTypes = metadata.licenseTypes || metadata.license_types || [];
      const typesArray = Array.isArray(licenseTypes) ? licenseTypes : Object.values(licenseTypes);

      for (const typeData of typesArray) {
        const displayName = (typeData as any).display_name || (typeData as any).name;
        reqs += `- ${displayName}\n`;
        if ((typeData as any).renewal_training_hours) {
          reqs += `  Renewal Training: ${(typeData as any).renewal_training_hours} hours\n`;
        }
      }

      return reqs;
    } catch (error) {
      return null;
    }
  }

  /**
   * Helper: Format event as conversational message
   */
  private formatEventAsMessage(event: any): string {
    switch (event.type) {
      case 'photo_uploaded':
        return 'I uploaded my license photo';
      case 'certificate_uploaded':
        return 'I uploaded my training certificate';
      case 'timeout_reminder':
        return '[System: 3 days since last activity]';
      case 'portal_submitted':
        return `I submitted the renewal. Confirmation number: ${event.data?.confirmationNumber}`;
      default:
        return JSON.stringify(event);
    }
  }
}

// Export singleton
export const autonomousRenewalAgent = new AutonomousRenewalAgent();
