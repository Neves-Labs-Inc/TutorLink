# Production web image: the built dashboard served by Caddy, which also proxies the API.
# Build context is the repo root (docker build -f docker/web.Dockerfile .) so the Caddyfile
# is reachable; web.Dockerfile.dockerignore trims the context to what this build reads.
FROM node:22-alpine AS build

WORKDIR /app

COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci

COPY dashboard/ ./
# Empty base URL: the browser calls the API same-origin through Caddy (D-012, no CORS).
ENV VITE_API_BASE_URL=""
RUN npm run build

FROM caddy:2-alpine

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
