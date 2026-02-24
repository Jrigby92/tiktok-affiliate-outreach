import type {
  FulfillmentPreview,
  FulfillmentAddress,
  FulfillmentItem,
  CreateFulfillmentOrderRequest,
  FulfillmentOrder,
  PackageTrackingDetails,
  ReturnReasonCode,
  CreateReturnRequest,
  SpApiError,
  GetFulfillmentPreviewResponse,
  GetFulfillmentOrderResponse,
} from "./types";

// ============================================================
// Amazon Fulfillment Outbound API v2020-07-01 Client
// Requires Fulfillment role
// Rate limit: 2 req/sec, burst 30
// ============================================================

const DEFAULT_ENDPOINT = "https://sellingpartnerapi-eu.amazon.com";
const FULFILLMENT_BASE_PATH = "/fba/outbound/2020-07-01";

export class FulfillmentOutboundClient {
  private accessToken: string;
  private endpoint: string;

  constructor(
    accessToken: string,
    endpoint: string = DEFAULT_ENDPOINT
  ) {
    this.accessToken = accessToken;
    this.endpoint = endpoint;
  }

  // ----------------------------------------------------------
  // Step 2: Get Fulfillment Preview
  // ----------------------------------------------------------

  /**
   * Get delivery date estimates, shipping options, and eligibility
   * for the given address and items.
   *
   * Accepts either two positional arguments (address, items) or a single
   * options object with { address, items, shippingSpeedCategories? }.
   */
  async getFulfillmentPreview(
    addressOrOptions: FulfillmentAddress | {
      address: FulfillmentAddress;
      items: FulfillmentItem[];
      shippingSpeedCategories?: string[];
    },
    items?: FulfillmentItem[]
  ): Promise<GetFulfillmentPreviewResponse> {
    let address: FulfillmentAddress;
    let resolvedItems: FulfillmentItem[];
    let shippingSpeedCategories: string[] | undefined;

    if (items !== undefined) {
      // Called with two positional args: (address, items)
      address = addressOrOptions as FulfillmentAddress;
      resolvedItems = items;
    } else {
      // Called with single options object
      const opts = addressOrOptions as {
        address: FulfillmentAddress;
        items: FulfillmentItem[];
        shippingSpeedCategories?: string[];
      };
      address = opts.address;
      resolvedItems = opts.items;
      shippingSpeedCategories = opts.shippingSpeedCategories;
    }

    const body: Record<string, unknown> = {
      marketplaceId: "A1F83G8C2ARO7P",
      address: {
        name: address.name,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        stateOrRegion: address.stateOrRegion,
        postalCode: address.postalCode,
        countryCode: address.countryCode,
      },
      items: resolvedItems.map((item) => ({
        sellerSku: item.sellerSku,
        sellerFulfillmentOrderItemId: item.sellerFulfillmentOrderItemId,
        quantity: item.quantity,
      })),
    };

    if (shippingSpeedCategories) {
      body.shippingSpeedCategories = shippingSpeedCategories;
    }

    const data = await this.request<{
      payload: {
        fulfillmentPreviews: Array<Record<string, unknown>>;
      };
    }>("POST", `${FULFILLMENT_BASE_PATH}/fulfillmentOrders/preview`, body);

    const previews = (data.payload.fulfillmentPreviews || []).map((p) => ({
      previewId: String(p.previewId ?? ""),
      shippingSpeedCategory: String(
        p.shippingSpeedCategory ?? "Standard"
      ) as FulfillmentPreview["shippingSpeedCategory"],
      estimatedArrival: (p.estimatedArrival as FulfillmentPreview["estimatedArrival"]) || {
        earliestArrivalDate: "",
        latestArrivalDate: "",
      },
      estimatedFees: Array.isArray(p.estimatedFees)
        ? (p.estimatedFees as FulfillmentPreview["estimatedFees"])
        : [],
      isFulfillable: Boolean(p.isFulfillable),
      isCODCapable: Boolean(p.isCODCapable),
      fulfillmentPreviewShipments: Array.isArray(p.fulfillmentPreviewShipments)
        ? p.fulfillmentPreviewShipments
        : [],
      unfulfillablePreviewItems: Array.isArray(p.unfulfillablePreviewItems)
        ? (p.unfulfillablePreviewItems as Array<{
            sellerSku?: string;
            quantity?: number;
            sellerFulfillmentOrderItemId?: string;
            itemUnfulfillableReasons: string[];
          }>)
        : [],
    }));

    return { payload: { fulfillmentPreviews: previews } };
  }

  // ----------------------------------------------------------
  // Step 3: Create Fulfillment Order (Hold + FillOrKill)
  // ----------------------------------------------------------

  /**
   * Create a new Multi-Channel Fulfillment order.
   * Typically called with fulfillmentAction="Hold" and
   * fulfillmentPolicy="FillOrKill".
   */
  async createFulfillmentOrder(
    request: CreateFulfillmentOrderRequest
  ): Promise<void> {
    const body = {
      sellerFulfillmentOrderId: request.sellerFulfillmentOrderId,
      displayableOrderId: request.displayableOrderId,
      displayableOrderDate: request.displayableOrderDate,
      displayableOrderComment: request.displayableOrderComment,
      shippingSpeedCategory: request.shippingSpeedCategory,
      destinationAddress: {
        name: request.destinationAddress.name,
        line1: request.destinationAddress.line1,
        line2: request.destinationAddress.line2,
        city: request.destinationAddress.city,
        stateOrRegion: request.destinationAddress.stateOrRegion,
        postalCode: request.destinationAddress.postalCode,
        countryCode: request.destinationAddress.countryCode,
      },
      items: request.items.map((item) => ({
        sellerSku: item.sellerSku,
        sellerFulfillmentOrderItemId: item.sellerFulfillmentOrderItemId,
        quantity: item.quantity,
      })),
      fulfillmentAction: request.fulfillmentAction,
      fulfillmentPolicy: request.fulfillmentPolicy,
    };

    await this.request(
      "POST",
      `${FULFILLMENT_BASE_PATH}/fulfillmentOrders`,
      body
    );
  }

  // ----------------------------------------------------------
  // Step 4 (cancel): Cancel Fulfillment Order
  // ----------------------------------------------------------

  /**
   * Cancel a fulfillment order. Only works when the order status
   * is "Received" or "Planning".
   */
  async cancelFulfillmentOrder(
    sellerFulfillmentOrderId: string
  ): Promise<void> {
    await this.request(
      "PUT",
      `${FULFILLMENT_BASE_PATH}/fulfillmentOrders/${encodeURIComponent(
        sellerFulfillmentOrderId
      )}/cancel`
    );
  }

  // ----------------------------------------------------------
  // Step 5: Update Fulfillment Order (Hold -> Ship)
  // ----------------------------------------------------------

  /**
   * Update a fulfillment order, typically to transition
   * fulfillmentAction from "Hold" to "Ship".
   *
   * Accepts either two positional arguments or a single options object.
   */
  async updateFulfillmentOrder(
    idOrOptions: string | { sellerFulfillmentOrderId: string; fulfillmentAction: "Ship" },
    fulfillmentAction?: "Ship"
  ): Promise<void> {
    let orderId: string;
    let action: "Ship";

    if (typeof idOrOptions === "string") {
      orderId = idOrOptions;
      action = fulfillmentAction ?? "Ship";
    } else {
      orderId = idOrOptions.sellerFulfillmentOrderId;
      action = idOrOptions.fulfillmentAction;
    }

    const body = {
      fulfillmentAction: action,
    };

    await this.request(
      "PUT",
      `${FULFILLMENT_BASE_PATH}/fulfillmentOrders/${encodeURIComponent(
        orderId
      )}`,
      body
    );
  }

  // ----------------------------------------------------------
  // Step 7: Get Fulfillment Order (status + packageNumber)
  // ----------------------------------------------------------

  /**
   * Retrieve fulfillment order details including status and
   * packageNumber(s) from fulfillmentShipments.
   *
   * Returns the full wrapped response with payload containing
   * fulfillmentOrder, fulfillmentOrderItems, and fulfillmentShipments.
   */
  async getFulfillmentOrder(
    sellerFulfillmentOrderId: string
  ): Promise<GetFulfillmentOrderResponse> {
    const data = await this.request<{
      payload: {
        fulfillmentOrder: Record<string, unknown>;
        fulfillmentOrderItems: Array<Record<string, unknown>>;
        fulfillmentShipments?: Array<Record<string, unknown>>;
      };
    }>(
      "GET",
      `${FULFILLMENT_BASE_PATH}/fulfillmentOrders/${encodeURIComponent(
        sellerFulfillmentOrderId
      )}`
    );

    const order = data.payload.fulfillmentOrder;

    return {
      payload: {
        fulfillmentOrder: {
          sellerFulfillmentOrderId: String(
            order.sellerFulfillmentOrderId ?? ""
          ),
          fulfillmentOrderStatus: String(
            order.fulfillmentOrderStatus ?? order.status ?? "New"
          ) as FulfillmentOrder["status"],
          fulfillmentAction: order.fulfillmentAction
            ? String(order.fulfillmentAction)
            : undefined,
          fulfillmentPolicy: order.fulfillmentPolicy
            ? String(order.fulfillmentPolicy)
            : undefined,
          statusUpdatedDate: order.statusUpdatedDate
            ? String(order.statusUpdatedDate)
            : undefined,
        },
        fulfillmentOrderItems: (data.payload.fulfillmentOrderItems || []).map(
          (item) => ({
            sellerSku: String(item.sellerSku ?? ""),
            sellerFulfillmentOrderItemId: String(
              item.sellerFulfillmentOrderItemId ?? ""
            ),
            quantity: Number(item.quantity ?? 0),
            cancelledQuantity: Number(item.cancelledQuantity ?? 0),
            unfulfillableQuantity: Number(item.unfulfillableQuantity ?? 0),
          })
        ),
        fulfillmentShipments: (data.payload.fulfillmentShipments || []).map(
          (s) => ({
            amazonShipmentId: s.amazonShipmentId
              ? String(s.amazonShipmentId)
              : undefined,
            fulfillmentCenterId: s.fulfillmentCenterId
              ? String(s.fulfillmentCenterId)
              : undefined,
            fulfillmentShipmentStatus: s.fulfillmentShipmentStatus
              ? String(s.fulfillmentShipmentStatus)
              : s.status
                ? String(s.status)
                : undefined,
            shippingDate: s.shippingDate
              ? String(s.shippingDate)
              : undefined,
            estimatedArrival: s.estimatedArrival
              ? (s.estimatedArrival as {
                  earliestArrivalDate: string;
                  latestArrivalDate: string;
                })
              : undefined,
            fulfillmentShipmentPackage: Array.isArray(
              s.fulfillmentShipmentPackage
            )
              ? (s.fulfillmentShipmentPackage as Array<{
                  packageNumber: number;
                  carrierCode?: string;
                  trackingNumber?: string;
                }>)
              : undefined,
            fulfillmentShipmentItem: Array.isArray(
              s.fulfillmentShipmentItem
            )
              ? (s.fulfillmentShipmentItem as Array<{
                  sellerSku?: string;
                  quantity?: number;
                  packageNumber?: number;
                }>)
              : [],
          })
        ),
      },
    };
  }

  // ----------------------------------------------------------
  // Step 8: Get Package Tracking Details
  // ----------------------------------------------------------

  /**
   * Get tracking information for a specific package.
   * packageNumber is an int32 retrieved from getFulfillmentOrder.
   */
  async getPackageTrackingDetails(
    packageNumber: number
  ): Promise<PackageTrackingDetails> {
    const params = new URLSearchParams();
    params.set("packageNumber", String(packageNumber));

    const data = await this.request<{
      payload: Record<string, unknown>;
    }>(
      "GET",
      `${FULFILLMENT_BASE_PATH}/tracking`,
      undefined,
      params
    );

    const p = data.payload;

    return {
      packageNumber: Number(p.packageNumber ?? packageNumber),
      trackingNumber: String(p.trackingNumber ?? ""),
      carrierCode: String(p.carrierCode ?? ""),
      carrierPhoneNumber: p.carrierPhoneNumber
        ? String(p.carrierPhoneNumber)
        : undefined,
      shipDate: p.shipDate ? String(p.shipDate) : undefined,
      estimatedArrival: p.estimatedArrival
        ? (p.estimatedArrival as PackageTrackingDetails["estimatedArrival"])
        : undefined,
      shipToAddress: p.shipToAddress
        ? (p.shipToAddress as PackageTrackingDetails["shipToAddress"])
        : undefined,
    };
  }

  // ----------------------------------------------------------
  // List All Fulfillment Orders (reconciliation)
  // ----------------------------------------------------------

  /**
   * List fulfillment orders, optionally filtered by start date.
   */
  async listAllFulfillmentOrders(
    queryStartDate?: string
  ): Promise<FulfillmentOrder[]> {
    const params = new URLSearchParams();
    if (queryStartDate) {
      params.set("queryStartDate", queryStartDate);
    }

    const data = await this.request<{
      payload: {
        fulfillmentOrders: Array<Record<string, unknown>>;
      };
    }>(
      "GET",
      `${FULFILLMENT_BASE_PATH}/fulfillmentOrders`,
      undefined,
      params
    );

    return (data.payload.fulfillmentOrders || []).map((order) => ({
      sellerFulfillmentOrderId: String(
        order.sellerFulfillmentOrderId ?? ""
      ),
      status: String(
        order.status ?? "New"
      ) as FulfillmentOrder["status"],
      statusUpdatedDate: String(order.statusUpdatedDate ?? ""),
      fulfillmentOrderItems: Array.isArray(order.fulfillmentOrderItems)
        ? (order.fulfillmentOrderItems as Array<Record<string, unknown>>).map(
            (item) => ({
              sellerSku: String(item.sellerSku ?? ""),
              sellerFulfillmentOrderItemId: String(
                item.sellerFulfillmentOrderItemId ?? ""
              ),
              quantity: Number(item.quantity ?? 0),
              cancelledQuantity: Number(item.cancelledQuantity ?? 0),
              unfulfillableQuantity: Number(
                item.unfulfillableQuantity ?? 0
              ),
            })
          )
        : [],
      fulfillmentShipments: undefined,
    }));
  }

  // ----------------------------------------------------------
  // Returns
  // ----------------------------------------------------------

  /**
   * Create a fulfillment return for items from a completed order.
   */
  async createFulfillmentReturn(
    request: CreateReturnRequest
  ): Promise<void> {
    const body = {
      items: request.items.map((item) => ({
        sellerReturnItemId: item.sellerReturnItemId,
        sellerFulfillmentOrderItemId: item.sellerFulfillmentOrderItemId,
        amazonShipmentId: item.amazonShipmentId,
        returnReasonCode: item.returnReasonCode,
        returnComment: item.returnComment,
      })),
    };

    await this.request(
      "PUT",
      `${FULFILLMENT_BASE_PATH}/fulfillmentOrders/${encodeURIComponent(
        request.sellerFulfillmentOrderId
      )}/return`,
      body
    );
  }

  /**
   * List valid return reason codes for a given SKU.
   */
  async listReturnReasonCodes(
    sellerSku: string
  ): Promise<ReturnReasonCode[]> {
    const params = new URLSearchParams();
    params.set("sellerSku", sellerSku);
    params.set("language", "en_GB");
    params.set("marketplaceId", "A1F83G8C2ARO7P");

    const data = await this.request<{
      payload: {
        reasonCodeDetails: Array<{
          returnReasonCode: string;
          description: string;
        }>;
      };
    }>(
      "GET",
      `${FULFILLMENT_BASE_PATH}/returnReasonCodes`,
      undefined,
      params
    );

    return (data.payload.reasonCodeDetails || []).map((r) => ({
      reasonCode: r.returnReasonCode,
      description: r.description,
    }));
  }

  // ----------------------------------------------------------
  // HTTP Transport
  // ----------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    params?: URLSearchParams
  ): Promise<T> {
    let url = `${this.endpoint}${path}`;
    if (params && params.toString()) {
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

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      let errorBody: { errors?: SpApiError[] } | undefined;
      try {
        errorBody = (await response.json()) as { errors?: SpApiError[] };
      } catch {
        // Non-JSON error response
      }

      const firstError = errorBody?.errors?.[0];
      throw new FulfillmentOutboundApiError(
        firstError?.message ||
          `Fulfillment Outbound API error: ${response.status}`,
        response.status,
        firstError?.code
      );
    }

    // Some endpoints (create, cancel, update) return 200/202 with no body
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }
}

// ============================================================
// Custom Error Class
// ============================================================

export class FulfillmentOutboundApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = "FulfillmentOutboundApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
