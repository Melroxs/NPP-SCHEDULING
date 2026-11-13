import { create } from 'zustand';
import type { User as SupabaseUser, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { USER_PUBLIC_COLUMNS } from '@/lib/userColumns';
import type { User, UserRole } from '@/types/database';

interface AuthState {
  session: Session | null;
  supabaseUser: SupabaseUser | null;
  profile: User | null;
  loading: boolean;
  initialized: boolean;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
  fetchProfile: (userId: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  clearAuthError: () => void;
}

/** Kept outside the store so we never register duplicate auth listeners. */
let authSubscription: { unsubscribe: () => void } | null = null;

const SIGNED_OUT_MESSAGE = 'Your account is not provisioned for this portal. Contact an administrator.';
const DEACTIVATED_MESSAGE = 'This account has been deactivated. Contact an administrator.';

function readableAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (lower.includes('email not confirmed')) return 'Please confirm your email address before signing in.';
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  return message;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  supabaseUser: null,
  profile: null,
  loading: false,
  initialized: false,
  authError: null,

  initialize: async () => {
    if (get().initialized) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        set({ session, supabaseUser: session.user });
        await get().fetchProfile(session.user.id);
        // A deactivated or unprovisioned user must not stay signed in.
        if (!get().profile) {
          await supabase.auth.signOut();
          set({ session: null, supabaseUser: null, authError: SIGNED_OUT_MESSAGE });
        }
      }
    } catch {
      // Treat an unreachable auth service as a signed-out session.
      set({ session: null, supabaseUser: null });
    } finally {
      set({ initialized: true });
    }

    authSubscription?.unsubscribe();
    const { data } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session) => {
        set({ session, supabaseUser: session?.user ?? null });

        if (!session?.user) {
          set({ profile: null });
          return;
        }

        await get().fetchProfile(session.user.id);

        if (event === 'SIGNED_IN' && !get().profile) {
          await get().signOut();
          set({ authError: SIGNED_OUT_MESSAGE });
        }
      },
    );
    authSubscription = data.subscription;
  },

  fetchProfile: async (userId: string) => {
    const { data, error } = await supabase
      .from('ss_users')
      .select(USER_PUBLIC_COLUMNS)
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      set({ profile: null });
      return;
    }

    const profile = data as User;

    if (!profile.active) {
      await supabase.auth.signOut();
      set({ profile: null, session: null, supabaseUser: null, authError: DEACTIVATED_MESSAGE });
      return;
    }

    set({ profile });
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true, authError: null });
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw new Error(readableAuthError(error.message));
    } catch (error) {
      set({ authError: error instanceof Error ? error.message : 'Sign in failed.' });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, supabaseUser: null, profile: null, authError: null });
  },

  refreshProfile: async () => {
    const { supabaseUser } = get();
    if (supabaseUser) {
      await get().fetchProfile(supabaseUser.id);
    }
  },

  requestPasswordReset: async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/login`,
    });
    // Supabase intentionally does not reveal whether an address exists; keep it
    // that way so the form cannot be used to enumerate accounts.
    if (error && !/rate limit|too many/i.test(error.message)) {
      throw new Error(readableAuthError(error.message));
    }
  },

  updatePassword: async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(readableAuthError(error.message));
  },

  clearAuthError: () => set({ authError: null }),
}));

export function useRole(): UserRole | null {
  return useAuthStore((s) => s.profile?.role ?? null);
}

export function useIsAdmin(): boolean {
  return useAuthStore((s) => s.profile?.role === 'admin');
}

export function useIsManager(): boolean {
  return useAuthStore((s) => s.profile?.role === 'manager');
}

export function useIsScheduler(): boolean {
  return useAuthStore((s) => s.profile?.role === 'scheduler');
}

export function useIsTechnician(): boolean {
  return useAuthStore((s) => s.profile?.role === 'technician');
}
