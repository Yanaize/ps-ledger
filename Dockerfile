# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/

RUN npm ci

COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web

RUN npm run build -w web

# --- runtime ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    BIND_HOST=0.0.0.0 \
    DB_PATH=/app/data/ps-price-compare.sqlite

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/

RUN npm ci --omit=dev && npm cache clean --force

COPY shared shared
COPY server server
COPY --from=build /app/web/dist web/dist

RUN mkdir -p /app/data

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
