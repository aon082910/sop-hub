# SOP-Hub -- single all-in-one image: Postgres + the Node/Express API +
# the built React frontend (served statically by Express), matching the
# rest of the AoN-Unraid-Apps collection (one container, one /config volume).

# ---- frontend build ----
FROM node:20-alpine AS frontend-build
WORKDIR /app
# Empty base URL = same-origin requests, since this build is served by the
# same Express process as the API in the final image.
ENV VITE_API_BASE_URL=""
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- backend build ----
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY backend/package.json ./
RUN npm install
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build
RUN cp src/db/schema.sql dist/db/schema.sql
COPY --from=frontend-build /app/dist ./dist/public

# ---- final image ----
FROM node:20-alpine
WORKDIR /app

# postgresql16: embedded database, lives under /config so it's part of the
# one Unraid appdata folder. su-exec: drop from root to PUID/PGID, matching
# Unraid's appdata-ownership convention.
RUN apk add --no-cache postgresql16 postgresql16-contrib su-exec curl tzdata

ENV NODE_ENV=production \
    PORT=8080 \
    PGDATA=/config/postgres \
    UPLOAD_DIR=/config/uploads \
    POSTGRES_USER=sophub \
    POSTGRES_DB=sophub \
    AI_DEFAULT_PROVIDER=ollama

COPY backend/package.json ./
RUN npm install --omit=dev
COPY --from=backend-build /app/dist ./dist
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /config
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
