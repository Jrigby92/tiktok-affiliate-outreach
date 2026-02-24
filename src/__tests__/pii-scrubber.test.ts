/**
 * PII Auto-Deletion Tests
 *
 * Tests for UK GDPR Article 17 compliance.
 * These tests verify the PostgreSQL function scrub_expired_pii()
 * correctly scrubs PII while preserving anonymized data.
 *
 * NOTE: These are integration tests that require a running PostgreSQL
 * instance. They are skipped when DB is unavailable.
 */

import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://andinn:andinn_secret@localhost:5432/andinn_organics";

let pool: Pool;

const canConnect = async (): Promise<boolean> => {
  try {
    const testPool = new Pool({ connectionString: DATABASE_URL });
    await testPool.query("SELECT 1");
    await testPool.end();
    return true;
  } catch {
    return false;
  }
};

// Conditionally run tests only when DB is available
const describeWithDb =
  process.env.CI || process.env.TEST_DB ? describe : describe.skip;

describeWithDb("PII Auto-Deletion (UK GDPR Article 17)", () => {
  beforeAll(async () => {
    if (!(await canConnect())) {
      return;
    }
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    // Clean test data
    await pool.query("DELETE FROM orders WHERE fulfillment_id LIKE 'TEST-%'");
  });

  it("should scrub PII from orders delivered 30+ days ago", async () => {
    // Insert a test order with PII
    await pool.query(
      `INSERT INTO orders (fulfillment_id, tracking_num, pii_data, status, delivered_at)
       VALUES ($1, $2, $3, $4, NOW() - INTERVAL '31 days')`,
      [
        "TEST-001",
        "TRK-001",
        JSON.stringify({
          name: "John Doe",
          address: "123 Test St, London, UK",
          phone: "+44123456789",
          email: "john@example.com",
          region: "London",
          product_data: { sku: "VIT-D-001", quantity: 1 },
        }),
        "DELIVERED",
      ]
    );

    // Run the scrubber
    const result = await pool.query<{ scrub_expired_pii: number }>(
      "SELECT scrub_expired_pii() AS scrub_expired_pii"
    );
    expect(result.rows[0].scrub_expired_pii).toBe(1);

    // Verify PII is scrubbed
    const order = await pool.query(
      "SELECT pii_data, pii_scrubbed FROM orders WHERE fulfillment_id = $1",
      ["TEST-001"]
    );

    const piiData = order.rows[0].pii_data;
    expect(order.rows[0].pii_scrubbed).toBe(true);
    expect(piiData.scrubbed).toBe(true);
    expect(piiData.legal_basis).toContain("UK GDPR Article 17");

    // PII must be gone
    expect(piiData.name).toBeUndefined();
    expect(piiData.address).toBeUndefined();
    expect(piiData.phone).toBeUndefined();
    expect(piiData.email).toBeUndefined();

    // Anonymized data must be preserved
    expect(piiData.region).toBe("London");
    expect(piiData.product_data).toEqual({ sku: "VIT-D-001", quantity: 1 });
  });

  it("should NOT scrub PII from orders delivered less than 30 days ago", async () => {
    await pool.query(
      `INSERT INTO orders (fulfillment_id, tracking_num, pii_data, status, delivered_at)
       VALUES ($1, $2, $3, $4, NOW() - INTERVAL '15 days')`,
      [
        "TEST-002",
        "TRK-002",
        JSON.stringify({
          name: "Jane Smith",
          address: "456 Test Ave, Manchester, UK",
          phone: "+44987654321",
          region: "Manchester",
          product_data: { sku: "VIT-C-001", quantity: 2 },
        }),
        "DELIVERED",
      ]
    );

    // Run the scrubber
    const result = await pool.query<{ scrub_expired_pii: number }>(
      "SELECT scrub_expired_pii() AS scrub_expired_pii"
    );
    expect(result.rows[0].scrub_expired_pii).toBe(0);

    // PII should still exist
    const order = await pool.query(
      "SELECT pii_data, pii_scrubbed FROM orders WHERE fulfillment_id = $1",
      ["TEST-002"]
    );
    expect(order.rows[0].pii_scrubbed).toBe(false);
    expect(order.rows[0].pii_data.name).toBe("Jane Smith");
  });

  it("should NOT scrub PII from non-DELIVERED orders", async () => {
    await pool.query(
      `INSERT INTO orders (fulfillment_id, tracking_num, pii_data, status)
       VALUES ($1, $2, $3, $4)`,
      [
        "TEST-003",
        "TRK-003",
        JSON.stringify({
          name: "Bob Wilson",
          address: "789 Test Rd, Birmingham, UK",
          phone: "+44111222333",
          region: "Birmingham",
          product_data: { sku: "OMEGA-001", quantity: 1 },
        }),
        "SHIPPED",
      ]
    );

    const result = await pool.query<{ scrub_expired_pii: number }>(
      "SELECT scrub_expired_pii() AS scrub_expired_pii"
    );
    expect(result.rows[0].scrub_expired_pii).toBe(0);

    const order = await pool.query(
      "SELECT pii_data FROM orders WHERE fulfillment_id = $1",
      ["TEST-003"]
    );
    expect(order.rows[0].pii_data.name).toBe("Bob Wilson");
  });

  it("should not double-scrub already scrubbed orders", async () => {
    // Insert an already-scrubbed order
    await pool.query(
      `INSERT INTO orders (fulfillment_id, tracking_num, pii_data, status, delivered_at, pii_scrubbed)
       VALUES ($1, $2, $3, $4, NOW() - INTERVAL '60 days', TRUE)`,
      [
        "TEST-004",
        "TRK-004",
        JSON.stringify({
          scrubbed: true,
          region: "Edinburgh",
          product_data: { sku: "ZINC-001", quantity: 1 },
        }),
        "DELIVERED",
      ]
    );

    const result = await pool.query<{ scrub_expired_pii: number }>(
      "SELECT scrub_expired_pii() AS scrub_expired_pii"
    );
    expect(result.rows[0].scrub_expired_pii).toBe(0);
  });
});
