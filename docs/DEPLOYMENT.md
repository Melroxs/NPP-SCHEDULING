# Deployment & rollback runbook

Status: the application builds and its database layer is verified locally, but
**no staging deployment has been performed yet** — see "Access required" below.

## Access required before staging work can continue

| Requirement | Why |
| --- | --- |
| Supabase **staging** project ref (`https://<ref>.supabase.co`) | Required to link the CLI and confirm staging vs production |
| Supabase **anon key** for staging | Frontend build (`VITE_SUPABASE_ANON_KEY`) |
| Supabase **access token** (`sbp_…`) or CLI login | `supabase link`, `db push`, `functions deploy`, `secrets set` |
| Confirmation that the target is staging | Prevents applying migrations to production by mistake |
| Google OAuth client id + secret + redirect URI | `google-oauth` Edge Function secrets |
| Four staging test accounts (admin, manager, scheduler, technician) | Role and workflow testing |

The `service_role` key must never be needed outside Supabase; Edge Functions
receive it automatically.

## Environment variables

Frontend (`VITE_*` — **public, compiled into the bundle**):

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | yes | Public anon key; RLS enforces access |
| `VITE_ORS_API_KEY` | optional | OpenRouteService; restrict by HTTP referrer |
| `VITE_GOOGLE_CLIENT_ID` | optional | Public OAuth client id only |
| `VITE_FIREBASE_*` | optional | Push notifications; app degrades silently if unset |

Server-only (Supabase Edge Function secrets):

| Secret | Required |
| --- | --- |
| `GOOGLE_CLIENT_ID` | for Google Calendar |
| `GOOGLE_CLIENT_SECRET` | for Google Calendar |
| `GOOGLE_REDIRECT_URI` | must equal `https://<domain>/auth/google/callback` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected by
the platform — do not set them.

> **Never** put `GOOGLE_CLIENT_SECRET` in a `VITE_` variable. Anything prefixed
> `VITE_` is served to every visitor.

## Open item (manual)

`.env.example` still contains the obsolete line:

```
VITE_GOOGLE_CLIENT_SECRET=your-google-client-secret
```

It must be deleted (the app no longer reads it, and a real value there would be
published in the bundle). Environment files are protected from automated edits,
so this needs a manual change.

## Staging checklist

### 1. Pre-flight (no changes)

```bash
npm ci
npm run lint && npm run typecheck && npm run test && npm run build
npm audit --omit=dev          # expect: 0 vulnerabilities
deno check supabase/functions/admin-users/index.ts supabase/functions/google-oauth/index.ts
```

Confirm the target project before every write:

```bash
supabase projects list        # note the ref you intend to use
supabase link --project-ref <STAGING_REF>
cat supabase/.temp/project-ref   # must be the STAGING ref
```

### 2. Back up before migrating

```bash
supabase db dump -f backup_pre_006.sql
```

Confirm the project has daily backups (or PITR) enabled.

### 3. Overlap pre-check (blocking)

Run against staging **before** applying migration 006:

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

- **No rows** → proceed.
- **Any rows** → **stop**. Report the pairs and get approval. Do not cancel,
  reschedule or delete appointments automatically.

### 4. Apply migrations

```bash
supabase db push      # 001 → 006 in order; each runs in a transaction
```

If 006 aborts with `Cannot enforce double-booking protection`, it means
conflicts exist — resolve them with approval, then re-run (the file is
idempotent).

### 5. Edge Functions

```bash
supabase functions deploy admin-users
supabase functions deploy google-oauth
supabase secrets set \
  GOOGLE_CLIENT_ID="…" \
  GOOGLE_CLIENT_SECRET="…" \
  GOOGLE_REDIRECT_URI="https://<staging-domain>/auth/google/callback"
```

Then verify unauthorized access is rejected:

```bash
# Unauthenticated: expect 401
curl -i -X POST "https://<ref>.supabase.co/functions/v1/admin-users" \
  -H "Content-Type: application/json" \
  -d '{"action":"create","name":"x","email":"x@example.com","role":"admin"}'

# Authenticated as a technician: expect 403 (create a different role)
curl -i -X POST "https://<ref>.supabase.co/functions/v1/admin-users" \
  -H "Authorization: Bearer <TECHNICIAN_JWT>" -H "Content-Type: application/json" \
  -d '{"action":"create","name":"x","email":"x2@example.com","role":"admin"}'
```

### 6. Frontend

Set the `VITE_*` variables in the hosting provider, configure the SPA rewrite
(`vercel.json` is committed), and set the Supabase Auth **Site URL** and allowed
redirect URLs to the staging origin.

### 7. Verification matrix

| Area | Check |
| --- | --- |
| Auth | Login/logout for all four roles; session survives refresh; password reset email arrives; deactivated user is signed out |
| Admin | Create user (one-time password shown once), change role, deactivate/reactivate |
| Manager | Dispatch board, assign/reassign technician, reschedule, reports |
| Scheduler | Create booking, edit, cancel |
| Technician | Sees only own jobs; status updates work; other technician's job returns no rows |
| Scheduling | Create → assign → reassign → reschedule → cancel → complete; data persists after logout/login |
| Integrity | Conflicting assignment rejected in the UI **and** via direct API |
| Escalation | `PATCH /rest/v1/ss_users?id=eq.<self>` with `{"role":"admin"}` returns an error |
| UI | Desktop, tablet, mobile; console free of errors |

## Rollback plan

Migration 006 is **additive and configuration-only** — it changes grants,
triggers and constraints but never rewrites rows. Rollback therefore needs no
data restoration.

### Frontend

Redeploy the previous commit (`5361336` is the last pre-verification state, or
the last known-good deployment). Static hosting rollback is instant and safe.

### Edge Functions

`supabase functions deploy <name>` from the previous commit. Functions hold no
state.

### Database (only if 006 must be undone)

```sql
BEGIN;
DROP TRIGGER IF EXISTS ss_appointments_guard_update ON public.ss_appointments;
DROP TRIGGER IF EXISTS ss_users_guard_privileges ON public.ss_users;
ALTER TABLE public.ss_appointments DROP CONSTRAINT IF EXISTS ss_appointments_no_overlap;
ALTER TABLE public.ss_appointments DROP CONSTRAINT IF EXISTS ss_appointments_time_order_check;

-- Restores broad column access on ss_users (re-exposes Google tokens to the
-- browser — only do this together with redeploying the pre-hardening frontend).
GRANT SELECT ON public.ss_users TO authenticated;
COMMIT;
```

Deliberately **not** rolled back: the `ss_get_user_role()` restriction, which
prevents role enumeration and has no dependency on application code.

### Point-in-time recovery

If data is ever damaged, use Supabase PITR / a restore to a new project, verify,
then repoint the frontend. Never restore over production without explicit
approval.

## Rollback triggers

- Any migration error or lock/timeout during `db push`.
- Booking creation returning errors for valid, non-overlapping times.
- Any role seeing data it should not.
- Elevated error rates or Edge Function 5xx after deploy.

## Release gate

Production deploy and merging to `main` require explicit approval, and must be
preceded by a fully passed staging verification of the matrix above.
