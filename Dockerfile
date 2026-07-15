# Stage 1 — builder: install all deps and build UI + API bundles
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY api/package.json ./api/
COPY ui/package.json ./ui/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:bundle

# Stage 2 — runtime: production-only node_modules + built artefacts
FROM node:20-alpine AS runtime
RUN apk add --no-cache curl
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=builder /app/api/package.json ./api/
COPY --from=builder /app/ui/package.json ./ui/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/api/dist ./api/dist
COPY --from=builder /app/api/drizzle ./api/drizzle
COPY --from=builder /app/ui/dist ./ui/dist
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh
ENV NODE_ENV=production
ENV STATIC_UI_ROOT=/app/ui/dist
EXPOSE 6040
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["serve"]
