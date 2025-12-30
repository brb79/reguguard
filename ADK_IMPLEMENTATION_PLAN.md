# Google Agent Development Kit (ADK/Genkit) Implementation Plan
## Step-by-Step Migration and Agent Development Guide

**Document Purpose**: Detailed technical implementation plan for migrating ReguGuard from direct Gemini SDK to Google Agent Development Kit (Genkit) and implementing Tier 4 autonomous agent features.

**Target Audience**: Development team implementing ADK migration

**Prerequisites**:
- Existing ReguGuard codebase with Tier 1 features implemented
- Google Cloud project with Gemini API enabled
- Node.js 18+ and TypeScript knowledge
- Understanding of agent-based architectures

---

## 📋 Table of Contents

1. [Overview & Decision Framework](#overview--decision-framework)
2. [Phase 1: Pilot Migration (Weeks 1-3)](#phase-1-pilot-migration-weeks-1-3)
3. [Phase 2: Core Agent Development (Weeks 4-9)](#phase-2-core-agent-development-weeks-4-9)
4. [Phase 3: Advanced Agents (Weeks 10-18)](#phase-3-advanced-agents-weeks-10-18)
5. [Phase 4: Production Rollout (Weeks 19-20)](#phase-4-production-rollout-weeks-19-20)
6. [Technical Architecture](#technical-architecture)
7. [Cost Analysis](#cost-analysis)
8. [Success Metrics](#success-metrics)

---

## Overview & Decision Framework

### When to Start ADK Migration

✅ **Proceed with migration if:**
- You're ready to implement ≥2 features from Tier 4
- You need multi-step autonomous workflows
- You want tool calling and external API integration
- You need long-running stateful conversations
- You require built-in observability and evaluation

⏸️ **Wait on migration if:**
- Current Tier 1-3 features meet all needs
- Team bandwidth is limited
- Budget for extended development unavailable

### Migration Decision Tree

```
Do you need multi-step workflows where AI decides the sequence?
├─ YES → Continue
└─ NO → Stay with current SDK

Do you need tool calling (AI decides which APIs to call)?
├─ YES → Continue
└─ NO → Stay with current SDK

Do you need ≥2 Tier 4 features?
├─ YES → MIGRATE TO ADK
└─ NO → Consider waiting
```

---

## Phase 1: Pilot Migration (Weeks 1-3)

**Goal**: Migrate one existing service to ADK, learn patterns, validate approach

### Week 1: Setup & Learning

#### Day 1-2: Environment Setup

**1. Install Genkit and dependencies**

```bash
# Install Genkit CLI
npm install -g genkit

# Install Genkit packages
npm install @genkit-ai/core @genkit-ai/googleai @genkit-ai/flow
npm install -D @genkit-ai/cli
```

**2. Create Genkit configuration**

Create `genkit.config.ts`:
```typescript
import { configureGenkit } from '@genkit-ai/core';
import { googleAI } from '@genkit-ai/googleai';

export default configureGenkit({
  plugins: [
    googleAI({
      apiKey: process.env.GOOGLE_AI_API_KEY,
    }),
  ],
  logLevel: 'debug',
  enableTracingAndMetrics: true,
});
```

**3. Update package.json scripts**

```json
{
  "scripts": {
    "genkit:dev": "genkit start -- npm run dev",
    "genkit:flow": "genkit flow:run",
    "genkit:eval": "genkit eval:run"
  }
}
```

#### Day 3-5: Genkit Fundamentals

**Study Resources:**
1. Read Genkit documentation: https://firebase.google.com/docs/genkit
2. Complete Genkit quickstart tutorial
3. Understand key concepts:
   - Flows: Orchestrated multi-step workflows
   - Tools: Functions AI can call
   - Prompts: Structured prompt management
   - Traces: Observability for agent decisions

**Practice Exercise:** Create a simple agent
```typescript
import { defineFlow, defineTool } from '@genkit-ai/flow';
import { gemini15Pro } from '@genkit-ai/googleai';

// Define a tool
const getWeather = defineTool(
  {
    name: 'getWeather',
    description: 'Get weather for a location',
    inputSchema: z.object({
      location: z.string(),
    }),
    outputSchema: z.object({
      temp: z.number(),
      conditions: z.string(),
    }),
  },
  async (input) => {
    // Mock implementation
    return { temp: 72, conditions: 'sunny' };
  }
);

// Define a flow that uses the tool
const weatherFlow = defineFlow(
  {
    name: 'weatherFlow',
    inputSchema: z.string(),
    outputSchema: z.string(),
  },
  async (location) => {
    const result = await gemini15Pro.generate({
      prompt: `What's the weather in ${location}? Use the getWeather tool.`,
      tools: [getWeather],
    });
    return result.text;
  }
);
```

### Week 2: Pilot Implementation - Compliance Q&A Agent

**Why start with Q&A Agent:**
- Relatively simple (single-turn interactions initially)
- Clear input/output
- Easy to measure success
- Existing service to compare against

#### Day 1-2: Create Tool Library

Create `src/lib/genkit/tools/compliance-tools.ts`:

```typescript
import { defineTool } from '@genkit-ai/flow';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// Tool 1: Search state regulations
export const searchStateRegulations = defineTool(
  {
    name: 'searchStateRegulations',
    description: 'Search state-specific licensing regulations and requirements',
    inputSchema: z.object({
      stateCode: z.string().length(2),
      licenseType: z.string().optional(),
      query: z.string(),
    }),
    outputSchema: z.object({
      regulations: z.array(z.object({
        title: z.string(),
        content: z.string(),
        source: z.string(),
      })),
    }),
  },
  async ({ stateCode, licenseType, query }) => {
    // Load state metadata
    const metadata = await loadStateMetadata(stateCode);

    // Search within requirements
    const regulations = searchRequirements(metadata, query, licenseType);

    return { regulations };
  }
);

// Tool 2: Check employee record
export const checkEmployeeRecord = defineTool(
  {
    name: 'checkEmployeeRecord',
    description: 'Get employee license and renewal information',
    inputSchema: z.object({
      employeeId: z.string(),
    }),
    outputSchema: z.object({
      employee: z.object({
        name: z.string(),
        licenses: z.array(z.object({
          type: z.string(),
          state: z.string(),
          expirationDate: z.string(),
          status: z.string(),
        })),
      }),
    }),
  },
  async ({ employeeId }) => {
    const supabase = await createClient();

    const { data: employee } = await supabase
      .from('employees')
      .select('*, licenses(*)')
      .eq('id', employeeId)
      .single();

    return { employee };
  }
);

// Tool 3: Calculate renewal cost
export const calculateRenewalCost = defineTool(
  {
    name: 'calculateRenewalCost',
    description: 'Calculate total renewal cost including fees and training',
    inputSchema: z.object({
      stateCode: z.string(),
      licenseType: z.string(),
    }),
    outputSchema: z.object({
      totalCost: z.number(),
      breakdown: z.object({
        applicationFee: z.number(),
        renewalFee: z.number(),
        trainingCost: z.number().optional(),
      }),
    }),
  },
  async ({ stateCode, licenseType }) => {
    const metadata = await loadStateMetadata(stateCode);
    const requirements = metadata.licenseTypes[licenseType];

    return {
      totalCost: requirements.fees.total,
      breakdown: {
        applicationFee: requirements.fees.application,
        renewalFee: requirements.fees.renewal,
        trainingCost: requirements.fees.training,
      },
    };
  }
);

// Tool 4: Find training providers
export const findTrainingProviders = defineTool(
  {
    name: 'findTrainingProviders',
    description: 'Find approved training providers for a license type',
    inputSchema: z.object({
      stateCode: z.string(),
      licenseType: z.string(),
      zipCode: z.string().optional(),
    }),
    outputSchema: z.object({
      providers: z.array(z.object({
        name: z.string(),
        location: z.string(),
        phone: z.string(),
        website: z.string().optional(),
        nextAvailable: z.string().optional(),
      })),
    }),
  },
  async ({ stateCode, licenseType, zipCode }) => {
    // In real implementation, query database or external API
    // For now, load from state metadata
    const metadata = await loadStateMetadata(stateCode);
    const providers = metadata.trainingProviders || [];

    return { providers };
  }
);
```

#### Day 3-4: Create Q&A Agent Flow

Create `src/lib/genkit/agents/compliance-qa-agent.ts`:

```typescript
import { defineFlow } from '@genkit-ai/flow';
import { gemini15Pro } from '@genkit-ai/googleai';
import { z } from 'zod';
import {
  searchStateRegulations,
  checkEmployeeRecord,
  calculateRenewalCost,
  findTrainingProviders,
} from '../tools/compliance-tools';

export const complianceQAAgent = defineFlow(
  {
    name: 'complianceQAAgent',
    inputSchema: z.object({
      question: z.string(),
      employeeId: z.string(),
      conversationHistory: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })).optional(),
    }),
    outputSchema: z.object({
      answer: z.string(),
      sources: z.array(z.string()),
      suggestedActions: z.array(z.string()).optional(),
    }),
  },
  async ({ question, employeeId, conversationHistory = [] }) => {
    // Build conversation context
    const messages = [
      {
        role: 'system' as const,
        content: `You are a compliance assistant for ReguGuard, helping security guards with license renewals and compliance questions.

You have access to tools to:
- Search state regulations
- Check employee records
- Calculate renewal costs
- Find training providers

Always:
1. Use tools to get accurate, real-time data
2. Cite sources for regulatory information
3. Provide actionable next steps
4. Be concise (SMS-friendly when possible)
5. Escalate to supervisor if you can't help

Current employee ID: ${employeeId}`,
      },
      ...conversationHistory,
      {
        role: 'user' as const,
        content: question,
      },
    ];

    // Run agent with tools
    const result = await gemini15Pro.generate({
      messages,
      tools: [
        searchStateRegulations,
        checkEmployeeRecord,
        calculateRenewalCost,
        findTrainingProviders,
      ],
      config: {
        temperature: 0.3, // Lower temp for factual responses
        maxOutputTokens: 500,
      },
    });

    // Extract sources from tool calls
    const sources: string[] = [];
    if (result.toolCalls) {
      result.toolCalls.forEach((call) => {
        if (call.name === 'searchStateRegulations') {
          sources.push('State Regulations');
        }
      });
    }

    // Parse suggested actions from response
    const suggestedActions = extractActions(result.text);

    return {
      answer: result.text,
      sources,
      suggestedActions,
    };
  }
);

function extractActions(text: string): string[] {
  // Simple extraction - improve with better parsing
  const actionPatterns = [
    /next step[s]?:(.+?)(?:\n|$)/i,
    /you should:(.+?)(?:\n|$)/i,
    /action[s]? needed:(.+?)(?:\n|$)/i,
  ];

  const actions: string[] = [];
  actionPatterns.forEach((pattern) => {
    const match = text.match(pattern);
    if (match) {
      actions.push(match[1].trim());
    }
  });

  return actions;
}
```

#### Day 5: Integration & Testing

**1. Create API endpoint**

Create `src/app/api/genkit/qa/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { complianceQAAgent } from '@/lib/genkit/agents/compliance-qa-agent';

export async function POST(req: NextRequest) {
  try {
    const { question, employeeId, conversationHistory } = await req.json();

    const result = await complianceQAAgent({
      question,
      employeeId,
      conversationHistory,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Q&A agent error:', error);
    return NextResponse.json(
      { error: 'Failed to process question' },
      { status: 500 }
    );
  }
}
```

**2. Test with Genkit Dev UI**

```bash
npm run genkit:dev
```

Open http://localhost:4000 and test the flow:
- Input test questions
- Verify tool calls are made
- Check response quality
- Review traces and metrics

**3. Unit tests**

Create `src/lib/genkit/agents/__tests__/compliance-qa-agent.test.ts`:

```typescript
import { complianceQAAgent } from '../compliance-qa-agent';

describe('Compliance Q&A Agent', () => {
  it('should answer renewal cost questions', async () => {
    const result = await complianceQAAgent({
      question: 'How much does it cost to renew my armed guard license in Virginia?',
      employeeId: 'test-employee-123',
    });

    expect(result.answer).toContain('$');
    expect(result.sources).toContain('State Regulations');
  });

  it('should find training providers', async () => {
    const result = await complianceQAAgent({
      question: 'Where can I get required training?',
      employeeId: 'test-employee-123',
    });

    expect(result.answer.toLowerCase()).toContain('training');
    expect(result.suggestedActions).toBeDefined();
  });

  it('should handle multi-turn conversations', async () => {
    const result = await complianceQAAgent({
      question: 'Can I book that training session?',
      employeeId: 'test-employee-123',
      conversationHistory: [
        {
          role: 'user',
          content: 'Where can I get training?',
        },
        {
          role: 'assistant',
          content: 'XYZ Training offers sessions on...',
        },
      ],
    });

    expect(result.answer).toBeDefined();
  });
});
```

### Week 3: Evaluation & Refinement

#### Day 1-2: Create Evaluation Dataset

Create `evaluations/qa-agent-eval.ts`:

```typescript
import { defineEval } from '@genkit-ai/evaluation';
import { complianceQAAgent } from '../src/lib/genkit/agents/compliance-qa-agent';

const testCases = [
  {
    question: 'How much does Virginia armed guard renewal cost?',
    expectedTopics: ['cost', 'fee', 'armed', 'virginia'],
    expectedTools: ['calculateRenewalCost', 'searchStateRegulations'],
  },
  {
    question: 'Where can I get training for unarmed license?',
    expectedTopics: ['training', 'provider', 'unarmed'],
    expectedTools: ['findTrainingProviders'],
  },
  {
    question: 'When does my license expire?',
    expectedTopics: ['expiration', 'date'],
    expectedTools: ['checkEmployeeRecord'],
  },
  // Add 20+ more test cases
];

export const qaAgentEval = defineEval({
  name: 'qa-agent-evaluation',
  flow: complianceQAAgent,
  testCases: testCases.map((tc) => ({
    input: {
      question: tc.question,
      employeeId: 'test-employee-123',
    },
    reference: tc,
  })),
  evaluators: [
    // Evaluator 1: Check if answer is relevant
    async (result, testCase) => {
      const { answer } = result;
      const { expectedTopics } = testCase.reference;

      const topicsFound = expectedTopics.filter((topic) =>
        answer.toLowerCase().includes(topic)
      );

      return {
        score: topicsFound.length / expectedTopics.length,
        details: `Found ${topicsFound.length}/${expectedTopics.length} expected topics`,
      };
    },

    // Evaluator 2: Check if correct tools were used
    async (result, testCase) => {
      const { toolCalls } = result;
      const { expectedTools } = testCase.reference;

      const toolsUsed = toolCalls?.map((call) => call.name) || [];
      const correctTools = expectedTools.filter((tool) =>
        toolsUsed.includes(tool)
      );

      return {
        score: correctTools.length / expectedTools.length,
        details: `Used ${correctTools.length}/${expectedTools.length} expected tools`,
      };
    },

    // Evaluator 3: Check response length (should be SMS-friendly)
    async (result) => {
      const { answer } = result;
      const isConcise = answer.length <= 500; // ~3 SMS messages

      return {
        score: isConcise ? 1 : 0.5,
        details: `Response length: ${answer.length} chars`,
      };
    },
  ],
});
```

#### Day 3-4: Run Evaluations & Iterate

```bash
# Run evaluation
npm run genkit:eval -- evaluations/qa-agent-eval.ts

# Review results in Genkit UI
npm run genkit:dev
```

**Iteration checklist:**
- [ ] Accuracy: >90% on test cases
- [ ] Tool usage: Correct tools called >95% of time
- [ ] Response quality: Concise, actionable, cited
- [ ] Performance: <3 seconds average response time
- [ ] Cost: <$0.01 per query

#### Day 5: Documentation & Handoff

**Create migration guide:** `docs/adk-migration-guide.md`

**Document:**
1. Key differences from old service
2. How to create tools
3. How to define flows
4. How to test and evaluate
5. Observability and monitoring
6. Rollback procedures

---

## Phase 2: Core Agent Development (Weeks 4-9)

**Goal**: Implement Multi-Step Autonomous Renewal Agent

### Week 4-5: Tool Development

#### Renewal Workflow Tools

Create `src/lib/genkit/tools/renewal-tools.ts`:

```typescript
// Tool 1: Check license status
export const checkLicenseStatus = defineTool({
  name: 'checkLicenseStatus',
  description: 'Check current license status and renewal eligibility',
  inputSchema: z.object({
    employeeId: z.string(),
    licenseId: z.string(),
  }),
  outputSchema: z.object({
    status: z.enum(['active', 'expiring_soon', 'expired', 'pending']),
    expirationDate: z.string(),
    renewalEligible: z.boolean(),
    renewalWindow: z.object({
      start: z.string(),
      end: z.string(),
    }),
    blockers: z.array(z.string()),
  }),
}, async ({ employeeId, licenseId }) => {
  // Implementation
});

// Tool 2: Identify state requirements
export const identifyStateRequirements = defineTool({
  name: 'identifyStateRequirements',
  description: 'Get all requirements for license renewal in specific state',
  inputSchema: z.object({
    stateCode: z.string(),
    licenseType: z.string(),
  }),
  outputSchema: z.object({
    requirements: z.array(z.object({
      type: z.enum(['document', 'training', 'fee', 'exam']),
      description: z.string(),
      required: z.boolean(),
      status: z.enum(['completed', 'pending', 'not_started']),
    })),
    estimatedTimeline: z.string(),
    criticalDeadlines: z.array(z.object({
      item: z.string(),
      deadline: z.string(),
    })),
  }),
}, async ({ stateCode, licenseType }) => {
  // Implementation
});

// Tool 3: Request documents
export const requestDocuments = defineTool({
  name: 'requestDocuments',
  description: 'Request specific documents from employee via SMS',
  inputSchema: z.object({
    employeeId: z.string(),
    documentTypes: z.array(z.string()),
    instructions: z.string(),
    urgency: z.enum(['low', 'medium', 'high']),
  }),
  outputSchema: z.object({
    requestId: z.string(),
    sentAt: z.string(),
    expectedResponseBy: z.string(),
  }),
}, async ({ employeeId, documentTypes, instructions, urgency }) => {
  // Send SMS with document request
  // Log request in database
  // Set up reminder if no response
});

// Tool 4: Validate document
export const validateDocument = defineTool({
  name: 'validateDocument',
  description: 'Validate uploaded document against requirements',
  inputSchema: z.object({
    documentId: z.string(),
    documentType: z.string(),
    requirements: z.object({
      fields: z.array(z.string()),
      validations: z.array(z.string()),
    }),
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    extractedData: z.record(z.any()),
    issues: z.array(z.object({
      field: z.string(),
      issue: z.string(),
      severity: z.enum(['error', 'warning']),
    })),
    qualityScore: z.number(),
  }),
}, async ({ documentId, documentType, requirements }) => {
  // Use existing vision service
  // Validate extracted data
  // Check image quality
});

// Tool 5: Submit application
export const submitApplication = defineTool({
  name: 'submitApplication',
  description: 'Submit renewal application to state portal or internal system',
  inputSchema: z.object({
    employeeId: z.string(),
    licenseId: z.string(),
    documents: z.array(z.string()),
    applicationData: z.record(z.any()),
  }),
  outputSchema: z.object({
    submissionId: z.string(),
    submittedAt: z.string(),
    status: z.enum(['submitted', 'pending_review', 'failed']),
    confirmationNumber: z.string().optional(),
    errors: z.array(z.string()).optional(),
  }),
}, async ({ employeeId, licenseId, documents, applicationData }) => {
  // Submit to state portal (if API available)
  // Or create internal submission record
  // Send confirmation to employee
});

// Tool 6: Track application status
export const trackApplicationStatus = defineTool({
  name: 'trackApplicationStatus',
  description: 'Check status of submitted renewal application',
  inputSchema: z.object({
    submissionId: z.string(),
  }),
  outputSchema: z.object({
    status: z.enum(['submitted', 'in_review', 'approved', 'rejected', 'pending_info']),
    lastUpdated: z.string(),
    nextSteps: z.array(z.string()),
    estimatedCompletion: z.string().optional(),
  }),
}, async ({ submissionId }) => {
  // Check state portal or internal database
});

// Tool 7: Schedule reminder
export const scheduleReminder = defineTool({
  name: 'scheduleReminder',
  description: 'Schedule follow-up reminder for employee',
  inputSchema: z.object({
    employeeId: z.string(),
    reminderType: z.string(),
    scheduledFor: z.string(),
    message: z.string(),
  }),
  outputSchema: z.object({
    reminderId: z.string(),
    scheduledAt: z.string(),
  }),
}, async ({ employeeId, reminderType, scheduledFor, message }) => {
  // Create reminder in database
  // Will be sent by cron job
});
```

### Week 6-7: Autonomous Renewal Agent Implementation

Create `src/lib/genkit/agents/renewal-agent.ts`:

```typescript
import { defineFlow } from '@genkit-ai/flow';
import { gemini15Pro } from '@genkit-ai/googleai';
import { z } from 'zod';

export const autonomousRenewalAgent = defineFlow(
  {
    name: 'autonomousRenewalAgent',
    inputSchema: z.object({
      employeeId: z.string(),
      licenseId: z.string().optional(),
      initialMessage: z.string(), // e.g., "Help me renew my armed guard license"
    }),
    outputSchema: z.object({
      sessionId: z.string(),
      status: z.enum(['in_progress', 'completed', 'failed', 'needs_human']),
      currentStep: z.string(),
      completedSteps: z.array(z.string()),
      nextActions: z.array(z.string()),
      summary: z.string(),
    }),
  },
  async ({ employeeId, licenseId, initialMessage }) => {
    // Create session for this renewal workflow
    const sessionId = generateSessionId();

    // System prompt for autonomous agent
    const systemPrompt = `You are an autonomous renewal assistant agent for ReguGuard.

Your goal: Guide the employee through the complete license renewal process from start to finish.

You have access to tools that let you:
1. Check license status and requirements
2. Request documents from the employee
3. Validate uploaded documents
4. Submit renewal applications
5. Track application status
6. Schedule reminders and follow-ups

Your workflow:
1. Assess the current situation (check license status, identify requirements)
2. Create a step-by-step plan
3. Execute each step autonomously
4. Handle errors gracefully (e.g., if photo is blurry, request a better one)
5. Keep the employee informed via SMS
6. Escalate to human supervisor only if you truly cannot proceed

Key principles:
- Be proactive: Don't wait for the employee to ask, guide them through each step
- Be resilient: If something fails, try alternative approaches
- Be clear: Explain what you're doing and what you need from them
- Be efficient: Complete the renewal as quickly as possible
- Track everything: Log all actions for audit trail

Current employee ID: ${employeeId}
${licenseId ? `License ID: ${licenseId}` : ''}
`;

    // Initialize conversation
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: initialMessage },
    ];

    const completedSteps: string[] = [];
    let currentStep = 'initializing';
    let maxIterations = 20; // Prevent infinite loops
    let iteration = 0;

    // Agent loop - continues until workflow is complete or max iterations reached
    while (iteration < maxIterations) {
      iteration++;

      const result = await gemini15Pro.generate({
        messages,
        tools: [
          checkLicenseStatus,
          identifyStateRequirements,
          requestDocuments,
          validateDocument,
          submitApplication,
          trackApplicationStatus,
          scheduleReminder,
        ],
        config: {
          temperature: 0.2, // Low temp for deterministic decisions
          maxOutputTokens: 1000,
        },
      });

      // Add agent's response to conversation
      messages.push({
        role: 'assistant' as const,
        content: result.text,
      });

      // Check if agent made tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        // Execute tool calls and add results to conversation
        for (const toolCall of result.toolCalls) {
          const toolResult = await executeToolCall(toolCall);

          // Track completed steps
          if (toolCall.name === 'submitApplication' && toolResult.status === 'submitted') {
            completedSteps.push('Application submitted');
          }

          messages.push({
            role: 'function' as const,
            name: toolCall.name,
            content: JSON.stringify(toolResult),
          });
        }

        // Continue agent loop to process tool results
        continue;
      }

      // Check if agent thinks workflow is complete
      if (isWorkflowComplete(result.text)) {
        return {
          sessionId,
          status: 'completed',
          currentStep: 'Renewal completed',
          completedSteps,
          nextActions: [],
          summary: result.text,
        };
      }

      // Check if agent needs human intervention
      if (needsHumanEscalation(result.text)) {
        return {
          sessionId,
          status: 'needs_human',
          currentStep,
          completedSteps,
          nextActions: ['Escalate to supervisor'],
          summary: result.text,
        };
      }

      // If no tool calls and not complete, ask agent to continue
      messages.push({
        role: 'user' as const,
        content: 'Please continue with the next step.',
      });
    }

    // Max iterations reached - escalate to human
    return {
      sessionId,
      status: 'needs_human',
      currentStep,
      completedSteps,
      nextActions: ['Workflow exceeded max iterations - needs supervisor review'],
      summary: 'Renewal workflow in progress but requires human oversight.',
    };
  }
);

function isWorkflowComplete(agentMessage: string): boolean {
  const completionIndicators = [
    'renewal is complete',
    'application has been submitted successfully',
    'all steps completed',
    'workflow finished',
  ];

  return completionIndicators.some((indicator) =>
    agentMessage.toLowerCase().includes(indicator)
  );
}

function needsHumanEscalation(agentMessage: string): boolean {
  const escalationIndicators = [
    'need supervisor',
    'requires human',
    'cannot proceed',
    'escalate',
  ];

  return escalationIndicators.some((indicator) =>
    agentMessage.toLowerCase().includes(indicator)
  );
}
```

### Week 8: State Management & Persistence

**Challenge**: Renewal workflows span days/weeks

**Solution**: Persist agent state between sessions

Create `src/lib/genkit/state/renewal-session-store.ts`:

```typescript
import { createClient } from '@/lib/supabase/server';

export interface RenewalSessionState {
  sessionId: string;
  employeeId: string;
  licenseId: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  currentStep: string;
  conversationHistory: Array<{
    role: 'user' | 'assistant' | 'function';
    content: string;
    timestamp: string;
  }>;
  completedSteps: string[];
  pendingActions: string[];
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export class RenewalSessionStore {
  async createSession(session: Omit<RenewalSessionState, 'createdAt' | 'updatedAt'>): Promise<RenewalSessionState> {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('renewal_sessions')
      .insert({
        ...session,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getSession(sessionId: string): Promise<RenewalSessionState | null> {
    const supabase = await createClient();

    const { data } = await supabase
      .from('renewal_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    return data;
  }

  async updateSession(sessionId: string, updates: Partial<RenewalSessionState>): Promise<void> {
    const supabase = await createClient();

    await supabase
      .from('renewal_sessions')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId);
  }

  async resumeSession(sessionId: string): Promise<RenewalSessionState> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    // Mark as active
    await this.updateSession(sessionId, { status: 'active' });

    return session;
  }
}

// Database migration
// Create renewal_sessions table
```

**Create migration:** `supabase/migrations/XXXXXX_create_renewal_sessions.sql`

```sql
CREATE TABLE renewal_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  employee_id TEXT NOT NULL,
  license_id TEXT,
  status TEXT NOT NULL,
  current_step TEXT NOT NULL,
  conversation_history JSONB DEFAULT '[]'::jsonb,
  completed_steps TEXT[] DEFAULT ARRAY[]::TEXT[],
  pending_actions TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_renewal_sessions_employee ON renewal_sessions(employee_id);
CREATE INDEX idx_renewal_sessions_status ON renewal_sessions(status);
CREATE INDEX idx_renewal_sessions_created ON renewal_sessions(created_at DESC);
```

### Week 9: Testing & Refinement

**E2E Testing Strategy:**

Create `tests/e2e/renewal-agent.test.ts`:

```typescript
describe('Autonomous Renewal Agent E2E', () => {
  it('should complete full renewal workflow for simple case', async () => {
    const result = await autonomousRenewalAgent({
      employeeId: 'test-emp-123',
      licenseId: 'test-lic-456',
      initialMessage: 'Help me renew my Virginia unarmed guard license',
    });

    expect(result.status).toBe('completed');
    expect(result.completedSteps).toContain('Application submitted');
  });

  it('should handle blurry photo gracefully', async () => {
    // Mock: First photo upload is blurry
    // Expect: Agent requests better photo
    // Then: Validates new photo and continues
  });

  it('should escalate when prerequisites are missing', async () => {
    // Employee tries to renew armed license without unarmed
    // Expect: Agent identifies blocker and escalates
  });
});
```

**Performance testing:**
```typescript
// Measure agent performance
const metrics = {
  averageStepsToCompletion: 0,
  averageTimeToCompletion: 0,
  successRate: 0,
  toolCallAccuracy: 0,
  escalationRate: 0,
};
```

---

## Phase 3: Advanced Agents (Weeks 10-18)

### Week 10-12: Proactive Compliance Monitor Agent

**Similar pattern to Renewal Agent:**
1. Define tools (scan, analyze, intervene)
2. Create agent flow
3. Add scheduling integration
4. Test and refine

### Week 13-15: Interactive Document Processing Agent

**Focus on:**
- Multi-turn document conversations
- Anomaly detection and clarification
- State persistence across photo uploads

### Week 16-18: Remaining Tier 4 Agents

- Supervisor Escalation Agent
- Predictive Renewal Workflow Agent

---

## Phase 4: Production Rollout (Weeks 19-20)

### Week 19: Staging Deployment

**1. Environment setup**
- Configure production Genkit instance
- Set up monitoring and alerts
- Enable tracing and metrics

**2. Load testing**
- Simulate 1000+ concurrent workflows
- Measure latency, cost, success rate

**3. Security review**
- Audit tool permissions
- Validate data access controls
- Test error handling

### Week 20: Production Launch

**1. Gradual rollout**
- Day 1: 10% of users
- Day 3: 25% of users
- Day 5: 50% of users
- Day 7: 100% of users

**2. Monitoring**
- Track success metrics
- Monitor costs
- Watch for errors

**3. Optimization**
- Tune agent prompts based on real usage
- Optimize tool calls
- Reduce latency

---

## Technical Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     ReguGuard Platform                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐                     │
│  │ SMS Webhook  │──────▶│ Conversation │                     │
│  │   (Twilio)   │      │   Router     │                     │
│  └──────────────┘      └──────┬───────┘                     │
│                                │                              │
│                                ▼                              │
│                    ┌──────────────────┐                      │
│                    │  Genkit Agents   │                      │
│                    │                  │                      │
│                    │  • Renewal       │                      │
│                    │  • Compliance    │                      │
│                    │  • Q&A           │                      │
│                    │  • Document      │                      │
│                    └────────┬─────────┘                      │
│                             │                                 │
│         ┌──────────────────┼──────────────────┐             │
│         │                   │                   │             │
│         ▼                   ▼                   ▼             │
│  ┌────────────┐      ┌────────────┐     ┌────────────┐     │
│  │   Tools    │      │   State    │     │ Gemini API │     │
│  │            │      │   Store    │     │            │     │
│  │ • License  │      │            │     │ • Pro      │     │
│  │ • Document │      │ • Sessions │     │ • Flash    │     │
│  │ • State    │      │ • History  │     │ • Vision   │     │
│  │ • Training │      │            │     │            │     │
│  └────────────┘      └────────────┘     └────────────┘     │
│         │                   │                   │             │
│         └──────────────────┼───────────────────┘             │
│                             │                                 │
│                             ▼                                 │
│                    ┌──────────────────┐                      │
│                    │  Supabase DB     │                      │
│                    │                  │                      │
│                    │  • Employees     │                      │
│                    │  • Licenses      │                      │
│                    │  • Sessions      │                      │
│                    │  • Documents     │                      │
│                    └──────────────────┘                      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Cost Analysis

### Estimated Monthly Costs

**Gemini API Usage:**
- Renewal Agent: ~$0.05 per workflow × 500 renewals/month = $25
- Compliance Monitor: ~$0.02 per employee × 1000 employees = $20
- Q&A Agent: ~$0.01 per query × 2000 queries/month = $20
- Document Agent: ~$0.03 per document × 500 documents/month = $15

**Total estimated: $80/month**

**Compared to current (direct SDK): ~$50/month**

**Cost increase: ~$30/month (+60%)**

**ROI:**
- Reduced manual intervention: 20 hours/month saved × $50/hr = $1000/month
- Improved compliance: Fewer violations = reduced fines
- Better UX: Higher employee satisfaction

**Net benefit: $920/month**

---

## Success Metrics

### Key Performance Indicators

**Agent Performance:**
- Workflow completion rate: >85%
- Average steps to completion: <12
- Escalation rate: <15%
- Tool call accuracy: >95%

**Business Impact:**
- License lapse reduction: 40%
- Support ticket reduction: 60%
- Time to renewal: -50%
- Employee satisfaction: +30%

**Technical Metrics:**
- Average latency: <2s per agent turn
- Error rate: <1%
- API cost per workflow: <$0.10
- Uptime: >99.9%

---

## Rollback Procedures

### If ADK Migration Fails

**Immediate rollback:**
1. Switch traffic back to old SDK services
2. Investigate issues in Genkit traces
3. Fix and redeploy

**Rollback checklist:**
- [ ] Feature flag to disable ADK agents
- [ ] Old SDK services still deployed
- [ ] Database migrations are reversible
- [ ] User sessions can migrate back

---

## Conclusion

This implementation plan provides a structured approach to migrating ReguGuard to Google's Agent Development Kit. The phased approach allows for learning, iteration, and validation at each step while minimizing risk.

**Key Success Factors:**
1. Start with pilot migration to learn
2. Build comprehensive tool library
3. Test extensively with real scenarios
4. Monitor costs and performance continuously
5. Iterate based on real user feedback

**Timeline Summary:**
- Phase 1: 3 weeks (Pilot)
- Phase 2: 6 weeks (Core agent)
- Phase 3: 9 weeks (Advanced agents)
- Phase 4: 2 weeks (Production rollout)
- **Total: 20 weeks (~5 months)**

---

**Document Version**: 1.0
**Last Updated**: 2025-12-30
**Author**: Development Team
**Status**: Ready for review and implementation
