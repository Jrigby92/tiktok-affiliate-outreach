/**
 * Randomized Reply Delay Layer Tests
 *
 * Verifies Non-Negotiable Rule #2:
 * - Every influencer-facing message type is delayed
 * - Delay is within configured min/max
 * - Layer cannot be circumvented
 */

import { InfluencerDelayLayer, MessageType } from "@/lib/messaging/delay-layer";

// Mock setTimeout to resolve instantly in tests
jest.useFakeTimers();

describe("InfluencerDelayLayer", () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("Delay enforcement", () => {
    it("should apply delay within configured min/max range", () => {
      const layer = new InfluencerDelayLayer({
        minDelayMs: 100,
        maxDelayMs: 200,
      });

      // calculateDelay should return values in range
      const delays: number[] = [];
      for (let i = 0; i < 50; i++) {
        delays.push(layer.calculateDelay());
      }

      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(100);
        expect(delay).toBeLessThanOrEqual(200);
      }
    });

    it("should delay EVERY message type via scheduleMessage", async () => {
      const layer = new InfluencerDelayLayer({
        minDelayMs: 50,
        maxDelayMs: 100,
      });

      const messageTypes: MessageType[] = [
        "im",
        "invitation",
        "approval",
        "rejection",
        "brief_delivery",
        "tracking_update",
      ];

      for (const type of messageTypes) {
        const promise = layer.scheduleMessage(type, "creator-1", "test content");
        jest.runAllTimers();
        const msg = await promise;

        expect(msg.type).toBe(type);
        expect(msg.recipientId).toBe("creator-1");
        expect(msg.actualDelayMs).toBeGreaterThanOrEqual(50);
        expect(msg.actualDelayMs).toBeLessThanOrEqual(100);
      }
    });

    it("should return a DelayedMessage with correct metadata", async () => {
      const layer = new InfluencerDelayLayer({
        minDelayMs: 10,
        maxDelayMs: 20,
      });

      const promise = layer.scheduleMessage("im", "creator-1", "Hello!");
      jest.runAllTimers();
      const msg = await promise;

      expect(msg.messageId).toMatch(/^msg_/);
      expect(msg.type).toBe("im");
      expect(msg.recipientId).toBe("creator-1");
      expect(msg.content).toBe("Hello!");
      expect(msg.actualDelayMs).toBeGreaterThanOrEqual(10);
      expect(msg.actualDelayMs).toBeLessThanOrEqual(20);
      expect(msg.scheduledAt).toBeInstanceOf(Date);
      expect(msg.deliverAt).toBeInstanceOf(Date);
    });
  });

  describe("Non-bypassability", () => {
    it("should not expose any method to send without delay", () => {
      const layer = new InfluencerDelayLayer({ minDelayMs: 50, maxDelayMs: 100 });

      // The only public send method is `scheduleMessage()` which always applies delay
      expect(typeof layer.scheduleMessage).toBe("function");

      // No bypass methods exist
      expect(
        (layer as unknown as Record<string, unknown>).sendImmediate
      ).toBeUndefined();
      expect(
        (layer as unknown as Record<string, unknown>).sendWithoutDelay
      ).toBeUndefined();
      expect(
        (layer as unknown as Record<string, unknown>).bypass
      ).toBeUndefined();
    });

    it("should always produce a positive delay when configured", () => {
      const layer = new InfluencerDelayLayer({
        minDelayMs: 50,
        maxDelayMs: 100,
      });

      for (let i = 0; i < 50; i++) {
        const delay = layer.calculateDelay();
        expect(delay).toBeGreaterThanOrEqual(50);
      }
    });
  });

  describe("Configuration", () => {
    it("should use default config when no args provided", () => {
      const layer = new InfluencerDelayLayer();
      const config = layer.getConfig();
      expect(config.minDelayMs).toBe(30000); // 30 seconds
      expect(config.maxDelayMs).toBe(300000); // 5 minutes
    });

    it("should accept custom config", () => {
      const layer = new InfluencerDelayLayer({
        minDelayMs: 100,
        maxDelayMs: 200,
      });
      const config = layer.getConfig();
      expect(config.minDelayMs).toBe(100);
      expect(config.maxDelayMs).toBe(200);
    });

    it("should return a copy of config (not mutable reference)", () => {
      const layer = new InfluencerDelayLayer({
        minDelayMs: 50,
        maxDelayMs: 100,
      });
      const config1 = layer.getConfig();
      const config2 = layer.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // different objects
    });
  });
});
