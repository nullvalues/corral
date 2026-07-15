import 'dotenv/config';
import path from 'path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = postgres(url, { max: 1 });

try {
  const localDb = drizzle(client);
  await migrate(localDb, { migrationsFolder: path.join(import.meta.dirname, '../../drizzle') });
  console.log('migrations applied successfully');
  process.exit(0);
} catch (err) {
  console.error('migration failed:', err);
  process.exit(1);
} finally {
  await client.end();
}
