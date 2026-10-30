# notifications-service

Node.js 22 + TypeScript + MongoDB. Convierte los eventos de la saga en notificaciones
(la campanita del frontend) y correos. Implementa `proto/notifications.proto` en el
puerto gRPC 50055.

- **Consume** `order.*` y `stock.low` de RabbitMQ (cola `notifications-service.events`).
  No publica nada: los demás servicios ni siquiera saben que existe.
- **Guarda** cada notificación en MongoDB (base `notifications`).
- **Envía correos** a Mailpit, un servidor de correo falso. Los mensajes no salen a
  internet: se ven en su web, <http://localhost:8025>.

## Estructura

```
src/
  main.ts       arranque: MongoDB + consumidor RabbitMQ + servidor gRPC
  config.ts     variables de entorno
  events.ts     valida el JSON de cada evento (proto/events.md)
  messages.ts   evento → título, mensaje y correo (texto en español, para los clientes)
  handler.ts    guarda la notificación y envía el correo, una sola vez por evento
  store.ts      consultas a MongoDB
  mailer.ts     envío por SMTP (nodemailer)
  rabbit.ts     cola, bindings y ack manual
  grpc.ts       los 3 RPCs del .proto
test/           vitest; MongoDB en memoria (mongodb-memory-server), no necesita Docker
```

El `.proto` se lee **al arrancar** (con `@grpc/proto-loader`), así que no hay código
generado. Por eso el Dockerfile copia `proto/notifications.proto`.

## Qué genera cada evento

| Evento | Notificación | Para | Correo a |
|---|---|---|---|
| `order.created` | "Recibimos tu pedido" (con el detalle de productos) | el cliente | `userEmail` del evento |
| `order.confirmed` | "Pedido confirmado" | el cliente | `userEmail` |
| `order.cancelled` | "Pedido cancelado" + motivo (sin stock / pago rechazado) | el cliente | `userEmail` |
| `stock.low` | "Stock bajo" | **todos los admins** | `ADMIN_ALERT_EMAILS` |

- Las notificaciones de cliente tienen `audience: "user"` y su `userId`. Las de stock bajo
  tienen `audience: "admin"` y las comparten todos los admins: si un admin la marca como
  leída, queda leída para todos (así lo define el `.proto`).
- El email del cliente viene en el propio evento (orders lo guarda con el pedido), así que
  este servicio **no necesita llamar a users-service**.

### Eventos repetidos y correos que fallan

RabbitMQ puede entregar el mismo evento dos veces. Cada notificación guarda su `eventId`
con un índice único: si llega de nuevo, se encuentra la existente en vez de crear otra.

El correo se marca como enviado (`emailedAt`) solo después de que Mailpit lo acepta. Si
el envío falla, el mensaje vuelve a la cola y en el reintento se envía el correo sin
duplicar la notificación. Si ya se había enviado, no se repite.

## Correr en local

Requisitos: Node.js 22 o superior y Docker.

```bash
# desde TCGBackend
docker compose up -d mongodb rabbitmq mailpit

# desde este repo
make install
make run     # servidor en :50055, recarga al guardar cambios
make test
```

O todo con Docker, desde TCGBackend:

```bash
docker compose up -d --build notifications-service
```

La primera vez, `make test` descarga un binario de MongoDB 7 (~170 MB, queda en caché).
Está fijado en la versión 7.0.14 (`config` en `package.json`): la 8 no corre en macOS 13.

## Probar

Las notificaciones se crean solo con eventos; la forma más fácil es hacer una compra
(ver el README de orders-service) y luego:

```bash
grpcurl -plaintext -d '{"user_id":"usr_..."}' \
  localhost:50055 tcgstore.notifications.NotificationsService/GetUnreadCount

grpcurl -plaintext -d '{"user_id":"usr_...","unread_only":true}' \
  localhost:50055 tcgstore.notifications.NotificationsService/ListNotifications

# un admin ve también las de stock bajo
grpcurl -plaintext -d '{"user_id":"usr_admin","include_admin":true}' \
  localhost:50055 tcgstore.notifications.NotificationsService/ListNotifications

# sin notification_ids marca todas como leídas
grpcurl -plaintext -d '{"user_id":"usr_..."}' \
  localhost:50055 tcgstore.notifications.NotificationsService/MarkAsRead
```

Y los correos en <http://localhost:8025>.

El health check (`grpc.health.v1.Health`) funciona, pero no aparece en `grpcurl list`:
`@grpc/reflection` no sabe describir el `map` que trae su `.proto`. Para probarlo con grpcurl
hay que pasarle ese archivo:

```bash
grpcurl -plaintext -import-path node_modules/grpc-health-check/proto/health/v1 \
  -proto health.proto localhost:50055 grpc.health.v1.Health/Check
```

## Variables de entorno

| Variable | Default | |
|---|---|---|
| `MONGO_URI` | — (obligatoria) | `mongodb://tcg:tcg@localhost:27017` en local |
| `RABBITMQ_URL` | — (obligatoria) | `amqp://tcg:tcg@localhost:5672` en local |
| `MONGO_DB` | `notifications` | |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | Mailpit |
| `MAIL_FROM` | `Pokémon TCG Store <no-reply@tcgstore.local>` | |
| `ADMIN_ALERT_EMAILS` | vacía | separados por coma; en compose usa `ADMIN_EMAIL` del `.env` |
| `GRPC_PORT` | `50055` | |
| `PROTO_PATH` | `proto/notifications.proto` | en Docker, `/app/proto/notifications.proto` |

## Notas para quien consume este servicio

- `user_id` e `include_admin` los pone el BFF desde el JWT (`include_admin` = `role == "admin"`);
  nunca deben venir del cliente.
- Para la campanita: `GetUnreadCount` para el número y `ListNotifications` al abrirla.
- `MarkAsRead` con ids de otro usuario no falla: simplemente no los cuenta en `updated_count`.
- Si pierde la conexión con RabbitMQ, el proceso termina y Docker/Kubernetes lo reinicia
  (`restart: on-failure` en compose).

## Contratos

Los archivos de `proto/` son una **copia** de los de `TCGBackend/proto`, que es la fuente
de verdad. No se editan aquí: el cambio se acuerda con el equipo, se hace en `TCGBackend` y
se copia con `./scripts/sync-proto.sh` (desde TCGBackend).
