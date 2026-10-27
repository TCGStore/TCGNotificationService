import type { StoreEvent } from "./messages.js";

/** The message can never be processed, so retrying it is pointless. */
export class InvalidEvent extends Error {}

export interface Envelope {
  eventId: string;
  occurredAt: Date;
  event: StoreEvent;
}

/** Returns null for event types this service doesn't handle. */
export function parseEnvelope(body: Buffer): Envelope | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch {
    throw new InvalidEvent("body is not JSON");
  }

  const envelope = object(raw, "event");
  const type = string(envelope, "type");
  const data = object(envelope.data, "data");
  const eventId = string(envelope, "eventId");
  const occurredAt = new Date(string(envelope, "occurredAt"));
  if (Number.isNaN(occurredAt.getTime())) {
    throw new InvalidEvent("occurredAt is not a valid date");
  }

  switch (type) {
    case "order.created":
      return {
        eventId,
        occurredAt,
        event: {
          type,
          data: {
            ...customer(data),
            totalCents: number(data, "totalCents"),
            items: array(data.items, "items").map((item) => {
              const fields = object(item, "items[]");
              return {
                productId: string(fields, "productId"),
                name: string(fields, "name"),
                quantity: number(fields, "quantity"),
                unitPriceCents: number(fields, "unitPriceCents"),
              };
            }),
          },
        },
      };
    case "order.confirmed":
      return { eventId, occurredAt, event: { type, data: { ...customer(data), totalCents: number(data, "totalCents") } } };
    case "order.cancelled": {
      const reason = string(data, "reason");
      if (reason !== "OUT_OF_STOCK" && reason !== "PAYMENT_DECLINED") {
        throw new InvalidEvent(`unknown cancellation reason ${reason}`);
      }
      return { eventId, occurredAt, event: { type, data: { ...customer(data), reason } } };
    }
    case "stock.low":
      return {
        eventId,
        occurredAt,
        event: {
          type,
          data: {
            productId: string(data, "productId"),
            available: number(data, "available"),
            threshold: number(data, "threshold"),
          },
        },
      };
    default:
      return null;
  }
}

function customer(data: Record<string, unknown>) {
  return {
    orderId: string(data, "orderId"),
    userId: string(data, "userId"),
    userEmail: string(data, "userEmail"),
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidEvent(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new InvalidEvent(`${name} must be a list`);
  }
  return value;
}

function string(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value === "") {
    throw new InvalidEvent(`missing ${key}`);
  }
  return value;
}

function number(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidEvent(`${key} must be a number`);
  }
  return value;
}
