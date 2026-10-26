# notifications-service

Node.js (TypeScript) + MongoDB.

- Consume eventos de RabbitMQ (exchange topic `tcg.events`): `order.created`,
  `order.confirmed`, `order.cancelled` y `stock.low`.
- Guarda las notificaciones en MongoDB; el frontend las muestra (campanita)
  consultándolas a través del BFF por gRPC.
- Envía correos simulados con Mailpit (web en http://localhost:8025 en local).
