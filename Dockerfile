# STAGE 1: Builder (Compilación y Bundling)

FROM oven/bun:1.2-alpine AS builder
WORKDIR /app

# Copiar manifiestos y configuración de TypeScript para workspaces
COPY bunfig.toml package.json bun.lock tsconfig.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/
COPY apps/cli/package.json ./apps/cli/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/web/package.json ./apps/web/
COPY apps/bun-lambda/package.json ./apps/bun-lambda/

# Instalar todas las dependencias del workspace
RUN bun install --frozen-lockfile

# Copiar código fuente de la API
COPY apps/api ./apps/api

# Compilar y empaquetar la aplicación TypeScript a JavaScript para Bun
RUN bun build apps/api/src/interfaces/http/server.ts --target bun --outdir ./dist


# STAGE 2: Production Runner

FROM oven/bun:1.2-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copiar manifiestos e instalar solo dependencias de producción
COPY bunfig.toml package.json bun.lock ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/
COPY apps/cli/package.json ./apps/cli/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/web/package.json ./apps/web/
COPY apps/bun-lambda/package.json ./apps/bun-lambda/
RUN bun install --frozen-lockfile --production --ignore-scripts

# Copiar el artefacto compilado desde el builder stage
COPY --from=builder /app/dist ./dist

# Exponer puerto HTTP de Fastify
EXPOSE 3000

# Ejecutar el bundle de producción compilado
CMD ["bun", "dist/server.js"]
