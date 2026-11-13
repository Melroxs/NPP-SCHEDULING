import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '@/stores/authStore';
import { defaultRouteForRole } from '@/lib/roles';
import { safeRedirect } from '@/lib/redirect';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const resetSchema = z.object({
  email: z.string().email('Invalid email address'),
});

type LoginForm = z.infer<typeof loginSchema>;
type ResetForm = z.infer<typeof resetSchema>;

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get('redirect'));
  const { signIn, loading, profile, authError, requestPasswordReset, clearAuthError } = useAuthStore();
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [resetSending, setResetSending] = useState(false);

  const loginForm = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });
  const resetForm = useForm<ResetForm>({ resolver: zodResolver(resetSchema) });

  if (profile) {
    return <Navigate to={redirectTo ?? defaultRouteForRole(profile.role)} replace />;
  }

  const onSubmit = async (data: LoginForm) => {
    try {
      setError('');
      clearAuthError();
      await signIn(data.email, data.password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const onReset = async (data: ResetForm) => {
    setResetSending(true);
    try {
      await requestPasswordReset(data.email);
      toast.success('If that address has an account, a reset link is on its way.');
      setMode('signin');
      resetForm.reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the reset email');
    } finally {
      setResetSending(false);
    }
  };

  const shownError = error || authError;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <img src="/npp-logo.png" alt="New Paradigm Projects" className="h-12 w-auto mx-auto" />
          </div>
          <p className="text-sm text-muted-foreground">
            Intelligent Field Service Dispatch
          </p>
        </CardHeader>
        <CardContent>
          {mode === 'signin' ? (
            <form onSubmit={loginForm.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              {shownError && (
                <div role="alert" className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                  {shownError}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-invalid={!!loginForm.formState.errors.email}
                  {...loginForm.register('email')}
                />
                {loginForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{loginForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  aria-invalid={!!loginForm.formState.errors.password}
                  {...loginForm.register('password')}
                />
                {loginForm.formState.errors.password && (
                  <p className="text-xs text-destructive">{loginForm.formState.errors.password.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>

              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
                onClick={() => {
                  setMode('reset');
                  setError('');
                  clearAuthError();
                }}
              >
                Forgot your password?
              </button>
            </form>
          ) : (
            <form onSubmit={resetForm.handleSubmit(onReset)} className="space-y-4" noValidate>
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Reset your password</h2>
                <p className="text-sm text-muted-foreground">
                  Enter your work email and we’ll send you a secure reset link.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={!!resetForm.formState.errors.email}
                  {...resetForm.register('email')}
                />
                {resetForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{resetForm.formState.errors.email.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={resetSending}>
                {resetSending ? 'Sending...' : 'Send reset link'}
              </Button>

              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
                onClick={() => setMode('signin')}
              >
                Back to sign in
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
