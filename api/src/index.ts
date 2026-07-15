import { buildApp } from './app.js';
import { config } from './lib/config.js';

const app = await buildApp();

await app.listen({ port: config.PORT, host: '0.0.0.0' });

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
