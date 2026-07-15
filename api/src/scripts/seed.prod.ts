import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { CATEGORIES } from '../db/seed.js';
import { experienceCategories } from '../db/schema/index.js';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = postgres(url, { max: 1 });

try {
  const db = drizzle(client);

  await db.insert(experienceCategories).values(CATEGORIES).onConflictDoNothing();

  console.log(`seed:prod complete — ${CATEGORIES.length} categories seeded (idempotent)`);
  process.exit(0);
} catch (err) {
  console.error('seed:prod failed:', err);
  process.exit(1);
} finally {
  await client.end();
}
