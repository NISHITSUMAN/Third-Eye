import { ArrowUpRight, ExternalLink, Github, Globe2 } from 'lucide-react';
import { appConfig } from '../lib/config';

export default function Dashboard() {
  return (
    <div className="page-shell section-wrap dashboard-page">
      <div className="dashboard-heading">
        <div><span className="eyebrow">PUBLIC EARTH INTELLIGENCE WORKSPACE</span><h1>Explore Earth.<br /><span className="text-muted">Investigate change.</span></h1><p>Open the Third Eye application or continue learning about satellite radar. No account is required.</p></div>
      </div>
      <section className="dashboard-launch-card">
        <div className="launch-card-copy"><span className="eyebrow">MAIN APPLICATION / 01</span><h2>Third Eye<br /><span className="text-muted">Earth observation workspace.</span></h2><p>Explore NASA NISAR catalogue coverage, public event context, satellite observations and available analysis tools.</p>
          <a className="button button-primary" href="/dashboard">Launch Earth workspace <ExternalLink size={15} /></a>
        </div>
        <div className="launch-card-visual"><div className="launch-orbit orbit-a" /><div className="launch-orbit orbit-b" /><div className="launch-center"><Globe2 size={48} strokeWidth={1} /></div><span className="orbit-caption">OPEN ACCESS / 01</span></div>
      </section>
      <section className="dashboard-links">
        <div><span className="eyebrow">PROJECT RESOURCE</span><h3>Source repository</h3><p>Explore implementation and project documentation.</p></div>
        {appConfig.repositoryUrl ? <a className="button button-outline" href={appConfig.repositoryUrl} target="_blank" rel="noreferrer"><Github size={15} /> Open repository <ArrowUpRight size={14} /></a> : <span className="resource-pending"><Github size={15} /> Repository link will be added</span>}
      </section>
    </div>
  );
}
