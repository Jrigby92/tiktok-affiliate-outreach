/**
 * TikTok Webhook Handler
 *
 * Receives webhook notifications via Cloudflare Edge → Tunnel.
 * Validates requests against the shared secret using HMAC-SHA256.
 * Rejects unauthenticated requests.
 */

import { NextRequest, NextResponse } from "next/server";
import * as crypto from "crypto";

const WEBHOOK_SECRET = process.env.TIKTOK_WEBHOOK_SECRET || "";

/**
 * Verify the webhook signature using HMAC-SHA256.
 */
function verifySignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature || !secret) return false;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  // Read raw body for signature verification
  const body = await request.text();
  const signature = request.headers.get("x-tiktok-signature");

  // Validate shared secret
  if (!verifySignature(body, signature, WEBHOOK_SECRET)) {
    return NextResponse.json(
      { error: "Unauthorized — invalid or missing webhook signature" },
      { status: 401 }
    );
  }

  // Parse the validated payload
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { error: "Bad Request — invalid JSON payload" },
      { status: 400 }
    );
  }

  // Log the webhook event
  // In production, this writes to the appropriate database table
  // based on the event type (sample requests, collaboration updates, etc.)
  console.log("[TikTok Webhook] Received event:", JSON.stringify(payload));

  // TODO: Route to appropriate handler based on event type
  // - Sample request events → sample management queue
  // - Collaboration updates → collaboration handler
  // - Message events → IM handler

  return NextResponse.json({ received: true }, { status: 200 });
}

/**
 * TikTok sends a GET request to verify the webhook endpoint.
 * Respond with the challenge parameter.
 */
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get("challenge");
  if (challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json(
    { error: "Missing challenge parameter" },
    { status: 400 }
  );
}
