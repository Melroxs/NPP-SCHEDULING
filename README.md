# NPP Scheduling Portal

Field-service scheduling, dispatch and technician portal for New Paradigm
Projects (NPP).

- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS 4, shadcn/ui, FullCalendar, Leaflet
- **Backend:** Supabase (Postgres + PostgREST + Auth) with row-level security
- **Server-side operations:** Supabase Edge Functions (`supabase/functions`)
- **PWA:** installable, offline shell, optional Firebase Cloud Messaging push

There is no custom API server. All data access goes through Supabase with RLS
enforced in the database; operations that need elevated privileges run in Edge
Functions. **The browser only ever holds the public anon key.**

## Roles

| Role | Portal |
| --- | --- |
| `admin` | User management, all operational views, settings |
| `manager` | Dispatch, calendars, technician/scheduler management, reports |
| `scheduler` | Bookings, calendars, customers |
| `technician` | Own appointments, route map, availability |

## Local setup

```bash
npm ci
cp .env.example .env.local     # then fill in the required values
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run lint` | ESLint (zero errors/warnings expected) |
| `npm run typecheck` | TypeScript project check |
| `npm run test` | Unit tests (Vitest) |
| `npm run build` | Production build into `dist/` |

Database/authorization tests and Edge Function checks are documented in
`supabase/tests/README.md` (they need a local PostgreSQL 14+ and Deno).

## Environment variables

See `.env.example`. Anything prefixed `VITE_` is **public** — it is compiled
into the JavaScript bundle.

Required:

| Variable | Notes |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (protected by RLS) |

Optional: `VITE_ORS_API_KEY` (drive times), `VITE_GOOGLE_CLIENT_ID`,
`VITE_FIREBASE_*` (push notifications).

Server-only secrets (Supabase Edge Function secrets, never `VITE_*`):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing, the app renders a
configuration notice instead of a blank page.

## Database

Migrations live in `supabase/migrations` and run in order:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

| Migration | Contents |
| --- | --- |
| `001` | Base schema, RLS, updated_at triggers |
| `002` | `admin` role + admin policies |
| `003` | Device token columns and constraints |
| `004` | Technician CRUD policies |
| `005` | Google Calendar columns, sync log table |
| `006` | Security hardening (see below) |

**Before applying `006`** on a database with existing data, check for
overlapping appointments, because it adds a double-booking exclusion
constraint:

```sql
SELECT a.id, b.id
FROM ss_appointments a
JOIN ss_appointments b
  ON a.technician_id = b.technician_id
 AND a.id < b.id
 AND tstzrange(a.start_time, a.end_time) && tstzrange(b.start_time, b.end_time)
WHERE a.status NOT IN ('cancelled','no_show')
  AND b.status NOT IN ('cancelled','no_show');
```

The migration aborts with an explanatory message rather than modifying data if
conflicts exist. Resolve them (cancel or reschedule the duplicate) and re-run.
The migration is idempotent and has been verified against a database containing
a conflicting pair (aborts, data untouched) and after resolution (applies).

## Edge Functions

Two functions hold privileged logic. See `supabase/functions/README.md`.

```bash
supabase functions deploy admin-users
supabase functions deploy google-oauth
```

Without these deployed, creating users and connecting Google Calendar will
fail with a clear error. Everything else works.

## Security model

- **Passwords** are hashed and managed by Supabase Auth (bcrypt). The
  application never stores or logs a password.
- **No hardcoded credentials.** No default or temporary password exists in the
  source. Account creation generates a cryptographically random one-time
  password server-side and returns it once to the authorized administrator.
- **Privilege escalation** is blocked by a database trigger: only admins may
  change a user's `role` or email. Managers may deactivate/reactivate
  technicians and schedulers (but not themselves or administrators). RBAC is
  enforced by RLS policies, not the UI.
- **Google OAuth secrets** (client secret, refresh tokens) never reach the
  browser; token exchange and refresh happen in `google-oauth`.
- **Refresh tokens are not readable** by the `authenticated` Postgres role
  (column-level grants).
- **Technicians** can only read appointments assigned to them, can only create
  appointments for themselves, and cannot reassign a job to another technician
  or change its customer/address (enforced by trigger).
- **Double bookings** are rejected by a database exclusion constraint, which
  also holds under concurrent writes.
- **Sessions** are refreshed by Supabase; deactivated accounts are signed out
  on their next request and on profile load.
- **Open redirects** are blocked: post-login redirects accept only same-origin
  absolute paths.
- **Search input** is sanitized before being placed in PostgREST filters.

## Deployment

The build is static (`dist/`). Configure:

1. Build command `npm run build`, output directory `dist`.
2. SPA rewrite of all paths to `/index.html` (`vercel.json` is included).
3. Production environment variables from the table above.
4. HTTPS only. Set the Supabase Auth **Site URL** and allowed redirect URLs to
   the production origin, and register
   `https://<domain>/auth/google/callback` with Google if Calendar is used.

Recommended Supabase Auth settings for production: email confirmation on,
minimum password length 12, and leaked-password protection enabled.

## Known limitations

- Push notifications require Firebase configuration; they are optional and
  degrade silently when unconfigured.
- Google Calendar sync failures are logged to `ss_calendar_sync_logs` and do
  not block booking creation.
- User email addresses can only be changed by an administrator (via the
  Supabase dashboard); the account page shows the address read-only.
