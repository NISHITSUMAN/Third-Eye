import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { localLandingPath, safeAuthReturnPath } from '../lib/auth-navigation';

export default function AuthCallback() {
  const { user, loading, configured } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [failed, setFailed] = useState(false);
  const next = safeAuthReturnPath(new URLSearchParams(location.search).get('next'));

  useEffect(() => {
    if (!configured) {
      setFailed(true);
      return;
    }
    if (loading) return;
    if (user) {
      const localPath = localLandingPath(next);
      if (localPath) navigate(localPath, { replace: true });
      else window.location.replace(next);
      return;
    }
    const timer = window.setTimeout(() => setFailed(true), 1800);
    return () => window.clearTimeout(timer);
  }, [configured, loading, user, navigate, next]);

  return (
    <div className="state-screen">
      {!failed ? <><span className="loader" /><h2>Completing secure sign-in</h2><p>Confirming your Google session with Supabase…</p></> : <><h2>Sign-in could not be completed.</h2><p>Check that Supabase is configured and that the OAuth redirect URLs are correct for this site.</p><Link className="button button-primary" to="/login" state={{ next }}>Return to sign in</Link></>}
    </div>
  );
}
