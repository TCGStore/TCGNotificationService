// Turns RabbitMQ events (proto/events.md) into the text customers and admins see.
// User-facing text is in Spanish because the store's customers are.

export type NotificationType = "ORDER_CREATED" | "ORDER_CONFIRMED" | "ORDER_CANCELLED" | "LOW_STOCK";

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export type StoreEvent =
  | {
      type: "order.created";
      data: { orderId: string; userId: string; userEmail: string; items: OrderItem[]; totalCents: number };
    }
  | { type: "order.confirmed"; data: { orderId: string; userId: string; userEmail: string; totalCents: number } }
  | {
      type: "order.cancelled";
      data: { orderId: string; userId: string; userEmail: string; reason: "OUT_OF_STOCK" | "PAYMENT_DECLINED" };
    }
  | { type: "stock.low"; data: { productId: string; available: number; threshold: number } };

export interface NotificationContent {
  type: NotificationType;
  title: string;
  message: string;
  // "user" notifications belong to userId; "admin" ones are shared by every admin.
  audience: "user" | "admin";
  userId?: string;
  orderId?: string;
  productId?: string;
  email: { to: string[]; subject: string; text: string };
}

const CANCELLATION_TEXT = {
  OUT_OF_STOCK: "no había stock suficiente de uno o más productos",
  PAYMENT_DECLINED: "el pago fue rechazado",
} as const;

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function buildNotification(event: StoreEvent, adminEmails: string[]): NotificationContent {
  switch (event.type) {
    case "order.created": {
      const { orderId, userId, userEmail, items, totalCents } = event.data;
      const lines = items.map(
        (item) => `- ${item.quantity} x ${item.name} (${formatMoney(item.unitPriceCents * item.quantity)})`,
      );
      return {
        type: "ORDER_CREATED",
        title: "Recibimos tu pedido",
        message: `Tu pedido ${orderId} por ${formatMoney(totalCents)} está en proceso.`,
        audience: "user",
        userId,
        orderId,
        email: {
          to: [userEmail],
          subject: `Recibimos tu pedido ${orderId}`,
          text: [
            "¡Hola!",
            "",
            `Recibimos tu pedido ${orderId}. Estamos reservando el stock y procesando el pago.`,
            "",
            ...lines,
            "",
            `Total: ${formatMoney(totalCents)}`,
          ].join("\n"),
        },
      };
    }
    case "order.confirmed": {
      const { orderId, userId, userEmail, totalCents } = event.data;
      const message = `Tu pedido ${orderId} por ${formatMoney(totalCents)} fue confirmado. ¡Gracias por tu compra!`;
      return {
        type: "ORDER_CONFIRMED",
        title: "Pedido confirmado",
        message,
        audience: "user",
        userId,
        orderId,
        email: { to: [userEmail], subject: `Pedido ${orderId} confirmado`, text: message },
      };
    }
    case "order.cancelled": {
      const { orderId, userId, userEmail, reason } = event.data;
      const message = `Tu pedido ${orderId} fue cancelado porque ${CANCELLATION_TEXT[reason]}. No se realizó ningún cobro.`;
      return {
        type: "ORDER_CANCELLED",
        title: "Pedido cancelado",
        message,
        audience: "user",
        userId,
        orderId,
        email: { to: [userEmail], subject: `Pedido ${orderId} cancelado`, text: message },
      };
    }
    case "stock.low": {
      const { productId, available, threshold } = event.data;
      const message = `Quedan ${available} unidades de ${productId} (el umbral es ${threshold}).`;
      return {
        type: "LOW_STOCK",
        title: "Stock bajo",
        message,
        audience: "admin",
        productId,
        email: { to: adminEmails, subject: `Stock bajo: ${productId}`, text: message },
      };
    }
  }
}
