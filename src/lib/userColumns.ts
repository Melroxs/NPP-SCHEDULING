/**
 * Columns of ss_users that are safe to send to the browser.
 *
 * `google_access_token` / `google_refresh_token` are revoked from the
 * `authenticated` role at the database level (migration 006), so a
 * `select('*')` on ss_users fails. Always select through these allowlists.
 *
 * Declared as literals so Supabase's typed query parser can read them.
 */
const PLAIN_COLUMNS =
  'id, name, email, phone, role, active, google_account_id, google_calendar_id, google_token_expires_at, calendar_connected, created_at, updated_at';

export const USER_PUBLIC_COLUMNS = PLAIN_COLUMNS;

/** Embedded select for appointments -> technician. */
export const USER_TECHNICIAN_EMBED = `technician:ss_users!ss_appointments_technician_id_fkey(${PLAIN_COLUMNS})`;

/** Appointment row plus all display relations. */
export const APPOINTMENT_WITH_RELATIONS = `*, customer:ss_customers(*), ${USER_TECHNICIAN_EMBED}, address:ss_addresses(*)`;
