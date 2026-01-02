# ADK Hierarchical Multi-Agent Implementation Plan
## Building AI Compliance Manager with Sub-Agents

**Document Purpose**: Implementation plan for building a hierarchical multi-agent system where the AI Compliance Manager orchestrates specialized sub-agents, designed to eventually integrate with an AI Operations Manager.

**Architecture Philosophy**:
- **Orchestrator Pattern**: Compliance Manager routes tasks to specialized sub-agents
- **Composability**: Sub-agents can be combined for complex workflows
- **Future-Ready**: Designed to be a domain manager under Operations Manager

---

## 📋 System Architecture

```
┌─────────────────────────────────────────────────────────┐
│          AI Operations Manager (Future)                  │
│  Routes to: Compliance, HR, Scheduling, etc.            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│          AI Compliance Manager (Orchestrator)            │
│  • Receives compliance requests                         │
│  • Routes to appropriate sub-agent(s)                   │
│  • Aggregates results                                   │
│  • Maintains compliance context                         │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┬────────────┐
         ▼               ▼               ▼            ▼
    ┌────────┐    ┌──────────┐    ┌──────────┐  ┌──────────┐
    │  Q&A   │    │ Renewal  │    │ Document │  │ Monitor  │
    │ Agent  │    │  Agent   │    │  Agent   │  │  Agent   │
    └────────┘    └──────────┘    └──────────┘  └──────────┘
```

---

## Phase 1: Build Compliance Orchestrator (Weeks 1-4)

### Week 1: Core Orchestrator Infrastructure

#### Day 1-2: Define Orchestrator Architecture

**Create**: `src/lib/agents/compliance/orchestrator.ts`

```typescript
import { defineFlow, defineTool } from '@genkit-ai/flow';
import { gemini15Pro } from '@genkit-ai/googleai';
import { z } from 'zod';

/**
 * AI Compliance Manager - Main Orchestrator
 *
 * Responsibilities:
 * - Classify incoming compliance requests
 * - Route to appropriate sub-agent(s)
 * - Aggregate results from multiple sub-agents
 * - Maintain conversation context across sub-agents
 */

// Input schema for orchestrator
const ComplianceRequestSchema = z.object({
  request: z.string(),
  employeeId: z.string().optional(),
  context: z.object({
    source: z.enum(['sms', 'email', 'web', 'operations_manager']),
    conversationId: z.string().optional(),
    urgency: z.enum(['low', 'medium', 'high']).optional(),
  }),
});

// Output schema
const ComplianceResponseSchema = z.object({
  response: z.string(),
  subAgentsInvoked: z.array(z.string()),
  actions: z.array(z.object({
    type: z.string(),
    status: z.string(),
    details: z.any(),
  })),
  requiresFollowUp: z.boolean(),
  escalationNeeded: z.boolean(),
});

export const complianceOrchestrator = defineFlow(
  {
    name: 'complianceOrchestrator',
    inputSchema: ComplianceRequestSchema,
    outputSchema: ComplianceResponseSchema,
  },
  async (input) => {
    // 1. Classify the request
    const classification = await classifyRequest(input.request);

    // 2. Route to appropriate sub-agent(s)
    const subAgentResults = await routeToSubAgents(
      classification,
      input
    );

    // 3. Aggregate results
    const aggregatedResponse = await aggregateResults(
      input.request,
      subAgentResults
    );

    return aggregatedResponse;
  }
);

// Helper: Classify what type of compliance request this is
async function classifyRequest(request: string) {
  // Use AI to classify: qa, renewal, document_upload, monitoring, etc.
  // This determines which sub-agent(s) to invoke
}

// Helper: Route to sub-agents based on classification
async function routeToSubAgents(classification: any, input: any) {
  // Invoke appropriate sub-agents
  // Can invoke multiple sub-agents in sequence or parallel
}

// Helper: Aggregate results from sub-agents into coherent response
async function aggregateResults(originalRequest: string, results: any[]) {
  // Combine sub-agent outputs into final response
}
```

#### Day 3-5: Build Request Classifier Tool

**Purpose**: AI-powered routing decision

```typescript
export const classifyComplianceRequest = defineTool(
  {
    name: 'classifyComplianceRequest',
    description: 'Classify a compliance request to determine which sub-agent(s) should handle it',
    inputSchema: z.object({
      request: z.string(),
      employeeId: z.string().optional(),
    }),
    outputSchema: z.object({
      primaryIntent: z.enum([
        'answer_question',
        'start_renewal',
        'upload_document',
        'check_status',
        'escalate',
        'multi_step_workflow',
      ]),
      subAgentsNeeded: z.array(z.string()),
      reasoning: z.string(),
      urgency: z.enum(['low', 'medium', 'high']),
    }),
  },
  async ({ request, employeeId }) => {
    const model = gemini15Pro;

    const prompt = `Classify this compliance request:

Request: "${request}"
${employeeId ? `Employee ID: ${employeeId}` : ''}

Determine:
1. Primary intent (what does the user want?)
2. Which sub-agents are needed:
   - qa_agent: Answer questions about regulations, requirements, costs
   - renewal_agent: Handle license renewal workflows
   - document_agent: Process uploaded documents
   - monitoring_agent: Check compliance status
   - escalation_agent: Handle complex issues

3. Urgency level
4. Your reasoning

Respond with JSON:
{
  "primaryIntent": "...",
  "subAgentsNeeded": ["agent1", "agent2"],
  "reasoning": "...",
  "urgency": "..."
}`;

    const result = await model.generate({ prompt });
    return parseJSON(result.text);
  }
);
```

### Week 2: Build Sub-Agent Framework

#### Day 1-3: Define Sub-Agent Interface

**Create**: `src/lib/agents/compliance/sub-agents/base.ts`

```typescript
import { z } from 'zod';

/**
 * Base interface all compliance sub-agents must implement
 */

export const SubAgentInputSchema = z.object({
  request: z.string(),
  employeeId: z.string().optional(),
  licenseId: z.string().optional(),
  context: z.record(z.any()).optional(),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
});

export const SubAgentOutputSchema = z.object({
  response: z.string(),
  data: z.record(z.any()).optional(),
  actions: z.array(z.object({
    type: z.string(),
    status: z.enum(['success', 'pending', 'failed']),
    details: z.any(),
  })),
  requiresFollowUp: z.boolean(),
  escalate: z.boolean(),
  escalationReason: z.string().optional(),
});

export type SubAgentInput = z.infer<typeof SubAgentInputSchema>;
export type SubAgentOutput = z.infer<typeof SubAgentOutputSchema>;

/**
 * Base class for all sub-agents
 */
export abstract class ComplianceSubAgent {
  abstract name: string;
  abstract description: string;

  abstract execute(input: SubAgentInput): Promise<SubAgentOutput>;

  /**
   * Validate if this sub-agent can handle the request
   */
  abstract canHandle(request: string): Promise<boolean>;
}
```

#### Day 4-5: Build Tool Registry for Sub-Agents

**Create**: `src/lib/agents/compliance/tools/registry.ts`

```typescript
/**
 * Centralized registry of all tools available to compliance sub-agents
 *
 * Tools are grouped by domain:
 * - Employee data
 * - License data
 * - State requirements
 * - Document processing
 * - Notifications
 */

import { defineTool } from '@genkit-ai/flow';
import { z } from 'zod';

// ============================================================================
// Employee Data Tools
// ============================================================================

export const getEmployeeRecord = defineTool({
  name: 'getEmployeeRecord',
  description: 'Get employee information and licenses',
  inputSchema: z.object({
    employeeId: z.string(),
  }),
  outputSchema: z.object({
    employee: z.object({
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      licenses: z.array(z.object({
        id: z.string(),
        type: z.string(),
        state: z.string(),
        expirationDate: z.string(),
        status: z.string(),
      })),
    }),
  }),
}, async ({ employeeId }) => {
  // Implementation
});

export const getLicenseDetails = defineTool({
  name: 'getLicenseDetails',
  description: 'Get detailed license information',
  inputSchema: z.object({
    licenseId: z.string(),
  }),
  outputSchema: z.object({
    license: z.object({
      type: z.string(),
      state: z.string(),
      expirationDate: z.string(),
      status: z.string(),
      requirements: z.array(z.string()),
    }),
  }),
}, async ({ licenseId }) => {
  // Implementation
});

// ============================================================================
// State Requirements Tools
// ============================================================================

export const searchStateRegulations = defineTool({
  name: 'searchStateRegulations',
  description: 'Search state-specific licensing regulations',
  inputSchema: z.object({
    stateCode: z.string(),
    query: z.string(),
    licenseType: z.string().optional(),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      content: z.string(),
      source: z.string(),
    })),
  }),
}, async ({ stateCode, query, licenseType }) => {
  // Implementation
});

export const getRenewalRequirements = defineTool({
  name: 'getRenewalRequirements',
  description: 'Get renewal requirements for a license type and state',
  inputSchema: z.object({
    stateCode: z.string(),
    licenseType: z.string(),
  }),
  outputSchema: z.object({
    requirements: z.array(z.object({
      type: z.enum(['document', 'training', 'fee', 'exam']),
      description: z.string(),
      required: z.boolean(),
    })),
    timeline: z.string(),
    totalCost: z.number().optional(),
  }),
}, async ({ stateCode, licenseType }) => {
  // Implementation
});

// ============================================================================
// Document Processing Tools
// ============================================================================

export const validateDocument = defineTool({
  name: 'validateDocument',
  description: 'Validate uploaded document using Vision AI',
  inputSchema: z.object({
    documentId: z.string(),
    expectedType: z.string(),
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    extractedData: z.record(z.any()),
    issues: z.array(z.object({
      field: z.string(),
      issue: z.string(),
      severity: z.enum(['error', 'warning']),
    })),
  }),
}, async ({ documentId, expectedType }) => {
  // Implementation
});

// ============================================================================
// Notification Tools
// ============================================================================

export const sendSMS = defineTool({
  name: 'sendSMS',
  description: 'Send SMS notification to employee',
  inputSchema: z.object({
    employeeId: z.string(),
    message: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.string().optional(),
  }),
}, async ({ employeeId, message }) => {
  // Implementation
});

export const sendEmail = defineTool({
  name: 'sendEmail',
  description: 'Send email to employee',
  inputSchema: z.object({
    employeeId: z.string(),
    subject: z.string(),
    body: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.string().optional(),
  }),
}, async ({ employeeId, subject, body }) => {
  // Implementation
});

// Export all tools grouped by category
export const employeeTools = [getEmployeeRecord, getLicenseDetails];
export const stateTools = [searchStateRegulations, getRenewalRequirements];
export const documentTools = [validateDocument];
export const notificationTools = [sendSMS, sendEmail];

export const allComplianceTools = [
  ...employeeTools,
  ...stateTools,
  ...documentTools,
  ...notificationTools,
];
```

### Week 3: Implement Q&A Sub-Agent

**Create**: `src/lib/agents/compliance/sub-agents/qa-agent.ts`

```typescript
import { defineFlow } from '@genkit-ai/flow';
import { gemini15Pro } from '@genkit-ai/googleai';
import {
  SubAgentInput,
  SubAgentOutput,
  SubAgentInputSchema,
  SubAgentOutputSchema
} from './base';
import {
  getEmployeeRecord,
  searchStateRegulations,
  getRenewalRequirements,
} from '../tools/registry';

/**
 * Q&A Sub-Agent
 *
 * Specializes in answering compliance questions:
 * - State requirements
 * - Renewal costs
 * - Training requirements
 * - Deadlines
 */

export const qaSubAgent = defineFlow(
  {
    name: 'qaSubAgent',
    inputSchema: SubAgentInputSchema,
    outputSchema: SubAgentOutputSchema,
  },
  async (input) => {
    const { request, employeeId, conversationHistory = [] } = input;

    // Get employee context if available
    let employeeContext = '';
    if (employeeId) {
      const employeeData = await getEmployeeRecord({ employeeId });
      employeeContext = formatEmployeeContext(employeeData);
    }

    // Build conversation
    const messages = [
      {
        role: 'system' as const,
        content: `You are a Q&A specialist for compliance questions.

Your role:
- Answer questions about license requirements, costs, timelines
- Use tools to get accurate, real-time information
- Cite sources for regulatory information
- Keep responses concise and actionable

${employeeContext}`,
      },
      ...conversationHistory,
      {
        role: 'user' as const,
        content: request,
      },
    ];

    // Call AI with tools
    const result = await gemini15Pro.generate({
      messages,
      tools: [
        getEmployeeRecord,
        searchStateRegulations,
        getRenewalRequirements,
      ],
      config: {
        temperature: 0.3,
        maxOutputTokens: 500,
      },
    });

    return {
      response: result.text,
      data: {
        sources: extractSources(result.toolCalls),
      },
      actions: [],
      requiresFollowUp: false,
      escalate: false,
    };
  }
);

function formatEmployeeContext(data: any): string {
  // Format employee data for context
}

function extractSources(toolCalls: any[]): string[] {
  // Extract sources from tool calls
}
```

### Week 4: Implement Renewal Sub-Agent

**Create**: `src/lib/agents/compliance/sub-agents/renewal-agent.ts`

```typescript
import { defineFlow } from '@genkit-ai/flow';
import { gemini15Pro } from '@genkit-ai/googleai';
import { SubAgentInputSchema, SubAgentOutputSchema } from './base';
import {
  getEmployeeRecord,
  getLicenseDetails,
  getRenewalRequirements,
  validateDocument,
  sendSMS,
  sendEmail,
} from '../tools/registry';

/**
 * Renewal Sub-Agent
 *
 * Specializes in license renewal workflows:
 * - Multi-step renewal orchestration
 * - Document collection and validation
 * - Portal submission preparation
 * - Status tracking
 */

export const renewalSubAgent = defineFlow(
  {
    name: 'renewalSubAgent',
    inputSchema: SubAgentInputSchema,
    outputSchema: SubAgentOutputSchema,
  },
  async (input) => {
    // This agent manages the renewal workflow
    // It maintains state across multiple interactions
    // Uses session service for persistence

    const { request, employeeId, licenseId } = input;

    // Determine current state of renewal workflow
    const workflowState = await determineWorkflowState(employeeId, licenseId);

    // Execute appropriate workflow step
    const stepResult = await executeWorkflowStep(workflowState, input);

    return stepResult;
  }
);

async function determineWorkflowState(employeeId?: string, licenseId?: string) {
  // Check if there's an active renewal session
  // Return current state
}

async function executeWorkflowStep(state: any, input: SubAgentInput) {
  // Execute the next step in the workflow
  // Return SubAgentOutput
}
```

---

## Phase 2: Build Additional Sub-Agents (Weeks 5-8)

### Week 5: Document Processing Sub-Agent

**Create**: `src/lib/agents/compliance/sub-agents/document-agent.ts`

Specializes in:
- Document validation
- Data extraction
- Quality checks
- Anomaly detection

### Week 6: Monitoring Sub-Agent

**Create**: `src/lib/agents/compliance/sub-agents/monitoring-agent.ts`

Specializes in:
- Proactive compliance checks
- Expiration monitoring
- Risk assessment
- Batch employee scanning

### Week 7: Escalation Sub-Agent

**Create**: `src/lib/agents/compliance/sub-agents/escalation-agent.ts`

Specializes in:
- Complex case handling
- Supervisor notification
- Edge case resolution
- Multi-license dependencies

### Week 8: Integration & Testing

- Wire all sub-agents to orchestrator
- Build routing logic
- Test complex multi-agent workflows
- Create evaluation suite

---

## Phase 3: API Integration & Operations Manager Prep (Weeks 9-10)

### Week 9: Create Unified Compliance API

**Create**: `src/app/api/compliance/route.ts`

```typescript
/**
 * Unified Compliance API Endpoint
 *
 * Single entry point for all compliance requests
 * Routes through Compliance Orchestrator
 */

import { NextRequest, NextResponse } from 'next/server';
import { complianceOrchestrator } from '@/lib/agents/compliance/orchestrator';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const result = await complianceOrchestrator({
    request: body.request,
    employeeId: body.employeeId,
    context: {
      source: body.source || 'web',
      conversationId: body.conversationId,
      urgency: body.urgency || 'medium',
    },
  });

  return NextResponse.json(result);
}
```

### Week 10: Operations Manager Interface

**Create**: `src/lib/agents/operations-manager/compliance-interface.ts`

```typescript
/**
 * Interface for Operations Manager to invoke Compliance Manager
 *
 * This defines the contract between Operations Manager and Compliance Manager
 */

export interface ComplianceManagerInput {
  task: string;
  context: {
    employeeId?: string;
    licenseId?: string;
    urgency: 'low' | 'medium' | 'high';
    source: 'operations_manager' | 'direct';
  };
}

export interface ComplianceManagerOutput {
  success: boolean;
  response: string;
  actions: Array<{
    type: string;
    status: string;
    details: any;
  }>;
  requiresEscalation: boolean;
  subAgentsInvoked: string[];
}

/**
 * Main entry point for Operations Manager
 */
export async function invokeComplianceManager(
  input: ComplianceManagerInput
): Promise<ComplianceManagerOutput> {
  return await complianceOrchestrator({
    request: input.task,
    employeeId: input.context.employeeId,
    context: {
      source: 'operations_manager',
      urgency: input.context.urgency,
    },
  });
}
```

---

## Success Criteria

### Orchestrator Performance
- [ ] Correctly routes 95%+ of requests to appropriate sub-agent(s)
- [ ] Aggregates multi-agent results coherently
- [ ] Maintains context across sub-agent invocations
- [ ] Response time <3s for simple requests, <10s for complex workflows

### Sub-Agent Performance
- [ ] Each sub-agent handles its domain with >90% accuracy
- [ ] Sub-agents can be composed for complex workflows
- [ ] Proper escalation when limits reached
- [ ] Clear separation of concerns

### Integration Readiness
- [ ] Clean interface for Operations Manager
- [ ] Well-documented API contracts
- [ ] Comprehensive observability and tracing
- [ ] Graceful degradation when sub-agents fail

---

## File Structure

```
src/lib/agents/
├── compliance/
│   ├── orchestrator.ts           # Main orchestrator
│   ├── classifier.ts              # Request classification
│   ├── aggregator.ts              # Result aggregation
│   │
│   ├── tools/
│   │   ├── registry.ts            # Central tool registry
│   │   ├── employee-tools.ts
│   │   ├── state-tools.ts
│   │   ├── document-tools.ts
│   │   └── notification-tools.ts
│   │
│   ├── sub-agents/
│   │   ├── base.ts                # Base interface
│   │   ├── qa-agent.ts            # Q&A specialist
│   │   ├── renewal-agent.ts       # Renewal workflow
│   │   ├── document-agent.ts      # Document processing
│   │   ├── monitoring-agent.ts    # Proactive monitoring
│   │   └── escalation-agent.ts    # Complex cases
│   │
│   └── sessions/
│       └── compliance-session.ts  # Cross-agent session management
│
└── operations-manager/            # Future
    └── compliance-interface.ts    # Contract with Compliance Manager
```

---

## Timeline Summary

- **Weeks 1-4**: Core orchestrator + Q&A + Renewal sub-agents
- **Weeks 5-8**: Additional sub-agents + integration
- **Weeks 9-10**: API unification + Operations Manager prep

**Total: 10 weeks** for production-ready hierarchical compliance system

---

**Next Step**: Start Week 1, Day 1 - Build the Compliance Orchestrator infrastructure
