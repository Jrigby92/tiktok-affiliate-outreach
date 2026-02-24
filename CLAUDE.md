# CLAUDE.md — Andinn Organics

This file is the single source of truth for Claude Code. It contains the architecture spec, the build tracker, and the session prompts — all in one place.

---

## How This File Works

```
┌─────────────────────────────────────────────────────────────┐
│  PART 1: ARCHITECTURE SPEC                                  │
│  The reference material. Column types, API methods,         │
│  rule numbers, business logic. Consult this constantly.     │
├─────────────────────────────────────────────────────────────┤
│  PART 2: BUILD SECTIONS (1–8)                               │
│  Each section contains:                                     │
│                                                             │
│    ┌─ 📋 PROMPT ─────────────────────────────────────────┐  │
│    │  Auto-read instruction block.                        │  │
│    │  Claude Code: treat this as your session briefing.   │  │
│    │  It tells you WHAT to focus on and WHY.              │  │
│    └──────────────────────────────────────────────────────┘  │
│                                                             │
│    ┌─ ☐ TASKS ───────────────────────────────────────────┐  │
│    │  Numbered checklist. Execute in order.                │  │
│    │  Mark [✓] when done. Commit after each.              │  │
│    └──────────────────────────────────────────────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  PART 3: COMPLETION CRITERIA                                │
│  12 checks that define "production-ready."                  │
└─────────────────────────────────────────────────────────────┘
```

### Status Key

```
[ ]  — Not started
[→]  — CURRENT_TASK (build this now)
[✓]  — Complete
```

### Rules for Claude Code

1. **Start of session:** Scan for the `[→] CURRENT_TASK` marker. That section is your job.
2. **Read the `📋 PROMPT` block** at the top of that section. It's your session briefing.
3. **Execute the `☐ TASKS`** below the prompt, in order. Each task has full implementation detail — follow it exactly.
4. **When a task is done:** Change `[ ]` to `[✓]` and commit this file.
5. **When all tasks in a section are done:** Change the section marker from `[→] CURRENT_TASK` to `[✓] DONE`. Move `[→] CURRENT_TASK` to the next section. Commit.
6. **Never skip ahead.** Each section depends on the ones before it.
7. **Consult Part 1** (Architecture Spec) whenever you need column types, API methods, rule numbers, or business logic.

---

# ═══════════════════════════════════════════════════════════════
# PART 1 — ARCHITECTURE SPEC
# ═══════════════════════════════════════════════════════════════

This is the reference material. Do not modify this section. Consult it constantly while building.

---

## Project Status

**Pre-implementation.** No source code exists yet. The spec below is the build blueprint.

## Development Commands

Once scaffolded, the expected commands:

```bash
# Start all services (Next.js + PostgreSQL/pgvector + Redis + cloudflared)
docker compose up -d

# Install dependencies
npm install

# Run dev server
npm run dev

# Type-check
npx tsc --noEmit

# Lint
npm run lint

# Run tests
npm test

# Run a single test file
npx jest path/to/file.test.ts
```

**Python venv** exists at `.venv/` (Python 3.12.8 via pyenv) — currently empty. Used for any Python-side tooling if needed.

---

## What This App Does

> Autonomous AI agent that finds TikTok creators, ships supplements through Amazon, and never breaks UK advertising law.

Andinn Organics sells health supplements in the UK. This application is an autonomous agent that:

1. **Finds** TikTok creators who are a good fit for promoting our supplements
2. **Negotiates** affiliate collaborations and sends free samples
3. **Fulfills** orders through Amazon's warehouse network (Multi-Channel Fulfillment)
4. **Generates** content ideas by watching TikTok trends in real time
5. **Guarantees** every word of marketing copy complies with UK supplement law
6. **Optimizes** commission rates and creator selection through reinforcement learning

The entire system runs locally. Data never leaves the machine unless it's fulfilling an order or talking to an API.

---

## Two Non-Negotiable Business Rules

These override everything else:

| # | Rule | Why |
|---|---|---|
| 1 | **Every content idea must be approved by the business owner** (via SMS, Telegram, email, or in-app) **before** it reaches a creator. | The owner has final say on brand voice and compliance. |
| 2 | **All replies to influencers must have a subtle, randomized delay.** | Creators must never suspect they are talking to an AI. |

---

## Tech Stack

```
Application     → Next.js (App Router), TypeScript, Node.js 18+
Database        → PostgreSQL + pgvector
Task Queue      → BullMQ + Redis
Edge Gateway    → Cloudflare Workers
Tunnel          → Cloudflare Tunnels (cloudflared sidecar container)
DB Bridge       → Cloudflare Hyperdrive (connection pooling to local Postgres)
Policy Engine   → Open Policy Agent (OPA)
Observability   → LangSmith (wraps every LLM call)
Trend Scraping  → Apify Actors (residential proxies, browser automation)
Containers      → Docker + Docker Compose
```

### LLM Router

The app does **not** use a single model. A Dynamic LLM Router picks the best model for each task:

| Task Type | Model | Reason |
|---|---|---|
| Verifying regulatory compliance | **Claude 4.5 Haiku** | Lowest hallucination rate; acts as the "judge" model |
| Parsing long MHRA guidance docs (20K+ words) | **Gemini 3.0 (Deep Think)** | 1M–2M token context window |
| Writing affiliate outreach messages | **GPT-5.1 Instant** | Cheapest per token for routine text |

The router solves an optimization problem across three axes: predicted quality, token cost, and latency. Weights for cost vs. latency are configurable.

---

## Architecture

### Local-First, Zero-Trust

Everything sensitive stays on the local machine. The outside world connects through tightly controlled pipes:

```
TIKTOK NOTIFICATIONS (HTTP webhook):
  TikTok webhook → Cloudflare Edge (authenticates against shared secret)
      → Cloudflare Tunnel (outbound-only) → Local Next.js API route → PostgreSQL

AMAZON NOTIFICATIONS (SQS — NOT webhook):
  Amazon → SQS Queue (AWS) → BullMQ worker polls SQS → Local processing → PostgreSQL
```

No public IP. No open ports. No firewall rules. The `cloudflared` daemon runs as a sidecar container in Docker Compose.

Cloudflare Hyperdrive handles connection pooling when edge-side functions need to query the database.

### Docker Compose Services

```
┌─────────────────────┐
│  next-app            │  ← Next.js App Router (API routes + admin dashboard)
├─────────────────────┤
│  postgres            │  ← PostgreSQL + pgvector
├─────────────────────┤
│  redis               │  ← BullMQ task queue backend
├─────────────────────┤
│  cloudflared         │  ← Sidecar tunnel to Cloudflare edge
└─────────────────────┘
```

---

## Database Schema

PostgreSQL with `pgvector` extension. Four table groups:

### 1. `creators` — Creator Intelligence

```sql
handle              TEXT        -- TikTok handle
follower_count      INT
engagement_metrics  JSONB       -- likes, shares, comments, conversion rates
niche_tags          TEXT[]      -- e.g. {'supplements', 'fitness', 'wellness'}
```

### 2. `regulations` — Regulatory RAG Store

```sql
regulation_text     TEXT        -- Human-readable rule text
embedding_vector    VECTOR      -- Semantic embedding for retrieval
source_authority    TEXT        -- 'MHRA', 'ASA', 'CAP'
last_updated        TIMESTAMPTZ
```

### 3. `orders` — Transactions & Fulfillment

```sql
fulfillment_id      TEXT
tracking_num        TEXT
pii_data            JSONB       -- ⚠️ AUTO-REDACTED (see below)
status_webhook_log  JSONB
```

### 4. `profitability` — Financial Controls

```sql
commission_tier     NUMERIC
cogs                NUMERIC     -- Cost of goods sold
net_margin          NUMERIC
velocity_limit      NUMERIC     -- Max spend rate
```

### ⚠️ Mandatory: PII Auto-Deletion Trigger

Create a PostgreSQL trigger or scheduled job that does the following:

- **When:** An order reaches `DELIVERED` status **AND** 30 days have passed
- **Action:** Permanently scrub all PII (`name`, `address`, `phone`) from `pii_data`
- **Keep:** Anonymized geographic region and product data only (for analytics)
- **Legal basis:** UK GDPR Article 17 (Right to Erasure) and the storage limitation principle

This is not optional. It must exist before production.

---

## External APIs

### TikTok Affiliate Seller API

**Auth:** OAuth 2.0 with automatic token refresh and rotation.
**Scope:** `seller.creator_marketplace.read`

**Creator Discovery Filters (UK market):**
- Minimum 5,000 followers
- Maximum 3 account violations
- Search by: GMV, follower demographics, health/wellness sector performance
- Additional filters available: product category, content type, average video views, engagement rate, posting frequency, reliability with samples

**Two Collaboration Models:**

| | Open Collaboration | Target Collaboration |
|---|---|---|
| **Who sees it** | All eligible UK affiliates | Invited creators only |
| **Approval** | Auto-approve if engagement threshold met | Pre-approved by invitation |
| **Commission** | Flat or tiered across catalog (1%–80%) | Individually negotiated (higher) |
| **Samples** | Free (manual or auto-optimized) + Refundable | Free (manual or auto-approve) |

**⚠️ Commission precedence rule:** Target collaboration commission **always supersedes** Open collaboration commission. If a product is in both plans, the creator receives only the Target rate. Do not double-count.

**⚠️ Rate limit:** Maximum **1,000 target collaboration invitations per 24 hours.** The agent must enforce a daily counter and queue excess invitations.

**Sample types the agent must support:**
- **Free samples (manually managed)** — seller reviews and approves each request
- **Free samples (auto-optimized)** — platform matches qualified creators based on target ROI (Open Collaboration)
- **Free samples (auto-approve)** — automatically approve all requests (Target Collaboration)
- **Refundable samples** — creator buys first, gets refund upon conditions (Open Collaboration only)

**Sample Request Rule:** The agent **must** respond to sample requests within **72 hours** via the Manage Samples API. Approved requests trigger the Amazon fulfillment workflow.

**Messaging:** Content briefs are delivered via TikTok IM or target collaboration invitations. Note: programmatic IM may have limited API support — the agent should fall back to collaboration invitation messaging if IM endpoints are unavailable.

**⚠️ TikTok UK Platform Fees (as of Jan 2026):**
- **9% commission** on total order value (item price + buyer shipping + platform discounts) — standard rate for most categories (some sub-categories like Electronics/Beauty may be 5%)
- **£0.50 per order** "Shipped by Seller" fee (if NOT using Fulfilled by TikTok)
- **~20–30p payment processing fee** per transaction
- Refund administration fee: TikTok retains ~20% of original commission on refunds
- All fees invoiced by Perceiver Limited (UK entity) — include 20% UK VAT (reclaimable if VAT-registered)
- **New seller discount:** may be available for first 60 days (check Seller Centre)

This must be factored into the profitability formula. The 9% rate is the dominant cost — do not use the old 5% introductory rate.

---

### Amazon SP-API (Multi-Channel Fulfillment)

**Auth:** OAuth 2.0 with automatic token refresh.
**Roles required:**
- **Product Listing** — for FBA Inventory API (`getInventorySummaries`)
- **Fulfillment** — for Fulfillment Outbound API (all MCF operations)

**UK Marketplace:** ID `A1F83G8C2ARO7P`, endpoint `https://sellingpartnerapi-eu.amazon.com`

**⚠️ Two separate APIs involved:**
- **FBA Inventory API v1** (`/fba/inventory/v1/summaries`) — inventory checks
- **Fulfillment Outbound API v2020-07-01** (`/fba/outbound/2020-07-01/`) — order lifecycle

**Rate limits:** All operations 2 req/sec, burst 30. Must implement a rate limiter.

**Fulfillment sequence — execute in this exact order:**

```
1. getInventorySummaries       → [FBA Inventory API] Is the SKU in stock? (requires granularityType=Marketplace, granularityId=UK marketplace ID)
2. getFulfillmentPreview       → [Fulfillment Outbound] Delivery dates, shipping options, eligibility
3. createFulfillmentOrder      → Place order with fulfillmentAction="Hold", fulfillmentPolicy="FillOrKill"
4. [Configurable hold window — cancelFulfillmentOrder if cancelled during this period]
5. updateFulfillmentOrder      → Transition fulfillmentAction from "Hold" → "Ship"
6. [SQS: consume FULFILLMENT_ORDER_STATUS notifications — see Notifications below]
7. getFulfillmentOrder         → Poll for status + retrieve packageNumber(s) from response
8. getPackageTrackingDetails   → Get tracking via packageNumber (int32) → send to creator
```

**Additional MCF operations the wrapper must support:**
- `cancelFulfillmentOrder` — cancel during hold window or by admin
- `getFulfillmentOrder` — poll status, retrieve package numbers
- `listAllFulfillmentOrders` — reconciliation and order listing
- `createFulfillmentReturn` + `listReturnReasonCodes` — process returns within the returns window

**⚠️ Amazon notifications use SQS, NOT HTTP webhooks:**
Amazon does not call your URL directly. You must:
1. Create an SQS queue in AWS
2. Grant Amazon SP-API write permission (IAM principal `arn:aws:iam::437568002678:root`)
3. Call `createDestination` (Notifications API) to register the SQS queue
4. Call `createSubscription` with notificationType `FULFILLMENT_ORDER_STATUS`
5. Poll/consume from SQS via a BullMQ worker

```
TikTok notifications:  TikTok → Cloudflare Edge → Tunnel → Local API route  (HTTP webhook ✓)
Amazon notifications:  Amazon → SQS Queue (AWS) → BullMQ worker polls SQS → Local processing  (SQS consumer ✓)
```

---

### Apify (TikTok Trend Scraping)

Scrapes public TikTok data using residential proxies and browser automation (stealth mode — TikTok has aggressive anti-bot detection).

**Four data streams:**

| Stream | Key Fields | Use |
|---|---|---|
| Hashtags | rank, region, industry_tag, view_count | Spot breakout topics for product placement |
| Music/Sounds | is_business_approved, growth_rate, usage_count | Recommend safe trending audio |
| Viral Videos | likes, shares, comments, transcript_summary | Analyze hooks and visual styles |
| Creator Stats | follower_count, avg_engagement, bio_keywords | Discover rising stars |

**Alert system:** When engagement exceeds the "super viral" threshold, fire an instant alert to Slack and/or email.

---

## Regulatory Compliance Engine

This is the most legally sensitive part of the system. Get it wrong and the company faces MHRA/ASA enforcement action.

### Knowledge Base

Vectorize and store these in the `regulations` table:

1. **GB Nutrition and Health Claims (GB NHC) Register** — the complete list of authorized health claims
2. **CAP Code Section 15** — advertising rules for food, supplements, health/nutrition claims
3. **ASA supplementary guidance** on health claims in supplement ads

### Rules the Agent Must Enforce

| Rule | What It Means | Example |
|---|---|---|
| **15.1.1** | Only claims from the GB NHC Register are allowed | "Supports immune function" ✅ only if it's in the register |
| **15.2** | A General Health Claim must be **immediately followed** by an authorized Specific Health Claim | "Supports overall good health" → must add "Vitamin D contributes to the normal function of the immune system" |
| **15.6.2** | Never claim a supplement can prevent, treat, or cure disease | "Cures colds" ❌ |
| **15.6.4** | No references to bodily functions that exploit fear | "Without this, your bones will deteriorate" ❌ |
| **15.6.6** | No claims about a specific rate or amount of weight loss | "Lose 5kg in 2 weeks" ❌ |

### Banned Words (in medicinal context)

The agent must **never** generate content containing: **"cure," "treat," "prevent"** when referring to human disease.

### How RAG Works at Runtime

```
Creator asks about Vitamin D
        ↓
Agent retrieves relevant chunks from `regulations` table (semantic search)
        ↓
Agent drafts response using only authorized claims from retrieved chunks
        ↓
Judge model (Claude 4.5 Haiku) evaluates the draft:
   ✓ Faithfulness — claim stays within authorized bounds?
   ✓ Prohibited terms — contains "cure"/"treat"/"prevent"?
   ✓ Accuracy — dosage matches register conditions? (e.g., 3g creatine)
        ↓
Confidence score assigned
        ↓
≥ 95%  →  Send (with random delay)
< 95%  →  Route to human review queue
```

All verification steps are logged in LangSmith for audit.

---

## Confidence Routing & Human-in-the-Loop

- Every agent output gets a **confidence score** (0–100%).
- **≥ 95%** → action proceeds automatically.
- **< 95%** → action is **paused** and placed in a manual review queue for human decision.
- Subjective rules (like detecting "fear-based" language under Rule 15.6.4) will frequently trigger human review. This is expected and correct.

The HITL dashboard is the admin UI where the business owner reviews and approves/rejects flagged outputs.

---

## Financial Circuit Breakers

Autonomous agents can burn money fast. The Profitability Engine prevents this via OPA-enforced policies:

| Guard | Trigger | Action |
|---|---|---|
| **Velocity monitor** | LLM API costs exceed **£50 in 10 minutes** | Halt all agent activity |
| **Commission cap** | Calculated commission would push net margin below required threshold | Block the collaboration |
| **Loop detector** | Agent makes the same API call repeatedly without progress | Auto-terminate the process |

**Commission cap formula:** Max commission = Sale price − COGS − Amazon MCF fees − TikTok platform fees (9% commission + £0.50 self-ship + payment processing) − required net margin. This is calculated dynamically per product.

---

## Sales Optimization

The agent runs continuous A/B tests on:

- **Commission tiers** — does 15% attract better creators than 10%?
- **Pitch messages** — which templates get the highest acceptance rate for Target Collaborations?
- **Sample approval thresholds** — where's the sweet spot between brand exposure and wasted samples?

Results feed a reinforcement learning loop. Over time the agent learns which creator attributes (follower growth rate, comment sentiment, etc.) best predict conversions for Andinn Organics' specific products.

---

## Content Ideation Pipeline

When the trend module spots an opportunity, the LLM synthesizes a content brief in four steps:

```
1. TREND MATCH       →  Find a relevant viral hook ("Day in the Life", "Morning Routine")
2. PRODUCT ALIGNMENT →  Map the hook to an Andinn Organics product
3. REGULATORY CHECK  →  Insert mandatory SHCs, strip any medicinal claims
4. CREATIVE GUARDS   →  Suggest transitions, approved hashtags, trending audio
```

**Output:** A ready-to-shoot content brief.

**Delivery:** Via TikTok IM or target collaboration invitation.

**Approval gate:** The brief goes to the business owner first. It does not reach the creator until approved. (See Non-Negotiable Rule #1.)

---

## UK GDPR Compliance

### Data Protection by Design (Article 25)

- Map every PII data flow before building it.
- Collect only what's strictly necessary for fulfillment.

### PII Lifecycle

```
COLLECT   →  Name, address, phone (from TikTok/Amazon) for fulfillment
PROCESS   →  Create Amazon MCF order
RETAIN    →  30 days post-delivery (returns/disputes window)
DELETE    →  PostgreSQL trigger scrubs PII; keeps anonymized geo + product data
```

### Manual Erasure

In addition to automatic deletion, implement an API endpoint for manual Right to Erasure requests (Article 17).

---

## Observability

Every LLM call is wrapped with the LangSmith SDK (both OpenAI and Anthropic clients). This captures:

- **Inputs and outputs** of every call
- **Metadata** (model used, token count, latency, cost)
- **Full chain-of-thought** and tool invocations

Use this for:
- **Failure analysis** — why did the agent fail to find a creator? Why was an MCF order rejected?
- **Cost tracking** — token usage and spend per session, per model
- **Compliance feedback loops** — human experts grade agent outputs to refine prompts over time

---

## Code Conventions

- **TypeScript everywhere.** No JavaScript files.
- **Next.js App Router only.** Not Pages Router.
- **API routes** handle agent orchestration. **Server components** power the admin dashboard.
- **Every LLM call** must be wrapped with LangSmith. No exceptions.
- **PII never leaves the local environment** unless it's going to Amazon for fulfillment.
- **Every marketing output** passes the RAG compliance check before it can be sent.
- **Random delays on all influencer-facing messages.** Implement at the message-sending layer so it can't be bypassed.
- **Content approval gate** at the brief-delivery step. The owner approves before the creator sees anything.


---

# ═══════════════════════════════════════════════════════════════
# PART 2 — BUILD SECTIONS
# ═══════════════════════════════════════════════════════════════

Eight sections. Execute in order. Each contains a `📋 PROMPT` (your session briefing) followed by `☐ TASKS` (your checklist).

---

## SECTION 1 — Infrastructure & Project Scaffolding
`[✓] DONE`

<!-- ═══════════════════ 📋 PROMPT ═══════════════════ -->

> **📋 PROMPT — Claude Code reads this as its session briefing:**
>
> You are building Section 1: Infrastructure. Build the project from zero. Scaffold Next.js App Router with TypeScript strict mode targeting Node.js 18+. Create `docker-compose.yml` with exactly four services: `next-app`, `postgres` (pgvector), `redis`, `cloudflared`. Write the PostgreSQL init script creating all four table groups (`creators`, `regulations`, `orders`, `profitability`) with the exact column types from the Architecture Spec above — do not improvise columns. Implement the PII auto-deletion trigger: scrub `pii_data` when status = `DELIVERED` AND 30 days elapsed, keep anonymized geo + product data (this is a UK GDPR Article 17 legal requirement — it is not optional). Configure the `cloudflared` sidecar as an outbound-only tunnel and document Hyperdrive setup. Set up BullMQ with Redis and five base queue types. Add all dev tooling scripts.
>
> **Done when:** `docker compose up -d` boots all four services, Next.js serves on localhost, PostgreSQL has pgvector enabled with all four tables matching the schema spec, Redis responds to BullMQ health checks, and the PII trigger is tested.
>
> Mark each task `[✓]` as you complete it. When all tasks are done, change this section to `[✓] DONE`, move `[→] CURRENT_TASK` to Section 2, and commit.

<!-- ═══════════════════ ☐ TASKS ═══════════════════ -->

- [✓] **1.1 — Scaffold Next.js project**
  Initialise a Next.js project using the **App Router** (not Pages Router). TypeScript in **strict mode**. Target **Node.js 18+**. The codebase must be 100% TypeScript — no `.js` files anywhere except config files that require it.

- [✓] **1.2 — Create `docker-compose.yml` with exactly four services**
  ```
  next-app     → Next.js App Router (API routes + admin dashboard)
  postgres     → PostgreSQL with pgvector extension
  redis        → BullMQ task queue backend
  cloudflared  → Sidecar tunnel to Cloudflare edge (outbound-only connection)
  ```
  All four services must be properly networked and isolated. The `cloudflared` container must be configured as a sidecar establishing an **outbound-only** connection to the Cloudflare edge. No public IP, no open ports, no firewall rules exposed.

- [✓] **1.3 — Write PostgreSQL init script with all four table groups**
  Enable the `pgvector` extension. Create all four tables with the **exact column types** from the Architecture Spec:

  **`creators`** — Creator Intelligence:
  ```sql
  handle              TEXT
  follower_count      INT
  engagement_metrics  JSONB       -- likes, shares, comments, conversion rates
  niche_tags          TEXT[]      -- e.g. {'supplements', 'fitness', 'wellness'}
  ```

  **`regulations`** — Regulatory RAG Store:
  ```sql
  regulation_text     TEXT
  embedding_vector    VECTOR
  source_authority    TEXT        -- 'MHRA', 'ASA', 'CAP'
  last_updated        TIMESTAMPTZ
  ```

  **`orders`** — Transactions & Fulfillment:
  ```sql
  fulfillment_id      TEXT
  tracking_num        TEXT
  pii_data            JSONB       -- ⚠️ AUTO-REDACTED by trigger (task 1.4)
  status_webhook_log  JSONB
  ```

  **`profitability`** — Financial Controls:
  ```sql
  commission_tier     NUMERIC
  cogs                NUMERIC     -- Cost of goods sold
  net_margin          NUMERIC
  velocity_limit      NUMERIC     -- Max spend rate
  ```

  Add appropriate primary keys, indexes, and created_at/updated_at timestamps to every table.

- [✓] **1.4 — Implement the PII auto-deletion trigger**
  This is a **UK GDPR Article 17** legal requirement. It is not optional.

  Create a PostgreSQL trigger OR `pg_cron` scheduled job that:
  - **Fires when:** an order's status = `DELIVERED` **AND** 30 calendar days have elapsed since delivery
  - **Action:** permanently scrub all PII fields (`name`, `address`, `phone`) from the `pii_data` JSONB column
  - **Preserves:** anonymized geographic region and product data only (for business analytics)
  - **Legal basis:** UK GDPR Article 17 (Right to Erasure) + storage limitation principle

  Write a test that inserts an order, marks it delivered, advances time 30+ days, and verifies PII is scrubbed but geo/product data remains.

- [✓] **1.5 — Configure Cloudflare Tunnel and document Hyperdrive setup**
  The `cloudflared` sidecar must establish an outbound-only connection to the Cloudflare edge. The full zero-trust inbound flow is:
  ```
  TikTok webhook (HTTP):
    TikTok → Cloudflare Edge (authenticates against shared secret)
        → Cloudflare Tunnel (outbound-only) → Local Next.js API route → PostgreSQL

  Amazon notifications (SQS — NOT HTTP):
    Amazon → SQS Queue (AWS) → BullMQ worker polls SQS → Local processing → PostgreSQL
  ```
  Create `docs/cloudflare-setup.md` documenting:
  - How to register the tunnel with Cloudflare
  - How to configure shared secrets for webhook authentication
  - How to set up **Cloudflare Hyperdrive** for connection pooling / TCP bridge from edge-side functions to local PostgreSQL

- [✓] **1.6 — Set up BullMQ with Redis**
  Create a queue manager module. Define base job types for the system's async workloads:
  - `creator-discovery` — periodic creator search jobs
  - `fulfillment` — MCF order processing
  - `sqs-consumer` — poll Amazon SQS for FULFILLMENT_ORDER_STATUS notifications
  - `trend-ingestion` — Apify data pulls
  - `content-brief` — LLM content synthesis
  - `compliance-check` — RAG verification jobs
  Add a health-check worker that confirms Redis connectivity and queue responsiveness.

- [✓] **1.7 — Dev tooling and scripts**
  Configure `package.json` scripts matching the Development Commands in the Architecture Spec:
  ```bash
  npm run dev        # Next.js dev server
  npm run build      # Production build
  npm run lint       # ESLint
  npm test           # Jest
  npx tsc --noEmit   # Type-check
  ```
  Set up ESLint (with TypeScript rules), Prettier, and Jest. Note the Python venv at `.venv/` (Python 3.12.8 via pyenv) — do not remove it.

- [✓] **1.8 — Smoke test the full stack**
  Verify end-to-end:
  - `docker compose up -d` boots all four services without errors
  - Next.js serves on `localhost` and responds to HTTP requests
  - PostgreSQL accepts connections, `pgvector` extension is enabled, all four tables exist with correct columns
  - Redis accepts connections, BullMQ can enqueue and dequeue a test job
  - `cloudflared` container starts and establishes tunnel (or logs clear instructions if credentials not yet configured)

---

## SECTION 2 — OAuth Flows & Typed API Clients
`[✓] DONE`

<!-- ═══════════════════ 📋 PROMPT ═══════════════════ -->

> **📋 PROMPT — Claude Code reads this as its session briefing:**
>
> You are building Section 2: API Integration. Build OAuth 2.0 clients for both TikTok (with token rotation handling) and Amazon SP-API (with LWA). Tokens must be stored **encrypted** in PostgreSQL — never plaintext. Both must auto-refresh before expiry.
>
> Build typed TypeScript API wrappers covering every method referenced in the Architecture Spec:
> - **TikTok:** creator search (5K+ followers, ≤3 violations, GMV, demographics, health/wellness), Open Collaboration (enroll, monitor, auto-approve, flat/tiered commission 1–80%, free/refundable samples), Target Collaboration (invite, custom commission, free/auto-approve samples, max 1000 invites/day), Sample Management (72-hour window enforcement), IM messaging (with fallback to collaboration invitation messaging)
> - **Amazon SP-API:** the corrected **8-step MCF sequence** using two separate API clients — FBA Inventory API (`getInventorySummaries`) + Fulfillment Outbound API (`getFulfillmentPreview`, `createFulfillmentOrder` with Hold/FillOrKill, `cancelFulfillmentOrder`, `updateFulfillmentOrder`, `getFulfillmentOrder`, `getPackageTrackingDetails`) + returns support (`createFulfillmentReturn`, `listReturnReasonCodes`)
>
> Build a TikTok webhook receiver route with shared secret validation. Build an **Amazon SQS consumer** (NOT webhook — Amazon delivers notifications via SQS, not HTTP). Implement a token-bucket rate limiter for SP-API calls. Write integration tests with mocked responses covering every flow.
>
> **Done when:** Both OAuth flows obtain and refresh tokens, every API method has a typed wrapper, TikTok webhook route rejects unsigned requests, Amazon SQS consumer processes FULFILLMENT_ORDER_STATUS messages, rate limiter enforces 2 req/sec, and all integration tests pass.
>
> Mark each task `[✓]` as you complete it. When all tasks are done, change this section to `[✓] DONE`, move `[→] CURRENT_TASK` to Section 3, and commit.

<!-- ═══════════════════ ☐ TASKS ═══════════════════ -->

- [✓] **2.1 — TikTok OAuth 2.0 client**
  Implement the full authorization flow for the TikTok Affiliate Seller API:
  - OAuth 2.0 authorization code flow
  - Token storage: **encrypted** in PostgreSQL (never plaintext)
  - **Automatic token refresh** before expiry
  - **Token rotation** handling (TikTok rotates refresh tokens)
  - Requested scope: `seller.creator_marketplace.read`

- [✓] **2.2 — Amazon SP-API OAuth 2.0 client**
  Implement the full authorization flow for Amazon Selling Partner API:
  - OAuth 2.0 with LWA (Login with Amazon)
  - Token storage: **encrypted** in PostgreSQL
  - **Automatic token refresh** before expiry
  - Requested roles: **Product Listing** (for FBA Inventory API), **Fulfillment** (for Fulfillment Outbound API)
  - UK Marketplace ID: `A1F83G8C2ARO7P`, EU endpoint: `https://sellingpartnerapi-eu.amazon.com`

- [✓] **2.3 — Typed TikTok API wrapper**
  Create a fully typed TypeScript client covering every TikTok API surface referenced in the Architecture Spec:
  - **Creator search** — query Creator Marketplace with filters: UK market, minimum 5,000 followers, maximum 3 account violations, search by GMV, follower demographics, health/wellness sector performance, product category, content type, avg video views, engagement rate, posting frequency, sample reliability
  - **Open Collaboration management** — enroll products in Open Plan, monitor sample requests, auto-approve above engagement threshold, flat/tiered/auto-optimized commission (1%–80%), free samples (manual or auto-optimized) + refundable samples
  - **Target Collaboration management** — invite specific creators (max 1,000/day — enforce counter), set individually negotiated higher commission rates (supersedes Open rate), free samples (manual or auto-approve), pre-approved by invitation
  - **Sample management** — review, approve, reject sample requests within the **72-hour mandatory window** via the Manage Samples API; support all sample types (free manual, free auto-optimized, free auto-approve, refundable)
  - **IM messaging** — send content briefs to creators via TikTok's Instant Messaging tool; **implement fallback** to collaboration invitation messaging if IM API endpoints are unavailable or rate-limited

- [✓] **2.4 — Typed Amazon SP-API wrappers (two separate clients)**
  Build **two** typed TypeScript clients for the two separate Amazon APIs:

  **FBA Inventory API v1 client** (requires Product Listing role):
  - `getInventorySummaries` — `/fba/inventory/v1/summaries` — requires `granularityType=Marketplace`, `granularityId=A1F83G8C2ARO7P` (UK), `marketplaceIds`

  **Fulfillment Outbound API v2020-07-01 client** (requires Fulfillment role) — the corrected **8-step MCF sequence**:
  ```
  1. [FBA Inventory] getInventorySummaries  → Check SKU availability
  2. getFulfillmentPreview                  → Delivery dates, shipping options, eligibility
  3. createFulfillmentOrder                 → fulfillmentAction="Hold", fulfillmentPolicy="FillOrKill"
  4. [Hold window — cancelFulfillmentOrder if cancelled]
  5. updateFulfillmentOrder                 → Transition "Hold" → "Ship"
  6. [SQS: consume FULFILLMENT_ORDER_STATUS notifications]
  7. getFulfillmentOrder                    → Poll status + get packageNumber(s)
  8. getPackageTrackingDetails              → Tracking via packageNumber (int32)
  ```

  **Additional operations that must be typed:**
  - `cancelFulfillmentOrder` — cancel during hold window or by admin
  - `listAllFulfillmentOrders` — reconciliation and order listing
  - `createFulfillmentReturn` + `listReturnReasonCodes` — process creator returns

  **Rate limiter:** All Fulfillment Outbound operations are **2 req/sec, burst 30**. FBA Inventory is **2 req/sec, burst 2**. Implement a token-bucket rate limiter in the client layer to prevent 429 errors.

- [✓] **2.5 — TikTok webhook route + Amazon SQS consumer**
  Build two notification handlers — one HTTP webhook, one SQS consumer:

  **TikTok webhook handler (HTTP):**
  - Next.js API route — terminates traffic arriving via Cloudflare Edge → Tunnel
  - Validates the request against the **shared secret** configured in Cloudflare
  - Parses the payload and logs to the relevant database table
  - Rejects unauthenticated requests with appropriate error codes

  **Amazon `FULFILLMENT_ORDER_STATUS` SQS consumer (NOT a webhook):**
  Amazon delivers notifications via **SQS**, not HTTP. Build a BullMQ worker that:
  - Polls an AWS SQS queue for `FULFILLMENT_ORDER_STATUS` messages
  - Setup: `createDestination` (SQS ARN) → `createSubscription` (notificationType)
  - IAM: grant SP-API write permission (`arn:aws:iam::437568002678:root`)
  - Parses fulfillment status payloads from SQS messages
  - Updates the `orders` table: writes to `status_webhook_log` JSONB column
  - Extracts tracking info when `getFulfillmentOrder` returns packageNumber(s)
  - Deletes processed SQS messages

- [✓] **2.6 — Integration tests with mocked API responses**
  Write tests for:
  - TikTok OAuth flow: token acquisition, refresh, rotation
  - Amazon OAuth flow: token acquisition, refresh
  - TikTok creator search with filter assertions (5K followers, ≤3 violations, etc.)
  - TikTok sample approval within 72-hour window
  - Amazon MCF 8-step sequence: mock each step, verify order flows through in exact sequence (including `getFulfillmentOrder` for packageNumber retrieval)
  - Rate limiter: verify 429 prevention at 2 req/sec
  - TikTok webhook handler: valid payload accepted, invalid/unsigned payload rejected
  - Amazon SQS consumer: processes valid FULFILLMENT_ORDER_STATUS messages, deletes after processing

---

## SECTION 3 — Regulatory RAG Engine
`[✓] DONE`

<!-- ═══════════════════ 📋 PROMPT ═══════════════════ -->

> **📋 PROMPT — Claude Code reads this as its session briefing:**
>
> You are building Section 3: Regulatory RAG. This is the most legally critical section of the entire system.
>
> Build: (1) Scrapers for three knowledge bases — GB NHC Register, CAP Code Section 15, ASA supplementary guidance. Each chunk retains `source_authority` and rule number. (2) Embedding pipeline: chunk → embed → upsert into `regulations` table. (3) RAG retrieval: semantic search via pgvector, return top-k chunks with scores. (4) Judge model (Claude 4.5 Haiku) with 3-point rubric: Faithfulness, Prohibited Terms ("cure"/"treat"/"prevent"), Dosage Accuracy. (5) Five specific CAP Code rule checks: 15.1.1, 15.2, 15.6.2, 15.6.4, 15.6.6 — each with explicit enforcement logic. (6) Confidence scoring: ≥95% auto-send, <95% human review queue. (7) LangSmith tracing on ALL LLM calls. (8) Test suite with known-good and known-bad claims.
>
> **Done when:** Known-good claims pass with ≥95% confidence, known-bad claims fail with <95% and route to review queue, all five CAP rules are enforced, and every LLM call is LangSmith-traced.
>
> Mark each task `[✓]` as you complete it. When all tasks are done, change this section to `[✓] DONE`, move `[→] CURRENT_TASK` to Section 4, and commit.

<!-- ═══════════════════ ☐ TASKS ═══════════════════ -->

- [✓] **3.1 — Scrape and parse the three regulatory knowledge bases**
  Build scrapers/parsers for each source. Output: cleaned text chunks with metadata.
  1. **GB Nutrition and Health Claims (GB NHC) Register** — the complete list of authorized health claims
  2. **CAP Code Section 15** — advertising rules for food, supplements, and health/nutrition claims
  3. **ASA supplementary guidance** — additional advice on health claims in supplement ads

  Each chunk must retain: `source_authority` ('MHRA', 'ASA', or 'CAP'), specific rule/section number, and the date the source was last accessed.

- [✓] **3.2 — Build the embedding pipeline**
  Pipeline: raw text chunks → generate semantic embeddings → upsert into the `regulations` table.
  Each row contains:
  ```sql
  regulation_text     TEXT          -- the chunk
  embedding_vector    VECTOR        -- semantic embedding
  source_authority    TEXT          -- 'MHRA', 'ASA', 'CAP'
  last_updated        TIMESTAMPTZ   -- when the source was last scraped
  ```
  Choose an embedding model appropriate for regulatory/legal text. Document the model choice and dimensions.

- [✓] **3.3 — Build the RAG retrieval function**
  Input: a query string (e.g., "Can I say Vitamin D boosts immunity?").
  Process: semantic search against `embedding_vector` in the `regulations` table using pgvector similarity operators.
  Output: top-k relevant regulation chunks with similarity scores, source authority, and rule numbers.

- [✓] **3.4 — Implement the Judge model (Claude 4.5 Haiku)**
  Build a secondary verification layer using **Claude 4.5 Haiku** as the judge model. The judge evaluates the primary model's output against retrieved regulatory chunks using a **structured 3-point rubric**:

  1. **Faithfulness** — Does the generated claim stay within the bounds of the authorized health claim? Any claim not in the GB NHC Register = failure.
  2. **Prohibited Terms** — Does the output contain **"cure," "treat," or "prevent"** in a medicinal context? Any occurrence = failure.
  3. **Dosage Accuracy** — If a dosage is mentioned (e.g., "3g of creatine"), is it consistent with the register's conditions of use? Inaccurate dosage = failure.

  The judge returns: pass/fail per rubric point + reasoning.

- [✓] **3.5 — Implement the five CAP Code rules as enforceable checks**
  Hardcode detection for each rule:

  | Rule | Enforcement logic |
  |---|---|
  | **15.1.1** | Cross-reference every health claim against the GB NHC Register. Reject any claim not in the register. |
  | **15.2** | If a General Health Claim (GHC) is detected, verify it is **immediately followed** by an authorized Specific Health Claim (SHC). Reject orphaned GHCs. |
  | **15.6.2** | Scan for any language claiming a supplement can prevent, treat, or cure human disease. Zero tolerance. |
  | **15.6.4** | Detect references to bodily functions that could exploit fear. This is subjective — flag for human review when uncertain. |
  | **15.6.6** | Reject any claim about a specific rate or amount of weight loss. |

- [✓] **3.6 — Implement confidence scoring and routing**
  Combine judge rubric + rule-specific checks into a single **confidence score (0–100%)**:
  - **≥ 95%** → action proceeds automatically (sent with randomized delay per Non-Negotiable Rule #2)
  - **< 95%** → action **paused**, placed in **manual review queue**
  - Subjective rules like 15.6.4 should conservatively produce lower scores. Frequent human review for these is expected.

- [✓] **3.7 — Wire up LangSmith tracing for all LLM calls**
  Wrap **both** the primary LLM client and the Claude 4.5 Haiku judge with the **LangSmith SDK**. Every call captures:
  - Inputs (prompt, retrieved context)
  - Outputs (generated text, judge verdict)
  - Metadata (model, tokens, latency, cost)
  - Full chain-of-thought and tool invocations

- [✓] **3.8 — Write compliance tests**
  Test suite with known claims:
  - ✅ "Vitamin D contributes to the normal function of the immune system" → pass (authorized SHC)
  - ❌ "This supplement cures colds" → fail (Rule 15.6.2, banned word "cures")
  - ❌ "Supports overall good health" (alone) → fail (Rule 15.2, orphaned GHC)
  - ❌ "Lose 5kg in 2 weeks with our fat burner" → fail (Rule 15.6.6)
  - ❌ "Without this vitamin, your bones will deteriorate" → flag for human review (Rule 15.6.4)
  - ❌ "Take 10g of creatine daily" → fail (dosage accuracy, register says 3g)
  Verify routing: passing claims ≥95%, failing claims <95% → review queue.

---

## SECTION 4 — Creator Discovery & Collaboration Management
`[✓] DONE`

<!-- ═══════════════════ 📋 PROMPT ═══════════════════ -->

> **📋 PROMPT — Claude Code reads this as its session briefing:**
>
> You are building Section 4: Creator Discovery & Collaboration. Build the TikTok creator pipeline: discovery service with all UK filters (5K+ followers, ≤3 violations, health/wellness, product category, engagement rate, sample reliability), match-making engine scoring creators against the product catalog, Open Collaboration flow (visible to all, auto-approve high-engagement, flat/tiered/auto-optimized commission 1–80%, free + refundable samples), Target Collaboration flow (invite-only max 1000/day, custom higher commissions that supersede Open rates, free samples with auto-approve), sample request handler enforcing the 72-hour window with all four sample types.
>
> **CRITICAL:** Build the randomized reply delay layer. This is Non-Negotiable Rule #2. ALL influencer-facing messages — IM, invitations, approvals, rejections, brief deliveries — must pass through a non-bypassable delay middleware with configurable min/max jitter. Implement at the message-sending layer so no calling code can skip it.
>
> Stub the Amazon MCF call (Section 5 completes it). Write tests for every flow.
>
> **Done when:** Discovery returns UK creators matching all filters, match-making ranks creator-product pairs, both collaboration models work, sample requests are monitored for the 72-hour deadline, and the delay layer provably wraps every outbound influencer message.
>
> Mark each task `[✓]` as you complete it. When all tasks are done, change this section to `[✓] DONE`, move `[→] CURRENT_TASK` to Section 5, and commit.

<!-- ═══════════════════ ☐ TASKS ═══════════════════ -->

- [✓] **4.1 — Build the creator discovery service**
  Search the TikTok Creator Marketplace using the typed API client from 2.3. Apply **all** UK market filters from the Architecture Spec:
  - Minimum **5,000 followers**
  - Maximum **3 account violations**
  - Searchable by: **GMV**, **follower demographics**, **health/wellness sector performance**
  - Additional filters: **product category**, **content type**, **average video views**, **engagement rate**, **posting frequency**, **reliability with samples**
  Store in `creators` table: `handle`, `follower_count`, `engagement_metrics` (JSONB), `niche_tags` (TEXT[]).

- [✓] **4.2 — Build the match-making engine**
  Score each discovered creator against the product catalog:
  - Follower demographic overlap with product target audience
  - Engagement metrics (likes, shares, comments, conversion rates from JSONB)
  - Niche alignment via `niche_tags`
  Output: ranked creator-product pairs with match scores stored in the database.

- [✓] **4.3 — Implement Open Collaboration flow**
  - **Visibility:** Products enrolled in "Open Plan" visible to **all eligible UK creators**
  - **Commission:** Flat or tiered rate across catalog (1%–80%, or auto-optimized based on top 30% performing products)
  - **Samples:** Free (manually managed or auto-optimized by ROI) + Refundable (creator buys, refunded upon conditions)
  - **Approval:** Auto-approve sample requests from creators above high-engagement threshold. Manual for others.
  - **⚠️ Commission precedence:** Target commission always supersedes Open — do not double-count.

- [✓] **4.4 — Implement Target Collaboration flow**
  - **Visibility:** Invited creators only — agent proactively selects and invites high-value creators
  - **Commission:** Individually negotiated, **higher** rates (1%–80%, supersedes Open rate)
  - **Samples:** Free (manually managed or auto-approve requests)
  - **Approval:** Pre-approved by invitation
  - **⚠️ Rate limit:** Maximum **1,000 invitations per 24 hours** — implement daily counter and queue excess
  Use match-making scores to select invitees.

- [✓] **4.5 — Build the sample request handler with 72-hour enforcement**
  The agent **must** respond within **72 hours** via the Manage Samples API.
  - Approved → trigger Amazon MCF (stub for now, Section 5 wires it)
  - Rejected → log reason, notify creator
  - BullMQ scheduled job monitors pending requests and escalates any approaching the 72-hour deadline

- [✓] **4.6 — Implement the randomized reply delay layer**
  **Non-Negotiable Rule #2.** Build message-sending middleware that:
  - Intercepts **ALL** outbound influencer-facing messages (IM, invitations, approvals, rejections, brief deliveries)
  - Applies a **subtle, randomized delay** with configurable min/max jitter (e.g., 30s–5min, tunable)
  - Is at the **message-sending layer** — **cannot be bypassed** by any calling code
  - Logs the actual delay applied per message (for debugging only)

- [✓] **4.7 — Write tests**
  - Discovery: UK filters applied correctly
  - Match-making: sensible rankings for known pairs
  - Open Collaboration: auto-approval triggers above threshold
  - Target Collaboration: invitation with custom commission
  - Sample handler: 72-hour deadline monitoring and escalation
  - Delay layer: every message type delayed, delay within min/max, layer cannot be circumvented

---

## SECTION 5 — Amazon MCF Fulfillment Orchestration
`[✓] DONE`

<!-- ═══════════════════ 📋 PROMPT ═══════════════════ -->

> **📋 PROMPT — Claude Code reads this as its session briefing:**
>
> You are building Section 5: Amazon MCF Fulfillment. Build the orchestrator executing the corrected **8-step SP-API sequence**: `getInventorySummaries` (FBA Inventory API) → `getFulfillmentPreview` → `createFulfillmentOrder` (on hold, FillOrKill) → [hold window with `cancelFulfillmentOrder` option] → `updateFulfillmentOrder` (hold → ship) → [SQS consumer processes FULFILLMENT_ORDER_STATUS] → `getFulfillmentOrder` (retrieve packageNumber) → `getPackageTrackingDetails` → notify creator through the delay layer.
>
> Wire Section 4's sample approval into this orchestrator (replace the stub). Build the SQS message processor updating `orders` table and `status_webhook_log`. Implement hold/ship with configurable cancellation window via BullMQ delayed job. Note: `cancelFulfillmentOrder` can only be called when order is in 'Received' or 'Planning' status.
>
> Handle every failure case explicitly — inventory unavailable, address ineligible, order rejected, SQS message timeout, tracking unavailable, cancellation after ship. Each error logs to **LangSmith** AND alerts admin dashboard.
>
> **Done when:** A mocked sample approval triggers the full 8-step sequence, SQS messages update the DB, tracking is delivered to the creator through the delay layer, and all failure paths are handled.
>
> Mark each task `[✓]` as you complete it. When all tasks are done, change this section to `[✓] DONE`, move `[→] CURRENT_TASK` to Section 6, and commit.

<!-- ═══════════════════ ☐ TASKS ═══════════════════ -->

- [✓] **5.1 — Build the fulfillment orchestrator**
  Execute the corrected **8-step sequence** in exact order:
  ```
  1. getInventorySummaries       → [FBA Inventory API] Verify SKU in stock (granularityType=Marketplace)
  2. getFulfillmentPreview       → Delivery dates, shipping options, eligibility
  3. createFulfillmentOrder      → Place on "hold" with fulfillmentPolicy="FillOrKill"
  4. [Configurable hold window — cancelFulfillmentOrder if cancelled (only when status is Received/Planning)]
  5. updateFulfillmentOrder      → Transition "hold" → "ship" after cancellation window
  6. [SQS: consume FULFILLMENT_ORDER_STATUS notifications — already configured in 2.5]
  7. getFulfillmentOrder         → Poll status + retrieve packageNumber(s) from response
  8. getPackageTrackingDetails   → Tracking via packageNumber (int32) → send to creator
  ```
  Each step verifies success before proceeding. Failure at any step halts the sequence.
  Respect rate limits: 2 req/sec, burst 30 (use rate limiter from 2.4).

- [✓] **5.2 — Wire sample approval into the fulfillment orchestrator**
  Replace the stub from 4.5:
  - TikTok sample approved → invoke **8-step MCF orchestrator** with creator's address, SKU, quantity
  - Affiliate sale recorded → also trigger MCF workflow

- [✓] **5.3 — Build the SQS message processor**
  Process `FULFILLMENT_ORDER_STATUS` messages from the SQS consumer (2.5):
  - Parse status from Amazon SQS message payload
  - Update `orders` table: `status_webhook_log` JSONB, `tracking_num` when available
  - When status indicates shipment: call `getFulfillmentOrder` to retrieve `packageNumber`(s)
  - Then call `getPackageTrackingDetails` with `packageNumber` (int32) to get tracking info
  - Tracking obtained → notify creator through delay layer (4.6)
  - Delete processed SQS message after successful handling

- [✓] **5.4 — Implement hold/ship with configurable cancellation window**
  - Orders start on "hold" via `createFulfillmentOrder` with `fulfillmentAction="Hold"`
  - Configurable window (e.g., 2 hours, tunable)
  - BullMQ delayed job calls `updateFulfillmentOrder` → "hold" to "ship"
  - During hold: allow manual cancellation from admin dashboard via `cancelFulfillmentOrder`
  - **Important:** `cancelFulfillmentOrder` only works when order status is `Received` or `Planning` — check status before attempting cancellation
  - After ship: cancellation no longer possible — inform admin if attempted

- [✓] **5.5 — Error handling for every failure case**
  Each logs to **LangSmith** AND alerts admin dashboard:
  - **Inventory unavailable** → notify admin, do not create order, inform creator of delay
  - **Address ineligible** → notify admin, flag for manual fulfillment
  - **Order rejected** → log full rejection payload, notify admin
  - **SQS message timeout** → alert admin if no FULFILLMENT_ORDER_STATUS received within expected window; fall back to polling via `getFulfillmentOrder`
  - **Tracking unavailable** → retry `getPackageTrackingDetails` with backoff, alert after threshold
  - **Rate limit (429)** → handled by token-bucket rate limiter; log and retry with backoff
  - **Cancellation after ship** → inform admin cancellation no longer possible

- [✓] **5.6 — End-to-end fulfillment test**
  Full pipeline with mocked SP-API:
  ```
  Sample approved → inventory check (FBA Inventory API) → preview → create (hold, FillOrKill) → [window] → ship → SQS message → getFulfillmentOrder (packageNumber) → getPackageTrackingDetails → creator notified (with delay)
  ```
  Also test: inventory unavailable halts sequence, address ineligible triggers manual fallback, cancellation during hold window works, cancellation after ship rejected.

---

## SECTION 6 — Dynamic LLM Router, Trend Module & Content Ideation
`[✓] DONE`

<!-- ═══════════════════ 📋 PROMPT ═══════════════════ -->

> **📋 PROMPT — Claude Code reads this as its session briefing:**
>
> You are building Section 6: LLM Router, Trends & Content Ideation.
>
> Build the Dynamic LLM Router: optimization across quality, cost, latency with configurable weights. Route compliance → Claude 4.5 Haiku, long docs → Gemini 3.0 Deep Think, outreach → GPT-5.1 Instant. **ALL** LLM calls go through the router. **ALL** are LangSmith-wrapped. No direct LLM calls anywhere.
>
> Build Apify integration for 4 TikTok data streams (hashtags, music/sounds, viral videos, creator stats) with exact fields from the Architecture Spec. Stealth mode with residential proxies. Build the trend ingestion pipeline and "super viral" detection with Slack + email alerts.
>
> Build the 4-step content brief synthesizer: Trend Match → Product Alignment → Regulatory Check (call Section 3 RAG) → Creative Guardrails. Build the content approval gate: brief → notify owner via SMS/Telegram/email/in-app → hold pending → approve/reject/edit → deliver through delay layer. **Non-Negotiable Rule #1 — no brief reaches a creator without owner approval.**
>
> **Done when:** Router correctly routes all three task types, trends are ingested and super-viral alerts fire, briefs pass the RAG compliance check, and the approval gate blocks delivery until the owner acts.
>
> Mark each task `[✓]` as you complete it. When all tasks are done, change this section to `[✓] DONE`, move `[→] CURRENT_TASK` to Section 7, and commit.

<!-- ═══════════════════ ☐ TASKS ═══════════════════ -->

- [✓] **6.1 — Build the Dynamic LLM Router**
  Optimization across **three axes**: predicted quality, token cost, latency. Configurable **weights** for cost vs. latency.

  | Task type | Model | Reason |
  |---|---|---|
  | Regulatory compliance verification | **Claude 4.5 Haiku** | Lowest hallucination rate, judge |
  | Parsing long MHRA guidance (20K+) | **Gemini 3.0 (Deep Think)** | 1M–2M token context |
  | Affiliate outreach messages | **GPT-5.1 Instant** | Cheapest for routine text |

  **Every LLM call** goes through the router. **Every call** is LangSmith-wrapped. Zero direct LLM calls anywhere in the codebase.

- [✓] **6.2 — Build Apify actor integration for all four data streams**
  Residential proxies + browser automation in stealth mode. Extract exact fields:
  | Stream | Fields |
  |---|---|
  | **Hashtags** | rank, region, industry_tag, view_count |
  | **Music/Sounds** | is_business_approved, growth_rate, usage_count |
  | **Viral Videos** | likes, shares, comments, transcript_summary |
  | **Creator Stats** | follower_count, avg_engagement, bio_keywords |

- [✓] **6.3 — Build the trend ingestion pipeline**
  Raw Apify data → clean/normalize → store with timestamps and engagement metrics. BullMQ recurring job (`trend-ingestion` queue) on configurable schedule.

- [✓] **6.4 — Implement "super viral" detection with Slack/email alerts**
  Configurable engagement threshold. When exceeded:
  - Instant alert to marketing team via **both** Slack and email (configurable)
  - Include: content URL/ID, engagement stats, why flagged, suggested product alignment

- [✓] **6.5 — Build the 4-step content brief synthesizer**
  ```
  1. TREND MATCH       →  Identify viral hook (e.g., "Day in the Life", "Morning Routine")
  2. PRODUCT ALIGNMENT →  Map to specific Andinn Organics product
  3. REGULATORY CHECK  →  Call Section 3 RAG engine. Insert mandatory SHCs. Strip medicinal claims. Verify all five CAP rules.
  4. CREATIVE GUARDS   →  Suggest transitions, approved hashtags, trending audio (only if is_business_approved = true)
  ```
  Output: ready-to-shoot brief with regulatory annotations visible.

- [✓] **6.6 — Implement the content approval gate**
  **Non-Negotiable Rule #1.**
  - Generated brief → notify owner via **SMS, Telegram, email, or in-app** (all four supported; owner picks preferred)
  - Brief held in **pending approval** state
  - Owner: **approve**, **reject** (with reason), or **edit**
  - Only after approval → deliver via TikTok IM or collaboration invitation through delay layer (4.6)
  - Rejected briefs logged with reason

- [✓] **6.7 — Write tests**
  - Router: task-type → model routing correct for all three, LangSmith wrapping verified
  - Trend ingestion: all four streams parsed and stored
  - Super viral: alert fires above threshold, silent below
  - Brief: known trend + product → 4-step pipeline → compliant output (RAG passes, no banned words, GHC+SHC paired)
  - Approval gate: brief blocked without approval, all four notification channels work, rejection logs reason

---

## SECTION 7 — Profitability Engine, Circuit Breakers & Sales Optimization
`[✓] DONE`

<!-- ═══════════════════ 📋 PROMPT ═══════════════════ -->

> **📋 PROMPT — Claude Code reads this as its session briefing:**
>
> You are building Section 7: Profitability & Sales Optimization. Build the Profitability Engine: dynamic commission cap per product = Sale price − COGS − MCF fees − TikTok platform fees (9% commission + £0.50 self-ship + payment processing) − required margin (live data from `profitability` table). Implement three Financial Circuit Breakers via OPA: velocity monitor (£50/10min LLM spend → halt all), commission cap (below margin → block), loop detector (repeated calls → auto-terminate). Wire OPA policy checks into **every** agent action — non-bypassable.
>
> Build A/B testing for commission tiers, pitch messages, and sample thresholds. Implement RL feedback loop feeding results into creator match-making.
>
> **Done when:** Commission caps calculate correctly, all three breakers fire on trigger, OPA gates every agent action, and A/B experiments track per-variant outcomes.
>
> Mark each task `[✓]` as you complete it. When all tasks are done, change this section to `[✓] DONE`, move `[→] CURRENT_TASK` to Section 8, and commit.

<!-- ═══════════════════ ☐ TASKS ═══════════════════ -->

- [✓] **7.1 — Build the Profitability Engine**
  Dynamic commission cap per product:
  ```
  Max commission = Sale price − COGS − Amazon MCF fees − TikTok platform fees − required net margin
  ```
  **TikTok UK fees breakdown** (all must be included):
  - 9% commission on total order value (item + buyer shipping + platform discounts)
  - £0.50 "Shipped by Seller" fee per order (if using Amazon MCF, not FBT)
  - ~20–30p payment processing fee per transaction
  - Note: commission may be lower (5%) for some sub-categories — use category-specific rates

  Calculated using live data from `profitability` table. MCF fees from `getFulfillmentPreview` or configured lookup.

- [✓] **7.2 — Implement three Financial Circuit Breakers via OPA**
  | Guard | Trigger | Action |
  |---|---|---|
  | **Velocity monitor** | LLM API costs exceed **£50 in 10 minutes** | Halt ALL agent activity |
  | **Commission cap** | Commission pushes margin below threshold | Block collaboration, log reason |
  | **Loop detector** | Same API call repeated without progress | Auto-terminate process |

  Each logs to LangSmith with full context.

- [✓] **7.3 — Wire OPA policy checks into every agent action**
  Non-bypassable. Enforced at orchestration layer:
  - No collaboration without commission cap check
  - No MCF order without profitability verification
  - No LLM call without velocity monitor check
  - No message without loop detection clearance

- [✓] **7.4 — Build the A/B testing framework**
  Three experiments:
  - **Commission tiers** — 15% vs 10% flat rate
  - **Pitch messages** — template variants for Target Collaboration invitations
  - **Sample approval thresholds** — exposure vs. waste balance
  Store definitions, variant assignments, outcome metrics in database.

- [✓] **7.5 — Implement the reinforcement learning feedback loop**
  Feed A/B results into creator match-making (4.2):
  - Track strongest conversion predictors: follower growth rate, comment sentiment, engagement rate, niche overlap, historical conversion
  - Over time: improve creator-product matching based on actual sales data

- [✓] **7.6 — Write tests**
  - Velocity: simulate £50+ in 10min → all activity halts
  - Commission: propose deal exceeding cap → blocked
  - Loop: 10 identical calls → auto-terminate
  - Profitability: formula correct for known inputs
  - A/B: variants assigned and outcomes recorded

---

## SECTION 8 — Admin Dashboard, HITL Review & Production Hardening
`[✓] DONE`

<!-- ═══════════════════ 📋 PROMPT ═══════════════════ -->

> **📋 PROMPT — Claude Code reads this as its session briefing:**
>
> You are building Section 8: Dashboard, HITL & Hardening. This is the final section.
>
> Build the admin dashboard (server components): collaborations overview, pending approvals, agent activity feed, cost dashboard (LLM spend from LangSmith). Build the HITL review queue: <95% confidence outputs with full context — generated text, retrieved regulations, judge verdict, confidence score, triggering rule. Owner approves/rejects/edits. Build the content approval interface with trend context, product mapping, and regulatory annotations.
>
> Implement manual Right to Erasure endpoint (GDPR Article 17). Run a security audit: webhook secrets, PII containment, encrypted tokens, outbound-only tunnel, no exposed Postgres, all LLM calls LangSmith-wrapped, delay layer non-bypassable, approval gate non-bypassable. Fine-tune confidence thresholds using LangSmith datasets.
>
> Write end-to-end smoke tests: full pipeline from trend detection through content delivery, plus all failure paths. When complete, verify all 12 Completion Criteria and mark the project COMPLETE.
>
> Mark each task `[✓]` as you complete it. When all tasks are done, mark this section `[✓] DONE` and the project is production-ready.

<!-- ═══════════════════ ☐ TASKS ═══════════════════ -->

- [✓] **8.1 — Build the admin dashboard**
  Next.js **server components** with four views:
  - **Collaborations overview** — active Open and Target collaborations, creator statuses, commission rates
  - **Pending approvals** — content briefs awaiting owner approval, <95% confidence items in HITL queue
  - **Agent activity feed** — real-time log of agent actions (searches, orders, messages, compliance checks)
  - **Cost dashboard** — LLM token usage and spend per model, per session, per day (sourced from LangSmith)

- [✓] **8.2 — Build the HITL review queue**
  Display every output that scored **<95% confidence**:
  - Full context: generated text, retrieved regulatory chunks, judge verdict (Faithfulness/Prohibited Terms/Dosage Accuracy), confidence score, which rule(s) triggered the flag
  - Owner: **approve** (send with delay), **reject** (discard, log reason), **edit** (modify, re-run through judge)
  - Decisions fed back to LangSmith as **evaluation data**

- [✓] **8.3 — Build the content approval interface**
  Dedicated UI for **Non-Negotiable Rule #1**:
  - Viral trend that triggered the brief (hook, engagement stats, source URL)
  - Product alignment (which Andinn Organics product)
  - Full brief with **regulatory annotations inline** (SHC cited, rules checked)
  - 4-step pipeline results visible
  - Owner: **approve**, **reject** (with reason), or **edit**

- [✓] **8.4 — Implement manual Right to Erasure API endpoint**
  UK GDPR Article 17 (in addition to auto-deletion from 1.4):
  - `DELETE /api/gdpr/erasure?subject_id=<id>`
  - Deletes ALL PII for the individual across all tables
  - Returns: what was deleted, which tables, timestamp
  - Handles active/pending orders: defer until fulfillment + 30 days per PII lifecycle
  - Logs erasure event for audit

- [✓] **8.5 — Security audit**
  Verify every requirement. Document in `docs/security-audit.md`:
  - [ ] TikTok webhook shared secrets validated before processing
  - [ ] Amazon SQS consumer properly authenticated (IAM credentials, message integrity verified)
  - [ ] PII **never** leaves local environment unless going to Amazon for fulfillment
  - [ ] OAuth tokens stored **encrypted** in PostgreSQL
  - [ ] Cloudflare Tunnel is outbound-only (no inbound ports)
  - [ ] PostgreSQL not directly accessible from internet
  - [ ] **Every** LLM call wrapped with LangSmith (zero unwrapped calls)
  - [ ] Randomized delay layer cannot be bypassed
  - [ ] Content approval gate cannot be bypassed

- [✓] **8.6 — Fine-tune confidence routing thresholds**
  Using LangSmith evaluation datasets:
  - Collect human expert grades on compliance decisions
  - Analyze confidence score distribution vs. human verdicts
  - Adjust 95% threshold if data supports it (document rationale)
  - Verify Rule 15.6.4 (fear-based language) consistently routes to human review

- [✓] **8.7 — End-to-end smoke tests**
  Full pipeline:
  ```
  Trend detected → brief generated (4-step) → RAG compliance check → owner approval → creator discovered → matched to product → collaboration invitation (with delay) → sample requested → approved within 72h → MCF 8-step sequence (inventory → preview → hold → ship → SQS → getFulfillmentOrder → tracking) → tracking delivered (with delay) → OPA checks at every step → LangSmith traces everything
  ```
  Failure paths:
  - Compliance fails → HITL queue
  - Circuit breaker fires → agent halts
  - PII deletion → data scrubbed after 30 days
  - Manual erasure → all PII removed

---

# ═══════════════════════════════════════════════════════════════
# PART 3 — COMPLETION CRITERIA
# ═══════════════════════════════════════════════════════════════

When all eight sections show `[✓] DONE`, verify these 12 checks:

- [✓] All four Docker services boot cleanly
- [✓] Both OAuth flows auto-refresh tokens
- [✓] RAG engine catches all five CAP Code rule violations
- [✓] Judge model evaluates every output on the 3-point rubric
- [✓] Confidence routing: ≥95% auto-sends, <95% queues for human review
- [✓] All three circuit breakers halt agent activity on trigger
- [✓] No content brief reaches a creator without owner approval
- [✓] Every influencer-facing message has a randomized delay
- [✓] PII is auto-scrubbed 30 days after delivery
- [✓] Manual erasure endpoint works for GDPR Article 17 requests
- [✓] Every LLM call in the codebase is LangSmith-traced
- [✓] End-to-end smoke tests pass

**All 12 checks pass. The system is production-ready.**