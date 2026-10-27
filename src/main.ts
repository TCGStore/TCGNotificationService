import * as grpc from "@grpc/grpc-js";
import { MongoClient } from "mongodb";

import { loadConfig } from "./config.js";
import { createGrpcServer } from "./grpc.js";
import { EventHandler } from "./handler.js";
import { SmtpMailer } from "./mailer.js";
import { startConsumer } from "./rabbit.js";
import { NotificationStore } from "./store.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const mongo = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  await mongo.connect();
  const store = new NotificationStore(mongo.db(config.mongoDb));
  await store.ensureIndexes();

  const mailer = new SmtpMailer(config.smtpHost, config.smtpPort, config.mailFrom);
  const consumer = await startConsumer(config.rabbitmqUrl, new EventHandler(store, mailer, config.adminAlertEmails));

  const server = createGrpcServer(config.protoPath, store);
  await new Promise<void>((resolve, reject) =>
    server.bindAsync(`0.0.0.0:${config.grpcPort}`, grpc.ServerCredentials.createInsecure(), (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  console.info(`notifications-service listening on port ${config.grpcPort}`);

  const stopped = new Promise<string>((resolve) => {
    process.once("SIGINT", () => resolve("SIGINT"));
    process.once("SIGTERM", () => resolve("SIGTERM"));
  });
  const reason = await Promise.race([stopped, consumer.closed.then(() => "lost RabbitMQ connection")]);

  console.info(`shutting down: ${reason}`);
  server.forceShutdown();
  await consumer.close().catch(() => {});
  await mongo.close();
  if (reason === "lost RabbitMQ connection") {
    process.exit(1); // so Docker/Kubernetes restart the service
  }
}

main().catch((error) => {
  console.error("notifications-service stopped", error);
  process.exit(1);
});
