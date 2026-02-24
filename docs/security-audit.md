# Security Audit — Andinn Organics

**Date:** 2026-02-24
**Auditor:** Claude Code (automated)
**Status:** PASS (all checks verified)

---

## Checklist

### 1. TikTok webhook shared secrets validated before processing
**Status:** PASS
**File:** `src/app/api/webhooks/tiktok/route.ts`
**Evidence:**
- HMAC-SHA256 signature verification on every POST request
- Uses `crypto.timingSafeEqual()` to prevent timing attacks
- Rejects with 401 if signature is missing or invalid
- Shared secret loaded from `TIKTOK_WEBHOOK_SECRET` environment variable

### 2. Amazon SQS consumer properly authenticated
**Status:** PASS
**File:** `src/lib/api/sqs/consumer.ts`
**Evidence:**
- Uses `@aws-sdk/client-sqs` with AWS IAM credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- SQS queue URL configured via environment variable
- Messages deleted after successful processing (no reprocessing risk)
- IAM principal `arn:aws:iam::437568002678:root` has write permission per SP-API spec

### 3. PII never leaves local environment unless going to Amazon for fulfillment
**Status:** PASS
**Files:** `src/lib/fulfillment/orchestrator.ts`, `src/lib/db/pii-scrubber.ts`
**Evidence:**
- PII (name, address, phone) stored only in `orders.pii_data` JSONB column in local PostgreSQL
- PII transmitted only during `createFulfillmentOrder` to Amazon SP-API for MCF fulfillment
- No PII sent to TikTok API, Apify, LLM providers, or any other external service
- LangSmith traces do not include PII fields — only model inputs/outputs
- Automatic PII scrubbing after delivery + 30 days (GDPR Article 17)

### 4. OAuth tokens stored encrypted in PostgreSQL
**Status:** PASS
**Files:** `src/lib/auth/token-store.ts`, `src/lib/crypto/encryption.ts`
**Evidence:**
- AES-256-GCM encryption for both access tokens and refresh tokens
- Each token stored with its own IV (initialization vector)
- Authentication tag appended to ciphertext for integrity verification
- Encryption key loaded from `TOKEN_ENCRYPTION_KEY` environment variable (never hardcoded)
- Tokens decrypted only on retrieval, never logged in plaintext

### 5. Cloudflare Tunnel is outbound-only (no inbound ports)
**Status:** PASS
**Files:** `docker-compose.yml`, `docs/cloudflare-setup.md`
**Evidence:**
- `cloudflared` container runs `tunnel --no-autoupdate run`
- Connection is outbound-only: local machine connects to Cloudflare edge
- No ports exposed on the host for the tunnel service
- No public IP, no firewall rules required
- Webhook flow: TikTok → Cloudflare Edge → Tunnel → Local Next.js

### 6. PostgreSQL not directly accessible from internet
**Status:** PASS
**File:** `docker-compose.yml`
**Evidence:**
- PostgreSQL runs on internal Docker bridge network (`internal`)
- Port 5432 mapped to localhost only (for local development)
- No external network exposure in production
- Cloudflare Hyperdrive handles edge-to-database connections via tunnel

### 7. Every LLM call wrapped with LangSmith
**Status:** PASS
**Files:** `src/lib/llm/router.ts`, `src/lib/llm/langsmith.ts`, `src/lib/regulatory/judge/judge.ts`
**Evidence:**
- `DynamicLLMRouter` is the single entry point for all LLM calls (singleton pattern)
- All calls use `createTracedOpenAI()` and `createTracedAnthropic()` wrappers
- `traceable()` decorator applied to all routed calls
- Judge model (Claude 4.5 Haiku) calls are independently LangSmith-traced
- No direct LLM client instantiation found outside the router/langsmith modules
- Captures: inputs, outputs, model ID, token counts, latency, cost

### 8. Randomized delay layer cannot be bypassed
**Status:** PASS
**Files:** `src/lib/messaging/delay-layer.ts`, `src/lib/messaging/sender.ts`
**Evidence:**
- `InfluencerDelayLayer.scheduleMessage()` is the only entry point
- Delay is enforced via `await this.wait(delay)` — cannot be skipped
- `InfluencerMessageSender` wraps the delay layer — all message types go through it
- Configurable min/max jitter (default: 30s–5min)
- All influencer-facing message types covered: IM, invitations, approvals, rejections, brief deliveries, tracking updates
- Collaboration modules (`open.ts`, `target.ts`) use the delay layer for all outbound messages

### 9. Content approval gate cannot be bypassed
**Status:** PASS
**Files:** `src/lib/content/approval.ts`, `src/app/api/dashboard/approvals/route.ts`
**Evidence:**
- `ContentApprovalGate` enforces Non-Negotiable Rule #1
- Brief status starts as `pending_approval` — cannot transition to sent without explicit approval
- Owner notification sent via SMS, Telegram, email, or in-app
- Only `approve()` method triggers delivery through the delay layer
- Rejected briefs logged with reason
- Edited briefs re-run through compliance engine before delivery
- No code path exists that sends a brief to a creator without approval gate

---

## Additional Security Measures

### Financial Circuit Breakers (OPA)
- **Velocity monitor:** Halts all agent activity when LLM costs exceed £50 in 10 minutes
- **Commission cap:** Blocks collaborations that would push margin below threshold
- **Loop detector:** Auto-terminates processes making repeated API calls without progress
- All breakers are non-bypassable (enforced at orchestration layer via `OPAPolicyGuard`)

### GDPR Compliance
- **Auto-deletion:** PostgreSQL trigger scrubs PII 30 days after delivery
- **Manual erasure:** `DELETE /api/gdpr/erasure?subject_id=<id>` endpoint
- **Deferred erasure:** Active orders marked for erasure upon fulfillment completion
- **Audit logging:** All erasure events logged in `agent_activity_log`

### Rate Limiting
- **Amazon SP-API:** Token bucket rate limiter (2 req/sec, burst 30 for fulfillment; 2 req/sec, burst 2 for inventory)
- **TikTok Target Invitations:** Daily counter enforces 1,000 invitations per 24 hours
- **Sample Requests:** 72-hour response deadline enforced via BullMQ scheduled monitoring

---

## Recommendations for Production

1. Set `TOKEN_ENCRYPTION_KEY` to a cryptographically random 32-byte hex string
2. Configure `TIKTOK_WEBHOOK_SECRET` with a strong shared secret
3. Rotate all API credentials on a regular schedule
4. Enable Cloudflare Access policies for additional authentication
5. Set up database backups with encryption at rest
6. Monitor LangSmith for anomalous patterns in LLM usage
7. Review OPA circuit breaker thresholds quarterly based on operational data
