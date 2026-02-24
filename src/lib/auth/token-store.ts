import { Pool } from "pg";
import { encrypt, decrypt } from "@/lib/crypto/encryption";

export class TokenStore {
  constructor(private db: Pool) {}

  async storeTokens(
    provider: "tiktok" | "amazon",
    accessToken: string,
    refreshToken: string | null,
    expiresAt: Date,
    scopes?: string[]
  ): Promise<void> {
    const { encrypted: accessEnc, iv: accessIv } = encrypt(accessToken);
    const refreshEnc = refreshToken ? encrypt(refreshToken) : null;
    await this.db.query(
      `INSERT INTO oauth_tokens (provider, access_token_encrypted, refresh_token_encrypted, token_iv, refresh_iv, expires_at, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (provider) DO UPDATE SET
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         token_iv = EXCLUDED.token_iv,
         refresh_iv = EXCLUDED.refresh_iv,
         expires_at = EXCLUDED.expires_at,
         scopes = EXCLUDED.scopes,
         updated_at = NOW()`,
      [
        provider,
        accessEnc,
        refreshEnc?.encrypted || null,
        accessIv,
        refreshEnc?.iv || null,
        expiresAt,
        scopes || null,
      ]
    );
  }

  async getTokens(
    provider: "tiktok" | "amazon"
  ): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date;
  } | null> {
    const result = await this.db.query(
      "SELECT * FROM oauth_tokens WHERE provider = $1",
      [provider]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    const accessToken = decrypt(row.access_token_encrypted, row.token_iv);
    const refreshToken =
      row.refresh_token_encrypted && row.refresh_iv
        ? decrypt(row.refresh_token_encrypted, row.refresh_iv)
        : null;
    return { accessToken, refreshToken, expiresAt: new Date(row.expires_at) };
  }

  async isExpired(provider: "tiktok" | "amazon"): Promise<boolean> {
    const tokens = await this.getTokens(provider);
    if (!tokens) return true;
    // 5 minute buffer before actual expiry
    return tokens.expiresAt.getTime() < Date.now() + 5 * 60 * 1000;
  }

  async deleteTokens(provider: "tiktok" | "amazon"): Promise<void> {
    await this.db.query("DELETE FROM oauth_tokens WHERE provider = $1", [
      provider,
    ]);
  }
}
