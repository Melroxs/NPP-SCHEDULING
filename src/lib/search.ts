/**
 * Strips the characters that carry meaning in a PostgREST filter expression so
 * a user-supplied search term cannot inject extra query conditions.
 */
export function sanitizeSearchTerm(term: string): string {
  return term
    .replace(/[,()"'\\%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}
