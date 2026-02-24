/**
 * Amazon SP-API OAuth 2.0 (LWA) Tests
 *
 * Tests for token refresh and auto-refresh.
 * Amazon SP-API uses a long-lived refresh token (configured, not exchanged via code).
 */

import { AmazonOAuthClient } from "@/lib/auth/amazon-oauth";
import { TokenStore } from "@/lib/auth/token-store";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const mockTokenStore = {
  storeTokens: jest.fn(),
  getTokens: jest.fn(),
  deleteTokens: jest.fn(),
  isExpired: jest.fn(),
} as unknown as TokenStore;

const TEST_CONFIG = {
  clientId: "amzn1.application-oa2-client.test",
  clientSecret: "test-amazon-secret",
  refreshToken: "pre-existing-refresh-token",
};

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
});

describe("Amazon SP-API OAuth 2.0 (LWA)", () => {
  let client: AmazonOAuthClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new AmazonOAuthClient(TEST_CONFIG, mockTokenStore);
  });

  it("should have the correct UK marketplace ID", () => {
    expect(AmazonOAuthClient.UK_MARKETPLACE_ID).toBe("A1F83G8C2ARO7P");
  });

  it("should have the correct EU endpoint", () => {
    expect(AmazonOAuthClient.EU_ENDPOINT).toBe(
      "https://sellingpartnerapi-eu.amazon.com"
    );
  });

  it("should refresh access token using refresh token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new-access-token",
        refresh_token: "pre-existing-refresh-token", // Amazon doesn't rotate
        token_type: "bearer",
        expires_in: 3600,
      }),
    });

    const refreshed = await client.refreshAccessToken();

    expect(refreshed.accessToken).toBe("new-access-token");
    expect(refreshed.expiresIn).toBe(3600);
    expect(mockTokenStore.storeTokens).toHaveBeenCalledWith(
      "amazon",
      "new-access-token",
      "pre-existing-refresh-token",
      expect.any(Date)
    );

    // Should have sent the refresh token in the request
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.amazon.com/auth/o2/token",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("pre-existing-refresh-token"),
      })
    );
  });

  it("should auto-refresh via getValidAccessToken when expired", async () => {
    (mockTokenStore.isExpired as jest.Mock).mockResolvedValueOnce(true);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "auto-refreshed-access",
        refresh_token: "pre-existing-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
      }),
    });

    const token = await client.getValidAccessToken();
    expect(token).toBe("auto-refreshed-access");
  });

  it("should return cached token if not expired", async () => {
    (mockTokenStore.isExpired as jest.Mock).mockResolvedValueOnce(false);
    (mockTokenStore.getTokens as jest.Mock).mockResolvedValueOnce({
      accessToken: "still-valid",
      refreshToken: "pre-existing-refresh-token",
      expiresAt: new Date(Date.now() + 3600000),
    });

    const token = await client.getValidAccessToken();
    expect(token).toBe("still-valid");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should throw on LWA error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => '{"error":"invalid_grant","error_description":"The refresh token is invalid"}',
    });

    await expect(client.refreshAccessToken()).rejects.toThrow(
      "Amazon LWA token refresh failed"
    );
  });
});
