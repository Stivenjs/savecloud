FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Copiar archivos de dependencias
COPY package.json bun.lock ./

# Instalar dependencias en producción
RUN bun install --frozen-lockfile --production --ignore-scripts

# Copiar código fuente
COPY apps/api ./apps/api
COPY tsconfig.json ./

# Exponer puerto HTTP de Fastify
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Ejecutar servidor Fastify directamente con Bun
CMD ["bun", "apps/api/src/interfaces/http/server.ts"]
