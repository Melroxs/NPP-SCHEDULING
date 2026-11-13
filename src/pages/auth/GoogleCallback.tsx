import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { connectGoogleCalendar } from '@/services/googleCalendarService';
import { toast } from 'sonner';

type ExchangeResult =
  | { state: 'processing' }
  | { state: 'success' }
  | { state: 'error'; message: string };

export function GoogleCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuthStore();
  const [result, setResult] = useState<ExchangeResult>({ state: 'processing' });

  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');

  // Synchronous outcomes are derived during render rather than pushed into
  // state from an effect.
  const view: ExchangeResult = oauthError
    ? {
        state: 'error',
        message: oauthError === 'access_denied' ? 'Access was denied. Please try again.' : oauthError,
      }
    : !code || !profile
      ? { state: 'error', message: 'Missing authorization code or user session.' }
      : result;

  useEffect(() => {
    if (oauthError || !code || !profile) return;

    let cancelled = false;

    void (async () => {
      const outcome = await connectGoogleCalendar(code);
      if (cancelled) return;

      if (outcome.success) {
        setResult({ state: 'success' });
        toast.success('Google Calendar connected successfully!');
        setTimeout(() => {
          navigate(`/${profile.role}/settings`);
        }, 1500);
      } else {
        setResult({
          state: 'error',
          message: outcome.error ?? 'Failed to connect Google Calendar',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [oauthError, code, profile, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8">
        {view.state === 'processing' && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
            <h2 className="text-xl font-semibold">Connecting Google Calendar...</h2>
            <p className="text-muted-foreground">Please wait while we set up your calendar integration.</p>
          </>
        )}
        {view.state === 'success' && (
          <>
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold">Calendar Connected!</h2>
            <p className="text-muted-foreground">Redirecting to settings...</p>
          </>
        )}
        {view.state === 'error' && (
          <>
            <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold">Connection Failed</h2>
            <p className="text-muted-foreground">{view.message}</p>
            <button
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md"
              onClick={() => navigate(-1)}
            >
              Go Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
