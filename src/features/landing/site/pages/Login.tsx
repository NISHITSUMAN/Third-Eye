import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, LockKeyhole } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { localLandingPath, safeAuthReturnPath } from '../lib/auth-navigation';

function GoogleMark() {
  return <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 4)"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.73 7.18l7.64 5.93c4.47-4.13 7.13-10.2 7.13-17.58Z"/><path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a24 24 0 0 0 0 21.56l7.98-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.94-2.13 15.92-5.87l-7.64-5.93c-2.12 1.42-4.84 2.27-8.28 2.27-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
}

export default function Login() {
  const { user, loading, configured, signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const stateDestination = (location.state as { next?: string } | null)?.next;
  const requestedDestination = new URLSearchParams(location.search).get('next') ?? stateDestination;
  const destination = safeAuthReturnPath(requestedDestination);

  useEffect(() => {
    if (loading || !user) return;
    const localPath = localLandingPath(destination);
    if (localPath) navigate(localPath, { replace: true });
    else window.location.replace(destination);
  }, [destination, loading, navigate, user]);

  if (!loading && user) {
    return <div className="state-screen" role="status"><span className="loader" /><p>Opening your workspace…</p></div>;
  }

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithGoogle(destination);
      if (result.error) setError(result.error);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Google sign-in could not be started.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page section-wrap">
      <div className="auth-card">
        <div className="auth-symbol"><LockKeyhole size={24} strokeWidth={1.4} /></div>
        <span className="eyebrow">THIRD EYE / SECURE ACCESS</span>
        <h1>Welcome<br /><span className="text-muted">to the workspace.</span></h1>
        <p>Sign in with Google to continue to Third Eye Dashboard or Learn.</p>
        <button className="google-button" onClick={handleGoogleSignIn} disabled={!configured || busy}>
          <GoogleMark /> {busy ? 'Connecting…' : 'Continue with Google'}
        </button>
        {!configured && (
          <div className="auth-setup-note">
            <strong>Google sign-in is not connected yet.</strong>
            <span>Add the Supabase URL and publishable key, then enable Google under Supabase Authentication → Providers. See the README for the exact callback setup.</span>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="auth-divider"><span /> <small>ACCOUNT ACCESS</small> <span /></div>
        <p className="auth-footnote">The first successful Google sign-in creates your account. Future sign-ins return you to the same account.</p>
        <button className="back-link" onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back to site</button>
        <a className="auth-policy-link" href="https://supabase.com/docs/guides/auth/social-login/auth-google" target="_blank" rel="noreferrer">Google OAuth setup reference <ArrowUpRight size={12} /></a>
      </div>
    </div>
  );
}
