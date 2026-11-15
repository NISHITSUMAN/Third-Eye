import { ArrowUpRight, Cloud, Focus, RadioTower, Waves } from 'lucide-react';

const references = [
  { name: 'NASA · NISAR Mission Overview', url: 'https://science.nasa.gov/mission/nisar/mission-overview/' },
  { name: 'NASA · Get to Know SAR', url: 'https://science.nasa.gov/mission/nisar/get-to-know-sar/' },
  { name: 'ISRO · NISAR Mission', url: 'https://www.isro.gov.in/ISRO_EN/Mission_GSLVF16_NISAR.html' },
];

export default function Science() {
  return (
    <div className="page-shell section-wrap">
      <div className="page-hero">
        <span className="eyebrow">LEARN / 01 — RADAR REMOTE SENSING</span>
        <h1>Read the signal.<br /><span className="text-muted">Respect the context.</span></h1>
        <p>Understanding what Synthetic Aperture Radar measures — and what it does not tell us on its own.</p>
      </div>

      <section className="science-intro-grid">
        <div className="science-intro-mark"><RadioTower size={42} strokeWidth={1.2} /><span>ACTIVE<br />SENSING</span></div>
        <div><span className="eyebrow">01 / HOW SAR WORKS</span><h2>Radar sends.<br />The surface responds.</h2><p>Synthetic Aperture Radar (SAR) is an active microwave remote-sensing technique. The instrument transmits radar pulses toward Earth and measures the energy that returns after interacting with the surface. As the satellite moves, measurements are combined to form a high-resolution radar image.</p><p>Because SAR supplies its own illumination, it can collect observations day or night and can operate through many cloud conditions that limit optical imaging.</p></div>
      </section>

      <section className="section-subsection">
        <div className="eyebrow">02 / INTERPRETING BACKSCATTER</div>
        <h2>A radar image is a measurement,<br /><span className="text-muted">not a verdict.</span></h2>
        <p className="wide-copy">The returned signal — often described as backscatter — is affected by several interacting factors. A brighter or darker pixel is not, by itself, proof of damage, flooding or another specific event.</p>
        <div className="factor-grid">
          <article><Waves size={20} /><h3>Surface roughness</h3><p>Small-scale surface structure changes how energy is scattered.</p></article>
          <article><Cloud size={20} /><h3>Moisture</h3><p>Water content in soil and vegetation can influence the returned signal.</p></article>
          <article><Focus size={20} /><h3>Viewing geometry</h3><p>Incidence angle, terrain orientation and radar look direction matter.</p></article>
          <article><RadioTower size={20} /><h3>Polarization & wavelength</h3><p>Different channels and wavelengths respond differently to targets.</p></article>
        </div>
        <div className="science-note"><span className="note-mark">!</span><p><strong>Interpret with care.</strong> Change analysis should use suitable comparison dates, consistent acquisition geometry, product metadata and independent context. SAR does not identify every hazard automatically, and radar signals do not pass through every material.</p></div>
      </section>

      <section className="nisar-panel">
        <div className="nisar-panel-copy">
          <span className="eyebrow">03 / NASA–ISRO JOINT MISSION</span>
          <h2>NISAR</h2>
          <p>The NASA–ISRO Synthetic Aperture Radar mission observes changes in Earth’s land, ice, water and vegetation using two radar wavelengths.</p>
          <a className="text-link" href="https://science.nasa.gov/mission/nisar/mission-overview/" target="_blank" rel="noreferrer">Official mission overview <ArrowUpRight size={15} /></a>
        </div>
        <div className="nisar-facts">
          <div><span>LAUNCH</span><strong>30 JUL 2025</strong></div>
          <div><span>NASA INSTRUMENT</span><strong>L-BAND · 24 CM</strong></div>
          <div><span>ISRO INSTRUMENT</span><strong>S-BAND · 9.4 CM</strong></div>
          <div><span>REPEAT CYCLE</span><strong>12 DAYS</strong></div>
          <div className="nisar-fact-wide"><span>OBSERVATION CADENCE</span><strong>About 6 days average sampling across ascending and descending passes.</strong></div>
        </div>
      </section>

      <section className="section-subsection">
        <div className="eyebrow">04 / DATA INTEGRITY</div>
        <h2>Know what you<br /><span className="text-muted">are looking at.</span></h2>
        <p className="wide-copy">A catalogue result, an acquisition footprint, a browse preview and a calibrated science product are different things. Always verify the product itself before using it for analysis.</p>
        <div className="metadata-list">
          {['Product type and processing level', 'Acquisition date and time', 'Polarization and frequency band', 'Coordinate reference system and geolocation', 'Source archive and product documentation'].map((item, index) => (
            <div key={item}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong></div>
          ))}
        </div>
      </section>

      <section className="references-panel">
        <span className="eyebrow">FURTHER READING / OFFICIAL SOURCES</span>
        <div className="reference-list">
          {references.map((reference) => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer">{reference.name}<ArrowUpRight size={15} /></a>)}
          <a href="https://www.earthdata.nasa.gov/" target="_blank" rel="noreferrer">NASA Earthdata — data and services<ArrowUpRight size={15} /></a>
        </div>
      </section>
    </div>
  );
}
