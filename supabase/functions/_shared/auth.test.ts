// Run with:  deno test --allow-env supabase/functions/_shared/auth.test.ts
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { HttpError, assertStrongPassword, generateTemporaryPassword, isRole } from './auth.ts';

Deno.test('generated temporary passwords satisfy the password policy', () => {
  for (let i = 0; i < 200; i++) {
    const password = generateTemporaryPassword();
    assert(password.length >= 20, `too short: ${password.length}`);
    // Must not throw: the generated value has to meet our own policy.
    assertStrongPassword(password);
  }
});

Deno.test('generated temporary passwords are unique', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const password = generateTemporaryPassword();
    assert(!seen.has(password), 'duplicate temporary password generated');
    seen.add(password);
  }
  assertEquals(seen.size, 500);
});

Deno.test('generated passwords avoid ambiguous characters', () => {
  for (let i = 0; i < 50; i++) {
    const password = generateTemporaryPassword();
    assert(!/[0O1lI]/.test(password.slice(0, -3)), `ambiguous character in ${password}`);
  }
});

Deno.test('assertStrongPassword rejects weak passwords', () => {
  assertThrows(() => assertStrongPassword('short1A'), HttpError);
  assertThrows(() => assertStrongPassword('alllowercase123'), HttpError);
  assertThrows(() => assertStrongPassword('ALLUPPERCASE123'), HttpError);
  assertThrows(() => assertStrongPassword('NoDigitsHereAtAll'), HttpError);
});

Deno.test('assertStrongPassword accepts a compliant password', () => {
  assertStrongPassword('CorrectHorse9Battery');
});

Deno.test('isRole only accepts known roles', () => {
  assertEquals(isRole('admin'), true);
  assertEquals(isRole('technician'), true);
  assertEquals(isRole('superuser'), false);
  assertEquals(isRole(''), false);
  assertEquals(isRole(null), false);
  assertEquals(isRole(42), false);
});
