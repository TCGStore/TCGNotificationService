export interface Config {
  grpcPort: number;
  mongoUri: string;
  mongoDb: string;
  rabbitmqUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  adminAlertEmails: string[];
  protoPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    grpcPort: Number(env.GRPC_PORT ?? 50055),
    mongoUri: required(env, "MONGO_URI", "mongodb://tcg:tcg@localhost:27017"),
    mongoDb: env.MONGO_DB ?? "notifications",
    rabbitmqUrl: required(env, "RABBITMQ_URL", "amqp://tcg:tcg@localhost:5672"),
    smtpHost: env.SMTP_HOST ?? "localhost",
    smtpPort: Number(env.SMTP_PORT ?? 1025),
    mailFrom: env.MAIL_FROM ?? "Pokémon TCG Store <no-reply@tcgstore.local>",
    adminAlertEmails: (env.ADMIN_ALERT_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean),
    protoPath: env.PROTO_PATH ?? "../../proto/notifications.proto",
  };
}

function required(env: NodeJS.ProcessEnv, key: string, example: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required, e.g. ${example}`);
  }
  return value;
}
