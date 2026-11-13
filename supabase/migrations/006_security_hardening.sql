-- ============================================
-- 006: SECURITY HARDENING
-- ============================================
-- Fixes privilege escalation, credential exposure and scheduling-integrity
-- gaps found during the production-readiness audit. Safe to run on an existing
-- database: every statement is idempotent and no user data is rewritten.
--
-- Apply with:  supabase db push     (or paste into the Supabase SQL editor)

-- ============================================
-- 1. HARDEN THE SECURITY-DEFINER HELPERS
-- ============================================
-- `SET search_path` prevents search_path hijacking on SECURITY DEFINER code.
-- The role lookup now only answers for the caller, so it cannot be used through
-- the REST API to enumerate other users' roles.
CREATE OR REPLACE FUNCTION public.ss_get_user_role(user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.ss_users
  WHERE id = user_id
    AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.ss_handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================
-- 2. STOP GOOGLE CREDENTIALS REACHING THE CLIENT
-- ============================================
-- Table-level SELECT overrides column-level REVOKEs, so the table grant must be
-- replaced with an explicit column list. OAuth refresh tokens are only ever
-- read by the google-oauth Edge Function (service_role).
REVOKE SELECT ON public.ss_users FROM anon, authenticated;

GRANT SELECT (
  id,
  name,
  email,
  phone,
  role,
  active,
  google_account_id,
  google_calendar_id,
  google_token_expires_at,
  calendar_connected,
  created_at,
  updated_at
) ON public.ss_users TO authenticated;

-- ============================================
-- 3. PRIVILEGE-ESCALATION GUARD ON ss_users
-- ============================================
-- RLS cannot restrict *which columns* an UPDATE may touch, so a technician could
-- previously run: UPDATE ss_users SET role = 'admin' WHERE id = auth.uid().
CREATE OR REPLACE FUNCTION public.ss_guard_user_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
BEGIN
  -- service_role / migrations (no JWT) are trusted.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  caller_role := public.ss_get_user_role(auth.uid());
  IF caller_role = 'admin' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Changing a user id is not permitted';
  END IF;

  -- Role and identity changes are administrator-only, for everybody else.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Only administrators can change a user role';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Only administrators can change a user email address';
  END IF;

  -- Managers may deactivate/reactivate the staff they dispatch (but never
  -- themselves, and never an administrator or another manager).
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    IF caller_role = 'manager'
       AND OLD.role IN ('technician', 'scheduler')
       AND OLD.id <> auth.uid()
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only administrators can change this user status';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ss_users_guard_privileges ON public.ss_users;
CREATE TRIGGER ss_users_guard_privileges
  BEFORE UPDATE ON public.ss_users
  FOR EACH ROW
  EXECUTE FUNCTION public.ss_guard_user_privileges();

-- Account deletion must go through the admin-users Edge Function so the auth
-- user is removed too (otherwise deleting this row orphans a usable login).
DROP POLICY IF EXISTS "ss_users_delete_admin" ON public.ss_users;

-- ============================================
-- 4. TECHNICIANS MAY ONLY CREATE THEIR OWN APPOINTMENTS
-- ============================================
-- Migration 004 allowed any technician to insert an appointment for *any*
-- technician (and therefore to write into a colleague's schedule).
DROP POLICY IF EXISTS "ss_appointments_insert" ON public.ss_appointments;
CREATE POLICY "ss_appointments_insert" ON public.ss_appointments
  FOR INSERT WITH CHECK (
    public.ss_get_user_role(auth.uid()) IN ('admin', 'manager', 'scheduler')
    OR (
      public.ss_get_user_role(auth.uid()) = 'technician'
      AND technician_id = auth.uid()
    )
  );

-- ============================================
-- 5. TECHNICIANS MAY NOT REASSIGN OR REPOINT APPOINTMENTS
-- ============================================
CREATE OR REPLACE FUNCTION public.ss_guard_appointment_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  caller_role := public.ss_get_user_role(auth.uid());
  IF caller_role IN ('admin', 'manager', 'scheduler') THEN
    RETURN NEW;
  END IF;

  -- Technicians may progress their own jobs, but cannot move a job to another
  -- technician, another customer or another address.
  IF NEW.technician_id IS DISTINCT FROM OLD.technician_id THEN
    RAISE EXCEPTION 'Technicians cannot reassign appointments';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Technicians cannot change the appointment customer';
  END IF;
  IF NEW.address_id IS DISTINCT FROM OLD.address_id THEN
    RAISE EXCEPTION 'Technicians cannot change the appointment address';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Technicians cannot change the appointment owner';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ss_appointments_guard_update ON public.ss_appointments;
CREATE TRIGGER ss_appointments_guard_update
  BEFORE UPDATE ON public.ss_appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.ss_guard_appointment_update();

-- ============================================
-- 6. NOTIFICATIONS: NO SENDING ON BEHALF OF OTHERS
-- ============================================
DROP POLICY IF EXISTS "ss_notifications_insert" ON public.ss_notifications;
CREATE POLICY "ss_notifications_insert" ON public.ss_notifications
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR public.ss_get_user_role(auth.uid()) IN ('admin', 'manager', 'scheduler')
  );

-- ============================================
-- 7. DOUBLE-BOOKING PROTECTION
-- ============================================
-- A technician cannot be booked into two overlapping appointments, including
-- under concurrent writes. Cancelled / no-show records are excluded.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
DECLARE
  conflict_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ss_appointments_no_overlap'
      AND conrelid = 'public.ss_appointments'::regclass
  ) THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO conflict_count
  FROM public.ss_appointments a
  JOIN public.ss_appointments b
    ON a.technician_id = b.technician_id
   AND a.id < b.id
   AND a.status NOT IN ('cancelled', 'no_show')
   AND b.status NOT IN ('cancelled', 'no_show')
   AND tstzrange(a.start_time, a.end_time) && tstzrange(b.start_time, b.end_time);

  IF conflict_count > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce double-booking protection: % overlapping appointment pair(s) already exist. Resolve them, then re-run this migration.',
      conflict_count
      USING HINT = 'Find them with: SELECT a.id, b.id FROM ss_appointments a JOIN ss_appointments b ON a.technician_id = b.technician_id AND a.id < b.id AND tstzrange(a.start_time, a.end_time) && tstzrange(b.start_time, b.end_time) WHERE a.status NOT IN (''cancelled'',''no_show'') AND b.status NOT IN (''cancelled'',''no_show'');';
  END IF;

  ALTER TABLE public.ss_appointments
    ADD CONSTRAINT ss_appointments_no_overlap
    EXCLUDE USING gist (
      technician_id WITH =,
      tstzrange(start_time, end_time) WITH &&
    ) WHERE (status NOT IN ('cancelled', 'no_show'));
END;
$$;

-- Guards against start/end inverted ranges reaching the exclusion constraint.
ALTER TABLE public.ss_appointments
  DROP CONSTRAINT IF EXISTS ss_appointments_time_order_check;
ALTER TABLE public.ss_appointments
  ADD CONSTRAINT ss_appointments_time_order_check CHECK (end_time > start_time);

-- ============================================
-- 8. QUERY SUPPORT
-- ============================================
CREATE INDEX IF NOT EXISTS idx_ss_appointments_tech_start
  ON public.ss_appointments (technician_id, start_time);

CREATE INDEX IF NOT EXISTS idx_ss_appointments_customer_start
  ON public.ss_appointments (customer_id, start_time);

CREATE INDEX IF NOT EXISTS idx_ss_users_email_lower
  ON public.ss_users (lower(email));

CREATE INDEX IF NOT EXISTS idx_ss_customers_full_name
  ON public.ss_customers (lower(last_name), lower(first_name));
