import { supabase } from '@/lib/supabase';
import { USER_PUBLIC_COLUMNS } from '@/lib/userColumns';
import type { User, UserRole } from '@/types/database';

export async function getUsers(role?: UserRole) {
  let query = supabase.from('ss_users').select(USER_PUBLIC_COLUMNS).order('name');
  if (role) query = query.eq('role', role);
  const { data, error } = await query;
  if (error) throw error;
  return data as User[];
}

export async function getUser(id: string) {
  const { data, error } = await supabase
    .from('ss_users')
    .select(USER_PUBLIC_COLUMNS)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as User;
}

export async function updateUser(id: string, updates: Partial<User>) {
  const { data, error } = await supabase
    .from('ss_users')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(USER_PUBLIC_COLUMNS)
    .single();
  if (error) throw error;
  return data as User;
}

export async function toggleUserActive(id: string, active: boolean) {
  return updateUser(id, { active });
}

export async function getSchedulers() {
  return getUsers('scheduler');
}

export async function getManagers() {
  return getUsers('manager');
}

/** Deleting an account requires server-side permissions: use adminService.deleteUserAccount. */
