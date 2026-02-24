/**
 * TikTok OAuth 2.0 Tests
 *
 * Tests for token acquisition, refresh, and rotation.
 * Uses mocked HTTP responses.
 */

import { TikTokOAuthClient } from "@/lib/auth/tiktok-oauth";
import { TokenStore } from "@/lib/auth/token-store";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock token store
const mockTokenStore = {
  storeTokens: jest.fn(),
  getTokens: jest.fn(),
  deleteTokens: jest.fn(),
  isExpired: jest.fn(),
} as unknown as TokenStore;

const TEST_CONFIG = {
  clientId: "test-client-key",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:3000/api/auth/tiktok/callback",
};

// Set encryption key for token storage
beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
});

describe("TikTok OAuth 2.0", () => {
  let client: TikTokOAuthClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new TikTokOAuthClient(TEST_CONFIG, mockTokenStore);
  });

  it("should generate an authorization URL with correct params", () => {
    const url = client.getAuthorizationUrl("test-state");

    expect(url).toContain("app_id=test-client-key");
    expect(url).toContain("state=test-state");
    expect(url).toContain("scope=seller.creator_marketplace.read");
  });

  it("should exchange code for tokens and store encrypted", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        message: "OK",
        data: {
          access_token: "access-token-123",
          refresh_token: "refresh-token-456",
          expires_in: 3600,
          refresh_expires_in: 86400,
          scope: "seller.creator_marketplace.read",
          token_type: "Bearer",
        },
      }),
    });

    const token = await client.exchangeCode("auth-code-xyz");

    expect(token.accessToken).toBe("access-token-123");
    expect(token.refreshToken).toBe("refresh-token-456");
    expect(token.expiresIn).toBe(3600);
    expect(mockTokenStore.storeTokens).toHaveBeenCalledWith(
      "tiktok",
      "access-token-123",
      "refresh-token-456",
      expect.any(Date),
      ["seller.creator_marketplace.read"]
    );
  });

  it("should handle token refresh with rotation", async () => {
    // Store a token so refreshAccessToken can retrieve it
    (mockTokenStore.getTokens as jest.Mock).mockResolvedValueOnce({
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      expiresAt: new Date(Date.now() - 1000),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        message: "OK",
        data: {
          access_token: "new-access-token",
          refresh_token: "new-rotated-refresh-token", // Rotated!
          expires_in: 3600,
          refresh_expires_in: 86400,
          scope: "seller.creator_marketplace.read",
          token_type: "Bearer",
        },
      }),
    });

    const refreshed = await client.refreshAccessToken();

    // Verify the NEW rotated refresh token is stored
    expect(refreshed.refreshToken).toBe("new-rotated-refresh-token");
    expect(refreshed.accessToken).toBe("new-access-token");
    expect(mockTokenStore.storeTokens).toHaveBeenCalledWith(
      "tiktok",
      "new-access-token",
      "new-rotated-refresh-token",
      expect.any(Date),
      ["seller.creator_marketplace.read"]
    );
  });

  it("should auto-refresh expired tokens via getValidAccessToken", async () => {
    (mockTokenStore.isExpired as jest.Mock).mockResolvedValueOnce(true);

    // refreshAccessToken needs getTokens
    (mockTokenStore.getTokens as jest.Mock).mockResolvedValueOnce({
      accessToken: "expired-token",
      refreshToken: "valid-refresh",
      expiresAt: new Date(Date.now() - 60000),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        message: "OK",
        data: {
          access_token: "refreshed-access-token",
          refresh_token: "new-refresh",
          expires_in: 3600,
          refresh_expires_in: 86400,
          scope: "seller.creator_marketplace.read",
          token_type: "Bearer",
        },
      }),
    });

    const token = await client.getValidAccessToken();
    expect(token).toBe("refreshed-access-token");
  });

  it("should return cached token if not expired", async () => {
    (mockTokenStore.isExpired as jest.Mock).mockResolvedValueOnce(false);

    (mockTokenStore.getTokens as jest.Mock).mockResolvedValueOnce({
      accessToken: "still-valid-token",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 3600000),
    });

    const token = await client.getValidAccessToken();
    expect(token).toBe("still-valid-token");
    expect(mockFetch).not.toHaveBeenCalled(); // No refresh needed
  });

  it("should throw on API error during code exchange", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 40001,
        message: "Invalid auth code",
        data: {},
      }),
    });

    await expect(client.exchangeCode("bad-code")).rejects.toThrow(
      "TikTok token exchange error"
    );
  });
});
