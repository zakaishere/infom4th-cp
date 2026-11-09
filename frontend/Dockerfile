FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Official language documentation for the editor's reference panel (about 340 MB of static files).
# Docker caches this step, so it only downloads again when the install script changes;
# `docker compose build --no-cache frontend` fetches newer docs.
FROM node:20-bookworm-slim AS refdocs
WORKDIR /docs
COPY scripts/install-docs.mjs ./
RUN node install-docs.mjs --out /docs/out

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=refdocs /docs/out /usr/share/nginx/html/refdocs
