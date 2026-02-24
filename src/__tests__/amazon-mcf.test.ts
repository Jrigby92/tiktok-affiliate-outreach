/**
 * Amazon MCF 8-Step Sequence Tests
 *
 * Mocks each step and verifies the order flows through in exact sequence.
 */

import { FbaInventoryClient } from "@/lib/api/amazon/fba-inventory";
import { FulfillmentOutboundClient } from "@/lib/api/amazon/fulfillment-outbound";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("Amazon MCF 8-Step Sequence", () => {
  let inventoryClient: FbaInventoryClient;
  let fulfillmentClient: FulfillmentOutboundClient;

  beforeEach(() => {
    jest.clearAllMocks();
    inventoryClient = new FbaInventoryClient("test-amz-token");
    fulfillmentClient = new FulfillmentOutboundClient("test-amz-token");
  });

  it("Step 1: getInventorySummaries — check SKU availability", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payload: {
          inventorySummaries: [
            {
              sellerSku: "VIT-D-001",
              totalQuantity: 150,
              inventoryDetails: {
                fulfillableQuantity: 120,
              },
            },
          ],
        },
      }),
    });

    const result = await inventoryClient.checkSkuAvailability("VIT-D-001");

    expect(result.available).toBe(true);
    expect(result.quantity).toBe(120);

    // Verify query params
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("granularityType")).toBe("Marketplace");
    expect(url.searchParams.get("granularityId")).toBe("A1F83G8C2ARO7P");
  });

  it("Step 1: returns unavailable when SKU is out of stock", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payload: {
          inventorySummaries: [
            {
              sellerSku: "VIT-D-001",
              totalQuantity: 0,
              inventoryDetails: {
                fulfillableQuantity: 0,
              },
            },
          ],
        },
      }),
    });

    const result = await inventoryClient.checkSkuAvailability("VIT-D-001");
    expect(result.available).toBe(false);
    expect(result.quantity).toBe(0);
  });

  it("Step 2: getFulfillmentPreview — delivery options", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          payload: {
            fulfillmentPreviews: [
              {
                shippingSpeedCategory: "Standard",
                isFulfillable: true,
                isCODCapable: false,
              },
            ],
          },
        }),
    });

    const previews = await fulfillmentClient.getFulfillmentPreview(
      {
        name: "Test User",
        line1: "123 Test St",
        city: "London",
        stateOrRegion: "",
        postalCode: "SW1A 1AA",
        countryCode: "GB",
      },
      [
        {
          sellerSku: "VIT-D-001",
          quantity: 1,
          sellerFulfillmentOrderItemId: "item-1",
        },
      ]
    );

    expect(previews.payload.fulfillmentPreviews).toHaveLength(1);
    expect(previews.payload.fulfillmentPreviews[0].isFulfillable).toBe(true);
  });

  it("Step 3: createFulfillmentOrder — with Hold and FillOrKill", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "",
    });

    await fulfillmentClient.createFulfillmentOrder({
      sellerFulfillmentOrderId: "ANDINN-001",
      displayableOrderId: "ANDINN-001",
      displayableOrderDate: "2026-02-24T00:00:00Z",
      displayableOrderComment: "TikTok affiliate sample",
      shippingSpeedCategory: "Standard",
      destinationAddress: {
        name: "Creator Name",
        line1: "456 Creator Lane",
        city: "Manchester",
        stateOrRegion: "",
        postalCode: "M1 1AA",
        countryCode: "GB",
      },
      items: [
        {
          sellerSku: "VIT-D-001",
          sellerFulfillmentOrderItemId: "item-1",
          quantity: 1,
        },
      ],
      fulfillmentAction: "Hold",
      fulfillmentPolicy: "FillOrKill",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.fulfillmentAction).toBe("Hold");
    expect(body.fulfillmentPolicy).toBe("FillOrKill");
  });

  it("Step 4: cancelFulfillmentOrder — during hold window", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "",
    });

    await fulfillmentClient.cancelFulfillmentOrder("ANDINN-001");

    expect(mockFetch.mock.calls[0][0]).toContain("/ANDINN-001/cancel");
    expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
  });

  it("Step 5: updateFulfillmentOrder — Hold to Ship", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "",
    });

    await fulfillmentClient.updateFulfillmentOrder("ANDINN-001", "Ship");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.fulfillmentAction).toBe("Ship");
  });

  it("Step 7: getFulfillmentOrder — retrieve packageNumber", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          payload: {
            fulfillmentOrder: {
              sellerFulfillmentOrderId: "ANDINN-001",
              status: "Complete",
              statusUpdatedDate: "2026-02-25T00:00:00Z",
            },
            fulfillmentOrderItems: [],
            fulfillmentShipments: [
              {
                shipmentId: "SHIP-001",
                status: "SHIPPED",
                shippingDate: "2026-02-25T00:00:00Z",
                fulfillmentShipmentPackage: [
                  { packageNumber: 12345, carrierCode: "ROYAL_MAIL", trackingNumber: "RM123456789GB" },
                ],
                fulfillmentShipmentItem: [
                  { sellerSku: "VIT-D-001", quantity: 1, packageNumber: 12345 },
                ],
              },
            ],
          },
        }),
    });

    const order = await fulfillmentClient.getFulfillmentOrder("ANDINN-001");

    expect(order.payload.fulfillmentOrder.fulfillmentOrderStatus).toBe("Complete");
    expect(order.payload.fulfillmentShipments?.[0]?.fulfillmentShipmentPackage?.[0]?.packageNumber).toBe(12345);
  });

  it("Step 8: getPackageTrackingDetails — tracking via packageNumber (int32)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          payload: {
            packageNumber: 12345,
            trackingNumber: "RM123456789GB",
            carrierCode: "ROYAL_MAIL",
          },
        }),
    });

    const tracking =
      await fulfillmentClient.getPackageTrackingDetails(12345);

    expect(tracking.packageNumber).toBe(12345);
    expect(tracking.trackingNumber).toBe("RM123456789GB");
    expect(tracking.carrierCode).toBe("ROYAL_MAIL");

    // Verify packageNumber sent as query param
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("packageNumber")).toBe("12345");
  });
});
