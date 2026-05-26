# =============================================================
# TAGS TRACKER - Dockerfile Multi-Stage
# Otimizado para Easypanel / Docker Desktop
# =============================================================

# ─── Stage 1: Base de dependências ─────────────────────────────
FROM node:20-alpine AS deps

# Instala dependências do sistema necessárias para o Prisma
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# Copia apenas os arquivos de dependências para aproveitar o cache do Docker
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Instala dependências de produção
RUN npm ci --only=production

# Gera o Prisma Client
RUN npx prisma generate

# ─── Stage 2: Build / Runner ─────────────────────────────────────
FROM node:20-alpine AS runner

# Instala dependências do sistema (necessário para SQLite e Prisma em runtime)
RUN apk add --no-cache libc6-compat openssl

# Configurações de segurança: executa como usuário não-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 tracker

WORKDIR /app

# Copia node_modules já instalados e o Prisma Client gerado
COPY --from=deps --chown=tracker:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=tracker:nodejs /app/prisma ./prisma/

# Copia o código da aplicação
COPY --chown=tracker:nodejs server.js ./
COPY --chown=tracker:nodejs public ./public/
COPY --chown=tracker:nodejs package.json ./

# Cria o diretório de dados para o SQLite (será o volume montado)
RUN mkdir -p /app/data && chown -R tracker:nodejs /app/data

# Variáveis de ambiente padrão (podem ser sobrescritas no Easypanel)
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL="file:./data/tracking.db"

# Muda para usuário não-root
USER tracker

# Expõe a porta da aplicação
EXPOSE 3000

# Health check: verifica se o processo Node está vivo
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD pgrep -f "node server.js" || exit 1

# Roda as migrations e inicia o servidor
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
