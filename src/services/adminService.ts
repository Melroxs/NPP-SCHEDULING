import { supabase } from '@/lib/supabase';
import type { User, UserRole } from '@/types/database';
import { USER_PUBLIC_COLUMNS } from '@/lib/userColumns';

/**
 * Privileged account operations. All authorization happens inside the
 * `admin-users` Edge Function — the browser never holds a service-role key.
 */
export interface CreateUserInput {
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  password?: string;
}

export interface CreateUserResult {
  user: User;
  /** Present only when the server generated a temporary password. Show once. */
  temporary_password?: string;
}

async function callAdminUsers<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: payload });

  if (error) {
    // FunctionsHttpError carries the JSON body returned by the function.
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = (await context.json()) as { error?: string };
        if (body?.error) throw new Error(body.error);
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message !== 'Unexpected end of JSON input') {
          throw parseError;
        }
      }
    }
    throw new Error(
      error.message.includes('Failed to send a request')
        ? 'Could not reach the server. Check that the admin-users function is deployed.'
        : error.message,
    );
  }

  return data as T;
}

export function createUserAccount(input: CreateUserInput): Promise<CreateUserResult> {
  return callAdminUsers<CreateUserResult>({ action: 'create', ...input });
}

export function deleteUserAccount(userId: string): Promise<{ deleted: boolean }> {
  return callAdminUsers({ action: 'delete', user_id: userId });
}

export function setUserPassword(userId: string, password?: string) {
  return callAdminUsers<{ temporary_password?: string }>({
    action: 'set_password',
    user_id: userId,
    password,
  });
}

/** Re-exported so callers can keep types local to the service layer. */
export type { User };
export { USER_PUBLIC_COLUMNS };
