/**
 * Drizzle Kit configuration.
 *
 * This is ONE of the three approved readers of `process.env` in the api
 * package (the others being `src/lib/config.ts` and `src/db/index.ts`).
 *
 * drizzle-kit is a CLI tool that runs outside the Fastify process, so it
 * cannot rely on the typed config layer that validates at module load time.
 * We read DATABASE_URL directly from process.env here.
 *
 * drizzle-kit ≥0.31 auto-loads `.env` but not `.env.local`. Load it explicitly
 * so local dev workflows (which store credentials in .env.local) work without
 * requiring the caller to export DATABASE_URL manually.
 */
import { config } from 'dotenv';
config({ path: '.env.local', override: false });

import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? '',
  },
} satisfies Config;
