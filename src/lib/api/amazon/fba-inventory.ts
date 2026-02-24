import type { InventoryResponse, InventorySummary, SpApiError } from "./types";

// ============================================================
// Amazon FBA Inventory API v1 Client
// Requires Product Listing role
// Rate limit: 2 req/sec, burst 2
// ============================================================

const DEFAULT_ENDPOINT = "https://sellingpartnerapi-eu.amazon.com";
const UK_MARKETPLACE_ID = "A1F83G8C2ARO7P";
const INVENTORY_BASE_PATH = "/fba/inventory/v1/summaries";

export class FbaInventoryClient {
  private accessToken: string;
  private marketplaceId: string;
  private endpoint: string;

  constructor(
    accessToken: string,
    marketplaceId: string = UK_MARKETPLACE_ID,
    endpoint: string = DEFAULT_ENDPOINT
  ) {
    this.accessToken = accessToken;
    this.marketplaceId = marketplaceId;
    this.endpoint = endpoint;
  }

  /**
   * Retrieve inventory summaries for one or more seller SKUs.
   * Uses granularityType=Marketplace and granularityId=UK marketplace ID.
   */
  async getInventorySummaries(
    sellerSkus: string[]
  ): Promise<InventoryResponse> {
    const params = new URLSearchParams();
    params.set("details", "true");
    params.set("granularityType", "Marketplace");
    params.set("granularityId", this.marketplaceId);
    params.set("marketplaceIds", this.marketplaceId);

    for (const sku of sellerSkus) {
      params.append("sellerSkus", sku);
    }

    const data = await this.request<{
      payload: {
        inventorySummaries: Array<Record<string, unknown>>;
      };
      pagination?: { nextToken?: string };
    }>("GET", INVENTORY_BASE_PATH, params);

    const summaries: InventorySummary[] = (
      data.payload.inventorySummaries || []
    ).map((s) => ({
      sellerSku: String(s.sellerSku ?? ""),
      asin: String(s.asin ?? ""),
      fnSku: String(s.fnSku ?? ""),
      condition: String(s.condition ?? ""),
      totalQuantity: Number(s.totalQuantity ?? 0),
      inventoryDetails: (s.inventoryDetails as InventorySummary["inventoryDetails"]) || {},
    }));

    return {
      inventorySummaries: summaries,
      pagination: data.pagination
        ? { nextToken: data.pagination.nextToken }
        : undefined,
    };
  }

  /**
   * Convenience method: check whether a single SKU is in stock.
   * Returns availability flag and fulfillable quantity.
   */
  async checkSkuAvailability(
    sellerSku: string
  ): Promise<{ available: boolean; quantity: number }> {
    const response = await this.getInventorySummaries([sellerSku]);
    const summary = response.inventorySummaries.find(
      (s) => s.sellerSku === sellerSku
    );

    if (!summary) {
      return { available: false, quantity: 0 };
    }

    const fulfillable =
      summary.inventoryDetails.fulfillableQuantity ?? summary.totalQuantity;

    return {
      available: fulfillable > 0,
      quantity: fulfillable,
    };
  }

  // ----------------------------------------------------------
  // HTTP Transport
  // ----------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    params?: URLSearchParams
  ): Promise<T> {
    let url = `${this.endpoint}${path}`;
    if (params) {
      url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
      "x-amz-access-token": this.accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    const response = await fetch(url, options);

    if (!response.ok) {
      let errorBody: { errors?: SpApiError[] } | undefined;
      try {
        errorBody = (await response.json()) as { errors?: SpApiError[] };
      } catch {
        // Non-JSON error response
      }

      const firstError = errorBody?.errors?.[0];
      throw new FbaInventoryApiError(
        firstError?.message ||
          `FBA Inventory API error: ${response.status}`,
        response.status,
        firstError?.code
      );
    }

    return (await response.json()) as T;
  }
}

// ============================================================
// Custom Error Class
// ============================================================

export class FbaInventoryApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = "FbaInventoryApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
