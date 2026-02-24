# Cloudflare Tunnel & Hyperdrive Setup

## Overview

The application uses a **zero-trust, local-first** architecture. No public IP, no open ports, no firewall rules. All inbound traffic arrives through Cloudflare's edge network via an outbound-only tunnel.

```
INBOUND TRAFFIC FLOW:

  TikTok webhook (HTTP):
    TikTok → Cloudflare Edge (validates shared secret)
        → Cloudflare Tunnel (outbound-only) → Local Next.js API route → PostgreSQL

  Amazon notifications (SQS — NOT HTTP):
    Amazon → SQS Queue (AWS) → BullMQ worker polls SQS → Local processing → PostgreSQL
```

---

## 1. Register the Tunnel

### Prerequisites

- A Cloudflare account with a domain configured
- `cloudflared` CLI installed locally (for initial setup — production uses the Docker sidecar)

### Steps

```bash
# Authenticate with Cloudflare
cloudflared tunnel login

# Create a named tunnel
cloudflared tunnel create andinn-outreach

# This creates a credentials file at:
# ~/.cloudflared/<TUNNEL_ID>.json
# Copy the tunnel token for docker-compose.yml
```

### Configure the Tunnel

Create `~/.cloudflared/config.yml` (or mount into the Docker container):

```yaml
tunnel: andinn-outreach
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json

ingress:
  # TikTok webhook endpoint
  - hostname: webhooks.yourdomain.com
    path: /api/webhooks/tiktok
    service: http://next-app:3000
    originRequest:
      noTLSVerify: false

  # Admin dashboard (optional — for remote access)
  - hostname: admin.yourdomain.com
    service: http://next-app:3000
    originRequest:
      noTLSVerify: false

  # Catch-all: reject everything else
  - service: http_status:404
```

### DNS Setup

```bash
# Create a CNAME record pointing to the tunnel
cloudflared tunnel route dns andinn-outreach webhooks.yourdomain.com
```

---

## 2. Docker Compose Integration

The `cloudflared` sidecar in `docker-compose.yml` uses a tunnel token:

```yaml
cloudflared:
  image: cloudflare/cloudflared:latest
  command: tunnel --no-autoupdate run
  environment:
    - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
```

Set the token in `.env`:

```
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiYWNj...your-tunnel-token
```

The token encodes the tunnel ID and credentials. The container establishes an **outbound-only** connection to Cloudflare's edge — no inbound ports are opened.

---

## 3. Shared Secret for Webhook Authentication

TikTok webhooks must be authenticated at the Cloudflare edge before reaching the local API.

### Generate a shared secret

```bash
openssl rand -hex 32
```

### Configure in Cloudflare

Use **Cloudflare Access** or a **Worker** to validate the webhook signature:

```typescript
// Example Cloudflare Worker (deployed at edge)
export default {
  async fetch(request: Request): Promise<Response> {
    const signature = request.headers.get("x-tiktok-signature");
    const secret = "YOUR_SHARED_SECRET";

    // Validate HMAC signature
    const body = await request.text();
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigBuffer = hexToBuffer(signature || "");
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBuffer,
      encoder.encode(body)
    );

    if (!valid) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Forward to tunnel origin
    return fetch(request);
  },
};
```

### Store in `.env`

```
TIKTOK_WEBHOOK_SECRET=your-generated-secret
```

---

## 4. Cloudflare Hyperdrive Setup

Hyperdrive provides connection pooling from Cloudflare edge functions to the local PostgreSQL database (via the tunnel).

### Prerequisites

- Cloudflare Workers paid plan
- Tunnel established and running

### Create a Hyperdrive Configuration

```bash
# Using Wrangler CLI
npx wrangler hyperdrive create andinn-db \
  --connection-string="postgresql://andinn:andinn_secret@webhooks.yourdomain.com:5432/andinn_organics"
```

This returns a Hyperdrive ID. Use it in your Cloudflare Worker bindings:

```toml
# wrangler.toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id"
```

### Usage in Edge Functions

```typescript
// In a Cloudflare Worker or Pages Function
export default {
  async fetch(request: Request, env: Env) {
    const sql = postgres(env.HYPERDRIVE.connectionString);
    const results = await sql`SELECT * FROM creators LIMIT 10`;
    return Response.json(results);
  },
};
```

### Key Benefits

- **Connection pooling** — reuses connections to local Postgres, reducing latency
- **TCP bridge** — Hyperdrive handles the TCP connection via the tunnel
- **No direct DB exposure** — Postgres is never directly accessible from the internet

---

## 5. Security Checklist

- [ ] Tunnel is outbound-only (no inbound ports)
- [ ] PostgreSQL is not directly accessible from the internet
- [ ] Shared secret is configured and validated at the edge
- [ ] Cloudflare Access policies restrict admin dashboard access
- [ ] Tunnel token stored in `.env`, never committed to version control
- [ ] HTTPS enforced on all Cloudflare-proxied domains
