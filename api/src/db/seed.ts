import { fileURLToPath } from 'url';
import { db } from './index.js';
import { experienceCategories, readinessConfig } from './schema/index.js';

export const CATEGORIES = [
  { slug: 'patient-care-experience', name: 'Patient Care Experience', sortOrder: 10, goalHours: 1000 },
  { slug: 'healthcare-experience',   name: 'Healthcare Experience',   sortOrder: 20, goalHours: 500 },
  { slug: 'volunteer-experience',    name: 'Volunteer Experience',    sortOrder: 30, goalHours: 300 },
  { slug: 'employment',              name: 'Employment',              sortOrder: 40, goalHours: null },
  { slug: 'research-experience',     name: 'Research Experience',     sortOrder: 50, goalHours: 300 },
  { slug: 'extracurricular-activities', name: 'Extracurricular Activities', sortOrder: 60, goalHours: null },
];

export async function seed() {
  await db.insert(experienceCategories).values(CATEGORIES).onConflictDoNothing();
  await db
    .insert(readinessConfig)
    .values({ id: 'default', wGoal: 0.6, wVerified: 0.25, wBreadth: 0.15 })
    .onConflictDoNothing();
}

// Guard so importing CATEGORIES in tests does not trigger a live DB call.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
