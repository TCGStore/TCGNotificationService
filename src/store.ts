import { type Collection, type Db, type Filter, ObjectId } from "mongodb";

import type { NotificationContent, NotificationType } from "./messages.js";

export interface NotificationDoc {
  _id: ObjectId;
  // Unique: a redelivered event finds its existing notification instead of creating another.
  eventId: string;
  type: NotificationType;
  audience: "user" | "admin";
  userId?: string;
  title: string;
  message: string;
  orderId?: string;
  productId?: string;
  read: boolean;
  createdAt: Date;
  emailedAt?: Date;
}

/** Who is asking: a customer sees their own notifications; an admin also sees the shared admin ones. */
export interface Reader {
  userId: string;
  includeAdmin: boolean;
}

export class InvalidNotificationId extends Error {}

export class NotificationStore {
  private readonly notifications: Collection<NotificationDoc>;

  constructor(db: Db) {
    this.notifications = db.collection<NotificationDoc>("notifications");
  }

  async ensureIndexes(): Promise<void> {
    await this.notifications.createIndex({ eventId: 1 }, { unique: true });
    await this.notifications.createIndex({ audience: 1, userId: 1, createdAt: -1 });
  }

  /** Inserts the notification once per event; later calls return the stored one. */
  async saveOnce(eventId: string, content: NotificationContent, createdAt: Date): Promise<NotificationDoc> {
    const { email: _email, ...fields } = content;
    const doc = await this.notifications.findOneAndUpdate(
      { eventId },
      { $setOnInsert: { eventId, ...fields, read: false, createdAt } },
      { upsert: true, returnDocument: "after" },
    );
    if (!doc) {
      throw new Error(`upsert of event ${eventId} returned nothing`);
    }
    return doc;
  }

  async markEmailed(id: ObjectId, at: Date): Promise<void> {
    await this.notifications.updateOne({ _id: id }, { $set: { emailedAt: at } });
  }

  async list(reader: Reader, unreadOnly: boolean, page: number, pageSize: number) {
    const filter = unreadOnly ? { ...visibleTo(reader), read: false } : visibleTo(reader);
    const [notifications, totalCount] = await Promise.all([
      this.notifications
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      this.notifications.countDocuments(filter),
    ]);
    return { notifications, totalCount };
  }

  async unreadCount(reader: Reader): Promise<number> {
    return this.notifications.countDocuments({ ...visibleTo(reader), read: false });
  }

  /** Empty ids marks everything the reader can see. Ids the reader can't see are skipped. */
  async markAsRead(reader: Reader, ids: string[]): Promise<number> {
    const filter: Filter<NotificationDoc> = { ...visibleTo(reader), read: false };
    if (ids.length > 0) {
      filter._id = { $in: ids.map(toObjectId) };
    }
    const result = await this.notifications.updateMany(filter, { $set: { read: true } });
    return result.modifiedCount;
  }
}

function visibleTo({ userId, includeAdmin }: Reader): Filter<NotificationDoc> {
  const own: Filter<NotificationDoc> = { audience: "user", userId };
  return includeAdmin ? { $or: [own, { audience: "admin" }] } : own;
}

function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new InvalidNotificationId(`"${id}" is not a valid notification id`);
  }
  return new ObjectId(id);
}
