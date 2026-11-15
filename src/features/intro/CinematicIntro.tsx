import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ClientOnly, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { SkipForward, ArrowRight, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogoMark } from '@/components/te/Logo';
import { INTRO_DURATION, SCENES, sceneAt } from './timeline';
import ScienceMap from './ScienceMap';
const SpaceScene = lazy(() => import('./SpaceScene'));
export default function CinematicIntro() {
  const [scene, setScene] = useState(0);
  const [finished, setFinished] = useState(false);
  const [ready, setReady] = useState(false);
  const progress = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const reduced = Boolean(useReducedMotion());
  const navigate = useNavigate();
  const onReady = useCallback(() => setReady(true), []);
  const enter = useCallback(() => void navigate({ to: '/landing' }), [navigate]);
  useEffect(() => {
    let elapsed = 0, previous = performance.now(), frame = 0, last = -1;
    const update = () => {
      const now = performance.now();
      if (!document.hidden) elapsed = Math.min(elapsed + now - previous, INTRO_DURATION);
      previous = now;
      if (progress.current) progress.current.style.transform = `scaleX(${elapsed / INTRO_DURATION})`;
      if (time.current) time.current.textContent = `${(elapsed / 1000).toFixed(1).padStart(4, '0')} / ${(INTRO_DURATION / 1000).toFixed(1)}`;
      const next = sceneAt(elapsed);
      if (next >= 0 && next !== last) { last = next; setScene(next); }
      if (elapsed < INTRO_DURATION) frame = requestAnimationFrame(update);
      else { setScene(SCENES.length - 1); setFinished(true); enter(); }
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [enter]);
  const id = SCENES[scene]?.id;
  const science = id === 'flood' || id === 'wetland' || id === 'surface';
  return <main className={`cinema awakening scene-${id}`} data-scene-ready={ready ? 'true' : undefined} data-intro-scene={id}>
    <div className="space-stage" aria-hidden="true"><ClientOnly fallback={<div className="earth-fallback" />}><Suspense fallback={<div className="earth-fallback" />}><SpaceScene mode={scene} reduced={reduced} onReady={onReady} /></Suspense></ClientOnly></div>
    <div className="space-vignette" />
    <div className={`opening-veil ${reduced ? 'reduced' : ''}`} />
    <header className="cinema-header"><a href="/landing" className="wordmark" aria-label="Third Eye home"><LogoMark size={26} /><span>THIRD EYE<i /></span></a><span className="header-center"><span className="status-dot" /> TEAM Cypher / NASA SPACE APPS CHALLENGE</span><div className="header-actions"><Button variant="cinematic" size="sm" onClick={enter}>SKIP INTRO <SkipForward /></Button></div></header>
    <div className="scene-coordinate"><span className="coordinate-cross">+</span><span>THE AWAKENING / MISSION 001</span><span>19.0760° N · 72.8777° E</span></div>
    {science && <ScienceMap key={id} kind={id} cinematic />}
    <AnimatePresence mode="sync"><motion.section key={scene} className={`scene-copy ${science ? 'science-copy' : ''}`} initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.1 : 0.28 }}>
      {scene === 0 ? <><div className="eyebrow"><span className="tiny-line" /> AN UNKNOWN SIGNAL</div><h1 className="opening-title">BEYOND WHAT<br />HUMAN EYES CAN SEE<span className="title-period">...</span></h1><p className="scene-caption">One planet. Infinite signals. Hidden stories.</p></> : scene === 1 ? <><div className="eyebrow">THE LIVING PLANET</div><h1>ONE PLANET<span className="title-period">.</span></h1><p className="project-subtitle">INFINITE SIGNALS. HIDDEN STORIES.</p></> : scene === 2 ? <><div className="eyebrow">THE EYE ACTIVATES / NISAR-INSPIRED</div><h1 className="opening-title">THE PLANET HAS SIGNALS.<br />WE LEARN TO READ THEM.</h1><p className="scene-caption">L-BAND / S-BAND · RADAR BEAMS ARE ILLUSTRATIVE</p></> : scene === 3 || scene === 4 || scene === 5 ? <><div className="eyebrow">THE HIDDEN STORY / MUMBAI</div><h1>{id === 'flood' ? 'FLOOD' : id === 'wetland' ? 'WETLAND' : 'SURFACE'}<br />INTELLIGENCE<span className="title-period">.</span></h1></> : <><div className="eyebrow">{id === 'initialize' ? 'THE REVELATION' : 'TEAM Cypher / NASA SPACE APPS CHALLENGE'}</div><h1 className="revelation-title">THIRD EYE<span className="title-period">.</span></h1><p className="project-subtitle">SEE WHAT THE EYE CANNOT.</p>{id === 'initialize' && <><p className="scene-caption">Understanding Earth's hidden changes through radar intelligence.</p><Button variant="mission" onClick={enter}>INITIALIZE MISSION <ArrowRight /></Button></>}</>}
    </motion.section></AnimatePresence>
    <div className="orbital-label"><span className="orbital-marker" /><span>EARTH<small>OUR ONLY HOME</small></span></div>
    {scene === 2 && <div className="radar-telemetry"><span>L / 24 cm</span><span>S / 10 cm</span><span>ILLUSTRATIVE WAVES</span><span>LANDSAT REFERENCE MODEL<br />NISAR-INSPIRED ANTENNA</span></div>}
    <footer className="cinema-footer"><div className="footer-left"><Radio size={15} /><span>INDEPENDENT SCIENTIFIC DEMONSTRATION</span></div><div className="timeline"><div className="timeline-label"><span>{finished ? 'MISSION READY' : `${String(scene + 1).padStart(2, '0')} / ${id?.toUpperCase()}`}</span><span ref={time}>00.0 / {(INTRO_DURATION / 1000).toFixed(1)}</span></div><div className="timeline-track"><div className="timeline-fill" ref={progress} /></div></div><span className="footer-credit">DANCING WITH THE SARs</span></footer>
  </main>;
}
