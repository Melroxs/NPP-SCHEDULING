// Privileged user administration.
//
// Replaces the previous browser-side `supabase.auth.admin.*` calls, which
// required the service-role key in the bundle and could never work with the
// public anon key (leaving orphaned profiles that could not log in).

import {
  HttpError,
  assertStrongPassword,
  errorResponse,
  generateTemporaryPassword,
  isRole,
  json,
  requireCaller,
  serviceClient,
  type Caller,
  type Role,
} from '../_shared/auth.ts';

interface CreateBody {
  action: 'create';
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  password?: string;
}

interface DeleteBody {
  action: 'delete';
  user_id?: string;
}

interface SetPasswordBody {
  action: 'set_password';
  user_id?: string;
  password?: string;
}

type Body = CreateBody | DeleteBody | SetPasswordBody;

const PUBLIC_COLUMNS = 'id, name, email, phone, role, active, calendar_connected, created_at, updated_at';

/** Managers may only provision technicians and schedulers; admins may provision anyone. */
function assertCanManage(caller: Caller, targetRole: Role): void {
  if (caller.role === 'admin') return;
  if (caller.role === 'manager' && (targetRole === 'technician' || targetRole === 'scheduler')) return;
  throw new HttpError(403, 'You are not allowed to manage this role');
}

function cleanEmail(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'Email is required');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpError(400, 'A valid email address is required');
  }
  return email;
}

function cleanText(value: unknown, field: string, max = 120, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new HttpError(400, `${field} is required`);
  if (trimmed.length > max) throw new HttpError(400, `${field} is too long`);
  return trimmed || null;
}

async function createUser(caller: Caller, body: CreateBody) {
  if (!isRole(body.role)) throw new HttpError(400, 'A valid role is required');
  assertCanManage(caller, body.role);

  const name = cleanText(body.name, 'Name', 120, true);
  const email = cleanEmail(body.email);
  const phone = cleanText(body.phone, 'Phone', 32);
  const generatedPassword = body.password ? null : generateTemporaryPassword();
  if (body.password) assertStrongPassword(body.password);
  const password = body.password ?? generatedPassword!;

  const admin = serviceClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    // 422 = already registered in auth.users.
    if (/already/i.test(createError.message)) {
      throw new HttpError(409, 'A login already exists for this email address');
    }
    throw new HttpError(400, createError.message);
  }

  const { data: profile, error: profileError } = await admin
    .from('ss_users')
    .insert({
      id: created.user.id,
      name,
      email,
      phone,
      role: body.role,
      active: true,
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (profileError) {
    // Roll back so we never leave an auth user without a portal profile.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    if (profileError.code === '23505') {
      throw new HttpError(409, 'A user with this email or id already exists');
    }
    throw new HttpError(400, 'Could not create the user profile');
  }

  return json({ user: profile, temporary_password: generatedPassword ?? undefined }, 201);
}

async function deleteUser(caller: Caller, body: DeleteBody) {
  if (caller.role !== 'admin') throw new HttpError(403, 'Only administrators can delete users');
  if (typeof body.user_id !== 'string') throw new HttpError(400, 'user_id is required');
  if (body.user_id === caller.id) throw new HttpError(400, 'You cannot delete your own account');

  const admin = serviceClient();

  const { data: target, error: targetError } = await admin
    .from('ss_users')
    .select('id, role')
    .eq('id', body.user_id)
    .maybeSingle();

  if (targetError) throw new HttpError(500, 'Could not load the user');
  if (!target) throw new HttpError(404, 'User not found');

  // Preserve scheduling history: reassigning/deleting appointments would corrupt
  // reporting, so refuse and let the admin deactivate the account instead.
  const { count, error: countError } = await admin
    .from('ss_appointments')
    .select('id', { count: 'exact', head: true })
    .eq('technician_id', body.user_id);

  if (countError) throw new HttpError(500, 'Could not check the user’s appointments');
  if (count && count > 0) {
    throw new HttpError(
      409,
      `This user has ${count} appointment(s) on record. Deactivate the account instead to preserve scheduling history.`,
    );
  }

  const { error: profileDeleteError } = await admin.from('ss_users').delete().eq('id', body.user_id);
  if (profileDeleteError) throw new HttpError(400, 'Could not delete the user profile');

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(body.user_id);
  if (authDeleteError) throw new HttpError(400, 'Could not delete the login');

  return json({ deleted: true });
}

async function setPassword(caller: Caller, body: SetPasswordBody) {
  if (typeof body.user_id !== 'string') throw new HttpError(400, 'user_id is required');

  const admin = serviceClient();
  const { data: target, error: targetError } = await admin
    .from('ss_users')
    .select('id, role')
    .eq('id', body.user_id)
    .maybeSingle();

  if (targetError) throw new HttpError(500, 'Could not load the user');
  if (!target) throw new HttpError(404, 'User not found');
  if (!isRole(target.role)) throw new HttpError(400, 'Target user has an invalid role');
  assertCanManage(caller, target.role);

  const generatedPassword = body.password ? null : generateTemporaryPassword();
  if (body.password) assertStrongPassword(body.password);
  const password = body.password ?? generatedPassword!;

  const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
  if (error) throw new HttpError(400, 'Could not update the password');

  return json({ temporary_password: generatedPassword ?? undefined });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const caller = await requireCaller(req);
    const body = (await req.json().catch(() => ({}))) as Body;

    switch (body.action) {
      case 'create':
        return await createUser(caller, body);
      case 'delete':
        return await deleteUser(caller, body);
      case 'set_password':
        return await setPassword(caller, body);
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (error) {
    return errorResponse(error);
  }
});
