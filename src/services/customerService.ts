import { supabase } from '@/lib/supabase';
import { sanitizeSearchTerm } from '@/lib/search';
import type { Customer, Address } from '@/types/database';

export async function getCustomers() {
  const { data, error } = await supabase
    .from('ss_customers')
    .select('*, addresses(*)')
    .order('last_name');
  if (error) throw error;
  return data as (Customer & { addresses: Address[] })[];
}

export async function getCustomer(id: string) {
  const { data, error } = await supabase
    .from('ss_customers')
    .select('*, addresses(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Customer & { addresses: Address[] };
}

export async function createCustomer(customer: {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
}) {
  const { data, error } = await supabase
    .from('ss_customers')
    .insert(customer)
    .select()
    .single();
  if (error) throw error;
  return data as Customer;
}

export async function updateCustomer(id: string, customer: Partial<Customer>) {
  const { data, error } = await supabase
    .from('ss_customers')
    .update(customer)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Customer;
}

export async function createAddress(address: {
  customer_id: string;
  address_line: string;
  city: string;
  state: string;
  zip_code: string;
  latitude?: number;
  longitude?: number;
}) {
  const { data, error } = await supabase
    .from('ss_addresses')
    .insert(address)
    .select()
    .single();
  if (error) throw error;
  return data as Address;
}

export async function searchCustomers(query: string) {
  const term = sanitizeSearchTerm(query);
  if (term.length < 2) return [];

  const pattern = `%${term}%`;
  const { data, error } = await supabase
    .from('ss_customers')
    .select('*, addresses(*)')
    .or(
      [
        `first_name.ilike.${pattern}`,
        `last_name.ilike.${pattern}`,
        `email.ilike.${pattern}`,
        `phone.ilike.${pattern}`,
      ].join(','),
    )
    .order('last_name')
    .limit(20);
  if (error) throw error;
  return data as (Customer & { addresses: Address[] })[];
}
