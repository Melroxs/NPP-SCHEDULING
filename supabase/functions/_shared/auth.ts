// Shared helpers for Edge Functions.
//
// Every privileged operation must authorise the *caller* on the server. The
// browser only ever holds the public anon key, so the role checks below are the
// real access-control boundary (the UI checks are convenience only).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Role = 'admin' | 'manager' | 'scheduler' | 'technician';

const ROLES: Role[] = ['admin', 'manager', 'scheduler', 'technician'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as string[]).includes(value);
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    throw new Error('Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Caller {
  id: string;
  role: Role;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolves the calling user from the request's bearer token and loads their
 * role from ss_users. Rejects unknown, unauthenticated and deactivated users.
 */
export async function requireCaller(req: Request): Promise<Caller> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Authentication required');

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new HttpError(500, 'Server is not configured');

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) throw new HttpError(401, 'Invalid or expired session');

  const { data: profile, error: profileError } = await serviceClient()
    .from('ss_users')
    .select('id, role, active')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError) throw new HttpError(500, 'Could not verify permissions');
  if (!profile) throw new HttpError(403, 'No portal profile is provisioned for this account');
  if (!profile.active) throw new HttpError(403, 'This account has been deactivated');
  if (!isRole(profile.role)) throw new HttpError(403, 'Unknown role');

  return { id: profile.id, role: profile.role };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  // Never leak stack traces or provider internals to the client.
  console.error('[edge-function]', message);
  return json({ error: 'Unexpected server error' }, 500);
}

/** Cryptographically strong temporary password (no ambiguous characters). */
export function generateTemporaryPassword(length = 20): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  // Guarantee complexity regardless of the random draw.
  return `${body}!7Aa`;
}

export function assertStrongPassword(password: string): void {
  if (password.length < 12) {
    throw new HttpError(400, 'Password must be at least 12 characters');
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new HttpError(400, 'Password must contain upper case, lower case and a number');
  }
}
