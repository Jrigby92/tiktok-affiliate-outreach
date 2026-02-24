// ============================================================
// Amazon SP-API — TypeScript Type Definitions
// FBA Inventory API v1 + Fulfillment Outbound API v2020-07-01
// ============================================================

// --- FBA Inventory API v1 ---

export interface InventoryDetails {
  fulfillableQuantity?: number;
  inboundWorkingQuantity?: number;
  inboundShippedQuantity?: number;
  inboundReceivingQuantity?: number;
  reservedQuantity?: {
    totalReservedQuantity?: number;
    pendingCustomerOrderQuantity?: number;
    pendingTransshipmentQuantity?: number;
    fcProcessingQuantity?: number;
  };
  researchingQuantity?: {
    totalResearchingQuantity?: number;
    researchingQuantityBreakdown?: Array<{
      name: string;
      quantity: number;
    }>;
  };
  unfulfillableQuantity?: {
    totalUnfulfillableQuantity?: number;
    customerDamagedQuantity?: number;
    warehouseDamagedQuantity?: number;
    distributorDamagedQuantity?: number;
    carrierDamagedQuantity?: number;
    defectiveQuantity?: number;
    expiredQuantity?: number;
  };
}

export interface InventorySummary {
  sellerSku: string;
  asin: string;
  fnSku: string;
  condition: string;
  totalQuantity: number;
  inventoryDetails: InventoryDetails;
}

export interface InventoryPagination {
  nextToken?: string;
}

export interface InventoryResponse {
  inventorySummaries: InventorySummary[];
  pagination?: InventoryPagination;
}

// --- Fulfillment Outbound API v2020-07-01 ---

export interface FulfillmentPreview {
  previewId: string;
  shippingSpeedCategory: "Standard" | "Expedited" | "Priority";
  estimatedArrival: {
    earliestArrivalDate: string;
    latestArrivalDate: string;
  };
  estimatedFees: Array<{
    name: string;
    amount: {
      currencyCode: string;
      value: string;
    };
  }>;
  isFulfillable: boolean;
}

export interface FulfillmentAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  stateOrRegion: string;
  postalCode: string;
  countryCode: string;
}

export interface FulfillmentItem {
  sellerSku: string;
  sellerFulfillmentOrderItemId: string;
  quantity: number;
}

export type FulfillmentAction = "Hold" | "Ship";

export type FulfillmentPolicy =
  | "FillOrKill"
  | "FillAll"
  | "FillAllAvailable";

export interface CreateFulfillmentOrderRequest {
  sellerFulfillmentOrderId: string;
  displayableOrderId: string;
  displayableOrderDate: string;
  displayableOrderComment: string;
  shippingSpeedCategory: "Standard" | "Expedited" | "Priority";
  destinationAddress: FulfillmentAddress;
  items: FulfillmentItem[];
  fulfillmentAction: FulfillmentAction;
  fulfillmentPolicy: FulfillmentPolicy;
}

export type FulfillmentOrderStatus =
  | "New"
  | "Received"
  | "Planning"
  | "Processing"
  | "Cancelled"
  | "Complete"
  | "CompletePartialled"
  | "Unfulfillable"
  | "Invalid";

export interface FulfillmentOrderItem {
  sellerSku: string;
  sellerFulfillmentOrderItemId: string;
  quantity: number;
  cancelledQuantity: number;
  unfulfillableQuantity: number;
}

export interface FulfillmentShipment {
  shipmentId: string;
  status: string;
  shippingDate: string;
  estimatedArrival: {
    earliestArrivalDate: string;
    latestArrivalDate: string;
  };
  packageNumber: number;
}

export interface FulfillmentOrder {
  sellerFulfillmentOrderId: string;
  status: FulfillmentOrderStatus;
  statusUpdatedDate: string;
  fulfillmentOrderItems: FulfillmentOrderItem[];
  fulfillmentShipments?: FulfillmentShipment[];
}

export interface PackageTrackingDetails {
  packageNumber: number;
  trackingNumber: string;
  carrierCode: string;
  carrierPhoneNumber?: string;
  shipDate?: string;
  estimatedArrival?: {
    earliestArrivalDate: string;
    latestArrivalDate: string;
  };
  shipToAddress?: FulfillmentAddress;
}

export interface ReturnReasonCode {
  reasonCode: string;
  description: string;
}

export interface CreateReturnItem {
  sellerReturnItemId: string;
  sellerFulfillmentOrderItemId: string;
  amazonShipmentId: string;
  returnReasonCode: string;
  returnComment?: string;
}

export interface CreateReturnRequest {
  sellerFulfillmentOrderId: string;
  items: CreateReturnItem[];
}

// --- Response Wrappers ---

/**
 * Address type used by the fulfillment orchestrator and sample bridge.
 * Maps TikTok shipping addresses to Amazon-compatible format.
 */
export interface Address {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrRegion?: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
}

/**
 * Wrapper for getFulfillmentPreview response.
 * Contains the list of fulfillment previews with fulfillability info.
 */
export interface GetFulfillmentPreviewResponse {
  payload: {
    fulfillmentPreviews: Array<
      FulfillmentPreview & {
        isCODCapable?: boolean;
        fulfillmentPreviewShipments?: unknown[];
        unfulfillablePreviewItems?: Array<{
          sellerSku?: string;
          quantity?: number;
          sellerFulfillmentOrderItemId?: string;
          itemUnfulfillableReasons: string[];
        }>;
      }
    >;
  };
}

/**
 * Shipment package details within a fulfillment shipment.
 */
export interface FulfillmentShipmentPackage {
  packageNumber: number;
  carrierCode?: string;
  trackingNumber?: string;
}

/**
 * Shipment item details within a fulfillment shipment.
 */
export interface FulfillmentShipmentItem {
  sellerSku?: string;
  quantity?: number;
  packageNumber?: number;
}

/**
 * Extended shipment info returned from getFulfillmentOrder.
 */
export interface GetFulfillmentOrderShipment {
  amazonShipmentId?: string;
  fulfillmentCenterId?: string;
  fulfillmentShipmentStatus?: string;
  shippingDate?: string;
  estimatedArrival?: {
    earliestArrivalDate: string;
    latestArrivalDate: string;
  };
  fulfillmentShipmentPackage?: FulfillmentShipmentPackage[];
  fulfillmentShipmentItem: FulfillmentShipmentItem[];
}

/**
 * Wrapper for getFulfillmentOrder response.
 * Contains the order details, items, and shipments with package numbers.
 */
export interface GetFulfillmentOrderResponse {
  payload: {
    fulfillmentOrder: {
      sellerFulfillmentOrderId: string;
      fulfillmentOrderStatus: FulfillmentOrderStatus;
      fulfillmentAction?: string;
      fulfillmentPolicy?: string;
      statusUpdatedDate?: string;
    };
    fulfillmentOrderItems: Array<{
      sellerSku: string;
      sellerFulfillmentOrderItemId: string;
      quantity: number;
      cancelledQuantity?: number;
      unfulfillableQuantity?: number;
    }>;
    fulfillmentShipments: GetFulfillmentOrderShipment[];
  };
}

/**
 * SQS notification for FULFILLMENT_ORDER_STATUS changes.
 */
export interface FulfillmentOrderStatusNotification {
  notificationType: string;
  payload: {
    sellerFulfillmentOrderId: string;
    fulfillmentOrderStatus: FulfillmentOrderStatus;
    statusUpdatedDate: string;
    fulfillmentShipment?: {
      amazonShipmentId?: string;
      fulfillmentShipmentStatus?: string;
    };
  };
}

// --- SP-API Common ---

export interface SpApiError {
  code: string;
  message: string;
  details?: string;
}
