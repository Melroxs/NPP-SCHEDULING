import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect';
import { describeDbError } from './dbErrors';
import { sanitizeSearchTerm } from './search';
import { defaultRouteForRole } from './roles';

describe('safeRedirect', () => {
  it('allows same-origin absolute paths', () => {
    expect(safeRedirect('/manager/dispatch')).toBe('/manager/dispatch');
    expect(safeRedirect('/technician/dashboard?tab=week')).toBe('/technician/dashboard?tab=week');
  });

  it('rejects absolute URLs', () => {
    expect(safeRedirect('https://evil.example/steal')).toBeNull();
    expect(safeRedirect('http://evil.example')).toBeNull();
  });

  it('rejects protocol-relative and backslash tricks', () => {
    expect(safeRedirect('//evil.example')).toBeNull();
    expect(safeRedirect('/\\evil.example')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(safeRedirect(null)).toBeNull();
    expect(safeRedirect('')).toBeNull();
  });
});

describe('sanitizeSearchTerm', () => {
  it('strips PostgREST filter operators', () => {
    expect(sanitizeSearchTerm('smith,id.eq.1')).toBe('smith id.eq.1');
    expect(sanitizeSearchTerm('a)b(c')).toBe('a b c');
  });

  it('strips quotes and wildcards used to reshape filters', () => {
    expect(sanitizeSearchTerm('x%')).toBe('x');
    expect(sanitizeSearchTerm('"quoted"')).toBe('quoted');
    expect(sanitizeSearchTerm("O'Brien")).toBe("O Brien");
  });

  it('caps very long input', () => {
    expect(sanitizeSearchTerm('a'.repeat(200)).length).toBeLessThanOrEqual(64);
  });

  it('keeps ordinary names intact', () => {
    expect(sanitizeSearchTerm('Mary Ann Smith')).toBe('Mary Ann Smith');
  });
});

describe('describeDbError', () => {
  it('explains double bookings from the exclusion constraint', () => {
    expect(describeDbError({ code: '23P01' }, 'fallback')).toMatch(/already booked/i);
  });

  it('explains invalid time ranges', () => {
    expect(describeDbError({ code: '23514' }, 'fallback')).toMatch(/end time must be after/i);
  });

  it('explains missing permissions', () => {
    expect(describeDbError({ code: '42501' }, 'fallback')).toMatch(/permission/i);
  });

  it('passes through guard-trigger messages', () => {
    expect(
      describeDbError(
        { code: 'P0001', message: 'Only administrators can change a user role' },
        'fallback',
      ),
    ).toBe('Only administrators can change a user role');
  });

  it('never leaks raw internals for unknown errors', () => {
    expect(
      describeDbError({ code: 'XX000', message: 'relation "ss_users" violates ...' }, 'fallback'),
    ).toBe('fallback');
  });

  it('handles a null error', () => {
    expect(describeDbError(null, 'fallback')).toBe('fallback');
  });
});

describe('defaultRouteForRole', () => {
  it('routes each role to its own portal', () => {
    expect(defaultRouteForRole('admin')).toBe('/admin/dashboard');
    expect(defaultRouteForRole('manager')).toBe('/manager/dashboard');
    expect(defaultRouteForRole('scheduler')).toBe('/scheduler/dashboard');
    expect(defaultRouteForRole('technician')).toBe('/technician/dashboard');
  });

  it('sends unknown or missing roles to login', () => {
    expect(defaultRouteForRole(null)).toBe('/login');
    expect(defaultRouteForRole(undefined)).toBe('/login');
  });
});
