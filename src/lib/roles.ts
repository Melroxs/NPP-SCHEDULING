import type { UserRole } from '@/types/database';

/** The landing page for each role, and for an unauthenticated visitor. */
export function defaultRouteForRole(role: UserRole | null | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin/dashboard';
    case 'manager':
      return '/manager/dashboard';
    case 'scheduler':
      return '/scheduler/dashboard';
    case 'technician':
      return '/technician/dashboard';
    default:
      return '/login';
  }
}
