import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema/auth.js';
import { systemRoles } from '../db/schema/roles.js';

const emailArg = process.argv.find((a) => a.startsWith('--email='));
const email = emailArg?.slice('--email='.length);

if (!email) {
  console.error('Usage: adminPromote.ts --email=<email>');
  process.exit(1);
}

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = postgres(url, { max: 1 });

try {
  const db = drizzle(client);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));

  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  await db
    .insert(systemRoles)
    .values({ userId: user.id, role: 'admin' })
    .onConflictDoNothing();

  console.log(`User ${email} (${user.id}) promoted to admin`);
  process.exit(0);
} catch (err) {
  console.error('admin:promote failed:', err);
  process.exit(1);
} finally {
  await client.end();
}
