import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { users } from '../db/schema/auth.js';
import { systemRoles } from '../db/schema/roles.js';

// E2E helper: removes the 'applicant' system role from a user identified by
// --email. Used by the experience-verification E2E spec to turn a freshly
// signed-up account into a mentor-only account (the verification endpoint
// blocks anyone holding the 'applicant' role via denyRole, per ADR-035).

const emailArg = process.argv.find((a) => a.startsWith('--email='));
const email = emailArg?.slice('--email='.length);

if (!email) {
  console.error('Usage: stripApplicantRole.ts --email=<email>');
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
    .delete(systemRoles)
    .where(and(eq(systemRoles.userId, user.id), eq(systemRoles.role, 'applicant')));

  console.log(`Stripped 'applicant' role from ${email} (${user.id})`);
  process.exit(0);
} catch (err) {
  console.error('strip:applicant-role failed:', err);
  process.exit(1);
} finally {
  await client.end();
}
