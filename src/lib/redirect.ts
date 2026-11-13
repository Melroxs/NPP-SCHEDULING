/**
 * Only same-origin, absolute paths are accepted as a post-login destination.
 * This prevents `?redirect=https://evil.example` open-redirect abuse.
 */
export function safeRedirect(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}
