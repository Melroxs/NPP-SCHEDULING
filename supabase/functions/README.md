# Supabase Edge Functions

These functions hold every privileged operation that must not run in the browser.
The frontend only ever has the public anon key.

| Function | Purpose | Caller authorization |
| --- | --- | --- |
| `admin-users` | Create / delete portal users and set passwords. Creates the `auth.users` record and the `ss_users` profile together. | `admin` for any role; `manager` for `technician` and `scheduler` only. Deletion is admin-only. |
| `google-oauth` | Exchanges Google authorization codes, refreshes access tokens, stores refresh tokens. | Self, or `admin` / `manager` / `scheduler` acting on a technician's calendar. |

## Deploy

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy admin-users
supabase functions deploy google-oauth
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the Supabase platform — never set them yourself.

## Required secrets

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID="<oauth client id>" \
  GOOGLE_CLIENT_SECRET="<oauth client secret>" \
  GOOGLE_REDIRECT_URI="https://your-production-domain/auth/google/callback"
```

`GOOGLE_REDIRECT_URI` must exactly match the redirect URI registered on the
Google OAuth client. The function rejects any client-supplied redirect that
differs from it.

## Local development

Create `supabase/functions/.env` with the three `GOOGLE_*` values, then:

```bash
supabase functions serve --env-file supabase/functions/.env
```
