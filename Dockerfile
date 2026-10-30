FROM node:22-slim AS build
WORKDIR /app
# Tests aren't run here, so skip downloading the MongoDB binary for mongodb-memory-server.
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PROTO_PATH=/app/proto/notifications.proto
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ dist/
COPY proto/notifications.proto proto/
USER node
EXPOSE 50055
CMD ["node", "dist/main.js"]
