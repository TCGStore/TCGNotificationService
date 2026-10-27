# Build context is the repo root (the image needs proto/notifications.proto at runtime):
#   docker build -f services/notifications-service/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
# Tests aren't run here, so skip downloading the MongoDB binary for mongodb-memory-server.
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY services/notifications-service/package.json services/notifications-service/package-lock.json ./
RUN npm ci
COPY services/notifications-service/tsconfig.json services/notifications-service/tsconfig.build.json ./
COPY services/notifications-service/src/ src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PROTO_PATH=/app/proto/notifications.proto
COPY services/notifications-service/package.json services/notifications-service/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ dist/
COPY proto/notifications.proto proto/
USER node
EXPOSE 50055
CMD ["node", "dist/main.js"]
