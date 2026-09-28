# STAGE 1: Builder (Compilación y Bundling)

FROM oven/bun:1.2-alpine AS builder
WORKDIR /app

# Copiar manifiestos y configuración de TypeScript para workspaces
COPY bunfig.toml package.json bun.lock tsconfig.json ./
COPY packages/types ./packages/types
COPY packages/crawler/package.json ./packages/crawler/
COPY apps/api/package.json ./apps/api/
COPY apps/cli/package.json ./apps/cli/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/web/package.json ./apps/web/
COPY apps/bun-lambda/package.json ./apps/bun-lambda/

# Instalar todas las dependencias del workspace
RUN bun install --frozen-lockfile --linker hoisted

# Copiar código fuente de la API
COPY apps/api ./apps/api

# Compilar y empaquetar la aplicación TypeScript a JavaScript para Bun
RUN bun build apps/api/src/interfaces/http/server.ts --target bun --outdir ./dist
RUN bun build apps/api/src/interfaces/worker/steam-seed-worker.ts --target bun --outfile ./dist/steam-seed-worker.js
RUN bun build apps/api/src/interfaces/worker/storage-bootstrap.ts --target bun --outfile ./dist/storage-bootstrap.js


# STAGE 2: Production Runner

FROM oven/bun:1.2-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copiar únicamente los bundles ya compilados; sus dependencias npm se integran en ellos.
COPY --from=builder /app/dist ./dist

# Exponer puerto HTTP de Fastify
EXPOSE 3000

# Ejecutar el bundle de producción compilado
CMD ["bun", "dist/server.js"]
