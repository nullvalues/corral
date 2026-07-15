import { db } from '../db/index.js';
import { experienceCategories } from '../db/schema/index.js';
import { asc, desc, eq } from 'drizzle-orm';

export async function listCategories() {
  return db
    .select()
    .from(experienceCategories)
    .orderBy(asc(experienceCategories.sortOrder), desc(experienceCategories.isActive));
}

export async function createCategory(data: {
  slug: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
  goalHours?: number | null;
}) {
  const [row] = await db
    .insert(experienceCategories)
    .values({
      slug: data.slug,
      name: data.name,
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
      goalHours: data.goalHours ?? null,
    })
    .returning();
  return row;
}

export async function getCategoryById(id: string) {
  const [row] = await db.select().from(experienceCategories).where(eq(experienceCategories.id, id)).limit(1);
  return row ?? null;
}

export async function updateCategory(id: string, data: {
  slug?: string;
  name?: string;
  sortOrder?: number;
  isActive?: boolean;
  goalHours?: number | null;
}) {
  const [row] = await db
    .update(experienceCategories)
    .set(data)
    .where(eq(experienceCategories.id, id))
    .returning();
  return row ?? null;
}

function isFkViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // Direct postgres error (err.code === '23503')
  if ('code' in err && (err as { code: unknown }).code === '23503') return true;
  // Drizzle wraps postgres errors in DrizzleQueryError — check the cause
  if ('cause' in err) {
    const cause = (err as { cause: unknown }).cause;
    if (cause && typeof cause === 'object' && 'code' in cause && (cause as { code: unknown }).code === '23503') return true;
  }
  return false;
}

export type DeleteCategoryResult =
  | { outcome: 'deleted' }
  | { outcome: 'not_found' }
  | { outcome: 'in_use' };

export async function deleteCategory(id: string): Promise<DeleteCategoryResult> {
  try {
    const result = await db
      .delete(experienceCategories)
      .where(eq(experienceCategories.id, id))
      .returning({ id: experienceCategories.id });
    return result.length > 0 ? { outcome: 'deleted' } : { outcome: 'not_found' };
  } catch (err) {
    if (isFkViolation(err)) {
      return { outcome: 'in_use' };
    }
    throw err;
  }
}
