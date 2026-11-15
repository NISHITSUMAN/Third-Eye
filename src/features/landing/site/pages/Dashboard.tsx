import { useState } from 'react';
import { ArrowUpRight, ExternalLink, Github, Globe2, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { appConfig } from '../lib/config';

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    const result = await signOut();
    if (result.error) {
      setSignOutError(result.error);
      return;
    }
    setSignOutError(null);
    navigate('/');
  };

  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'Researcher';

  return (
    <div className="page-shell section-wrap dashboard-page">
      <div className="dashboard-heading">
        <div><span className="eyebrow">PROJECT WORKSPACE / AUTHENTICATED ACCESS</span><h1>Welcome,<br /><span className="text-muted">{displayName.split(' ')[0]}.</span></h1><p>Your access point for the Third Eye application and project resources.</p></div>
        <button className="button button-outline signout-button" onClick={handleSignOut}><LogOut size={15} /> Sign out</button>
      </div>
      {signOutError && <p className="form-error" role="alert">{signOutError}</p>}
      <div className="account-strip"><span className="status-dot" /><span>Signed in as</span><strong>{user?.email ?? 'Authenticated account'}</strong></div>
      <section className="dashboard-launch-card">
        <div className="launch-card-copy"><span className="eyebrow">MAIN APPLICATION / 01</span><h2>Third Eye<br /><span className="text-muted">Earth observation workspace.</span></h2><p>Open the main project application to explore its current tools, observations and data views.</p>
          <a className="button button-primary" href="/dashboard">Launch application <ExternalLink size={15} /></a>
        </div>
        <div className="launch-card-visual"><div className="launch-orbit orbit-a" /><div className="launch-orbit orbit-b" /><div className="launch-center"><Globe2 size={48} strokeWidth={1} /></div><span className="orbit-caption">PROJECT ACCESS / 01</span></div>
      </section>
      <section className="dashboard-links">
        <div><span className="eyebrow">PROJECT RESOURCE</span><h3>Source repository</h3><p>Explore implementation and project documentation.</p></div>
        {appConfig.repositoryUrl ? <a className="button button-outline" href={appConfig.repositoryUrl} target="_blank" rel="noreferrer"><Github size={15} /> Open repository <ArrowUpRight size={14} /></a> : <span className="resource-pending"><Github size={15} /> Repository link will be added</span>}
      </section>
    </div>
  );
}
