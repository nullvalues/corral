/** Coerce a Drizzle COUNT() result (Postgres returns bigint as string) to number. Null/undefined → 0. */
export function coerceCount(v: string | number | null | undefined): number {
  return Number(v ?? 0);
}

/** Coerce a Drizzle SUM() result (Postgres returns numeric/bigint as string) to number. Null/undefined → 0. */
export function coerceSum(v: string | number | null | undefined): number {
  return Number(v ?? 0);
}
