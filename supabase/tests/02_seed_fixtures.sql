-- Deterministic fixtures for supabase/tests/01_rls_security_tests.sh.
-- Test data only — never load this into a production database.

INSERT INTO ss_users (id, name, email, role, active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Admin User',   'admin@npp.test',   'admin',      true),
  ('22222222-2222-2222-2222-222222222222', 'Tech One',     't1@npp.test',      'technician', true),
  ('33333333-3333-3333-3333-333333333333', 'Tech Two',     't2@npp.test',      'technician', true),
  ('66666666-6666-6666-6666-666666666666', 'Manager User', 'manager@npp.test', 'manager',    true),
  ('77777777-7777-7777-7777-777777777777', 'Scheduler',    'sched@npp.test',   'scheduler',  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ss_customers (id, first_name, last_name, phone, email) VALUES
  ('44444444-4444-4444-4444-444444444444', 'Pat', 'Customer', '555-0100', 'pat@example.com'),
  -- A second customer/address so impersonation tests can change the value.
  ('88888888-8888-8888-8888-888888888888', 'Sam', 'Other', '555-0199', 'sam@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ss_addresses (id, customer_id, address_line, city, state, zip_code) VALUES
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444',
   '1 Main St', 'Albany', 'NY', '12207'),
  ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888',
   '2 Other Rd', 'Troy', 'NY', '12180')
ON CONFLICT (id) DO NOTHING;

-- Tech One has one live appointment plus two cancelled ones (3 visible rows);
-- Tech Two has exactly one. Total visible to staff: 4.
INSERT INTO ss_appointments
  (id, customer_id, technician_id, address_id, start_time, end_time, appointment_type, status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555',
   '2026-03-04 09:00:00+00', '2026-03-04 11:00:00+00', 'repair', 'scheduled'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555',
   '2026-03-04 13:00:00+00', '2026-03-04 14:00:00+00', 'repair', 'cancelled'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555',
   '2026-03-05 09:00:00+00', '2026-03-05 10:00:00+00', 'maintenance', 'no_show'),
  ('aaaaaaaa-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444',
   '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555',
   '2026-03-06 09:00:00+00', '2026-03-06 10:00:00+00', 'repair', 'scheduled')
ON CONFLICT (id) DO NOTHING;
