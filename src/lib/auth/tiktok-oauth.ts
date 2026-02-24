import { TokenStore } from "./token-store";

export interface TikTokOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TikTokTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const TIKTOK_AUTH_BASE = "https://business-api.tiktok.com/portal/auth";
const TIKTOK_TOKEN_URL = "https://business-api.tiktok.com/open_api/v1.3/oauth2/token/";
const TIKTOK_REFRESH_URL = "https://business-api.tiktok.com/open_api/v1.3/oauth2/token/renew/";

export class TikTokOAuthClient {
  private config: TikTokOAuthConfig;
  private tokenStore: TokenStore;

  constructor(config: TikTokOAuthConfig, tokenStore: TokenStore) {
    this.config = config;
    this.tokenStore = tokenStore;
  }

  /**
   * Generate the OAuth 2.0 authorization URL for TikTok.
   * Scope: seller.creator_marketplace.read
   */
  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      app_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state: state || "",
      scope: "seller.creator_marketplace.read",
    });
    return `${TIKTOK_AUTH_BASE}?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for access + refresh tokens.
   * Stores encrypted tokens via TokenStore.
   */
  async exchangeCode(code: string): Promise<TikTokTokenResponse> {
    const response = await fetch(TIKTOK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.config.clientId,
        secret: this.config.clientSecret,
        auth_code: code,
        grant_type: "authorized_code",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `TikTok token exchange failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(
        `TikTok token exchange error: ${data.message || JSON.stringify(data)}`
      );
    }

    const tokenData = data.data;
    const result: TikTokTokenResponse = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    };

    const expiresAt = new Date(Date.now() + result.expiresIn * 1000);
    await this.tokenStore.storeTokens(
      "tiktok",
      result.accessToken,
      result.refreshToken,
      expiresAt,
      ["seller.creator_marketplace.read"]
    );

    return result;
  }

  /**
   * Refresh the access token using the stored refresh token.
   * TikTok rotates refresh tokens on each refresh — the new refresh token
   * replaces the old one in the store.
   */
  async refreshAccessToken(): Promise<TikTokTokenResponse> {
    const stored = await this.tokenStore.getTokens("tiktok");
    if (!stored || !stored.refreshToken) {
      throw new Error(
        "No TikTok refresh token available. Re-authorization required."
      );
    }

    const response = await fetch(TIKTOK_REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.config.clientId,
        secret: this.config.clientSecret,
        refresh_token: stored.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `TikTok token refresh failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(
        `TikTok token refresh error: ${data.message || JSON.stringify(data)}`
      );
    }

    const tokenData = data.data;
    const result: TikTokTokenResponse = {
      accessToken: tokenData.access_token,
      // TikTok rotates the refresh token — use the new one
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    };

    const expiresAt = new Date(Date.now() + result.expiresIn * 1000);
    await this.tokenStore.storeTokens(
      "tiktok",
      result.accessToken,
      result.refreshToken,
      expiresAt,
      ["seller.creator_marketplace.read"]
    );

    return result;
  }

  /**
   * Get a valid access token, auto-refreshing if expired or about to expire.
   */
  async getValidAccessToken(): Promise<string> {
    const isExpired = await this.tokenStore.isExpired("tiktok");
    if (isExpired) {
      const refreshed = await this.refreshAccessToken();
      return refreshed.accessToken;
    }
    const tokens = await this.tokenStore.getTokens("tiktok");
    if (!tokens) {
      throw new Error(
        "No TikTok tokens available. Authorization required."
      );
    }
    return tokens.accessToken;
  }
}
