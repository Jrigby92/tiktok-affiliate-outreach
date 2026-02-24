import { TokenStore } from "./token-store";

export interface AmazonOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface AmazonTokenResponse {
  accessToken: string;
  expiresIn: number;
}

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

export class AmazonOAuthClient {
  static readonly UK_MARKETPLACE_ID = "A1F83G8C2ARO7P";
  static readonly EU_ENDPOINT = "https://sellingpartnerapi-eu.amazon.com";

  private config: AmazonOAuthConfig;
  private tokenStore: TokenStore;

  constructor(config: AmazonOAuthConfig, tokenStore: TokenStore) {
    this.config = config;
    this.tokenStore = tokenStore;
  }

  /**
   * Refresh the access token using Login with Amazon (LWA).
   * Amazon SP-API uses a long-lived refresh token that does not rotate.
   */
  async refreshAccessToken(): Promise<AmazonTokenResponse> {
    const response = await fetch(LWA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.config.refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Amazon LWA token refresh failed: ${response.status} ${response.statusText} - ${errorBody}`
      );
    }

    const data = await response.json();
    const result: AmazonTokenResponse = {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };

    const expiresAt = new Date(Date.now() + result.expiresIn * 1000);
    await this.tokenStore.storeTokens(
      "amazon",
      result.accessToken,
      // Amazon refresh token is long-lived and configured, not rotated
      this.config.refreshToken,
      expiresAt
    );

    return result;
  }

  /**
   * Get a valid access token, auto-refreshing if expired or about to expire.
   */
  async getValidAccessToken(): Promise<string> {
    const isExpired = await this.tokenStore.isExpired("amazon");
    if (isExpired) {
      const refreshed = await this.refreshAccessToken();
      return refreshed.accessToken;
    }
    const tokens = await this.tokenStore.getTokens("amazon");
    if (!tokens) {
      throw new Error(
        "No Amazon tokens available. Token refresh required."
      );
    }
    return tokens.accessToken;
  }
}
