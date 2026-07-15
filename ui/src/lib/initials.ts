/**
 * Derive uppercase initials from a display name.
 *
 * - Multi-word names: first character of the first word + first character of
 *   the last word (e.g. "Ada Lovelace" → "AL").
 * - Single-word names: first character only (e.g. "Cher" → "C").
 * - Empty or whitespace-only input: "?".
 * - Extra internal whitespace is ignored.
 *
 * Reconciliation note (UI-094): five copies existed with minor differences.
 * TalentPoolPage/RisingCandidatesCard returned slice(0,2) for single-word
 * names; the other copies returned only the first character. The test spec
 * requires single-word → single char, so the VerificationQueueCard /
 * HomePage approach wins. Whitespace normalisation (trim + split on /\s+/ +
 * filter) comes from the TalentPoolPage variant — the most robust form.
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase();
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}
