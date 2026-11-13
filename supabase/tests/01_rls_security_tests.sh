#!/usr/bin/env bash
# ============================================
# RLS / AUTHORIZATION / INTEGRITY TESTS
# ============================================
# Runs real SQL against a PostgreSQL database that has the Supabase harness and
# migrations 001-006 applied, switching into the `authenticated` role and
# impersonating each user exactly as PostgREST does.
#
#   createdb npp_test
#   psql -d npp_test -f supabase/tests/00_supabase_harness.sql
#   for f in supabase/migrations/00*.sql; do psql -v ON_ERROR_STOP=1 -d npp_test -f "$f"; done
#   psql -d npp_test -f supabase/tests/02_seed_fixtures.sql
#   bash supabase/tests/01_rls_security_tests.sh
#
# Environment: PGHOST/PGPORT/PGUSER select the server, NPP_TEST_DB the database.
# Every case runs in a transaction that is rolled back, so the fixtures are
# never modified and the suite is repeatable.

set -uo pipefail

DB="${NPP_TEST_DB:-npp_test}"
PASS=0
FAIL=0

ADMIN='11111111-1111-1111-1111-111111111111'
TECH1='22222222-2222-2222-2222-222222222222'
TECH2='33333333-3333-3333-3333-333333333333'
MANAGER='66666666-6666-6666-6666-666666666666'
SCHED='77777777-7777-7777-7777-777777777777'
APPT_TECH1='aaaaaaaa-0000-0000-0000-000000000001'
APPT_TECH2='aaaaaaaa-0000-0000-0000-000000000004'
CUSTOMER='44444444-4444-4444-4444-444444444444'
OTHER_CUSTOMER='88888888-8888-8888-8888-888888888888'
ADDRESS='55555555-5555-5555-5555-555555555555'
OTHER_ADDRESS='99999999-9999-9999-9999-999999999999'

# SQL must go through stdin: `psql -c` only reports the last statement's result.
psql_q() { printf '%s\n' "$1" | psql -tAq -v ON_ERROR_STOP=1 -d "$DB" 2>&1; }

as_user() {
  printf "BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '%s'; %s ROLLBACK;" "$1" "$2"
}

# For seeding/assertions that must bypass RLS, run as the owner in a rolled-back txn.
as_owner() { printf "BEGIN; %s ROLLBACK;" "$1"; }

# service_role is what the Edge Functions use (BYPASSRLS, full column access).
as_service() {
  printf "BEGIN; SET LOCAL ROLE service_role; %s ROLLBACK;" "$1"
}

report() {
  local status="$1" name="$2" detail="${3:-}"
  case "$status" in
    PASS) PASS=$((PASS + 1)); printf 'PASS  %s\n' "$name" ;;
    FAIL) FAIL=$((FAIL + 1)); printf 'FAIL  %s\n      -> %s\n' "$name" "$detail" ;;
  esac
}

expect_ok() { # name, sub, sql
  local out
  out=$(psql_q "$(as_user "$2" "$3")")
  if [ $? -eq 0 ]; then report PASS "$1"; else report FAIL "$1" "$out"; fi
}

expect_denied() { # name, sub, sql
  local out
  out=$(psql_q "$(as_user "$2" "$3")")
  if [ $? -ne 0 ]; then report PASS "$1"; else report FAIL "$1" "statement was allowed"; fi
}

expect_value() { # name, sub, sql, expected
  local out
  out=$(psql_q "$(as_user "$2" "$3")" | tr -d ' ')
  if [ "$out" = "$4" ]; then report PASS "$1"; else report FAIL "$1" "expected '$4', got '$out'"; fi
}

expect_owner_value() { # name, sql, expected
  local out
  out=$(psql_q "$(as_owner "$2")" | tr -d ' ')
  if [ "$out" = "$3" ]; then report PASS "$1"; else report FAIL "$1" "expected '$3', got '$out'"; fi
}

echo "=== READ ISOLATION ==="
expect_value "technician sees only their own appointments" "$TECH1" \
  "SELECT count(*) FROM ss_appointments;" "3"
expect_value "second technician sees only their own appointment" "$TECH2" \
  "SELECT count(*) FROM ss_appointments;" "1"
expect_value "technician cannot read a colleague's appointment by id" "$TECH1" \
  "SELECT count(*) FROM ss_appointments WHERE id = '$APPT_TECH2';" "0"
expect_value "manager sees every appointment" "$MANAGER" \
  "SELECT count(*) FROM ss_appointments;" "4"
expect_value "scheduler sees every appointment" "$SCHED" \
  "SELECT count(*) FROM ss_appointments;" "4"

echo
echo "=== CREDENTIAL COLUMNS ==="
expect_denied "technician cannot read google_refresh_token" "$TECH1" \
  "SELECT google_refresh_token FROM ss_users WHERE id = '$TECH1';"
expect_denied "technician cannot read google_access_token" "$TECH1" \
  "SELECT google_access_token FROM ss_users WHERE id = '$TECH1';"
expect_ok "technician can read their public profile columns" "$TECH1" \
  "SELECT id, name, email, role, active, calendar_connected FROM ss_users WHERE id = '$TECH1';"
expect_value "role enumeration via ss_get_user_role returns nothing for others" "$TECH1" \
  "SELECT coalesce(public.ss_get_user_role('$TECH2'), 'null');" "null"
expect_value "ss_get_user_role still works for the caller" "$TECH1" \
  "SELECT public.ss_get_user_role('$TECH1');" "technician"

# The google-oauth function must still be able to read refresh tokens server-side.
service_out=$(psql_q "$(as_service "SELECT count(*) FROM ss_users WHERE google_refresh_token IS NULL;")" | tr -d ' ')
if [ "$service_out" = "5" ]; then report PASS "service_role can read refresh tokens (edge function path)"; else report FAIL "service_role can read refresh tokens (edge function path)" "got '$service_out'"; fi

# Anonymous visitors must never see portal data. After migration 006 the anon
# role holds no SELECT grant on ss_users at all, which is stricter than 0 rows.
anon_out=$(psql_q "BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM ss_users; ROLLBACK;" | tr -d ' ')
case "$anon_out" in
  0|*ERROR*permission*denied*) report PASS "anonymous role cannot read user rows" ;;
  *) report FAIL "anonymous role cannot read user rows" "got '$anon_out'" ;;
esac

echo
echo "=== PRIVILEGE ESCALATION ==="
expect_denied "technician cannot promote themselves to admin" "$TECH1" \
  "UPDATE ss_users SET role = 'admin' WHERE id = '$TECH1';"
expect_denied "technician cannot change their own active status" "$TECH1" \
  "UPDATE ss_users SET active = false WHERE id = '$TECH1';"
expect_denied "technician cannot change their own email" "$TECH1" \
  "UPDATE ss_users SET email = 'attacker@example.com' WHERE id = '$TECH1';"
expect_owner_value "technician role unchanged in the database" \
  "SELECT role FROM ss_users WHERE id = '$TECH1';" "technician"
expect_owner_value "technician email unchanged in the database" \
  "SELECT email FROM ss_users WHERE id = '$TECH1';" "t1@npp.test"
expect_denied "manager cannot change a technician's role" "$MANAGER" \
  "UPDATE ss_users SET role = 'admin' WHERE id = '$TECH1';"
expect_denied "manager cannot deactivate an administrator" "$MANAGER" \
  "UPDATE ss_users SET active = false WHERE id = '$ADMIN';"
expect_ok "manager can deactivate a technician" "$MANAGER" \
  "UPDATE ss_users SET active = false WHERE id = '$TECH1';"
expect_ok "admin can change a user's role" "$ADMIN" \
  "UPDATE ss_users SET role = 'scheduler' WHERE id = '$TECH2';"

echo
echo "=== APPOINTMENT ASSIGNMENT INTEGRITY ==="
expect_denied "technician cannot create an appointment for a colleague" "$TECH1" \
  "INSERT INTO ss_appointments (customer_id, technician_id, address_id, start_time, end_time, appointment_type) VALUES ('$CUSTOMER', '$TECH2', '$ADDRESS', '2026-03-09 09:00+00', '2026-03-09 10:00+00', 'repair');"
expect_ok "technician can create an appointment for themselves" "$TECH1" \
  "INSERT INTO ss_appointments (customer_id, technician_id, address_id, start_time, end_time, appointment_type) VALUES ('$CUSTOMER', '$TECH1', '$ADDRESS', '2026-03-09 09:00+00', '2026-03-09 10:00+00', 'repair');"
expect_denied "technician cannot reassign their job to a colleague" "$TECH1" \
  "UPDATE ss_appointments SET technician_id = '$TECH2' WHERE id = '$APPT_TECH1';"
expect_denied "technician cannot change the customer on their job" "$TECH1" \
  "UPDATE ss_appointments SET customer_id = '$OTHER_CUSTOMER' WHERE id = '$APPT_TECH1';"
expect_denied "technician cannot change the address on their job" "$TECH1" \
  "UPDATE ss_appointments SET address_id = '$OTHER_ADDRESS' WHERE id = '$APPT_TECH1';"
expect_ok "technician can update the status of their own job" "$TECH1" \
  "UPDATE ss_appointments SET status = 'completed' WHERE id = '$APPT_TECH1';"
expect_ok "scheduler can create an appointment" "$SCHED" \
  "INSERT INTO ss_appointments (customer_id, technician_id, address_id, start_time, end_time, appointment_type) VALUES ('$CUSTOMER', '$TECH2', '$ADDRESS', '2026-03-10 09:00+00', '2026-03-10 10:00+00', 'installation');"

echo
echo "=== DOUBLE BOOKING (exclusion constraint) ==="
expect_denied "overlapping appointment for the same technician is rejected" "$SCHED" \
  "INSERT INTO ss_appointments (customer_id, technician_id, address_id, start_time, end_time, appointment_type) VALUES ('$CUSTOMER', '$TECH2', '$ADDRESS', '2026-03-10 08:00+00', '2026-03-10 09:00+00', 'repair'); INSERT INTO ss_appointments (customer_id, technician_id, address_id, start_time, end_time, appointment_type) VALUES ('$CUSTOMER', '$TECH2', '$ADDRESS', '2026-03-10 08:30+00', '2026-03-10 09:30+00', 'repair');"
expect_ok "back-to-back appointment is allowed" "$SCHED" \
  "INSERT INTO ss_appointments (customer_id, technician_id, address_id, start_time, end_time, appointment_type) VALUES ('$CUSTOMER', '$TECH2', '$ADDRESS', '2026-03-12 08:00+00', '2026-03-12 09:00+00', 'repair'); INSERT INTO ss_appointments (customer_id, technician_id, address_id, start_time, end_time, appointment_type) VALUES ('$CUSTOMER', '$TECH2', '$ADDRESS', '2026-03-12 09:00+00', '2026-03-12 10:00+00', 'repair');"
expect_denied "appointment ending before it starts is rejected" "$SCHED" \
  "INSERT INTO ss_appointments (customer_id, technician_id, address_id, start_time, end_time, appointment_type) VALUES ('$CUSTOMER', '$TECH2', '$ADDRESS', '2026-03-11 11:00+00', '2026-03-11 09:00+00', 'repair');"
expect_ok "cancelled appointments do not block a slot" "$SCHED" \
  "INSERT INTO ss_appointments (customer_id, technician_id, address_id, start_time, end_time, appointment_type, status) VALUES ('$CUSTOMER', '$TECH2', '$ADDRESS', '2026-03-13 08:00+00', '2026-03-13 09:00+00', 'repair', 'cancelled'); INSERT INTO ss_appointments (customer_id, technician_id, address_id, start_time, end_time, appointment_type) VALUES ('$CUSTOMER', '$TECH2', '$ADDRESS', '2026-03-13 08:00+00', '2026-03-13 09:00+00', 'repair');"

echo
echo "=== NOTIFICATIONS ==="
expect_denied "technician cannot notify a colleague" "$TECH1" \
  "INSERT INTO ss_notifications (user_id, title, body) VALUES ('$TECH2', 'spoof', 'spoof');"
expect_ok "scheduler can notify a technician" "$SCHED" \
  "INSERT INTO ss_notifications (user_id, title, body) VALUES ('$TECH1', 'New appointment', 'You have a job');"
expect_value "notifications are private to the recipient" "$TECH2" \
  "SELECT count(*) FROM ss_notifications;" "0"

echo
echo "=== SUMMARY: ${PASS} passed, ${FAIL} failed ==="
[ "$FAIL" -eq 0 ]
