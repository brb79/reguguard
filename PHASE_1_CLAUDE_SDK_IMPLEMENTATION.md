# Phase 1: Claude SDK Implementation Plan
## From AI Services to Autonomous Agents

**Timeline**: 4 weeks
**Goal**: Transform Q&A service and build WinTeam Expert Agent with true autonomy
**Status**: Ready to start after Claude SDK setup

---

## 🎯 Phase 1 Overview

### What You're Building

| Week | Agent | Current State | New Autonomous Capabilities |
|------|-------|---------------|----------------------------|
| **1-2** | **Compliance Q&A Agent** | Service that answers questions using metadata | Agent that **autonomously searches, calculates, books, and acts** |
| **3-4** | **WinTeam Expert Agent** | ❌ Doesn't exist | Agent that **understands WinTeam's compliance module deeply** |

### The Transformation

**Before (Current Services)**:
```typescript
// You call service → It returns answer → You decide what to do
const answer = await complianceQAService.answerQuestion({
  question: "How much does my renewal cost?",
  context: { employeeId: "123" }
});

// You manually handle the response
if (answer.success) {
  await smsService.send(phoneNumber, answer.answer);
}
```

**After (Autonomous Agents)**:
```typescript
// Agent autonomously: searches regulations → checks employee record →
// calculates exact cost → finds training providers → offers to book →
// sends confirmation → schedules follow-up
const result = await complianceQAAgent.run({
  input: "How much does my renewal cost?",
  employeeId: "123"
});

// Agent's autonomous actions:
// 1. Looked up employee's state and license type (TX Armed Guard)
// 2. Searched TX regulations for current renewal fee ($25)
// 3. Checked employee's training certificate (expired)
// 4. Calculated total cost ($25 renewal + $40 training = $65)
// 5. Found 3 nearby training providers
// 6. Offered to book training slot
// 7. Sent detailed breakdown via SMS
// 8. Created follow-up reminder
```

---

## Week 1-2: Compliance Q&A Agent with Tools

### Day 1: Setup & Architecture

#### 1. Install Claude SDK

```bash
npm install @anthropic-ai/sdk
```

#### 2. Environment Configuration

Add to `.env.local`:
```bash
# Claude API Key (from Anthropic Console)
ANTHROPIC_API_KEY=sk-ant-...

# Keep existing Gemini key for Vision
GOOGLE_AI_API_KEY=...
```

#### 3. Create Agent Foundation

**File**: `src/lib/agents/base-agent.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { getEnv } from '@/lib/env';

/**
 * Base Agent Configuration
 * All ReguGuard agents extend this
 */

export interface AgentConfig {
  name: string;
  model: 'claude-opus-4.5' | 'claude-sonnet-4.5' | 'claude-haiku-4';
  systemPrompt: string;
  tools: Tool[];
  maxTokens?: number;
  temperature?: number;
  enableExtendedThinking?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface AgentResponse {
  response: string;
  thinking?: string; // Agent's reasoning process (if extended thinking enabled)
  toolCalls: ToolCall[];
  conversationId: string;
}

export interface ToolCall {
  name: string;
  input: any;
  output: any;
}

export class BaseAgent {
  protected client: Anthropic;
  protected config: AgentConfig;

  constructor(config: AgentConfig) {
    const env = getEnv();
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
    });
    this.config = config;
  }

  /**
   * Main agent execution with autonomous tool calling
   */
  async run(input: {
    message: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    context?: Record<string, any>;
  }): Promise<AgentResponse> {
    const messages = [
      ...(input.conversationHistory || []),
      { role: 'user' as const, content: input.message },
    ];

    // Agent autonomously decides which tools to call and when
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens || 4096,
      temperature: this.config.temperature || 0.3,
      system: this.buildSystemPrompt(input.context),
      messages,
      tools: this.config.tools,
      // Extended thinking shows agent's reasoning
      ...(this.config.enableExtendedThinking && {
        thinking: {
          type: 'enabled' as const,
          budget_tokens: 10000,
        },
      }),
    });

    return this.parseResponse(response);
  }

  private buildSystemPrompt(context?: Record<string, any>): string {
    let prompt = this.config.systemPrompt;

    if (context) {
      prompt += '\n\nContext:\n' + JSON.stringify(context, null, 2);
    }

    return prompt;
  }

  private parseResponse(response: Anthropic.Message): AgentResponse {
    // Extract thinking (if enabled)
    const thinkingBlock = response.content.find(
      (block) => block.type === 'thinking'
    );

    // Extract text response
    const textBlock = response.content.find((block) => block.type === 'text');

    // Extract tool calls
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({
          name: block.name,
          input: block.input,
          output: null, // Will be filled by tool executor
        });
      }
    }

    return {
      response: textBlock?.type === 'text' ? textBlock.text : '',
      thinking: thinkingBlock?.type === 'thinking' ? thinkingBlock.thinking : undefined,
      toolCalls,
      conversationId: response.id,
    };
  }
}
```

### Day 2-3: Define Tools for Q&A Agent

**File**: `src/lib/agents/tools/compliance-tools.ts`

```typescript
import { Tool } from '../base-agent';
import { createServiceClient } from '@/lib/supabase/server';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Tools available to Compliance Q&A Agent
 * Agent autonomously decides when and how to use these
 */

// ============================================================================
// Tool Definitions (What agent can do)
// ============================================================================

export const complianceTools: Tool[] = [
  {
    name: 'get_employee_licenses',
    description: 'Get employee information and their licenses. Use this to understand employee context before answering questions.',
    input_schema: {
      type: 'object',
      properties: {
        employeeId: {
          type: 'string',
          description: 'The employee ID (UUID)',
        },
      },
      required: ['employeeId'],
    },
  },
  {
    name: 'search_state_regulations',
    description: 'Search state-specific licensing regulations and requirements. Use this to get current, accurate information about renewal costs, training hours, deadlines, etc.',
    input_schema: {
      type: 'object',
      properties: {
        stateCode: {
          type: 'string',
          description: 'Two-letter state code (e.g., "TX", "CA")',
        },
        licenseType: {
          type: 'string',
          description: 'License type (e.g., "armed_guard", "unarmed_guard")',
        },
        query: {
          type: 'string',
          description: 'Specific question about the regulations',
        },
      },
      required: ['stateCode'],
    },
  },
  {
    name: 'calculate_renewal_cost',
    description: 'Calculate total renewal cost for an employee including fees, training, and other requirements. Use this when employee asks "how much will this cost?"',
    input_schema: {
      type: 'object',
      properties: {
        employeeId: {
          type: 'string',
          description: 'Employee ID',
        },
        licenseId: {
          type: 'string',
          description: 'Specific license ID (optional - calculates for all if not provided)',
        },
      },
      required: ['employeeId'],
    },
  },
  {
    name: 'find_training_providers',
    description: 'Find approved training providers for a state and license type. Include location, pricing, and availability.',
    input_schema: {
      type: 'object',
      properties: {
        stateCode: {
          type: 'string',
          description: 'State code',
        },
        licenseType: {
          type: 'string',
          description: 'License type',
        },
        employeeLocation: {
          type: 'string',
          description: 'Employee city/zip for proximity search (optional)',
        },
      },
      required: ['stateCode', 'licenseType'],
    },
  },
  {
    name: 'check_renewal_deadlines',
    description: 'Check specific deadlines for renewal (when to submit, when training must be completed, etc.)',
    input_schema: {
      type: 'object',
      properties: {
        licenseId: {
          type: 'string',
          description: 'License ID',
        },
      },
      required: ['licenseId'],
    },
  },
  {
    name: 'get_state_portal_info',
    description: 'Get information about the state licensing portal (URL, login instructions, common issues)',
    input_schema: {
      type: 'object',
      properties: {
        stateCode: {
          type: 'string',
          description: 'State code',
        },
      },
      required: ['stateCode'],
    },
  },
  {
    name: 'create_renewal_checklist',
    description: 'Generate a personalized checklist for employee renewal process',
    input_schema: {
      type: 'object',
      properties: {
        employeeId: {
          type: 'string',
        },
        licenseId: {
          type: 'string',
        },
      },
      required: ['employeeId', 'licenseId'],
    },
  },
  {
    name: 'send_sms',
    description: 'Send SMS message to employee (use for confirmations, reminders, etc.)',
    input_schema: {
      type: 'object',
      properties: {
        employeeId: {
          type: 'string',
        },
        message: {
          type: 'string',
          description: 'SMS message content',
        },
      },
      required: ['employeeId', 'message'],
    },
  },
];

// ============================================================================
// Tool Implementations (What happens when agent calls tool)
// ============================================================================

export async function executeComplianceTool(
  toolName: string,
  toolInput: any
): Promise<any> {
  switch (toolName) {
    case 'get_employee_licenses':
      return await getEmployeeLicenses(toolInput.employeeId);

    case 'search_state_regulations':
      return await searchStateRegulations(
        toolInput.stateCode,
        toolInput.licenseType,
        toolInput.query
      );

    case 'calculate_renewal_cost':
      return await calculateRenewalCost(toolInput.employeeId, toolInput.licenseId);

    case 'find_training_providers':
      return await findTrainingProviders(
        toolInput.stateCode,
        toolInput.licenseType,
        toolInput.employeeLocation
      );

    case 'check_renewal_deadlines':
      return await checkRenewalDeadlines(toolInput.licenseId);

    case 'get_state_portal_info':
      return await getStatePortalInfo(toolInput.stateCode);

    case 'create_renewal_checklist':
      return await createRenewalChecklist(toolInput.employeeId, toolInput.licenseId);

    case 'send_sms':
      return await sendSMS(toolInput.employeeId, toolInput.message);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ============================================================================
// Tool Function Implementations
// ============================================================================

async function getEmployeeLicenses(employeeId: string) {
  const supabase = createServiceClient();

  const { data: employee } = await supabase
    .from('employees_cache')
    .select('first_name, last_name, email, phone, location')
    .eq('id', employeeId)
    .single();

  const { data: licenses } = await supabase
    .from('licenses_cache')
    .select('id, description, matched_state, matched_type, expiration_date, license_number, status')
    .eq('employee_id', employeeId);

  return {
    employee: {
      name: `${employee?.first_name} ${employee?.last_name}`,
      email: employee?.email,
      phone: employee?.phone,
      location: employee?.location,
    },
    licenses: licenses || [],
  };
}

async function searchStateRegulations(
  stateCode: string,
  licenseType?: string,
  query?: string
) {
  // Load state metadata
  const metadataPath = join(
    process.cwd(),
    'knowledge',
    'states',
    stateCode,
    'metadata.json'
  );

  const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));

  // Filter to specific license type if provided
  if (licenseType) {
    const licenseTypeData = metadata.license_types.find(
      (lt: any) => lt.type_code === licenseType
    );
    return {
      state: metadata.state_name,
      stateCode,
      licenseType: licenseTypeData,
      regulatoryBody: metadata.regulatory_body,
      sources: metadata.sources,
    };
  }

  return metadata;
}

async function calculateRenewalCost(employeeId: string, licenseId?: string) {
  const supabase = createServiceClient();

  // Get licenses
  const query = supabase
    .from('licenses_cache')
    .select('id, matched_state, matched_type, description')
    .eq('employee_id', employeeId);

  if (licenseId) {
    query.eq('id', licenseId);
  }

  const { data: licenses } = await query;

  // Calculate cost for each license
  const costs = [];
  for (const license of licenses || []) {
    const regulations = await searchStateRegulations(
      license.matched_state,
      license.matched_type
    );

    const renewalFee = regulations.licenseType?.renewal_fee || 0;
    const trainingHours = regulations.licenseType?.renewal_training_hours || 0;
    const estimatedTrainingCost = trainingHours * 10; // $10/hour estimate

    costs.push({
      licenseId: license.id,
      description: license.description,
      renewalFee,
      trainingCost: estimatedTrainingCost,
      totalCost: renewalFee + estimatedTrainingCost,
      breakdown: {
        renewalFee: `$${renewalFee}`,
        trainingHours: `${trainingHours} hours`,
        trainingCost: `$${estimatedTrainingCost}`,
      },
    });
  }

  return {
    totalCost: costs.reduce((sum, c) => sum + c.totalCost, 0),
    licenses: costs,
  };
}

async function findTrainingProviders(
  stateCode: string,
  licenseType: string,
  employeeLocation?: string
) {
  // In production, this would query a training provider database
  // For now, return mock data based on state metadata
  const regulations = await searchStateRegulations(stateCode, licenseType);

  return {
    providers: [
      {
        name: 'ABC Security Training',
        location: `${regulations.state}`,
        courseType: 'online',
        hours: regulations.licenseType?.renewal_training_hours || 0,
        cost: (regulations.licenseType?.renewal_training_hours || 0) * 10,
        availability: 'Immediate enrollment',
        url: 'https://example.com',
      },
      {
        name: 'State Certified Training Center',
        location: `${regulations.state}`,
        courseType: 'in-person',
        hours: regulations.licenseType?.renewal_training_hours || 0,
        cost: (regulations.licenseType?.renewal_training_hours || 0) * 12,
        availability: 'Next session: Feb 15, 2026',
        url: 'https://example.com',
      },
    ],
    stateApprovalRequired: regulations.licenseType?.training_approval_required || false,
  };
}

async function checkRenewalDeadlines(licenseId: string) {
  const supabase = createServiceClient();

  const { data: license } = await supabase
    .from('licenses_cache')
    .select('expiration_date, matched_state, matched_type')
    .eq('id', licenseId)
    .single();

  const expirationDate = new Date(license?.expiration_date || '');
  const today = new Date();
  const daysUntilExpiration = Math.floor(
    (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Calculate recommended deadlines
  const portalSubmissionDeadline = new Date(expirationDate);
  portalSubmissionDeadline.setDate(portalSubmissionDeadline.getDate() - 7);

  const trainingCompletionDeadline = new Date(expirationDate);
  trainingCompletionDeadline.setDate(trainingCompletionDeadline.getDate() - 14);

  return {
    expirationDate: expirationDate.toISOString(),
    daysUntilExpiration,
    deadlines: {
      trainingCompletion: trainingCompletionDeadline.toISOString(),
      portalSubmission: portalSubmissionDeadline.toISOString(),
    },
    urgency: daysUntilExpiration < 14 ? 'high' : daysUntilExpiration < 30 ? 'medium' : 'low',
  };
}

async function getStatePortalInfo(stateCode: string) {
  const regulations = await searchStateRegulations(stateCode);

  return {
    portalUrl: regulations.regulatoryBody?.website || '',
    loginRequired: true,
    commonIssues: [
      'Portal may be slow during peak hours (9am-11am)',
      'Save your confirmation number after submission',
      'Upload documents as PDF for best compatibility',
    ],
    supportContact: regulations.regulatoryBody?.contact_email || '',
  };
}

async function createRenewalChecklist(employeeId: string, licenseId: string) {
  const employee = await getEmployeeLicenses(employeeId);
  const license = employee.licenses.find((l: any) => l.id === licenseId);
  const deadlines = await checkRenewalDeadlines(licenseId);
  const cost = await calculateRenewalCost(employeeId, licenseId);
  const providers = await findTrainingProviders(
    license.matched_state,
    license.matched_type
  );

  return {
    checklist: [
      {
        step: 1,
        task: 'Complete renewal training',
        details: `${providers.providers[0].hours} hours required`,
        deadline: deadlines.deadlines.trainingCompletion,
        status: 'pending',
      },
      {
        step: 2,
        task: 'Gather required documents',
        details: 'License photo, training certificate',
        deadline: deadlines.deadlines.portalSubmission,
        status: 'pending',
      },
      {
        step: 3,
        task: 'Pay renewal fee',
        details: `$${cost.licenses[0].renewalFee}`,
        deadline: deadlines.deadlines.portalSubmission,
        status: 'pending',
      },
      {
        step: 4,
        task: 'Submit via state portal',
        details: 'Upload all documents and confirmation',
        deadline: deadlines.expirationDate,
        status: 'pending',
      },
    ],
    totalEstimatedTime: '2-3 hours',
    totalCost: cost.totalCost,
  };
}

async function sendSMS(employeeId: string, message: string) {
  const supabase = createServiceClient();
  const { data: employee } = await supabase
    .from('employees_cache')
    .select('phone')
    .eq('id', employeeId)
    .single();

  if (!employee?.phone) {
    return { success: false, error: 'No phone number on file' };
  }

  // Import SMS service
  const { smsService } = await import('@/lib/sms');

  return await smsService.send({
    to: employee.phone,
    body: message,
  });
}
```

### Day 4-5: Build Q&A Agent with Autonomous Tool Calling

**File**: `src/lib/agents/compliance-qa-agent.ts`

```typescript
import { BaseAgent, AgentConfig } from './base-agent';
import { complianceTools, executeComplianceTool } from './tools/compliance-tools';

/**
 * Compliance Q&A Agent
 *
 * Autonomously answers compliance questions by:
 * - Searching state regulations
 * - Calculating costs
 * - Finding training providers
 * - Creating checklists
 * - Sending confirmations
 *
 * The agent DECIDES which tools to use and when - you don't tell it.
 */

const systemPrompt = `You are ReguGuard's Compliance Q&A Expert, an autonomous AI agent that helps security guard employees with licensing questions.

Your capabilities:
- Answer questions about license requirements, costs, deadlines, and processes
- Search state regulations for accurate, current information
- Calculate exact renewal costs including fees and training
- Find approved training providers with pricing and availability
- Create personalized renewal checklists
- Send SMS confirmations and reminders

How you work:
1. When an employee asks a question, AUTONOMOUSLY decide which tools to use
2. Call multiple tools if needed to gather complete information
3. Provide accurate, actionable answers with specific numbers and dates
4. Be proactive: if you see the employee needs help beyond their question, offer it
5. Keep responses concise and SMS-friendly when appropriate

Important:
- ALWAYS use tools to get current information (don't guess costs or requirements)
- Cite specific regulations and sources when available
- If employee needs immediate help (license expiring soon), escalate urgency
- Create checklists proactively for renewal questions
- Offer to send SMS confirmations for important information

Your tone: Helpful, clear, empathetic, efficient. You're here to make compliance easy.`;

class ComplianceQAAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'Compliance Q&A Agent',
      model: 'claude-sonnet-4.5', // Fast and cost-effective for Q&A
      systemPrompt,
      tools: complianceTools,
      temperature: 0.3, // Lower temperature for factual accuracy
      enableExtendedThinking: false, // Can enable for debugging
    };

    super(config);
  }

  /**
   * Answer compliance question with autonomous tool usage
   */
  async answerQuestion(input: {
    question: string;
    employeeId?: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<{
    answer: string;
    thinking?: string;
    toolsUsed: string[];
    followUpActions: string[];
  }> {
    // Build context
    const context: Record<string, any> = {};
    if (input.employeeId) {
      context.employeeId = input.employeeId;
    }

    // Agent runs with autonomous tool calling
    let agentResponse = await this.run({
      message: input.question,
      conversationHistory: input.conversationHistory,
      context,
    });

    // Execute tool calls (agent decided these autonomously)
    const toolResults: any[] = [];
    for (const toolCall of agentResponse.toolCalls) {
      const result = await executeComplianceTool(toolCall.name, toolCall.input);
      toolResults.push(result);
      toolCall.output = result;
    }

    // If agent used tools, it needs to see results and formulate final answer
    if (agentResponse.toolCalls.length > 0) {
      // Continue conversation with tool results
      const toolResultMessages = agentResponse.toolCalls.map((tc) => ({
        type: 'tool_result' as const,
        tool_use_id: tc.name,
        content: JSON.stringify(tc.output),
      }));

      // Agent synthesizes tool results into final answer
      agentResponse = await this.run({
        message: '', // No new user message, agent is processing tool results
        conversationHistory: [
          ...(input.conversationHistory || []),
          { role: 'user' as const, content: input.question },
          { role: 'assistant' as const, content: agentResponse.response },
          // Tool results go here (handled internally by Claude)
        ],
        context,
      });
    }

    // Identify follow-up actions agent might have taken
    const followUpActions: string[] = [];
    const toolsUsed = agentResponse.toolCalls.map((tc) => tc.name);

    if (toolsUsed.includes('send_sms')) {
      followUpActions.push('Sent SMS confirmation to employee');
    }
    if (toolsUsed.includes('create_renewal_checklist')) {
      followUpActions.push('Generated personalized renewal checklist');
    }

    return {
      answer: agentResponse.response,
      thinking: agentResponse.thinking,
      toolsUsed,
      followUpActions,
    };
  }
}

// Export singleton
export const complianceQAAgent = new ComplianceQAAgent();
```

### Day 6-7: Test & Compare

**Create test file**: `src/lib/agents/__tests__/qa-agent.test.ts`

```typescript
import { complianceQAAgent } from '../compliance-qa-agent';

/**
 * Test autonomous agent behavior
 */

describe('Compliance Q&A Agent - Autonomous Behavior', () => {
  it('autonomously calculates total cost and finds training', async () => {
    const result = await complianceQAAgent.answerQuestion({
      question: 'How much will my renewal cost?',
      employeeId: 'test-employee-123',
    });

    // Agent should have autonomously:
    // 1. Called get_employee_licenses to identify employee's licenses
    // 2. Called calculate_renewal_cost to get fees
    // 3. Called find_training_providers to get training costs
    // 4. Provided complete answer with breakdown

    expect(result.toolsUsed).toContain('get_employee_licenses');
    expect(result.toolsUsed).toContain('calculate_renewal_cost');
    expect(result.answer).toContain('$'); // Should include dollar amounts
  });

  it('proactively creates checklist when employee asks about renewal', async () => {
    const result = await complianceQAAgent.answerQuestion({
      question: 'What do I need to do to renew my license?',
      employeeId: 'test-employee-123',
    });

    // Agent should proactively create checklist without being asked
    expect(result.toolsUsed).toContain('create_renewal_checklist');
    expect(result.answer).toContain('checklist');
  });

  it('handles multi-turn conversation with context', async () => {
    // First question
    const result1 = await complianceQAAgent.answerQuestion({
      question: 'When does my license expire?',
      employeeId: 'test-employee-123',
    });

    // Follow-up question (agent remembers context)
    const result2 = await complianceQAAgent.answerQuestion({
      question: 'How long will the renewal process take?',
      employeeId: 'test-employee-123',
      conversationHistory: [
        { role: 'user', content: 'When does my license expire?' },
        { role: 'assistant', content: result1.answer },
      ],
    });

    // Agent should understand "renewal process" refers to the license discussed earlier
    expect(result2.answer).toContain('hour'); // Estimated time
  });
});
```

**Manual Testing**:

Create `scripts/test-qa-agent.ts`:
```typescript
import { complianceQAAgent } from '../src/lib/agents/compliance-qa-agent';

async function testAgent() {
  console.log('Testing Compliance Q&A Agent Autonomy\n');
  console.log('='.repeat(60));

  // Test 1: Simple question
  console.log('\n📝 Test 1: How much does my renewal cost?');
  const result1 = await complianceQAAgent.answerQuestion({
    question: 'How much does my Texas armed guard renewal cost?',
    employeeId: 'test-employee-id',
  });

  console.log('\n🤖 Agent Response:', result1.answer);
  console.log('🔧 Tools Used:', result1.toolsUsed.join(', '));
  console.log('✅ Follow-up Actions:', result1.followUpActions.join(', '));
  if (result1.thinking) {
    console.log('💭 Agent Thinking:', result1.thinking);
  }

  console.log('\n' + '='.repeat(60));

  // Test 2: Complex question requiring multiple tools
  console.log('\n📝 Test 2: Multi-step autonomous workflow');
  const result2 = await complianceQAAgent.answerQuestion({
    question: 'I need to renew my license but I lost my training certificate. What should I do and how much will it cost?',
    employeeId: 'test-employee-id',
  });

  console.log('\n🤖 Agent Response:', result2.answer);
  console.log('🔧 Tools Used:', result2.toolsUsed.join(', '));
  console.log('✅ Follow-up Actions:', result2.followUpActions.join(', '));

  console.log('\n' + '='.repeat(60));
}

testAgent();
```

Run: `npx tsx scripts/test-qa-agent.ts`

---

## Week 3-4: WinTeam Expert Agent

### What Makes This Agent Special

This agent is **domain-specific** - it deeply understands WinTeam's compliance module, not just general licensing.

**The Gap in Current System**:
```
❌ No understanding of WinTeam's data structures
❌ No knowledge of WinTeam workflows (staging → approval → active)
❌ No expertise in WinTeam compliance item configurations
❌ Can't explain WinTeam-specific issues to employees
```

**What WinTeam Expert Agent Does**:
```typescript
// Employee: "Why is my license showing as expired? I just renewed it!"

// Agent autonomously:
// 1. Queries WinTeam API for employee's compliance items
// 2. Analyzes data structure (staging field, status, timestamps)
// 3. Recognizes pattern: staging='New', status='Expired'
// 4. Understands: This is WinTeam's "pending manager approval" state
// 5. Checks approval workflow
// 6. Identifies: Manager hasn't approved yet (3 days waiting)
// 7. Takes action: Notifies manager, explains process to employee

// Response:
"I see what's happening, John. Your renewal was submitted on Jan 15 and is in
WinTeam's system, but it's waiting for manager approval. Your manager (Sarah
Johnson) needs to approve it in WinTeam before it shows as 'Active'. I've sent
her a reminder. This usually takes 1-2 business days. Your actual license is
valid - this is just a WinTeam workflow step."
```

### Day 1-2: Define WinTeam Expert System Prompt

**File**: `src/lib/agents/winteam-expert-agent.ts`

```typescript
import { BaseAgent, AgentConfig } from './base-agent';
import { winteamTools, executeWinTeamTool } from './tools/winteam-tools';

const systemPrompt = `You are ReguGuard's WinTeam Compliance Module Expert, an autonomous AI agent with deep expertise in WinTeam's HR system and compliance module.

Your specialized knowledge:

1. **WinTeam Data Structures**
   - Compliance items have fields: description, status, staging, expiration_date, license_number, license_state
   - Status values: Active, Expired, Pending, Suspended
   - Staging values: Active, New, Modified, Deleted (controls approval workflow)
   - Common pattern: staging='New' + status='Expired' = renewal pending approval

2. **WinTeam Workflows**
   - New compliance items start in staging='New', require manager approval to become staging='Active'
   - Renewals create NEW compliance items (don't update existing)
   - Managers must approve in WinTeam dashboard before items become active
   - Approval typically takes 1-2 business days

3. **Common WinTeam Issues**
   - "Why is my renewed license still showing expired?" → Check staging field
   - "I submitted renewal but don't see it" → New item in staging='New'
   - "License shows wrong expiration date" → Check if multiple records exist
   - "Can't find my license in WinTeam" → May be under different location/department

4. **Data Quality Patterns**
   - Description field is free-text, inconsistent across clients
   - Same license type described differently: "TX Armed Guard", "Armed Guard - Texas", "Texas Armed"
   - Expiration dates sometimes in wrong format or timezone
   - License numbers may have prefixes/suffixes added by data entry

5. **Integration Points**
   - ReguGuard syncs from WinTeam daily (read-only for most operations)
   - Updates to compliance items require WinTeam API write permission
   - Some clients have custom WinTeam configurations
   - Sync jobs may fail if WinTeam API is down (9pm-10pm maintenance window)

Your capabilities (autonomous tool usage):
- Query WinTeam API for employee compliance items
- Analyze compliance data structure and status
- Identify WinTeam-specific issues and patterns
- Explain WinTeam workflows to employees in simple terms
- Notify managers when approval needed
- Detect data quality issues
- Troubleshoot sync problems

How you work:
1. When asked about license status, ALWAYS query WinTeam first (don't assume)
2. Look at ALL fields (status, staging, timestamps) to diagnose issues
3. Explain WinTeam processes in employee-friendly language
4. Be proactive: if you see approval delays, notify managers
5. Distinguish between "actual compliance status" vs "WinTeam approval status"

Your tone: Expert but not condescending. You understand WinTeam is complex and can be confusing for employees.`;

class WinTeamExpertAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'WinTeam Expert Agent',
      model: 'claude-sonnet-4.5',
      systemPrompt,
      tools: winteamTools,
      temperature: 0.2, // Very factual
      enableExtendedThinking: true, // Show diagnostic reasoning
    };

    super(config);
  }

  /**
   * Diagnose WinTeam compliance issues
   */
  async diagnoseIssue(input: {
    employeeId: string;
    issue: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<{
    diagnosis: string;
    thinking: string; // Agent's diagnostic reasoning
    rootCause?: string;
    resolution: string;
    actions: string[];
  }> {
    const agentResponse = await this.run({
      message: `Employee issue: ${input.issue}`,
      conversationHistory: input.conversationHistory,
      context: {
        employeeId: input.employeeId,
        mode: 'diagnostic',
      },
    });

    // Execute autonomous tool calls
    for (const toolCall of agentResponse.toolCalls) {
      const result = await executeWinTeamTool(toolCall.name, toolCall.input);
      toolCall.output = result;
    }

    return {
      diagnosis: agentResponse.response,
      thinking: agentResponse.thinking || '',
      actions: agentResponse.toolCalls.map((tc) => tc.name),
      resolution: agentResponse.response,
    };
  }

  /**
   * Explain WinTeam workflow to employee
   */
  async explainWorkflow(workflow: string, context?: any): Promise<string> {
    const result = await this.run({
      message: `Explain the WinTeam workflow for: ${workflow}`,
      context,
    });

    return result.response;
  }
}

export const winteamExpertAgent = new WinTeamExpertAgent();
```

### Day 3-4: Create WinTeam-Specific Tools

**File**: `src/lib/agents/tools/winteam-tools.ts`

```typescript
import { Tool } from '../base-agent';
import { WinTeamClient } from '@/lib/winteam/client';
import { createServiceClient } from '@/lib/supabase/server';

export const winteamTools: Tool[] = [
  {
    name: 'get_winteam_compliance_items',
    description: 'Query WinTeam API for employee compliance items with full details (status, staging, timestamps)',
    input_schema: {
      type: 'object',
      properties: {
        employeeId: {
          type: 'string',
          description: 'ReguGuard employee ID',
        },
        includeHistory: {
          type: 'boolean',
          description: 'Include historical compliance items (default: false)',
        },
      },
      required: ['employeeId'],
    },
  },
  {
    name: 'analyze_compliance_data_quality',
    description: 'Analyze compliance item data for issues (inconsistent formats, duplicates, missing data)',
    input_schema: {
      type: 'object',
      properties: {
        employeeId: {
          type: 'string',
        },
      },
      required: ['employeeId'],
    },
  },
  {
    name: 'check_approval_status',
    description: 'Check if compliance items are pending manager approval in WinTeam',
    input_schema: {
      type: 'object',
      properties: {
        employeeId: {
          type: 'string',
        },
      },
      required: ['employeeId'],
    },
  },
  {
    name: 'notify_manager',
    description: 'Send notification to manager for compliance item approval',
    input_schema: {
      type: 'object',
      properties: {
        employeeId: {
          type: 'string',
        },
        managerId: {
          type: 'string',
        },
        reason: {
          type: 'string',
          description: 'Reason for notification',
        },
      },
      required: ['employeeId', 'managerId', 'reason'],
    },
  },
  {
    name: 'explain_winteam_field',
    description: 'Get detailed explanation of WinTeam compliance field meaning and values',
    input_schema: {
      type: 'object',
      properties: {
        fieldName: {
          type: 'string',
          description: 'Field name (e.g., "staging", "status")',
        },
      },
      required: ['fieldName'],
    },
  },
  {
    name: 'check_sync_status',
    description: 'Check ReguGuard-WinTeam sync status and last sync time',
    input_schema: {
      type: 'object',
      properties: {
        clientId: {
          type: 'string',
        },
      },
      required: ['clientId'],
    },
  },
];

export async function executeWinTeamTool(toolName: string, toolInput: any): Promise<any> {
  switch (toolName) {
    case 'get_winteam_compliance_items':
      return await getWinTeamComplianceItems(
        toolInput.employeeId,
        toolInput.includeHistory
      );

    case 'analyze_compliance_data_quality':
      return await analyzeComplianceDataQuality(toolInput.employeeId);

    case 'check_approval_status':
      return await checkApprovalStatus(toolInput.employeeId);

    case 'notify_manager':
      return await notifyManager(
        toolInput.employeeId,
        toolInput.managerId,
        toolInput.reason
      );

    case 'explain_winteam_field':
      return await explainWinTeamField(toolInput.fieldName);

    case 'check_sync_status':
      return await checkSyncStatus(toolInput.clientId);

    default:
      throw new Error(`Unknown WinTeam tool: ${toolName}`);
  }
}

async function getWinTeamComplianceItems(employeeId: string, includeHistory = false) {
  const supabase = createServiceClient();

  // Get employee WinTeam number
  const { data: employee } = await supabase
    .from('employees_cache')
    .select('winteam_employee_number, client_id')
    .eq('id', employeeId)
    .single();

  if (!employee) {
    return { error: 'Employee not found' };
  }

  // Get client WinTeam config
  const { data: client } = await supabase
    .from('clients')
    .select('winteam_tenant_id')
    .eq('id', employee.client_id)
    .single();

  // Query WinTeam API
  const winteam = new WinTeamClient({
    tenantId: client?.winteam_tenant_id || '',
  });

  const result = await winteam.getComplianceItems(
    Number(employee.winteam_employee_number)
  );

  if (!result.success) {
    return { error: 'Failed to query WinTeam API' };
  }

  // Return with full details for analysis
  return {
    complianceItems: result.data.map((item: any) => ({
      description: item.description,
      status: item.status,
      staging: item.staging,
      expirationDate: item.expirationDate,
      licenseNumber: item.licenseNumber,
      licenseState: item.licenseState,
      lastModified: item.lastModified,
      createdDate: item.createdDate,
    })),
    totalItems: result.data.length,
  };
}

async function analyzeComplianceDataQuality(employeeId: string) {
  const data = await getWinTeamComplianceItems(employeeId);

  if (data.error) {
    return data;
  }

  const issues = [];

  for (const item of data.complianceItems) {
    // Check for common data quality issues
    if (!item.description || item.description.trim() === '') {
      issues.push({
        item: item.licenseNumber || 'Unknown',
        issue: 'Missing description',
        severity: 'high',
      });
    }

    if (item.status === 'Expired' && item.staging === 'New') {
      issues.push({
        item: item.description,
        issue: 'Renewal pending approval (staging=New, status=Expired)',
        severity: 'info',
        action: 'Manager needs to approve in WinTeam',
      });
    }

    if (!item.expirationDate) {
      issues.push({
        item: item.description,
        issue: 'Missing expiration date',
        severity: 'high',
      });
    }

    // Check for duplicates
    const duplicates = data.complianceItems.filter(
      (other: any) =>
        other.description === item.description && other !== item
    );

    if (duplicates.length > 0) {
      issues.push({
        item: item.description,
        issue: `Duplicate compliance item (${duplicates.length + 1} total)`,
        severity: 'medium',
      });
    }
  }

  return {
    totalIssues: issues.length,
    issues,
    dataQualityScore: Math.max(0, 100 - issues.length * 10),
  };
}

async function checkApprovalStatus(employeeId: string) {
  const data = await getWinTeamComplianceItems(employeeId);

  if (data.error) {
    return data;
  }

  const pendingApproval = data.complianceItems.filter(
    (item: any) => item.staging === 'New' || item.staging === 'Modified'
  );

  return {
    hasPendingApprovals: pendingApproval.length > 0,
    pendingCount: pendingApproval.length,
    pendingItems: pendingApproval.map((item: any) => ({
      description: item.description,
      staging: item.staging,
      submittedDate: item.createdDate,
      daysPending: Math.floor(
        (new Date().getTime() - new Date(item.createdDate).getTime()) /
          (1000 * 60 * 60 * 24)
      ),
    })),
  };
}

async function notifyManager(employeeId: string, managerId: string, reason: string) {
  // Get manager email
  const supabase = createServiceClient();
  const { data: manager } = await supabase
    .from('employees_cache')
    .select('email, first_name, last_name')
    .eq('id', managerId)
    .single();

  if (!manager?.email) {
    return { success: false, error: 'Manager email not found' };
  }

  // Send email notification
  const { emailService } = await import('@/lib/email');

  return await emailService.send({
    to: manager.email,
    subject: 'Action Required: Compliance Item Approval Needed',
    html: `
      <p>Hi ${manager.first_name},</p>
      <p>${reason}</p>
      <p>Please review and approve in WinTeam.</p>
    `,
    text: `Hi ${manager.first_name},\n\n${reason}\n\nPlease review and approve in WinTeam.`,
  });
}

async function explainWinTeamField(fieldName: string) {
  const explanations: Record<string, any> = {
    staging: {
      description: 'WinTeam approval workflow status',
      values: {
        Active: 'Item is approved and active in system',
        New: 'New item pending manager approval',
        Modified: 'Updated item pending manager approval',
        Deleted: 'Item marked for deletion pending approval',
      },
      note: 'Managers must approve items in WinTeam before staging changes to Active',
    },
    status: {
      description: 'Current compliance status',
      values: {
        Active: 'Compliance item is current and valid',
        Expired: 'Compliance item has passed expiration date',
        Pending: 'Awaiting documentation or renewal',
        Suspended: 'Temporarily suspended',
      },
    },
  };

  return explanations[fieldName] || { error: 'Unknown field' };
}

async function checkSyncStatus(clientId: string) {
  const supabase = createServiceClient();

  const { data: syncJob } = await supabase
    .from('sync_jobs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!syncJob) {
    return { error: 'No sync jobs found' };
  }

  return {
    lastSyncDate: syncJob.created_at,
    status: syncJob.status,
    employeesSynced: syncJob.employees_synced,
    licensesSynced: syncJob.licenses_synced,
    errors: syncJob.error_message || null,
    nextSyncEstimate: 'Daily at 2:00 AM',
  };
}
```

### Day 5-7: Test WinTeam Expert Agent

**Test Scenarios**:

```typescript
// Test 1: Diagnose "expired but renewed" issue
const result1 = await winteamExpertAgent.diagnoseIssue({
  employeeId: 'test-employee-123',
  issue: 'My license shows as expired but I submitted my renewal 3 days ago',
});

console.log('Diagnosis:', result1.diagnosis);
console.log('Agent Thinking:', result1.thinking);
console.log('Actions Taken:', result1.actions);

// Expected behavior:
// - Agent queries WinTeam API
// - Finds compliance item with staging='New', status='Expired'
// - Recognizes pattern: pending approval
// - Checks approval status
// - Notifies manager
// - Explains to employee in clear terms
```

---

## 📊 Week 1-4 Deliverables

### What You'll Have Built

1. **Compliance Q&A Agent** ✅
   - Autonomous tool calling
   - Multi-step workflows
   - Proactive assistance
   - SMS confirmations

2. **WinTeam Expert Agent** ✅
   - Deep domain knowledge
   - Diagnostic reasoning
   - Data quality analysis
   - Manager notifications

3. **Tool Library** ✅
   - 15+ compliance tools
   - WinTeam integration tools
   - Notification tools
   - Extensible framework

### The Autonomy You'll Achieve

**Before (Current Services)**:
```
User asks question → Service returns data → YOU decide what to do next
```

**After (Autonomous Agents)**:
```
User asks question → Agent:
  1. Decides which tools to use
  2. Calls multiple tools autonomously
  3. Analyzes results
  4. Takes actions (send SMS, notify manager, create checklist)
  5. Provides complete answer
  6. Schedules follow-ups

All without you writing conditional logic!
```

### Metrics to Track

- **Tool Usage**: Which tools agents call most frequently
- **Multi-tool Workflows**: How often agents use >1 tool per question
- **Proactive Actions**: How often agents take actions without being asked
- **Accuracy**: Answer quality vs. current Q&A service
- **Cost**: API costs per conversation
- **User Satisfaction**: Employee feedback

---

## 🚀 What Comes After Phase 1

### Phase 2 (Weeks 5-8): More Specialized Agents

- **Renewal Orchestrator Agent**: Multi-day workflows
- **Proactive Monitor Agent**: Daily compliance scanning
- **Document Intelligence Agent**: Multi-document validation

### Phase 3 (Weeks 9-12): Orchestration Layer

- **Compliance Manager Agent**: Routes to sub-agents
- **Multi-agent workflows**: Agents collaborating
- **Operations Manager prep**: Ready for company-wide AI

---

## 💡 Key Differences You'll Experience

### 1. From Predefined Logic to Autonomous Decision-Making

**Before**:
```typescript
if (intent === 'confirm') {
  transitionTo('confirmed');
} else if (intent === 'reject') {
  transitionTo('rejected');
}
// You write every conditional
```

**After**:
```typescript
// Agent decides what to do based on context
const result = await agent.run({ message: userMessage });
// Agent might: confirm, ask clarifying question, request more info, escalate
```

### 2. From Single-Purpose to Multi-Step Workflows

**Before**:
```typescript
const cost = await calculateCost(employeeId);
// Just returns cost
```

**After**:
```typescript
// Agent autonomously:
// - Gets employee info
// - Calculates cost
// - Finds training providers
// - Creates checklist
// - Sends confirmation
// All in one flow!
```

### 3. From Reactive to Proactive

**Before**:
```typescript
// Wait for user to ask specific question
```

**After**:
```typescript
// Agent sees employee's license expires in 10 days
// Proactively: "I noticed your license expires soon.
//               Want me to start the renewal process?"
```

---

## ✅ Success Criteria for Phase 1

By end of Week 4, you should have:

- [ ] Q&A Agent answering questions autonomously with 90%+ accuracy
- [ ] Agent using 3+ tools per complex question on average
- [ ] WinTeam Expert Agent diagnosing issues with visible reasoning
- [ ] 50%+ reduction in manual work for compliance questions
- [ ] Cost per conversation <$0.10 (sustainable economics)
- [ ] Employee satisfaction score >4/5

---

## 📋 Ready to Start?

Next step after Claude SDK setup:

1. **Day 1**: Create `src/lib/agents/base-agent.ts`
2. **Day 2**: Define compliance tools
3. **Day 3**: Build Q&A agent
4. **Day 4-5**: Test and iterate
5. **Day 6**: Start WinTeam Expert Agent

**Want me to start implementing?**
