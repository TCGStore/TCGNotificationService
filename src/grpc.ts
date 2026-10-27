import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ReflectionService } from "@grpc/reflection";
import { HealthImplementation } from "grpc-health-check";

import { InvalidNotificationId, type NotificationDoc, type NotificationStore, type Reader } from "./store.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Field names stay as in the .proto (keepCase), so reflection shows grpcurl the real contract.
interface ReaderRequest {
  user_id: string;
  include_admin: boolean;
}

interface ListRequest extends ReaderRequest {
  unread_only: boolean;
  page: number;
  page_size: number;
}

interface MarkAsReadRequest extends ReaderRequest {
  notification_ids: string[];
}

class RequestError extends Error {
  constructor(
    readonly code: grpc.status,
    message: string,
  ) {
    super(message);
  }
}

/** Loads the .proto at runtime, so there's no generated code to keep in sync. */
export function createGrpcServer(protoPath: string, store: NotificationStore): grpc.Server {
  const packageDefinition = protoLoader.loadSync(protoPath, { keepCase: true, enums: String, defaults: true });
  const proto = grpc.loadPackageDefinition(packageDefinition) as any;
  const server = new grpc.Server();

  server.addService(proto.tcgstore.notifications.NotificationsService.service, {
    ListNotifications: unary<ListRequest>(async (request) => {
      const { page, pageSize } = paging(request);
      const result = await store.list(reader(request), request.unread_only, page, pageSize);
      return { notifications: result.notifications.map(toProto), total_count: result.totalCount };
    }),
    GetUnreadCount: unary<ReaderRequest>(async (request) => ({ count: await store.unreadCount(reader(request)) })),
    MarkAsRead: unary<MarkAsReadRequest>(async (request) => {
      try {
        return { updated_count: await store.markAsRead(reader(request), request.notification_ids) };
      } catch (error) {
        if (error instanceof InvalidNotificationId) {
          throw new RequestError(grpc.status.INVALID_ARGUMENT, error.message);
        }
        throw error;
      }
    }),
  });

  // Not listed by reflection: @grpc/reflection can't describe the map field in the health .proto.
  // Kubernetes probes call it directly, so they work anyway.
  new HealthImplementation({ "": "SERVING" }).addToServer(server);
  // Lets grpcurl and Postman discover the API without the .proto file.
  new ReflectionService(packageDefinition).addToServer(server);
  return server;
}

function unary<Req>(handler: (request: Req) => Promise<object>): grpc.handleUnaryCall<Req, object> {
  return (call, callback) => {
    handler(call.request).then(
      (response) => callback(null, response),
      (error: unknown) => {
        if (error instanceof RequestError) {
          callback({ code: error.code, details: error.message });
          return;
        }
        console.error("unexpected error in gRPC call", error);
        callback({ code: grpc.status.INTERNAL, details: "internal error" });
      },
    );
  };
}

function reader(request: ReaderRequest): Reader {
  if (!request.user_id) {
    throw new RequestError(grpc.status.INVALID_ARGUMENT, "user_id is required");
  }
  return { userId: request.user_id, includeAdmin: request.include_admin };
}

function paging(request: ListRequest) {
  if (request.page < 0 || request.page_size < 0) {
    throw new RequestError(grpc.status.INVALID_ARGUMENT, "page and page_size can't be negative");
  }
  return {
    page: request.page || 1,
    pageSize: Math.min(request.page_size || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

function toProto(doc: NotificationDoc) {
  return {
    id: doc._id.toHexString(),
    type: `NOTIFICATION_TYPE_${doc.type}`,
    title: doc.title,
    message: doc.message,
    read: doc.read,
    created_at: doc.createdAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    order_id: doc.orderId ?? "",
    product_id: doc.productId ?? "",
  };
}
