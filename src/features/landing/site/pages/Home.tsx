import { ArrowDown, ArrowRight, ArrowUpRight, Database, Radar, ScanLine, Satellite, Waves } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EarthVisual } from '../components/EarthVisual';

const scienceCards = [
  { icon: Radar, index: '01', title: 'Active radar sensing', body: 'SAR instruments transmit microwave energy and measure the signal returned from Earth’s surface.' },
  { icon: Satellite, index: '02', title: 'Dual-frequency observations', body: 'NISAR carries L-band and S-band radar instruments, offering complementary views of surface properties.' },
  { icon: Waves, index: '03', title: 'Change over time', body: 'Repeated observations can help researchers study how land, ice, water and vegetation evolve.' },
];

const workflow = [
  ['01', 'Discover', 'Find relevant satellite acquisition records.'],
  ['02', 'Inspect', 'Review footprints, dates and source metadata.'],
  ['03', 'Explore', 'Open available imagery and scientific products.'],
  ['04', 'Interpret', 'Compare observations with context and care.'],
];

export default function Home() {
  return (
    <>
      <section className="hero section-wrap">
        <div className="hero-copy">
          <div className="eyebrow hero-eyebrow"><span className="eyebrow-line" /> TEAM Cypher <span className="eyebrow-divider">/</span> NASA SPACE APPS CHALLENGE 2026</div>
          <h1>THIRD<span className="title-accent"> EYE</span><span className="title-period">.</span></h1>
          <p className="hero-tagline">Seeing Beyond the Surface.</p>
          <p className="hero-description">An Earth-observation platform for exploring SAR acquisitions, mission data and observations of a changing planet.</p>
          <div className="hero-actions">
            <a href="/learn" className="button button-primary">Open Learn <ArrowRight size={16} /></a>
            <a href="/dashboard" className="button button-outline">Open Dashboard <ArrowUpRight size={15} /></a>
          </div>
          <div className="hero-meta">
            <span><span className="status-dot" /> EARTH OBSERVATION</span>
            <span>SPACE-BORNE RADAR</span>
            <span>SCIENTIFIC EXPLORATION</span>
          </div>
        </div>
        <div className="hero-visual"><EarthVisual /></div>
        <a href="#mission" className="scroll-cue"><ArrowDown size={14} /> SCROLL TO EXPLORE</a>
      </section>

      <section id="mission" className="section section-wrap section-rule">
        <div className="section-heading">
          <div><span className="eyebrow">01 / THE PROJECT</span><h2>Look closer.<br /><span className="text-muted">Understand more.</span></h2></div>
          <p className="section-intro">Third Eye is a project portal for exploring satellite observations and the science behind them. It brings mission context, data discovery and project access into one place.</p>
        </div>
        <div className="mission-band">
          <div className="mission-band-label"><span className="status-dot" /> OUR APPROACH</div>
          <p>Move from <strong>satellite observation</strong> to <strong>evidence-led interpretation</strong> — with the source, acquisition context and limitations always in view.</p>
          <ScanLine className="mission-mark" size={43} strokeWidth={1} />
        </div>
      </section>

      <section className="section section-wrap">
        <div className="section-heading compact-heading">
          <div><span className="eyebrow">02 / SCIENTIFIC FOUNDATION</span><h2>The science behind<br /><span className="text-muted">the signal.</span></h2></div>
          <a href="/learn" className="text-link">Explore Learn <ArrowUpRight size={15} /></a>
        </div>
        <div className="science-grid">
          {scienceCards.map(({ icon: Icon, index, title, body }) => (
            <article className="science-card" key={index}>
              <div className="card-topline"><span>{index} / PRINCIPLE</span><Icon size={20} strokeWidth={1.5} /></div>
              <h3>{title}</h3><p>{body}</p>
              <div className="card-bottom-line" />
            </article>
          ))}
        </div>
      </section>

      <section className="section section-wrap workflow-section">
        <div className="section-heading compact-heading">
          <div><span className="eyebrow">03 / EXPLORATION WORKFLOW</span><h2>From observation<br /><span className="text-muted">to insight.</span></h2></div>
          <p className="section-intro">A conceptual route through the information. The steps available in the live application depend on the data and processing products currently integrated.</p>
        </div>
        <div className="workflow-grid">
          {workflow.map(([number, title, text], index) => (
            <div className="workflow-step" key={number}>
              <div className="workflow-number">{number}</div>
              <div className="workflow-connector"><span /></div>
              <h3>{title}</h3><p>{text}</p>
              {index < workflow.length - 1 && <ArrowRight className="workflow-arrow" size={15} />}
            </div>
          ))}
        </div>
      </section>

      <section className="section section-wrap source-section">
        <div className="source-panel">
          <div><span className="eyebrow">04 / DATA PROVENANCE</span><h2>Start with<br />trusted sources.</h2><p>Scientific interpretation is only as strong as the data behind it. Follow each dataset back to its mission or archive source.</p></div>
          <div className="source-list">
            <a href="https://science.nasa.gov/mission/nisar/mission-overview/" target="_blank" rel="noreferrer"><span className="source-icon"><Satellite size={18} /></span><span><strong>NISAR Mission</strong><small>NASA · ISRO</small></span><ArrowUpRight size={16} /></a>
            <a href="https://www.earthdata.nasa.gov/" target="_blank" rel="noreferrer"><span className="source-icon"><Database size={18} /></span><span><strong>NASA Earthdata</strong><small>Earth science data and services</small></span><ArrowUpRight size={16} /></a>
            <a href="https://www.isro.gov.in/ISRO_EN/Mission_GSLVF16_NISAR.html" target="_blank" rel="noreferrer"><span className="source-icon"><Waves size={18} /></span><span><strong>ISRO NISAR</strong><small>Mission information</small></span><ArrowUpRight size={16} /></a>
          </div>
        </div>
      </section>

      <section className="section section-wrap">
        <div className="dashboard-cta">
          <div><span className="eyebrow">05 / PROJECT ACCESS</span><h2>Explore the<br /><span className="text-muted">observation workspace.</span></h2><p>Open the Third Eye Dashboard to explore its current tools, observations and data views.</p></div>
          <a href="/dashboard" className="button button-primary">Go to Dashboard <ArrowUpRight size={16} /></a>
          <div className="cta-grid-pattern" />
        </div>
      </section>

      <section className="section section-wrap team-teaser">
        <div><span className="eyebrow">06 / THE PEOPLE</span><h2>Built by<br /><span className="text-muted">Team Cypher.</span></h2></div>
        <div><p>Five teammates contributing across full-stack development, storytelling and research.</p><Link to="/team" className="text-link">Meet the team <ArrowUpRight size={15} /></Link></div>
      </section>
    </>
  );
}
