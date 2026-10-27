import { describe, expect, it } from "vitest";

import { InvalidEvent, parseEnvelope } from "../src/events.js";
import { buildNotification, formatMoney } from "../src/messages.js";

const body = (value: unknown) => Buffer.from(JSON.stringify(value));

const orderCreated = {
  eventId: "evt_1",
  type: "order.created",
  occurredAt: "2026-10-27T12:00:00Z",
  data: {
    orderId: "ord_1",
    userId: "usr_42",
    userEmail: "ash@example.com",
    items: [{ productId: "prd_1", name: "Charizard ex", quantity: 2, unitPriceCents: 2499 }],
    totalCents: 4998,
  },
};

describe("parseEnvelope", () => {
  it("parses an order.created event", () => {
    const envelope = parseEnvelope(body(orderCreated));

    expect(envelope?.eventId).toBe("evt_1");
    expect(envelope?.occurredAt.toISOString()).toBe("2026-10-27T12:00:00.000Z");
    expect(envelope?.event).toEqual({ type: "order.created", data: orderCreated.data });
  });

  it("returns null for event types it doesn't handle", () => {
    expect(parseEnvelope(body({ ...orderCreated, type: "stock.reserved" }))).toBeNull();
  });

  it.each([
    ["not JSON", Buffer.from("not json")],
    ["missing data", body({ ...orderCreated, data: undefined })],
    ["missing userEmail", body({ ...orderCreated, data: { ...orderCreated.data, userEmail: "" } })],
    ["bad date", body({ ...orderCreated, occurredAt: "yesterday" })],
    [
      "unknown reason",
      body({ ...orderCreated, type: "order.cancelled", data: { ...orderCreated.data, reason: "BORED" } }),
    ],
  ])("rejects %s", (_name, message) => {
    expect(() => parseEnvelope(message)).toThrow(InvalidEvent);
  });
});

describe("buildNotification", () => {
  it("addresses order notifications to the customer", () => {
    const content = buildNotification(parseEnvelope(body(orderCreated))!.event, ["admin@tcgstore.local"]);

    expect(content).toMatchObject({ type: "ORDER_CREATED", audience: "user", userId: "usr_42", orderId: "ord_1" });
    expect(content.email.to).toEqual(["ash@example.com"]);
    expect(content.email.text).toContain("- 2 x Charizard ex ($49.98)");
  });

  it("explains why an order was cancelled", () => {
    const content = buildNotification(
      {
        type: "order.cancelled",
        data: { orderId: "ord_1", userId: "usr_42", userEmail: "ash@example.com", reason: "PAYMENT_DECLINED" },
      },
      [],
    );

    expect(content.message).toContain("el pago fue rechazado");
  });

  it("sends low stock alerts to the admins", () => {
    const content = buildNotification(
      { type: "stock.low", data: { productId: "prd_1", available: 2, threshold: 3 } },
      ["admin@tcgstore.local"],
    );

    expect(content).toMatchObject({ type: "LOW_STOCK", audience: "admin", productId: "prd_1" });
    expect(content.userId).toBeUndefined();
    expect(content.email.to).toEqual(["admin@tcgstore.local"]);
  });

  it("formats cents as dollars", () => {
    expect(formatMoney(4599)).toBe("$45.99");
    expect(formatMoney(10)).toBe("$0.10");
  });
});
