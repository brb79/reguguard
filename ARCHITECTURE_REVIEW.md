# Architecture Review: ADK Multi-Agent System
## Alignment Check for Hierarchical Compliance Agent Implementation

**Created**: 2025-12-30
**Purpose**: Review proposed ADK architecture against existing codebase to ensure alignment

---

## 🏗️ Current Architecture (What Exists)

### Existing Services & Patterns

```
Current ReguGuard Architecture
├── Conversation Service (src/lib/conversations/service.ts)
│   ├── SMS-based license renewal flows
│   ├── State machine: general_inquiry → awaiting_photo → processing → completed
│   ├── Uses NLP service for intent detection
│   ├── Uses Compliance QA service for questions
│   └── Direct Gemini SDK integration
│
├── Renewal Session Service (src/lib/renewals/session-service.ts)
│   ├── Multi-day workflow state persistence
│   ├── Event logging system
│   └── Session management (active, awaiting_photo, completed, etc.)
│
├── Autonomous Renewal Agent (src/lib/renewals/autonomous-agent.ts)
│   ├── AI-driven renewal workflows
│   ├── Direct Gemini SDK calls (NOT ADK)
│   └── Session-based state management
│
└── API Endpoints
    ├── /api/genkit/qa - Q&A agent (direct Gemini, NOT using ADK)
    ├── /api/sms/webhook - SMS conversation routing
    ├── /api/renewals/* - Renewal workflow endpoints
    └── /api/compliance/* - Compliance validation & reporting
```

### Key Findings

✅ **Strong Foundation**:
- Robust state machine for conversations
- Session persistence for multi-day workflows
- Event logging and audit trail
- NLP-powered intent detection
- Compliance Q&A with web grounding

❌ **Not Using ADK**:
- Agents use direct Gemini SDK (`GoogleGenerativeAI`)
- No `defineFlow()` or `defineTool()` patterns
- No Genkit observability/tracing
- No structured tool calling framework

---

## 🎯 Proposed ADK Architecture

### Hierarchical Multi-Agent System

```
AI Operations Manager (Future - Top Level)
│
└── AI Compliance Manager (Orchestrator)
    │
    ├── Request Classification Layer
    │   └── Routes to appropriate sub-agent(s)
    │
    ├── Sub-Agents (Specialists)
    │   ├── Q&A Sub-Agent
    │   ├── Renewal Sub-Agent
    │   ├── Document Processing Sub-Agent
    │   ├── Monitoring Sub-Agent
    │   └── Escalation Sub-Agent
    │
    └── Tool Registry (Shared)
        ├── Employee Tools
        ├── License Tools
        ├── State Requirement Tools
        ├── Document Processing Tools
        └── Notification Tools
```

---

## 🔍 Architecture Alignment Analysis

### ✅ What Aligns Well

| Current Pattern | Proposed ADK Pattern | Alignment |
|----------------|---------------------|-----------|
| Conversation Service handles routing | Compliance Orchestrator routes requests | ✅ Strong - same concept, ADK makes it more structured |
| NLP service classifies intents | ADK Classifier Tool | ✅ Strong - migrate intent detection to ADK tool |
| Renewal Session Service persists state | ADK sessions with conversation history | ✅ Perfect - keep session service, add ADK on top |
| Existing tools (vision, WinTeam, SMS) | ADK Tool Registry | ✅ Perfect - wrap existing services as ADK tools |
| Event logging system | ADK traces + existing events | ✅ Strong - ADK adds observability layer |

### ⚠️ Integration Challenges

| Challenge | Solution |
|-----------|----------|
| **Dual State Systems**: Existing state machine vs. ADK flows | Keep existing state machine, use ADK for decision-making only |
| **SMS Webhook Entry**: Current `/api/sms/webhook` routes directly | Add orchestrator layer before routing to sub-agents |
| **Session Persistence**: Two session systems (conversations + renewals) | Unify under Compliance Orchestrator with sub-agent sessions |
| **Direct Gemini Calls**: Many existing services use direct SDK | Gradual migration - wrap existing calls in ADK flows |

### ⚡ Key Decisions Required

#### Decision 1: State Management Strategy

**Option A: ADK-First State Management**
- Replace existing state machines with ADK flows
- ❌ High risk - breaks existing SMS flows
- ❌ Requires rewriting conversation service
- ✅ Clean ADK architecture

**Option B: Hybrid State Management** ⭐ RECOMMENDED
- Keep existing state machines for SMS flows
- Add ADK orchestrator as decision layer
- ADK manages sub-agent routing and tool calling
- Existing services remain operational
- ✅ Low risk - incremental migration
- ✅ Preserves working SMS flows
- ⚠️ Dual systems temporarily

**Recommendation**: **Option B (Hybrid)** - Less risk, gradual migration

#### Decision 2: Entry Point Architecture

**How should requests flow into the system?**

**Current Flow**:
```
SMS → /api/sms/webhook → conversationService → (direct Gemini) → Response
```

**Proposed Flow**:
```
SMS → /api/sms/webhook → complianceOrchestrator → [Sub-Agents] → Response
                                                        ↓
                                                   ADK Tools
                                                   (employee, state, docs, etc.)
```

**Question**: Where does `conversationService` fit?

**Option A**: Replace conversationService with orchestrator
- ❌ Breaks existing working code
- ❌ High migration effort

**Option B**: Orchestrator calls conversationService as a tool ⭐
- ✅ Preserves existing functionality
- ✅ Low risk
- ✅ Gradual migration path

**Recommendation**: **Option B** - Orchestrator treats existing services as tools

#### Decision 3: Tool Registry Scope

**What should be ADK tools vs. existing services?**

**Low-Level Tools** (migrate to ADK):
- `getEmployeeRecord`
- `getLicenseDetails`
- `searchStateRegulations`
- `getRenewalRequirements`
- `validateDocument`
- `sendSMS` / `sendEmail`

**High-Level Services** (keep as-is, call from ADK):
- `conversationService` - complex state machine
- `renewalSessionService` - session persistence
- `visionService` - document extraction
- `winTeamClient` - external API

**Recommendation**: **Hybrid** - Simple tools in ADK, complex services called by ADK

---

## 📋 Revised Implementation Strategy

### Phase 0: Foundation (Week 1)

**Goal**: Set up ADK infrastructure without breaking existing code

**Tasks**:
1. ✅ Activate `genkit.config.ts` (rename from .unused)
2. ✅ Create tool registry with low-level tools
3. ✅ Build orchestrator shell (routes to existing services initially)
4. ✅ Add `/api/compliance` unified endpoint (parallel to existing APIs)
5. ⚠️ Do NOT touch `/api/sms/webhook` yet

**Success Criteria**:
- ADK tools callable via Genkit Dev UI
- Orchestrator can route simple requests
- Existing SMS flows still work

### Phase 1: Q&A Sub-Agent Migration (Week 2)

**Goal**: Migrate Q&A from direct Gemini to ADK

**Migration Path**:
```
Before: /api/genkit/qa → direct Gemini SDK
After:  /api/genkit/qa → ADK qaSubAgent → ADK tools
```

**Tasks**:
1. Create `qaSubAgent` as ADK flow
2. Migrate tools: `searchStateRegulations`, `getRenewalRequirements`
3. Test with evaluation dataset
4. Deploy parallel to existing endpoint
5. Compare responses (existing vs. ADK)
6. Switch traffic once validated

**Rollback Plan**: Feature flag to switch back to direct Gemini

### Phase 2: Orchestrator Integration (Week 3)

**Goal**: Route requests through orchestrator

**Tasks**:
1. Build request classifier (ADK tool)
2. Implement routing logic
3. Test with Q&A sub-agent
4. Add response aggregation
5. Create `/api/compliance` unified endpoint

**Flow**:
```
POST /api/compliance
  → complianceOrchestrator
      → classifyRequest (ADK tool)
      → route to qaSubAgent (ADK flow)
      → aggregate results
      → return response
```

### Phase 3: Renewal Sub-Agent Migration (Weeks 4-5)

**Goal**: Migrate renewal workflows to ADK

**Challenge**: Renewal agent is more complex (multi-day sessions)

**Migration Strategy**:
```
Keep: renewalSessionService (state persistence)
Keep: conversationService (SMS state machine)

Migrate: Decision logic → ADK renewalSubAgent
Migrate: Tool calls → ADK tool registry
```

**Tasks**:
1. Create renewal tools (document request, validation, submission)
2. Build `renewalSubAgent` flow
3. Integrate with session service
4. Test multi-day workflows
5. Deploy parallel to existing autonomous agent

### Phase 4: SMS Integration (Week 6)

**Goal**: Route SMS through orchestrator

**Migration Path**:
```
Before: /api/sms/webhook → conversationService → direct Gemini
After:  /api/sms/webhook → complianceOrchestrator → [sub-agents] → conversationService (for state)
```

**Tasks**:
1. Add SMS context to orchestrator input
2. Build SMS-specific routing logic
3. Preserve existing state machine
4. Test with real SMS flows
5. Gradual rollout (10% → 50% → 100%)

---

## 🏛️ Final Architecture (Post-Migration)

```
┌─────────────────────────────────────────────────────────────┐
│                   Entry Points                               │
│  • POST /api/compliance (web, email, operations manager)    │
│  • POST /api/sms/webhook (Twilio)                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           AI Compliance Manager (ADK Orchestrator)           │
│                                                               │
│  1. Classify request (ADK tool: classifyComplianceRequest)  │
│  2. Route to sub-agent(s)                                   │
│  3. Aggregate results                                        │
│  4. Return unified response                                  │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┬────────────┐
         ▼               ▼               ▼            ▼
    ┌────────┐    ┌──────────┐    ┌──────────┐  ┌──────────┐
    │  Q&A   │    │ Renewal  │    │ Document │  │ Monitor  │
    │ Sub-   │    │  Sub-    │    │  Sub-    │  │  Sub-    │
    │ Agent  │    │  Agent   │    │  Agent   │  │  Agent   │
    │ (ADK)  │    │  (ADK)   │    │  (ADK)   │  │  (ADK)   │
    └───┬────┘    └────┬─────┘    └────┬─────┘  └────┬─────┘
        │              │               │             │
        └──────────────┼───────────────┴─────────────┘
                       │
                       ▼
         ┌─────────────────────────────────────┐
         │         ADK Tool Registry            │
         ├─────────────────────────────────────┤
         │  • getEmployeeRecord                │
         │  • searchStateRegulations           │
         │  • validateDocument                 │
         │  • sendSMS / sendEmail              │
         │  ...                                │
         └──────────────┬──────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    ┌─────────┐  ┌─────────┐  ┌─────────────────┐
    │ Existing │  │ Existing │  │ Existing State  │
    │ Services │  │ Session │  │ Machines        │
    │          │  │ Service │  │                 │
    │ • Vision │  │         │  │ • Conversation  │
    │ • WinTeam│  │ • Events│  │   Service       │
    │ • Email  │  │ • Logs  │  │ • SMS State     │
    └─────────┘  └─────────┘  └─────────────────┘
```

---

## ✅ Key Principles

1. **Incremental Migration**: Parallel deployment, gradual traffic shift
2. **Preserve Working Code**: Keep SMS flows operational during migration
3. **Hybrid State**: ADK for decisions, existing services for complex state
4. **Tool Wrapping**: Wrap existing services as ADK tools
5. **Rollback Safety**: Feature flags at every migration step
6. **Observability**: ADK tracing + existing event logs

---

## 📊 Success Metrics

### Technical Metrics
- [ ] All sub-agents use ADK `defineFlow()`
- [ ] 95%+ of tools in ADK registry
- [ ] <10% overhead vs. direct Gemini calls
- [ ] Genkit Dev UI shows all agent traces
- [ ] Evaluation scores match or exceed current performance

### Business Metrics
- [ ] 0 regressions in SMS flows
- [ ] 0 downtime during migration
- [ ] Improved response quality (>5% better user satisfaction)
- [ ] Faster development of new agents (50% reduction in time)

---

## 🚨 Critical Questions for Alignment

Before proceeding, please confirm:

### Q1: State Management Approach
**Should we use Hybrid State (existing state machines + ADK orchestration)?**
- ✅ Yes → Lower risk, gradual migration
- ❌ No → Full ADK rewrite required

### Q2: Entry Point Strategy
**Should orchestrator call existing conversationService as a tool?**
- ✅ Yes → Preserves SMS flows, lower risk
- ❌ No → Replace conversationService entirely

### Q3: Migration Timeline
**Is 6-week incremental migration acceptable?**
- ✅ Yes → Safe, parallel deployment
- ❌ No → Need faster approach (higher risk)

### Q4: SMS Flow Priority
**Should we preserve existing SMS flows during migration?**
- ✅ Yes → Phase 4 (week 6) before touching SMS
- ❌ No → Migrate SMS immediately (higher risk)

### Q5: Scope of ADK Tools
**Should complex services (vision, WinTeam) be wrapped as ADK tools?**
- ✅ Yes → Full ADK integration, more consistent
- ❌ No → Call existing services from ADK (simpler)

---

## 📝 Recommendations

Based on the current codebase analysis:

1. ✅ **Use Hybrid State Management** - Keep existing state machines
2. ✅ **Gradual Migration** - 6-week phased approach
3. ✅ **Preserve SMS Flows** - Don't touch until Phase 4
4. ✅ **Wrap Simple Tools** - Employee, license, state data as ADK tools
5. ✅ **Call Complex Services** - Vision, WinTeam called by ADK, not wrapped
6. ✅ **Parallel Deployment** - New ADK endpoints alongside existing ones
7. ✅ **Feature Flags** - Easy rollback at each phase

---

## 🎯 Next Steps (If Aligned)

1. **Review this document** - Confirm approach aligns with your vision
2. **Answer critical questions** - Determine migration strategy
3. **Begin Phase 0** - Set up ADK infrastructure without breaking anything
4. **Build tool registry** - Start with 3-5 simple tools
5. **Create Q&A sub-agent** - First ADK flow migration

**Estimated Timeline**: 6 weeks to full ADK multi-agent system

---

**Questions? Concerns? Different approach preferred?**
