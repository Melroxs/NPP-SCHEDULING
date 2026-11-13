# Database & authorization tests

These tests execute the real migrations and then exercise row-level security,
guard triggers and constraints as the `anon`, `authenticated` and `service_role`
Postgres roles — the same roles PostgREST uses in production.

They run against **plain PostgreSQL 14+**, so no Docker or hosted Supabase
project is needed. `00_supabase_harness.sql` recreates the small part of Supabase
the migrations depend on (the `auth` schema, `auth.uid()`, and the default role
grants).

## Run

```bash
createdb npp_test

psql -d npp_test -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_harness.sql
for f in supabase/migrations/00*.sql; do
  psql -d npp_test -v ON_ERROR_STOP=1 -f "$f" || break
done
psql -d npp_test -v ON_ERROR_STOP=1 -f supabase/tests/02_seed_fixtures.sql

NPP_TEST_DB=npp_test bash supabase/tests/01_rls_security_tests.sh
```

Every assertion runs inside a transaction that is rolled back, so the suite is
repeatable and never mutates the fixtures. The script exits non-zero if any
assertion fails.

## Coverage

- **Read isolation** — technicians only see their own appointments; staff see all.
- **Credential columns** — `google_access_token` / `google_refresh_token` are
  unreadable by `authenticated`, readable by `service_role` (Edge Functions).
- **Privilege escalation** — technicians cannot change their own role, `active`
  flag or email; managers cannot change roles or touch administrators; managers
  can deactivate technicians; admins can change roles.
- **Role enumeration** — `ss_get_user_role()` no longer answers for other users.
- **Assignment integrity** — technicians cannot create appointments for a
  colleague or repoint an existing job at another technician/customer/address.
- **Double booking** — overlapping appointments are rejected by the exclusion
  constraint; back-to-back and cancelled slots are allowed.
- **Time integrity** — end-before-start ranges are rejected.
- **Notifications** — technicians cannot notify colleagues; notifications stay
  private to the recipient.
- **Anonymous access** — the `anon` role holds no `SELECT` grant on `ss_users`.

## Edge Function tests

```bash
deno check supabase/functions/admin-users/index.ts supabase/functions/google-oauth/index.ts
deno test --allow-env supabase/functions/_shared/auth.test.ts
```

This covers the server-side password policy, temporary-password generation and
role validation. Request authorization (`requireCaller`) needs a live Supabase
Auth service and is verified in staging, not here.

> These are test fixtures only. Never point this harness at a production
> database.
