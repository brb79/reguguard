# CLAUDE.md - AI Assistant Guide for ReguGuard

**Last Updated:** 2025-12-30
**Project:** ReguGuard - AI-Powered License Compliance & Renewal Platform
**Version:** 0.1.0

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture & Tech Stack](#architecture--tech-stack)
3. [Directory Structure](#directory-structure)
4. [Key Conventions & Patterns](#key-conventions--patterns)
5. [Development Workflows](#development-workflows)
6. [Database Schema](#database-schema)
7. [API Endpoints Reference](#api-endpoints-reference)
8. [External Integrations](#external-integrations)
9. [Common Tasks & Examples](#common-tasks--examples)
10. [Critical Notes for AI Assistants](#critical-notes-for-ai-assistants)

---

## Project Overview

### What is ReguGuard?

ReguGuard is a **SaaS compliance platform** that automates license tracking, expiration alerts, and SMS-based license renewals for security guard companies. It integrates deeply with WinTeam (HR system), Twilio (SMS), and Google Gemini AI (document extraction & NLP).

### Core Features

1. **Automated License Expiration Monitoring** - Daily cron jobs check for expiring licenses with configurable alert thresholds (30, 14, 7 days before expiration)
2. **SMS-Based License Renewal Workflow** - Employees text license photos; AI extracts data; system confirms and syncs to WinTeam
3. **AI-Powered Document Extraction** - Google Vision API extracts expiration dates, license numbers, states, and types from photos
4. **Compliance Validation** - AI validates licenses against state requirements metadata
5. **State Requirements Monitoring** - Automated web scraping detects changes in state licensing regulations
6. **Alert Personalization** - AI generates context-aware SMS messages with A/B testing support
7. **WinTeam Integration** - Bi-directional sync of employees and licenses with the WinTeam HR system
8. **Multi-Tenant Architecture** - Per-client configuration with isolated data and custom settings

### Business Context

- **Target Users:** Security guard staffing companies (consulting clients)
- **End Users:** Security guards/employees who need to renew licenses
- **Compliance Domain:** State-by-state security guard licensing (24+ states supported)
- **Critical Path:** License expiration → Alert → Employee SMS → Photo submission → AI extraction → Confirmation → WinTeam sync

---

## Architecture & Tech Stack

### Framework & Runtime

- **Next.js 16.1.1** - React framework with App Router (server components, API routes)
- **React 19.2.3** - UI library
- **TypeScript 5.x** - Strict mode enabled
- **Node.js** - Deployed on Vercel

### Database & Storage

- **Supabase 2.89.0** - PostgreSQL backend with:
  - Row Level Security (RLS) policies
  - Real-time subscriptions (not currently used)
  - Server and browser clients
  - Admin client for bypassing RLS (used in SMS webhook)
- **11+ Database Migrations** - Schema evolution tracked in `supabase/migrations/`

### External APIs & Services

| Service | Purpose | Library | Key Features |
|---------|---------|---------|--------------|
| **Google Gemini AI** | Document extraction, NLP, compliance | `@google/generative-ai` | Vision API, gemini-1.5-pro/flash models |
| **Twilio** | SMS/MMS messaging | `twilio` | Inbound webhook, outbound messaging, signature validation |
| **WinTeam** | HR system integration | Custom client | Employee/license sync, tenant-based API |
| **Upstash Redis** | Rate limiting | `@upstash/ratelimit` | Sliding window, in-memory fallback |

### Key Utilities

- **Zod 3.23.8** - Runtime type validation (all API requests/responses)
- **TailwindCSS 4** - Utility-first styling
- **ESLint 9** - Code linting with Next.js config

---

## Directory Structure

```
reguguard/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/                      # API route handlers
│   │   │   ├── alerts/               # Alert creation & sending
│   │   │   │   ├── expiring/         # GET - List expiring licenses
│   │   │   │   ├── send/             # POST - Send SMS alerts
│   │   │   │   └── ab-testing/       # GET - A/B test analytics
│   │   │   ├── compliance/           # Compliance validation
│   │   │   │   ├── validate/         # POST - Validate license
│   │   │   │   └── report/           # GET - Compliance report
│   │   │   ├── cron/                 # Vercel cron jobs
│   │   │   │   ├── daily-check/      # Daily license expiration check
│   │   │   │   └── state-requirements-monitor/  # State monitoring
│   │   │   ├── renewals/             # Renewal management
│   │   │   │   └── pending/          # GET - List pending renewals
│   │   │   ├── sms/                  # SMS webhook
│   │   │   │   └── webhook/          # POST - Twilio webhook (inbound SMS/MMS)
│   │   │   ├── state-requirements/   # State requirements API
│   │   │   │   ├── monitor/          # GET - Trigger monitoring
│   │   │   │   ├── changes/          # GET - View changes
│   │   │   │   └── reports/          # GET - Impact reports
│   │   │   ├── winteam/              # WinTeam integration
│   │   │   │   └── sync/             # POST - Sync employees/licenses
│   │   │   └── health/               # GET - Health check
│   │   ├── dashboard/                # Dashboard page (server component)
│   │   ├── layout.tsx                # Root layout
│   │   └── page.tsx                  # Home page
│   └── lib/                          # Shared libraries
│       ├── ai/                       # AI/ML services
│       │   ├── nlp-service.ts        # Intent classification (Flash)
│       │   ├── matching-service.ts   # License-to-state matching (Pro)
│       │   ├── compliance-validation-service.ts  # Validate against state reqs
│       │   ├── compliance-qa-service.ts          # Q&A with metadata
│       │   ├── alert-personalization-service.ts  # Personalized SMS
│       │   ├── qa-cache-service.ts   # Q&A caching with TTL
│       │   └── ab-testing-utils.ts   # A/B test variant selection
│       ├── conversations/            # SMS conversation orchestration
│       │   └── conversation-service.ts  # State machine for SMS flows
│       ├── supabase/                 # Supabase clients
│       │   ├── client.ts             # Browser client
│       │   ├── server.ts             # Server client (cookies)
│       │   ├── admin.ts              # Admin client (bypasses RLS)
│       │   ├── types.ts              # Database types
│       │   └── query-types.ts        # Type-safe query helpers
│       ├── sms/                      # Twilio SMS service
│       │   └── sms-service.ts        # Send SMS/MMS, validate webhooks
│       ├── vision/                   # Google Vision API
│       │   └── vision-service.ts     # License photo extraction
│       ├── state-requirements/       # State monitoring
│       │   ├── monitor-service.ts    # Scraping & change detection
│       │   └── metadata-utils.ts     # Load state metadata
│       ├── winteam/                  # WinTeam client
│       │   └── client.ts             # REST API wrapper
│       ├── validation/               # Zod schemas
│       │   └── schemas.ts            # Request/response validation
│       ├── auth/                     # Authentication
│       │   └── middleware.ts         # requireAuth, requireClientAccess
│       ├── ratelimit/                # Rate limiting
│       │   └── config.ts             # Rate limiter setup
│       ├── errors/                   # Error handling
│       │   └── types.ts              # Custom error classes
│       └── env/                      # Environment management
│           ├── validation.ts         # Zod-based env validation
│           └── index.ts              # Export getEnv()
├── supabase/
│   └── migrations/                   # Database schema versions
│       ├── 20241201000000_initial_schema.sql
│       ├── 20241210000000_sms_conversations.sql
│       ├── ... (11 total migrations)
│       └── 20241229000000_compliance_qa_cache.sql
├── knowledge/
│   └── states/                       # State requirements metadata
│       ├── AZ/ (metadata.json, requirements.json, README.md)
│       ├── CA/ (same structure)
│       └── ... (24+ states)
├── scripts/                          # Utility scripts
├── public/                           # Static assets
├── package.json                      # Dependencies & scripts
├── tsconfig.json                     # TypeScript config (strict mode, @/* alias)
├── next.config.ts                    # Next.js config
├── eslint.config.mjs                 # ESLint config
├── postcss.config.mjs                # PostCSS/Tailwind config
└── [Documentation]
    ├── CLAUDE.md                     # This file
    ├── AI_QUICK_START.md             # AI feature quick reference
    ├── AI_STRATEGY_SUMMARY.md        # AI architecture overview
    ├── AI_EXPANSION_PLAN.md          # Future AI enhancements
    ├── STATE_REQUIREMENTS_MONITORING.md  # State monitoring docs
    └── ALERT_PERSONALIZATION_IMPLEMENTATION.md  # Personalization guide
```

---

## Key Conventions & Patterns

### Code Style

1. **Strict TypeScript** - `strict: true` in tsconfig.json
2. **Module Aliases** - `@/*` maps to `src/*` (use everywhere)
3. **snake_case** - Database tables, columns, enums
4. **camelCase** - TypeScript variables, functions, properties
5. **PascalCase** - Classes, types, interfaces, React components
6. **UPPER_SNAKE_CASE** - Constants, environment variables

### Naming Conventions

| Pattern | Example | Usage |
|---------|---------|-------|
| `*Service` | `ConversationService`, `VisionService` | Service classes |
| `*Client` | `WinTeamClient`, `createClient()` | External API clients |
| `*Result` | `ExtractionResult`, `MatchingResult` | Function return types |
| `*Request` | `SendAlertsRequest`, `SyncRequest` | API request bodies |
| `*Response` | `AlertsResponse`, `SyncResponse` | API response bodies |
| `*Schema` | `sendAlertsSchema`, `syncRequestSchema` | Zod validation schemas |
| `*Error` | `ValidationError`, `AuthenticationError` | Custom error classes |

### Design Patterns Used

#### 1. Service Pattern
All business logic is encapsulated in service classes:

```typescript
// Example: src/lib/ai/nlp-service.ts
export class NLPService {
  private model: GenerativeModel;

  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async classifyIntent(message: string): Promise<IntentResult> {
    // Business logic here
  }
}

// Singleton export
export const nlpService = new NLPService();
```

#### 2. Middleware Pattern
Authentication, rate limiting, and error handling as composable middleware:

```typescript
// Example: src/app/api/alerts/send/route.ts
export async function POST(request: Request) {
  return withErrorHandling(async () => {
    await requireAuth(request);
    await rateLimiters.api(request);

    // Business logic
  });
}
```

#### 3. State Machine Pattern
SMS conversations follow a strict state machine with defined transitions:

```typescript
// States: general_inquiry → awaiting_photo → processing → awaiting_confirmation → confirmed
// See: src/lib/conversations/conversation-service.ts
const VALID_TRANSITIONS = {
  general_inquiry: ['awaiting_photo', 'completed'],
  awaiting_photo: ['processing', 'failed', 'expired'],
  processing: ['awaiting_confirmation', 'failed'],
  // ...
};
```

#### 4. Type-Safe Query Pattern
Zod schemas validate requests; TypeScript types ensure type-safe database queries:

```typescript
// Request validation
const sendAlertsSchema = z.object({
  clientId: z.string().uuid(),
  daysThreshold: z.number().min(1).max(90),
});

// Type-safe query with helper
const { data, error } = await supabase
  .from('licenses_cache')
  .select(selectLicensesWithExpiry)  // Type helper ensures correct fields
  .eq('client_id', clientId);
```

#### 5. Factory Pattern
Supabase clients created based on context (browser, server, admin):

```typescript
// Browser: src/lib/supabase/client.ts
export function createBrowserClient() { ... }

// Server: src/lib/supabase/server.ts
export async function createServerClient() { ... }

// Admin: src/lib/supabase/admin.ts
export function createAdminClient() { ... }  // Bypasses RLS
```

---

## Development Workflows

### Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables (copy from .env.example if exists)
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
GOOGLE_AI_API_KEY=your-google-ai-key
WINTEAM_API_URL=https://winteam-api.example.com
WINTEAM_TENANT_ID=your-tenant-id
REGUGUARD_API_KEY=your-api-key
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token
EOF

# 3. Run development server
npm run dev
# → Starts on http://localhost:3000

# 4. Run linting
npm run lint

# 5. Build for production
npm run build
```

### Git Workflow

**Branch Naming Convention:**
- Feature branches: `claude/add-feature-name-<sessionId>`
- All Claude Code branches must start with `claude/` and end with session ID
- Main branch: (check with `git branch`)

**Commit Messages:**
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, etc.
- Be specific: "feat: Implement compliance Q&A caching with NLP entity extraction"
- Not generic: "fix: bug fix"

**Push Requirements:**
- Always push to feature branch first: `git push -u origin <branch-name>`
- Retry on network errors (up to 4 times with exponential backoff: 2s, 4s, 8s, 16s)
- Never force push to main/master

### Common Development Commands

```bash
# Development
npm run dev              # Start dev server (hot reload)
npm run build            # Production build
npm run start            # Start production server
npm run lint             # Run ESLint

# Database (Supabase CLI required)
supabase db reset        # Reset local DB
supabase db push         # Push migrations to remote
supabase gen types typescript --local > src/lib/supabase/types.ts  # Generate types

# Testing (not currently configured)
# npm test               # Run tests (add Jest/Vitest)
```

---

## Database Schema

### Core Tables

#### `clients`
Tenant configuration for consulting clients.

```sql
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  winteam_tenant_id TEXT UNIQUE,
  alert_config JSONB DEFAULT '{"enabled": true, "thresholds": [30, 14, 7], "escalation_emails": []}',
  sms_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Key Points:**
- Multi-tenant architecture root
- `alert_config` stores threshold days and escalation emails
- `sms_enabled` gates SMS renewal feature per client

#### `employees_cache`
Synced from WinTeam.

```sql
CREATE TABLE employees_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  winteam_employee_number TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  email TEXT,
  location TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, winteam_employee_number)
);

CREATE INDEX idx_employees_cache_client_id ON employees_cache(client_id);
CREATE INDEX idx_employees_cache_phone ON employees_cache(phone);
```

**Key Points:**
- Cached copy of WinTeam employees (not source of truth)
- Phone numbers used for SMS matching
- Unique constraint prevents duplicates per client

#### `licenses_cache`
Security guard licenses/compliance items.

```sql
CREATE TABLE licenses_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees_cache(id) ON DELETE CASCADE,
  winteam_license_id TEXT,
  description TEXT NOT NULL,
  expiration_date DATE,
  license_number TEXT,
  license_state TEXT,
  license_type TEXT,
  staging TEXT,
  status TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  -- AI matching results
  matched_state TEXT,
  matched_type TEXT,
  matching_confidence NUMERIC(5,2),
  matching_metadata JSONB,
  UNIQUE(client_id, winteam_license_id)
);

-- View with computed expiration days
CREATE VIEW licenses_with_expiry AS
SELECT *,
  CASE
    WHEN expiration_date IS NOT NULL THEN expiration_date - CURRENT_DATE
    ELSE NULL
  END AS days_until_expiration
FROM licenses_cache;
```

**Key Points:**
- `description` is free-text from WinTeam (e.g., "Armed Guard License - CA")
- AI populates `matched_state`, `matched_type`, `matching_confidence`
- View `licenses_with_expiry` used for alert queries

#### `alerts`
Expiration alerts generated by cron jobs.

```sql
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees_cache(id) ON DELETE CASCADE,
  license_id UUID REFERENCES licenses_cache(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('expiring_30d', 'expiring_14d', 'expiring_7d', 'expired')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'acknowledged', 'failed')),
  days_until_expiration INTEGER,
  message_sent_at TIMESTAMPTZ,
  personalization_metadata JSONB,  -- A/B test variant, personalization details
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Key Points:**
- Alert types correspond to threshold days (30, 14, 7, 0)
- `personalization_metadata` stores A/B test variant and AI-generated message details

#### `sms_conversations`
SMS conversation state tracking.

```sql
CREATE TABLE sms_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees_cache(id) ON DELETE SET NULL,
  license_id UUID REFERENCES licenses_cache(id) ON DELETE SET NULL,
  alert_id UUID REFERENCES alerts(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('general_inquiry', 'awaiting_photo', 'processing', 'awaiting_confirmation', 'confirmed', 'completed', 'rejected', 'expired', 'failed')),
  context JSONB,  -- Conversation metadata (extracted data, user responses)
  expires_at TIMESTAMPTZ,  -- Default 24 hours from creation
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**State Machine:**
```
general_inquiry → awaiting_photo → processing → awaiting_confirmation → confirmed → completed
                                 ↓                                    ↓
                              failed                              rejected
```

**Key Points:**
- One active conversation per phone number (enforce in code)
- `context` stores extracted license data during renewal flow
- Conversations expire after 24 hours (configurable)

#### `pending_renewals`
License photos and extracted data awaiting confirmation.

```sql
CREATE TABLE pending_renewals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees_cache(id),
  license_id UUID REFERENCES licenses_cache(id),
  conversation_id UUID REFERENCES sms_conversations(id),
  photo_url TEXT NOT NULL,
  extracted_expiration_date DATE,
  extracted_license_number TEXT,
  extracted_state TEXT,
  extracted_type TEXT,
  extraction_confidence NUMERIC(5,2),
  extraction_metadata JSONB,  -- Raw AI response, processing notes
  confirmed BOOLEAN DEFAULT false,
  confirmed_at TIMESTAMPTZ,
  synced_to_winteam BOOLEAN DEFAULT false,
  winteam_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Key Points:**
- Created after successful photo extraction
- `confirmed = true` after employee confirms accuracy
- `synced_to_winteam = true` after successful WinTeam API call

#### `compliance_qa_cache`
Cached Q&A answers with TTL.

```sql
CREATE TABLE compliance_qa_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_fingerprint TEXT UNIQUE NOT NULL,  -- Hash of (question + state + license_type)
  question TEXT NOT NULL,
  state TEXT,
  license_type TEXT,
  answer TEXT NOT NULL,
  metadata JSONB,  -- Source files, confidence, etc.
  cache_hit_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL  -- TTL (default 7 days)
);

-- LRU cleanup index
CREATE INDEX idx_qa_cache_expiry ON compliance_qa_cache(expires_at);
```

**Key Points:**
- Fingerprint = `sha256(question + state + license_type)`
- Daily cron job deletes expired entries
- Cache hit count tracks usage for analytics

### Additional Tables

- `sync_jobs` - WinTeam sync history with error tracking
- `sms_message_log` - All SMS/MMS messages (inbound/outbound)
- `state_requirements_monitoring` - Monitoring history per state
- `state_requirements_changes` - Detected requirement changes
- `compliance_impact_reports` - Generated impact analysis
- `compliance_validations` - License validation results
- `compliance_reports` - Employee compliance aggregations

---

## API Endpoints Reference

### Authentication

All API endpoints require one of:
1. **API Key** - `x-api-key` header (for service-to-service, cron jobs)
2. **Supabase Session** - Cookie-based (for authenticated users)

### Rate Limiting

Default: **10 requests per 10 seconds** (sliding window via Upstash Redis)

### Endpoints

#### Alerts

**GET `/api/alerts/expiring`**
- **Auth:** Required
- **Purpose:** List licenses expiring within threshold
- **Query Params:**
  - `clientId` (UUID) - Required
  - `daysThreshold` (number) - Default: 30
- **Response:** `{ licenses: License[], count: number }`

**POST `/api/alerts/send`**
- **Auth:** Required
- **Purpose:** Send SMS alerts to employees
- **Body:**
  ```json
  {
    "clientId": "uuid",
    "daysThreshold": 30,
    "enablePersonalization": true
  }
  ```
- **Response:** `{ sent: number, failed: number, errors: string[] }`

**GET `/api/alerts/ab-testing`**
- **Auth:** Required
- **Purpose:** Get A/B test analytics
- **Query Params:**
  - `clientId` (UUID)
  - `startDate` (ISO date)
  - `endDate` (ISO date)
- **Response:** Variant performance metrics

#### Compliance

**POST `/api/compliance/validate`**
- **Auth:** Required
- **Purpose:** Validate license against state requirements
- **Body:**
  ```json
  {
    "licenseId": "uuid",
    "state": "CA",
    "licenseType": "armed_guard"
  }
  ```
- **Response:** `{ valid: boolean, issues: string[], metadata: object }`

**GET `/api/compliance/report`**
- **Auth:** Required
- **Purpose:** Generate compliance report
- **Query Params:**
  - `employeeId` (UUID) - Optional
  - `clientId` (UUID) - Required if no employeeId
- **Response:** Compliance status, missing requirements, expiring licenses

#### Renewals

**GET `/api/renewals/pending`**
- **Auth:** Required
- **Purpose:** List pending renewals with pagination
- **Query Params:**
  - `clientId` (UUID) - Required
  - `page` (number) - Default: 1
  - `limit` (number) - Default: 50
- **Response:** `{ renewals: PendingRenewal[], total: number, page: number }`

#### SMS

**POST `/api/sms/webhook`**
- **Auth:** Twilio signature validation (no API key)
- **Purpose:** Receive inbound SMS/MMS from Twilio
- **Body:** Twilio webhook payload (form-encoded)
- **Response:** TwiML response

#### State Requirements

**GET `/api/state-requirements/monitor`**
- **Auth:** Required (API key only for cron)
- **Purpose:** Trigger state requirements monitoring
- **Response:** Monitoring job results

**GET `/api/state-requirements/changes`**
- **Auth:** Required
- **Query Params:**
  - `state` (string) - Optional filter
  - `since` (ISO date) - Optional filter
- **Response:** List of detected changes

**GET `/api/state-requirements/reports`**
- **Auth:** Required
- **Query Params:**
  - `reportId` (UUID) - Optional
- **Response:** Impact reports

#### WinTeam

**POST `/api/winteam/sync`**
- **Auth:** Required
- **Purpose:** Sync employees and licenses from WinTeam
- **Body:**
  ```json
  {
    "clientId": "uuid",
    "syncType": "full" | "incremental"
  }
  ```
- **Response:** `{ employeesSynced: number, licensesSynced: number, errors: string[] }`

#### Cron Jobs

**GET `/api/cron/daily-check`**
- **Auth:** API key (Vercel cron secret)
- **Purpose:** Daily license expiration check (runs 8 AM)
- **Response:** Job execution summary

**GET `/api/cron/state-requirements-monitor`**
- **Auth:** API key
- **Purpose:** Periodic state requirements monitoring
- **Response:** Monitoring results

#### Health

**GET `/api/health`**
- **Auth:** None
- **Purpose:** System health check
- **Response:**
  ```json
  {
    "status": "healthy",
    "services": {
      "supabase": "ok",
      "twilio": "ok",
      "vision": "ok",
      "redis": "ok"
    }
  }
  ```

---

## External Integrations

### 1. Google Gemini AI

**Purpose:** Document extraction, NLP, compliance Q&A, license matching

**Models Used:**
- `gemini-1.5-pro` - Complex reasoning (license matching, compliance validation, Q&A)
- `gemini-1.5-flash` - Fast responses (intent classification, simple NLP)

**Key Services:**
- **VisionService** (`src/lib/vision/vision-service.ts`)
  - Extracts expiration date, license number, state, type from photos
  - Returns confidence scores (0-100)
  - Handles edge cases (poor image quality, multiple documents)

- **MatchingService** (`src/lib/ai/matching-service.ts`)
  - Maps WinTeam license descriptions to standardized (state, type) pairs
  - Uses state metadata for context
  - Caches results in `licenses_cache.matched_*` columns

- **ComplianceQAService** (`src/lib/ai/compliance-qa-service.ts`)
  - Answers licensing questions using state requirements metadata
  - Caches answers with 7-day TTL
  - Entity extraction for question fingerprinting

- **NLPService** (`src/lib/ai/nlp-service.ts`)
  - Classifies SMS message intent (license_renewal, general_inquiry, confirmation, etc.)
  - Confidence-based routing in conversation flow

**API Key:** `GOOGLE_AI_API_KEY` environment variable

### 2. Twilio SMS

**Purpose:** Two-way SMS/MMS for license renewals and alerts

**Key Features:**
- **Inbound Webhook** - Receives SMS/MMS at `/api/sms/webhook`
- **Signature Validation** - Verifies webhook authenticity
- **Media Download** - Fetches MMS photo URLs for AI processing
- **Outbound Messaging** - Sends alerts and status updates

**Configuration:**
```typescript
// Environment variables
TWILIO_ACCOUNT_SID=ACxxxxxxxxx
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE_NUMBER=+1234567890

// Webhook URL (configure in Twilio console)
https://your-app.vercel.app/api/sms/webhook
```

**Message Flow:**
1. Employee replies to alert SMS
2. Twilio POSTs to webhook with message content
3. Webhook validates signature
4. ConversationService processes message (state machine)
5. Response sent back via TwiML or SMS API

**Rate Limits:** Configure in Twilio console (default: none)

### 3. Supabase (PostgreSQL)

**Purpose:** Database, authentication, storage

**Client Types:**
- **Browser Client** - For client-side React components (RLS enforced)
- **Server Client** - For API routes with cookie-based auth (RLS enforced)
- **Admin Client** - For bypassing RLS (use sparingly, e.g., SMS webhook)

**Row Level Security (RLS):**
- All tables have RLS policies based on `client_id` or user roles
- Admin client bypasses RLS for system operations

**Type Safety:**
```typescript
// Generate types from schema
supabase gen types typescript --local > src/lib/supabase/types.ts

// Import in code
import type { Database } from '@/lib/supabase/types';
```

**Migrations:**
- Located in `supabase/migrations/`
- Apply with `supabase db push` (remote) or `supabase db reset` (local)

### 4. WinTeam HR System

**Purpose:** Employee and license data source of truth

**API Client:** `src/lib/winteam/client.ts`

**Key Methods:**
```typescript
const winteam = new WinTeamClient(apiUrl, tenantId);

// Fetch employees with pagination
const employees = await winteam.getEmployees({ page: 1, limit: 100 });

// Fetch licenses for employee
const licenses = await winteam.getLicenses(employeeId);

// Update license (after renewal)
await winteam.updateLicense(licenseId, { expirationDate, licenseNumber });
```

**Sync Flow:**
1. API route `/api/winteam/sync` triggered (manual or cron)
2. Fetch all employees (paginated)
3. Upsert to `employees_cache`
4. Fetch licenses for each employee
5. Upsert to `licenses_cache`
6. Track in `sync_jobs` table

**Error Handling:**
- Retries on network errors (3 attempts)
- Logs errors to `sync_jobs.error_message`
- Continues sync even if individual records fail

### 5. Upstash Redis

**Purpose:** Distributed rate limiting

**Configuration:**
```typescript
// Environment variables
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

// Rate limiter setup (src/lib/ratelimit/config.ts)
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const rateLimiters = {
  api: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '10 s'),  // 10 req / 10 sec
  }),
};
```

**Fallback:** In-memory rate limiter if Redis not configured (development)

---

## Common Tasks & Examples

### Task 1: Add a New API Endpoint

**Example:** Add GET `/api/employees/list` to list employees

```typescript
// 1. Create route file: src/app/api/employees/list/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';
import { z } from 'zod';

// 2. Define request schema
const listEmployeesSchema = z.object({
  clientId: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

// 3. Implement handler
export async function GET(request: NextRequest) {
  try {
    // Authenticate
    await requireAuth(request);

    // Validate query params
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const { clientId, limit, offset } = listEmployeesSchema.parse(searchParams);

    // Query database
    const supabase = await createServerClient();
    const { data, error, count } = await supabase
      .from('employees_cache')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Return response
    return NextResponse.json({
      employees: data,
      total: count,
      limit,
      offset,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error listing employees:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Task 2: Add a New Database Table

**Example:** Add `employee_notes` table

```sql
-- 1. Create migration: supabase/migrations/20250101000000_employee_notes.sql
CREATE TABLE employee_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees_cache(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by UUID,  -- Could reference auth.users if using Supabase Auth
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_employee_notes_client_id ON employee_notes(client_id);
CREATE INDEX idx_employee_notes_employee_id ON employee_notes(employee_id);

-- RLS policies
ALTER TABLE employee_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view notes for their client"
  ON employee_notes
  FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE id = auth.jwt()->>'client_id'));

CREATE POLICY "Users can insert notes for their client"
  ON employee_notes
  FOR INSERT
  WITH CHECK (client_id = auth.jwt()->>'client_id');
```

```typescript
// 2. Regenerate types
// Run: supabase gen types typescript --local > src/lib/supabase/types.ts

// 3. Use in code
const { data, error } = await supabase
  .from('employee_notes')  // Type-safe!
  .select('*')
  .eq('employee_id', employeeId);
```

### Task 3: Add a New AI Service

**Example:** Add sentiment analysis for SMS messages

```typescript
// 1. Create service: src/lib/ai/sentiment-service.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getEnv } from '@/lib/env';

const genAI = new GoogleGenerativeAI(getEnv().GOOGLE_AI_API_KEY!);

export interface SentimentResult {
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;  // 0-100
  reasoning?: string;
}

export class SentimentService {
  private model;

  constructor() {
    this.model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',  // Fast model for simple classification
    });
  }

  async analyzeSentiment(message: string): Promise<SentimentResult> {
    const prompt = `
Analyze the sentiment of this SMS message and respond with JSON only:

Message: "${message}"

Response format:
{
  "sentiment": "positive" | "neutral" | "negative",
  "confidence": 0-100,
  "reasoning": "brief explanation"
}
`;

    try {
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);

      return {
        sentiment: parsed.sentiment,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      console.error('Error analyzing sentiment:', error);
      // Fallback to neutral
      return {
        sentiment: 'neutral',
        confidence: 50,
      };
    }
  }
}

// Singleton export
export const sentimentService = new SentimentService();
```

```typescript
// 2. Use in conversation handler
import { sentimentService } from '@/lib/ai/sentiment-service';

// In SMS webhook
const sentiment = await sentimentService.analyzeSentiment(incomingMessage);
if (sentiment.sentiment === 'negative' && sentiment.confidence > 70) {
  // Flag for supervisor review
  await flagForReview(conversationId, 'Negative sentiment detected');
}
```

### Task 4: Modify SMS Conversation Flow

**Example:** Add a new state for supervisor approval

```typescript
// 1. Update state type: src/lib/conversations/conversation-service.ts

export type ConversationState =
  | 'general_inquiry'
  | 'awaiting_photo'
  | 'processing'
  | 'awaiting_confirmation'
  | 'awaiting_supervisor_approval'  // NEW STATE
  | 'confirmed'
  | 'completed'
  | 'rejected'
  | 'expired'
  | 'failed';

// 2. Update valid transitions
const VALID_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  // ... existing transitions
  awaiting_confirmation: ['awaiting_supervisor_approval', 'confirmed', 'rejected'],  // Modified
  awaiting_supervisor_approval: ['confirmed', 'rejected'],  // New
  // ... rest
};

// 3. Update transition logic
async transitionToSupervisorApproval(
  conversationId: string,
  supervisorPhone: string
): Promise<void> {
  const conversation = await this.getConversation(conversationId);
  if (!conversation) throw new Error('Conversation not found');

  // Validate state transition
  if (!this.canTransition(conversation.state, 'awaiting_supervisor_approval')) {
    throw new Error('Invalid state transition');
  }

  // Update conversation
  await this.supabase
    .from('sms_conversations')
    .update({
      state: 'awaiting_supervisor_approval',
      context: {
        ...conversation.context,
        supervisorPhone,
        approvalRequestedAt: new Date().toISOString(),
      },
    })
    .eq('id', conversationId);

  // Send SMS to supervisor
  await this.smsService.sendSMS(
    supervisorPhone,
    `Approval needed for license renewal. Employee: ${conversation.context.employeeName}. Reply APPROVE or REJECT.`
  );
}
```

### Task 5: Add a New State Requirement Field

**Example:** Add "minimum_age" to state metadata

```json
// 1. Update metadata: knowledge/states/CA/metadata.json
{
  "state_code": "CA",
  "state_name": "California",
  "license_types": [
    {
      "type_code": "guard_card",
      "type_name": "Guard Card",
      "minimum_age": 18,  // NEW FIELD
      "requirements": {
        "training_hours": 40,
        "background_check": true,
        "renewal_period_days": 730
      }
    }
  ]
}
```

```typescript
// 2. Update TypeScript type: src/lib/state-requirements/types.ts
export interface LicenseTypeMetadata {
  type_code: string;
  type_name: string;
  minimum_age?: number;  // New field
  requirements: {
    training_hours?: number;
    background_check?: boolean;
    renewal_period_days?: number;
    // ... other fields
  };
}
```

```typescript
// 3. Use in compliance validation
import { loadStateMetadata } from '@/lib/state-requirements/metadata-utils';

async function validateAge(employeeBirthdate: Date, state: string, licenseType: string) {
  const metadata = await loadStateMetadata(state);
  const licenseTypeMeta = metadata.license_types.find(t => t.type_code === licenseType);

  if (licenseTypeMeta?.minimum_age) {
    const age = calculateAge(employeeBirthdate);
    if (age < licenseTypeMeta.minimum_age) {
      return {
        valid: false,
        error: `Employee must be at least ${licenseTypeMeta.minimum_age} years old`,
      };
    }
  }

  return { valid: true };
}
```

---

## Critical Notes for AI Assistants

### Security & Safety

1. **NEVER commit secrets** - Check for `.env`, credentials, API keys before committing
2. **NEVER bypass RLS without reason** - Use admin client only when absolutely necessary (e.g., SMS webhook)
3. **ALWAYS validate input** - Use Zod schemas for all user input
4. **ALWAYS authenticate** - Use `requireAuth` or `requireClientAccess` middleware
5. **ALWAYS validate Twilio webhooks** - Use signature validation in SMS webhook

### Database & Queries

1. **NEVER use raw SQL** - Use Supabase query builder for type safety
2. **ALWAYS use indexes** - Check query plans for slow queries (use `EXPLAIN ANALYZE`)
3. **ALWAYS paginate** - Large result sets should use `limit` and `offset`/`cursor`
4. **NEVER cascade deletes carelessly** - Understand `ON DELETE CASCADE` implications
5. **ALWAYS use transactions** - For multi-table updates (use Supabase RPC or database functions)

### AI Services

1. **ALWAYS handle AI failures gracefully** - Models can return invalid JSON or timeout
2. **ALWAYS set confidence thresholds** - Don't blindly trust AI extraction results
3. **ALWAYS cache when possible** - AI API calls are expensive (see Q&A cache pattern)
4. **NEVER expose raw prompts to users** - Sanitize AI responses before sending
5. **ALWAYS log AI usage** - Track costs, errors, and performance

### SMS & Conversations

1. **ALWAYS validate phone numbers** - E.164 format (`+1234567890`)
2. **NEVER create duplicate conversations** - Check for active conversation before creating
3. **ALWAYS set expiration** - Conversations should timeout (default 24 hours)
4. **ALWAYS validate state transitions** - Use `VALID_TRANSITIONS` mapping
5. **NEVER store PII unnecessarily** - SMS message logs should have retention policies

### Code Quality

1. **ALWAYS use strict TypeScript** - No `any` types unless absolutely necessary
2. **ALWAYS use the `@/*` alias** - Import from `@/lib/...` not `../../lib/...`
3. **ALWAYS handle errors** - Use try/catch and return meaningful error messages
4. **NEVER use `console.log` in production** - Use proper logging (consider adding a logger)
5. **ALWAYS write self-documenting code** - Clear variable names, comments for complex logic

### Performance

1. **ALWAYS use indexes** - Check `EXPLAIN` for full table scans
2. **NEVER fetch all records** - Use pagination or streaming
3. **ALWAYS use connection pooling** - Supabase handles this, but be aware of limits
4. **NEVER block on AI calls** - Consider async processing for non-critical paths
5. **ALWAYS monitor rate limits** - Upstash Redis tracks this, but be aware of quotas

### Testing (Future)

1. **ALWAYS mock external APIs** - Don't call Twilio/Google in tests
2. **ALWAYS test edge cases** - Invalid input, missing data, API failures
3. **ALWAYS test state transitions** - Conversation flow is complex
4. **NEVER use production data in tests** - Mock or use fixtures
5. **ALWAYS test RLS policies** - Ensure data isolation between clients

---

## Additional Resources

### Documentation Files

- **AI_QUICK_START.md** - Quick reference for AI features
- **AI_STRATEGY_SUMMARY.md** - Overall AI architecture and strategy
- **AI_EXPANSION_PLAN.md** - Planned AI feature enhancements
- **STATE_REQUIREMENTS_MONITORING.md** - State monitoring implementation details
- **ALERT_PERSONALIZATION_IMPLEMENTATION.md** - Alert personalization guide

### External Documentation

- [Next.js 16 Docs](https://nextjs.org/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Twilio SMS API](https://www.twilio.com/docs/sms)
- [Google Gemini API](https://ai.google.dev/docs)
- [Zod Validation](https://zod.dev/)
- [Upstash Rate Limiting](https://upstash.com/docs/redis/features/ratelimiting)

### Key File References

| What You Need | File to Check |
|---------------|---------------|
| Environment variables | `src/lib/env/validation.ts` |
| Database types | `src/lib/supabase/types.ts` |
| API authentication | `src/lib/auth/middleware.ts` |
| SMS conversation logic | `src/lib/conversations/conversation-service.ts` |
| License extraction | `src/lib/vision/vision-service.ts` |
| License matching | `src/lib/ai/matching-service.ts` |
| Error handling | `src/lib/errors/types.ts` |
| Rate limiting | `src/lib/ratelimit/config.ts` |
| Request validation | `src/lib/validation/schemas.ts` |
| State metadata | `knowledge/states/*/metadata.json` |

---

## Version History

- **2025-12-30** - Initial CLAUDE.md creation (comprehensive codebase documentation)

---

**End of CLAUDE.md**

*This document should be updated whenever significant architectural changes, new patterns, or major features are added to the codebase.*
