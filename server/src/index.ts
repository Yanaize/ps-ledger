import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, rootDir } from './config/env.js';
import { createAppContext } from './appContext.js';
import { registerRoutes } from './routes/index.js';
import { logger } from './lib/logger.js';

async function main() {
  const env = loadEnv();
  const ctx = createAppContext(env);

  const app = Fastify({
    logger: true,
    trustProxy: true,
  });

  await app.register(cors, { origin: true });
  await registerRoutes(app, ctx);

  const webDist = path.join(rootDir, 'web', 'dist');
  if (fs.existsSync(webDist)) {
    // Hashed assets can be cached; the HTML shell must not be — it points at those hashes.
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: true,
      index: false,
      maxAge: '7d',
      immutable: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    });
    const sendIndex = (reply: import('fastify').FastifyReply) => {
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      return reply.sendFile('index.html');
    };
    app.get('/', async (_req, reply) => sendIndex(reply));
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'API route not found' });
      }
      return sendIndex(reply);
    });
  } else {
    app.get('/', async (_req, reply) => {
      reply.type('text/html').send(`<!doctype html>
<html><body style="font-family:sans-serif;background:#0b0f14;color:#e8eef5;padding:2rem">
<h1>PS Price Compare API</h1>
<p>Web UI not built yet. Run <code>npm run build</code> or <code>npm run dev</code>.</p>
<p>API health: <a href="/api/health" style="color:#6cf">/api/health</a></p>
</body></html>`);
    });
  }

  await app.listen({ port: env.PORT, host: env.BIND_HOST });

  ctx.refresh.startAutoRefresh();
  ctx.priceCollector.start();

  const shutdown = () => {
    ctx.refresh.stopAutoRefresh();
    ctx.priceCollector.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.info(`Listening on http://${env.BIND_HOST}:${env.PORT}`);
  for (const ip of ctx.lanAddresses) {
    logger.info(`LAN: http://${ip}:${env.PORT}`);
  }
  console.log('\nPS Price Compare is running');
  console.log(`  Local:   http://127.0.0.1:${env.PORT}`);
  for (const ip of ctx.lanAddresses) {
    console.log(`  Network: http://${ip}:${env.PORT}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
