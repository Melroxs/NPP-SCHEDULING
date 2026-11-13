interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string;
}

/**
 * Converts a PostgREST/Postgres error into something an operator can act on.
 * Never surfaces raw driver text such as table or policy internals.
 */
export function describeDbError(error: unknown, fallback: string): string {
  if (!error) return fallback;

  const err = error as PostgrestLikeError;
  const message = err.message ?? '';

  switch (err.code) {
    case '23P01':
      return 'That technician is already booked for this time slot. Choose another slot or technician.';
    case '23505':
      return 'That record already exists.';
    case '23514':
      return 'The appointment times are invalid: the end time must be after the start time.';
    case '42501':
      return 'You do not have permission to perform this action.';
    case 'P0001':
      // Raised deliberately by our guard triggers; the message is user-safe.
      return message || fallback;
    case 'PGRST301':
      return 'Your session has expired. Please sign in again.';
    default:
      break;
  }

  if (/permission denied/i.test(message)) {
    return 'You do not have permission to perform this action.';
  }
  if (/exclusion constraint|conflicting key value/i.test(message)) {
    return 'That technician is already booked for this time slot. Choose another slot or technician.';
  }
  if (/jwt|token/i.test(message) && /expired|invalid/i.test(message)) {
    return 'Your session has expired. Please sign in again.';
  }

  return fallback;
}
