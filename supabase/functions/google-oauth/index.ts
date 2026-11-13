// Google Calendar OAuth token brokerage.
//
// The OAuth client secret and refresh tokens must never reach the browser, so
// exchange/refresh happens here and only short-lived access tokens are returned.

import {
  HttpError,
  errorResponse,
  json,
  requireCaller,
  serviceClient,
  type Caller,
} from '../_shared/auth.ts';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_LIST = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface ExchangeBody {
  action: 'exchange';
  code?: string;
  redirect_uri?: string;
}

interface AccessTokenBody {
  action: 'access_token';
  user_id?: string;
}

interface DisconnectBody {
  action: 'disconnect' | 'status';
  user_id?: string;
}

type Body = ExchangeBody | AccessTokenBody | DisconnectBody;

function googleCredentials() {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new HttpError(
      500,
      'Google Calendar is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)',
    );
  }
  return { clientId, clientSecret };
}

function resolveRedirectUri(provided?: string): string {
  const allowed = Deno.env.get('GOOGLE_REDIRECT_URI') ?? Deno.env.get('APP_URL');
  if (!allowed) throw new HttpError(500, 'GOOGLE_REDIRECT_URI is not configured');
  const expected = allowed.endsWith('/auth/google/callback') ? allowed : `${allowed.replace(/\/$/, '')}/auth/google/callback`;
  // Reject any client-supplied redirect that does not exactly match the
  // registered callback (prevents token redirection to another origin).
  if (provided && provided !== expected) {
    throw new HttpError(400, 'Invalid redirect URI');
  }
  return expected;
}

async function upsertProfile(userId: string, values: Record<string, unknown>) {
  const { error } = await serviceClient().from('ss_users').update(values).eq('id', userId);
  if (error) throw new HttpError(500, 'Could not persist the calendar connection');
}

async function logSync(
  userId: string,
  action: 'create' | 'update' | 'delete' | 'sync' | 'token_refresh',
  status: 'success' | 'failed',
  details?: string,
) {
  await serviceClient()
    .from('ss_calendar_sync_logs')
    .insert({ user_id: userId, action, status, details });
}

/** Staff may operate a technician's calendar; nobody else may act for another user. */
async function assertCanActFor(caller: Caller, userId: string) {
  if (caller.id === userId) return;
  if (!['admin', 'manager', 'scheduler'].includes(caller.role)) {
    throw new HttpError(403, 'You cannot access another user’s calendar');
  }
  const { data, error } = await serviceClient()
    .from('ss_users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Could not verify calendar permissions');
  if (!data) throw new HttpError(404, 'User not found');
  if (data.role !== 'technician') {
    throw new HttpError(403, 'You can only manage a technician’s calendar');
  }
}

async function exchange(caller: Caller, body: ExchangeBody) {
  if (typeof body.code !== 'string' || !body.code.trim()) {
    throw new HttpError(400, 'Authorization code is required');
  }
  const { clientId, clientSecret } = googleCredentials();
  const redirectUri = resolveRedirectUri(body.redirect_uri);

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: body.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    await logSync(caller.id, 'sync', 'failed', 'Token exchange rejected by Google');
    throw new HttpError(400, 'Google rejected the authorization code');
  }

  const tokens = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!tokens.access_token) throw new HttpError(400, 'Google did not return an access token');
  if (!tokens.refresh_token) {
    throw new HttpError(
      400,
      'Google did not return a refresh token. Remove the app from your Google account permissions and reconnect.',
    );
  }

  const calendars = await fetch(GOOGLE_CALENDAR_LIST, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json() as Promise<{ items?: { id: string; summary: string; primary?: boolean }[] }>);

  const list = calendars.items ?? [];
  const primary = list.find((c) => c.primary) ?? list[0];
  if (!primary) throw new HttpError(400, 'No calendars found for this Google account');

  const userInfo = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));

  await upsertProfile(caller.id, {
    google_account_id: userInfo.id ?? userInfo.email ?? null,
    google_calendar_id: primary.id,
    google_access_token: tokens.access_token,
    google_refresh_token: tokens.refresh_token,
    google_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    calendar_connected: true,
  });

  await logSync(caller.id, 'sync', 'success', `Connected calendar: ${primary.summary}`);
  return json({ connected: true, calendar_id: primary.id, calendar_summary: primary.summary });
}

async function accessToken(caller: Caller, body: AccessTokenBody) {
  const targetId = body.user_id ?? caller.id;
  if (typeof targetId !== 'string') throw new HttpError(400, 'user_id must be a string');
  await assertCanActFor(caller, targetId);

  const { data: user, error } = await serviceClient()
    .from('ss_users')
    .select('google_access_token, google_refresh_token, google_token_expires_at')
    .eq('id', targetId)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Could not load calendar credentials');
  if (!user?.google_access_token || !user?.google_refresh_token) {
    return json({ access_token: null });
  }

  const expiresAt = new Date(user.google_token_expires_at ?? 0).getTime();
  if (expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return json({ access_token: user.google_access_token });
  }

  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: user.google_refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    // Refresh token revoked/expired: mark the connection dead instead of
    // retrying on every scheduling request.
    await upsertProfile(targetId, {
      calendar_connected: false,
      google_access_token: null,
      google_refresh_token: null,
      google_token_expires_at: null,
    });
    await logSync(targetId, 'token_refresh', 'failed', 'Refresh token rejected by Google');
    return json({ access_token: null, reauth_required: true });
  }

  const refreshed = (await response.json()) as { access_token: string; expires_in: number };
  await upsertProfile(targetId, {
    google_access_token: refreshed.access_token,
    google_token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
  });
  await logSync(targetId, 'token_refresh', 'success');

  return json({ access_token: refreshed.access_token });
}

async function disconnect(caller: Caller, body: DisconnectBody) {
  const targetId = body.user_id ?? caller.id;
  if (typeof targetId !== 'string') throw new HttpError(400, 'user_id must be a string');
  await assertCanActFor(caller, targetId);

  await upsertProfile(targetId, {
    google_account_id: null,
    google_calendar_id: null,
    google_access_token: null,
    google_refresh_token: null,
    google_token_expires_at: null,
    calendar_connected: false,
  });
  await logSync(targetId, 'sync', 'success', 'Disconnected calendar');
  return json({ connected: false });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const caller = await requireCaller(req);
    const body = (await req.json().catch(() => ({}))) as Body;

    switch (body.action) {
      case 'exchange':
        return await exchange(caller, body);
      case 'access_token':
        return await accessToken(caller, body);
      case 'disconnect':
        return await disconnect(caller, body);
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (error) {
    return errorResponse(error);
  }
});
