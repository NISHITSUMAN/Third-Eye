import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { ThirdEyeMark } from './BrandMark';

const navigation = [
  { to: '/', label: 'Home' },
  { to: '/learn', label: 'Learn', application: true },
  { to: '/dashboard', label: 'Dashboard', application: true },
  { to: '/team', label: 'Team' },
  { to: '/links', label: 'Links' },
];

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [authError, setAuthError] = useState<string | null>(null);

  const handleSignOut = async () => {
    const result = await signOut();
    if (result.error) {
      setAuthError(result.error);
      return;
    }
    setAuthError(null);
    setMenuOpen(false);
    navigate('/');
  };

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="Third Eye home" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark"><ThirdEyeMark size={21} /></span>
          <span className="brand-name">THIRD<span> EYE</span></span>
        </Link>

        <nav className={`main-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
          {navigation.map((item) => item.application ? (
            <a key={item.to} href={item.to} className="nav-link" onClick={() => setMenuOpen(false)}>{item.label}</a>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
          <div className="mobile-nav-action">
            {user ? (
              <button className="button button-quiet nav-auth" onClick={handleSignOut}>Sign out</button>
            ) : (
              <Link className="button button-quiet nav-auth" to="/login" onClick={() => setMenuOpen(false)}>Sign in</Link>
            )}
          </div>
        </nav>

        <div className="header-actions">
          {user ? (
            <a href="/dashboard" className="user-chip" title={user.email ?? 'Signed in'}>
              <span className="user-avatar">{(user.email?.[0] ?? 'U').toUpperCase()}</span>
              <span>Dashboard</span>
            </a>
          ) : (
            <Link to="/login" className={`button button-quiet header-signin ${location.pathname === '/login' ? 'active' : ''}`}>
              Sign in <ArrowUpRight size={14} />
            </Link>
          )}
          <button className="menu-toggle" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
        {authError && <p className="header-auth-error" role="alert">{authError}</p>}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div>
          <Link to="/" className="brand footer-brand"><span className="brand-mark"><ThirdEyeMark size={20} /></span><span className="brand-name">THIRD<span> EYE</span></span></Link>
          <p className="footer-tagline">Seeing Beyond the Surface.</p>
          <p className="footer-team">An Earth-observation project by Team Cypher.</p>
        </div>
        <div className="footer-links">
          <span className="eyebrow">EXPLORE</span>
          <a href="/learn">Learn</a>
          <a href="/dashboard">Earth Intelligence dashboard</a>
          <Link to="/team">Our team</Link>
          <Link to="/links">Resources</Link>
        </div>
        <div className="footer-links">
          <span className="eyebrow">MISSION REFERENCES</span>
          <a href="https://science.nasa.gov/mission/nisar/mission-overview/" target="_blank" rel="noreferrer">NASA NISAR <ArrowUpRight size={13} /></a>
          <a href="https://www.earthdata.nasa.gov/" target="_blank" rel="noreferrer">NASA Earthdata <ArrowUpRight size={13} /></a>
          <a href="https://www.isro.gov.in/ISRO_EN/Mission_GSLVF16_NISAR.html" target="_blank" rel="noreferrer">ISRO NISAR <ArrowUpRight size={13} /></a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>TEAM Cypher · NASA SPACE APPS CHALLENGE 2026</span>
        <span>Scientific context linked to official mission sources.</span>
      </div>
    </footer>
  );
}

export function SiteLayout({ children }: { children: ReactNode }) {
  const location = useLocation();

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    let observer: IntersectionObserver | undefined;
    let frame = 0;
    let targets: Element[] = [];

    frame = window.requestAnimationFrame(() => {
      const main = document.querySelector('main');
      if (!main) return;

      const selector = [
        '.hero-copy', '.hero-visual', '.section-heading', '.mission-band',
        '.science-card', '.workflow-step', '.source-panel', '.dashboard-cta',
        '.team-teaser', '.page-hero', '.science-intro-grid', '.section-subsection',
        '.nisar-panel', '.factor-grid article', '.science-note', '.references-panel',
        '.team-placeholder', '.team-overview', '.team-member-card', '.team-closing-note', '.resource-card', '.auth-card', '.dashboard-heading',
        '.account-strip', '.dashboard-launch-card', '.dashboard-links',
      ].join(',');

      targets = Array.from(main.querySelectorAll(selector));
      if (!('IntersectionObserver' in window)) {
        targets.forEach((target) => target.classList.add('is-revealed'));
        return;
      }

      targets.forEach((target, index) => {
        target.classList.add('scroll-reveal');
        (target as HTMLElement).style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 55}ms`);
      });

      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            observer?.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -7% 0px' });

      targets.forEach((target) => observer?.observe(target));
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      targets.forEach((target) => {
        target.classList.remove('scroll-reveal', 'is-revealed');
        (target as HTMLElement).style.removeProperty('--reveal-delay');
      });
    };
  }, [location.pathname]);

  return <><SiteHeader /><main>{children}</main><SiteFooter /></>;
}
