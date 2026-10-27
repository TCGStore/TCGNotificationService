import type { Envelope } from "./events.js";
import type { Mailer } from "./mailer.js";
import { buildNotification } from "./messages.js";
import type { NotificationStore } from "./store.js";

export class EventHandler {
  constructor(
    private readonly store: NotificationStore,
    private readonly mailer: Mailer,
    private readonly adminEmails: string[],
    private readonly log: Pick<Console, "info" | "warn"> = console,
  ) {}

  async handle({ eventId, occurredAt, event }: Envelope): Promise<void> {
    const content = buildNotification(event, this.adminEmails);
    const notification = await this.store.saveOnce(eventId, content, occurredAt);

    // emailedAt is set only after a successful send: a redelivered event that failed
    // to email the first time tries again, and one that already emailed doesn't repeat it.
    if (notification.emailedAt) {
      this.log.info(`event ${eventId} (${event.type}) already processed`);
      return;
    }
    if (content.email.to.length === 0) {
      this.log.warn(`no recipients for ${event.type}; set ADMIN_ALERT_EMAILS to email low-stock alerts`);
      return;
    }

    await this.mailer.send(content.email);
    await this.store.markEmailed(notification._id, new Date());
    this.log.info(`${event.type} -> notification ${notification._id}, emailed ${content.email.to.join(", ")}`);
  }
}
