import { type Db, MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Envelope } from "../src/events.js";
import { EventHandler } from "../src/handler.js";
import type { Mail, Mailer } from "../src/mailer.js";
import { InvalidNotificationId, NotificationStore } from "../src/store.js";

class FakeMailer implements Mailer {
  sent: Mail[] = [];
  failNext = false;

  async send(mail: Mail): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("SMTP down");
    }
    this.sent.push(mail);
  }
}

const quietLog = { info: () => {}, warn: () => {} };

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let store: NotificationStore;
let mailer: FakeMailer;
let handler: EventHandler;
let eventCounter = 0;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  db = client.db(`test_${++eventCounter}`);
  store = new NotificationStore(db);
  await store.ensureIndexes();
  mailer = new FakeMailer();
  handler = new EventHandler(store, mailer, ["admin@tcgstore.local"], quietLog);
});

let minute = 0;
function orderConfirmed(userId: string, eventId = `evt_${++minute}`): Envelope {
  return {
    eventId,
    occurredAt: new Date(Date.UTC(2026, 9, 27, 12, minute)),
    event: {
      type: "order.confirmed",
      data: { orderId: `ord_${eventId}`, userId, userEmail: `${userId}@example.com`, totalCents: 999 },
    },
  };
}

function lowStock(): Envelope {
  return {
    eventId: `evt_${++minute}`,
    occurredAt: new Date(Date.UTC(2026, 9, 27, 12, minute)),
    event: { type: "stock.low", data: { productId: "prd_1", available: 2, threshold: 3 } },
  };
}

describe("EventHandler", () => {
  it("saves the notification and emails the customer", async () => {
    await handler.handle(orderConfirmed("usr_ash"));

    const { notifications } = await store.list({ userId: "usr_ash", includeAdmin: false }, false, 1, 20);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ type: "ORDER_CONFIRMED", read: false });
    expect(notifications[0]?.emailedAt).toBeInstanceOf(Date);
    expect(mailer.sent.map((mail) => mail.to)).toEqual([["usr_ash@example.com"]]);
  });

  it("does not duplicate a redelivered event", async () => {
    const event = orderConfirmed("usr_ash");

    await handler.handle(event);
    await handler.handle(event);

    expect(await store.unreadCount({ userId: "usr_ash", includeAdmin: false })).toBe(1);
    expect(mailer.sent).toHaveLength(1);
  });

  it("retries the email when the first attempt failed", async () => {
    const event = orderConfirmed("usr_ash");
    mailer.failNext = true;

    await expect(handler.handle(event)).rejects.toThrow("SMTP down");
    await handler.handle(event); // RabbitMQ redelivery

    expect(await store.unreadCount({ userId: "usr_ash", includeAdmin: false })).toBe(1);
    expect(mailer.sent).toHaveLength(1);
  });
});

describe("NotificationStore", () => {
  it("shows admin notifications only to admins", async () => {
    await handler.handle(orderConfirmed("usr_ash"));
    await handler.handle(lowStock());

    expect(await store.unreadCount({ userId: "usr_ash", includeAdmin: false })).toBe(1);
    expect(await store.unreadCount({ userId: "usr_admin", includeAdmin: true })).toBe(1);
    expect(await store.unreadCount({ userId: "usr_ash", includeAdmin: true })).toBe(2);
  });

  it("lists newest first, paged, and filters unread", async () => {
    await handler.handle(orderConfirmed("usr_ash", "evt_old"));
    await handler.handle(orderConfirmed("usr_ash", "evt_new"));
    const ash = { userId: "usr_ash", includeAdmin: false };

    const firstPage = await store.list(ash, false, 1, 1);
    expect(firstPage.totalCount).toBe(2);
    expect(firstPage.notifications.map((n) => n.eventId)).toEqual(["evt_new"]);

    await store.markAsRead(ash, [firstPage.notifications[0]!._id.toHexString()]);
    const unread = await store.list(ash, true, 1, 20);
    expect(unread.notifications.map((n) => n.eventId)).toEqual(["evt_old"]);
  });

  it("marks everything as read when no ids are given, without touching other users", async () => {
    await handler.handle(orderConfirmed("usr_ash"));
    await handler.handle(orderConfirmed("usr_ash"));
    await handler.handle(orderConfirmed("usr_misty"));

    expect(await store.markAsRead({ userId: "usr_ash", includeAdmin: false }, [])).toBe(2);
    expect(await store.unreadCount({ userId: "usr_ash", includeAdmin: false })).toBe(0);
    expect(await store.unreadCount({ userId: "usr_misty", includeAdmin: false })).toBe(1);
  });

  it("can't mark another user's notification as read", async () => {
    await handler.handle(orderConfirmed("usr_misty"));
    const misty = await store.list({ userId: "usr_misty", includeAdmin: false }, false, 1, 20);

    const updated = await store.markAsRead({ userId: "usr_ash", includeAdmin: false }, [
      misty.notifications[0]!._id.toHexString(),
    ]);

    expect(updated).toBe(0);
  });

  it("rejects malformed ids", async () => {
    await expect(store.markAsRead({ userId: "usr_ash", includeAdmin: false }, ["nope"])).rejects.toThrow(
      InvalidNotificationId,
    );
  });
});
