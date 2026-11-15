import { ArrowUpRight, BookOpen, Database, Github, Globe2, Satellite } from 'lucide-react';
import { appConfig } from '../lib/config';

type Resource = { title: string; detail: string; href: string; icon: typeof Satellite; external?: boolean };

const groups: { title: string; resources: Resource[] }[] = [
  {
    title: 'Mission references',
    resources: [
      { title: 'NISAR Mission Overview', detail: 'NASA mission scope, instruments and observations.', href: 'https://science.nasa.gov/mission/nisar/mission-overview/', icon: Satellite },
      { title: 'NISAR and SAR', detail: 'An introduction to Synthetic Aperture Radar.', href: 'https://science.nasa.gov/mission/nisar/get-to-know-sar/', icon: BookOpen },
      { title: 'ISRO NISAR Mission', detail: 'Mission details from the Indian Space Research Organisation.', href: 'https://www.isro.gov.in/ISRO_EN/Mission_GSLVF16_NISAR.html', icon: Globe2 },
    ],
  },
  {
    title: 'Data and documentation',
    resources: [
      { title: 'NASA Earthdata', detail: 'NASA Earth science data, tools and services.', href: 'https://www.earthdata.nasa.gov/', icon: Database },
    ],
  },
];

export default function Links() {
  return (
    <div className="page-shell section-wrap">
      <div className="page-hero">
        <span className="eyebrow">LINKS / 04 — RESOURCE DIRECTORY</span>
        <h1>Sources worth<br /><span className="text-muted">following.</span></h1>
        <p>Official mission references, data portals and project entry points.</p>
      </div>
      <div className="resource-groups">
        {groups.map((group) => (
          <section className="resource-group" key={group.title}>
            <div className="eyebrow">{group.title.toUpperCase()}</div>
            <div className="resource-grid">
              {group.resources.map(({ title, detail, href, icon: Icon }) => (
                <a className="resource-card" key={href} href={href} target="_blank" rel="noreferrer">
                  <span className="resource-icon"><Icon size={20} /></span>
                  <span className="resource-copy"><strong>{title}</strong><small>{detail}</small></span>
                  <ArrowUpRight size={16} />
                </a>
              ))}
            </div>
          </section>
        ))}
        <section className="resource-group">
          <div className="eyebrow">TEAM PROJECT LINKS</div>
          <div className="resource-grid">
            <a className="resource-card" href="/dashboard">
              <span className="resource-icon"><Globe2 size={20} /></span><span className="resource-copy"><strong>Third Eye Dashboard</strong><small>Open the Earth Intelligence workspace.</small></span><ArrowUpRight size={16} />
            </a>
            <a className={`resource-card ${!appConfig.repositoryUrl ? 'is-placeholder' : ''}`} href={appConfig.repositoryUrl || undefined} target={appConfig.repositoryUrl ? '_blank' : undefined} rel="noreferrer">
              <span className="resource-icon"><Github size={20} /></span><span className="resource-copy"><strong>Project repository</strong><small>{appConfig.repositoryUrl ? 'View the project source repository.' : 'Repository link will be added.'}</small></span><ArrowUpRight size={16} />
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
