import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="state-screen"><span className="loader" /><p>Restoring secure session…</p></div>;
  }

  if (!user) {
    const next = `/landing${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ next }} />;
  }
  return <>{children}</>;
}
