import { supabase } from '@/lib/supabase';
import { USER_PUBLIC_COLUMNS } from '@/lib/userColumns';
import { createUserAccount } from './adminService';
import type { User, AvailabilityBlock } from '@/types/database';

export async function getTechnicians() {
  const { data, error } = await supabase
    .from('ss_users')
    .select(USER_PUBLIC_COLUMNS)
    .eq('role', 'technician')
    .order('name');
  if (error) throw error;
  return data as User[];
}

export async function getActiveTechnicians() {
  const { data, error } = await supabase
    .from('ss_users')
    .select(USER_PUBLIC_COLUMNS)
    .eq('role', 'technician')
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return data as User[];
}

export async function getTechnician(id: string) {
  const { data, error } = await supabase
    .from('ss_users')
    .select(USER_PUBLIC_COLUMNS)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as User;
}

/**
 * Creates the login (auth user) and the portal profile together, server-side.
 * Returns a one-time temporary password when the server generated one.
 */
export async function createTechnician(technician: {
  name: string;
  email: string;
  phone?: string;
}) {
  const result = await createUserAccount({ ...technician, role: 'technician' });
  return result;
}

export async function updateTechnician(id: string, updates: Partial<User>) {
  const { data, error } = await supabase
    .from('ss_users')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(USER_PUBLIC_COLUMNS)
    .single();
  if (error) throw error;
  return data as User;
}

export async function getAvailabilityBlocks(technicianId: string, startDate?: string, endDate?: string) {
  let query = supabase
    .from('ss_availability_blocks')
    .select('*')
    .eq('technician_id', technicianId)
    .order('start_time');

  if (startDate) query = query.gte('start_time', startDate);
  if (endDate) query = query.lte('end_time', endDate);

  const { data, error } = await query;
  if (error) throw error;
  return data as AvailabilityBlock[];
}

export async function createAvailabilityBlock(block: {
  technician_id: string;
  start_time: string;
  end_time: string;
  reason: string;
}) {
  const { data, error } = await supabase
    .from('ss_availability_blocks')
    .insert(block)
    .select()
    .single();
  if (error) throw error;
  return data as AvailabilityBlock;
}

export async function deleteAvailabilityBlock(id: string) {
  const { error } = await supabase
    .from('ss_availability_blocks')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
