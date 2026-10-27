import amqp from "amqplib";

import { InvalidEvent, parseEnvelope } from "./events.js";
import type { EventHandler } from "./handler.js";

const EXCHANGE = "tcg.events";
const QUEUE = "notifications-service.events";
// "order.*" matches any routing key with one word after "order.".
const BINDINGS = ["order.*", "stock.low"];
const PREFETCH = 10;

/**
 * Consumes until the connection drops, then resolves `closed` so main() can exit
 * and Docker/Kubernetes restart the service with a fresh connection.
 */
export async function startConsumer(url: string, handler: EventHandler) {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });
  for (const routingKey of BINDINGS) {
    await channel.bindQueue(QUEUE, EXCHANGE, routingKey);
  }
  await channel.prefetch(PREFETCH);

  // Ack only after the handler finishes: if the service dies midway, RabbitMQ redelivers.
  await channel.consume(QUEUE, async (message) => {
    if (!message) {
      return; // the broker cancelled the consumer
    }
    try {
      const envelope = parseEnvelope(message.content);
      if (envelope) {
        await handler.handle(envelope);
      } else {
        console.info(`ignoring event type with routing key ${message.fields.routingKey}`);
      }
      channel.ack(message);
    } catch (error) {
      if (error instanceof InvalidEvent) {
        console.error(`dropping invalid message ${message.properties.messageId}: ${error.message}`);
        channel.nack(message, false, false);
        return;
      }
      console.error(`failed to process message ${message.properties.messageId}, requeueing`, error);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // avoids a hot loop while Mongo/SMTP recover
      channel.nack(message, false, true);
    }
  });
  console.info(`consuming ${BINDINGS.join(", ")} from ${QUEUE}`);

  const closed = new Promise<void>((resolve) => connection.once("close", () => resolve()));
  return { closed, close: () => connection.close() };
}
