import { Link as RouterLink, useNavigate, useSearch } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars, useTexture } from '@react-three/drei'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  CloudRain,
  Globe2,
  Home,
  Map,
  Menu,
  Radar as RadarIcon,
  Satellite,
  Settings2,
  Sparkles,
  Target,
  UserRound,
  Waves,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'

type IconType = typeof Home

type NavItem = {
  label: string
  path: string
  icon: IconType
}

type Lesson = {
  id: number
  title: string
  summary: string
  objectives: string[]
  explanation: string
  applications: string[]
  takeaway: string
}

type Chapter = {
  id: string
  title: string
  lesson: string
  guide: string
  workedExample: string
  watchFor: string
  answerWhy: string
  playground: PlaygroundId
  prompt: string
  choices: string[]
  answer: string
  animation: 'pulse' | 'wave' | 'scatter' | 'change' | 'phase'
}

type PlaygroundId =
  | 'sensor-choice'
  | 'pulse-echo'
  | 'range-calculator'
  | 'band-comparator'
  | 'aperture-builder'
  | 'science-question'
  | 'repeat-stack'
  | 'product-matcher'
  | 'metadata-audit'
  | 'archive-finder'
  | 'backscatter-meter'
  | 'water-roughness'
  | 'vegetation-depth'
  | 'double-bounce'
  | 'polarization-mixer'
  | 'flood-signal'
  | 'biomass-calibration'
  | 'crop-calendar'
  | 'glacier-speed'
  | 'comparison-audit'
  | 'phase-cycle'
  | 'interferogram-builder'
  | 'coherence-check'
  | 'line-of-sight'
  | 'uncertainty-budget'

type LocationEntry = {
  name: string
  region: string
  significance: string
  missionFocus: string
  applications: string[]
  latitude: number
  longitude: number
}

type Question = {
  prompt: string
  options: string[]
  correct: string
  explanation: string
}

type Mission = {
  title: string
  challenge: string
  evidence: string
  tools: string[]
  score: number
  badge: string
}

type ResearchResource = {
  title: string
  author: string
  year: string
  topic: string
  level: string
  format: string
  summary: string
  citation: string
  url: string
}

type SatelliteArea = {
  name: string
  bbox: string
}

const navItems: NavItem[] = [
  { label: 'Home', path: '/', icon: Home },
  { label: 'Learning Journey', path: '/academy', icon: BookOpen },
  { label: 'NASA Eyes', path: '/nasa-eyes', icon: Globe2 },
  { label: 'Reference Library', path: '/research-library', icon: BookOpen },
  { label: 'Achievements', path: '/achievements', icon: Award },
  { label: 'My Progress', path: '/my-progress', icon: BarChart3 },
]

function learningTarget(to: string) {
  const [path = '/', query = ''] = to.split('?', 2)
  const params = new URLSearchParams(query)
  const search: { section: string; level?: number; chapter?: number; lesson?: number } = { section: path }
  for (const key of ['level', 'chapter', 'lesson'] as const) {
    const value = Number(params.get(key))
    if (Number.isInteger(value) && value > 0) search[key] = value
  }
  return { search }
}

type LearningLinkProps = {
  to: string
  children?: React.ReactNode
  className?: string
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
  'aria-current'?: React.AriaAttributes['aria-current']
  'aria-disabled'?: boolean
  'aria-label'?: string
  tabIndex?: number
  title?: string
}

function Link({ to, onClick, className, children, ...props }: LearningLinkProps) {
  const target = learningTarget(to)
  return (
    <RouterLink
      to="/learn"
      search={() => ({
        section: target.search.section,
        level: target.search.level,
        chapter: target.search.chapter,
        lesson: target.search.lesson,
      })}
      {...(className ? { className } : {})}
      {...(onClick ? { onClick } : {})}
      {...(props['aria-current'] !== undefined ? { 'aria-current': props['aria-current'] } : {})}
      {...(props['aria-disabled'] !== undefined ? { 'aria-disabled': props['aria-disabled'] } : {})}
      {...(props['aria-label'] !== undefined ? { 'aria-label': props['aria-label'] } : {})}
      {...(props.tabIndex !== undefined ? { tabIndex: props.tabIndex } : {})}
      {...(props.title !== undefined ? { title: props.title } : {})}
    >
      {children}
    </RouterLink>
  )
}

function NavLink({
  to,
  className,
  ...props
}: Omit<LearningLinkProps, 'className'> & {
  className?: string | ((state: { isActive: boolean }) => string)
}) {
  const activeSection = useSearch({ from: '/learn', select: (search) => search.section ?? '/' })
  const active = activeSection === to.split('?', 1)[0]
  const resolvedClassName = typeof className === 'function' ? className({ isActive: active }) : className
  return <Link to={to} {...(resolvedClassName ? { className: resolvedClassName } : {})} aria-current={active ? 'page' : undefined} {...props} />
}

const learningLevels: Lesson[] = [
  {
    id: 1,
    title: 'Understanding Earth',
    summary: 'Earth is dynamic, and radar helps reveal hidden motion and change.',
    objectives: ['Remote sensing fundamentals', 'Natural and human-driven changes', 'Satellite observation principles'],
    explanation:
      'Earth observation satellites measure energy reflected and emitted from the surface. SAR is especially powerful because it actively sends microwave pulses and records the return signal, enabling observation through clouds and darkness.',
    applications: ['Land cover changes', 'Coastal erosion', 'Hydrology tracking'],
    takeaway: 'The planet is always changing, and radar reveals patterns not obvious to the human eye.',
  },
  {
    id: 2,
    title: 'The NISAR Mission',
    summary: 'NASA–ISRO NISAR pairs science from two space agencies to observe Earth with dual-band radar.',
    objectives: ['Mission objectives', 'Orbital geometry', 'L-band and S-band radar'],
    explanation:
      'NISAR is designed to measure Earth’s changing surface with high accuracy. Its L-band and S-band radar systems respond differently to vegetation, soil moisture, and structure, giving scientists complementary information.',
    applications: ['Ground motion', 'Ecosystem monitoring', 'Ice dynamics'],
    takeaway: 'Mission design matters: the sensor choice determines what Earth processes can be observed most clearly.',
  },
  {
    id: 3,
    title: 'Mastering SAR',
    summary: 'Synthetic Aperture Radar turns reflected waves into detailed surface imagery.',
    objectives: ['Backscatter', 'Incidence angle', 'Polarization'],
    explanation:
      'SAR measures the strength and timing of reflected microwave pulses. Return strength depends on roughness, moisture, vegetation, and geometry, which is why images can reveal different surface types and changes over time.',
    applications: ['Forest mapping', 'Urban planning', 'Flood delineation'],
    takeaway: 'Backscatter is not just brightness; it encodes surface properties and the geometry of the observation.',
  },
  {
    id: 4,
    title: 'Understanding Earth Changes',
    summary: 'SAR reveals changes caused by seasons, disasters, and land use shifts.',
    objectives: ['Flood monitoring', 'Deforestation', 'Glacier movement'],
    explanation:
      'Surface changes often create a measurable signal in radar backscatter or coherence. Repeated imaging helps researchers distinguish long-term trends from one-off events.',
    applications: ['Agriculture stress', 'Landslide monitoring', 'Wetland management'],
    takeaway: 'Time series are the key to understanding whether a change is natural, recurrent, or anthropogenic.',
  },
  {
    id: 5,
    title: 'Scientific Analysis',
    summary: 'SAR interpretation turns raw measurements into evidence-based science.',
    objectives: ['Change detection', 'InSAR', 'Coherence and uncertainty'],
    explanation:
      'Interpreting radar data requires careful attention to geometry, vegetation, speckle, and temporal consistency. Scientific analysis combines multiple observations to detect deformation and evaluate confidence.',
    applications: ['Displacement mapping', 'Monitoring infrastructure', 'Climate studies'],
    takeaway: 'Reliable science depends on sound interpretation and clear uncertainty estimates, not only on flashy imagery.',
  },
]

const learningPathModules = [
  {
    lessonId: 1,
    duration: '20 min',
    imageUrl: 'https://earthdata.nasa.gov/s3fs-public/styles/hero_background_745/public/2024-11/sar-hero.jpg?VersionId=08IXOuUcFy18YAvEWy4He36D6i8LClPv&itok=P5JeqHVC',
    imageAlt: 'Radar image of Death Valley, California, collected by the SIR-C mission.',
    imageCredit: 'NASA Earthdata · SIR-C',
    concept: 'Start with Earth observation, active sensors, and what radar can reveal when optical imagery cannot.',
    practice: 'Choose an Earth region and connect its landscape to a satellite observation question.',
    resourceLabel: 'NASA Earthdata: What is SAR?',
    resourceUrl: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar',
    labPath: '/earth-explorer',
    labLabel: 'Explore a study area',
  },
  {
    lessonId: 2,
    duration: '30 min',
    imageUrl: 'https://assets.science.nasa.gov/dynamicimage/assets/science/missions/nisar/nisar-jpl/images/nisar-2021-02-12-105655%20-%2020210212_092334.jpg?w=1200&h=800&fit=crop&crop=faces%2Cfocalpoint',
    imageAlt: 'NISAR L-band and S-band radar instruments being prepared at NASA JPL.',
    imageCredit: 'NASA JPL · NISAR instruments',
    concept: 'Learn NISAR’s science goals, orbit, and complementary L-band and S-band instruments.',
    practice: 'Match the mission’s radar bands to questions about vegetation, ice, and ground motion.',
    resourceLabel: 'NASA: NISAR mission overview',
    resourceUrl: 'https://science.nasa.gov/mission/nisar/mission-overview/',
    labPath: '/nisar-mission',
    labLabel: 'Review mission design',
  },
  {
    lessonId: 3,
    duration: '45 min',
    imageUrl: 'https://earthdata.nasa.gov/s3fs-public/styles/hds_large/public/2022-02/SARPolarization.jpg?VersionId=KyQ7vrmGXFfSLVdRu6r8oMCEiSy.uiuu&itok=TPctruIs',
    imageAlt: 'NASA diagram comparing radar scattering from rough surfaces, vegetation, and structures.',
    imageCredit: 'NASA Earthdata · SAR Handbook',
    concept: 'Interpret backscatter, wavelength, polarization, incidence angle, and common scattering behavior.',
    practice: 'Change surface and sensor settings, then explain why the simulated return changes.',
    resourceLabel: 'NASA ARSET: Introduction to SAR',
    resourceUrl: 'https://appliedsciences.nasa.gov/get-involved/training/english/arset-introduction-synthetic-aperture-radar-sar-and-its-applications',
    labPath: '/radar-simulator',
    labLabel: 'Run the radar simulator',
  },
  {
    lessonId: 4,
    duration: '45 min',
    imageUrl: 'https://assets.science.nasa.gov/dynamicimage/assets/science/missions/nisar/1-PIA26670-NISAR_Views_Seattle.jpg?w=1200&h=800&fit=crop&crop=faces%2Cfocalpoint',
    imageAlt: 'False-color NISAR radar view of Seattle, Puget Sound, and Lake Washington.',
    imageCredit: 'NASA · NISAR Seattle image',
    concept: 'Compare repeat observations and account for water, vegetation, surface moisture, and seasonal change.',
    practice: 'Investigate one change case and distinguish a plausible signal from an unsupported conclusion.',
    resourceLabel: 'NASA ARSET: Radar for land, water, and disasters',
    resourceUrl: 'https://appliedsciences.nasa.gov/get-involved/training/english/arset-radar-remote-sensing-land-water-disaster-applications',
    labPath: '/change-detection',
    labLabel: 'Investigate a change case',
  },
  {
    lessonId: 5,
    duration: '45 min',
    imageUrl: 'https://earthdata.nasa.gov/s3fs-public/styles/hds_large/public/2024-11/sar-interferometry-okmok-volcano.jpg?VersionId=h4oxvSWUowkSCVMfVsLQsq4LRvUrOqKY&itok=JMujJ3Sr',
    imageAlt: 'Interferometric SAR fringes showing surface deformation at Okmok Volcano, Alaska.',
    imageCredit: 'NASA Earthdata · ASF DAAC',
    concept: 'Build from repeat-pass comparison to InSAR phase, coherence, displacement, and uncertainty.',
    practice: 'Inspect the interferometry lab and state what a phase pattern can and cannot tell you.',
    resourceLabel: 'NASA Earthdata: SAR interferometry',
    resourceUrl: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar#toc-interferometry',
    labPath: '/insar-lab',
    labLabel: 'Open the InSAR lab',
  },
]

const chapterContent: Omit<Chapter, 'id' | 'guide' | 'workedExample' | 'watchFor' | 'answerWhy' | 'playground'>[][] = [
  [
    { title: 'What satellites observe', lesson: 'Remote sensing measures Earth from a distance. Optical instruments record reflected or emitted light; radar systems measure microwave energy returned from the surface.', prompt: 'Which statement best describes remote sensing?', choices: ['Measuring Earth from a distance', 'Only taking visible photographs', 'Collecting data only from the ground'], answer: 'Measuring Earth from a distance', animation: 'pulse' },
    { title: 'Active radar pulses', lesson: 'SAR is active: its antenna transmits a microwave pulse and records the echo. Because the instrument supplies its own energy, it can collect data at night.', prompt: 'Why can SAR collect observations after dark?', choices: ['It transmits its own energy', 'It uses moonlight', 'It records surface color'], answer: 'It transmits its own energy', animation: 'pulse' },
    { title: 'Echo time and range', lesson: 'The time between transmission and echo relates to distance from the antenna. Processing uses these timings and the satellite path to locate returns in an image.', prompt: 'What does echo travel time help determine?', choices: ['Distance to the scattering surface', 'Surface temperature', 'Vegetation species'], answer: 'Distance to the scattering surface', animation: 'pulse' },
    { title: 'Wavelength in the landscape', lesson: 'Microwave wavelengths interact with objects at different scales. Longer wavelengths can interact with larger branches and trunks, while shorter wavelengths respond to smaller features.', prompt: 'Which usually interacts more deeply with forest structure?', choices: ['Longer wavelength radar', 'Visible light only', 'A shorter wavelength in every case'], answer: 'Longer wavelength radar', animation: 'wave' },
    { title: 'The synthetic aperture', lesson: 'As a satellite moves, it observes the same target from multiple positions. Processing combines those echoes to synthesize a long antenna and achieve fine along-track resolution.', prompt: 'What is combined to form a synthetic aperture?', choices: ['Echoes from multiple satellite positions', 'Images from different planets', 'Cloud and sunlight measurements'], answer: 'Echoes from multiple satellite positions', animation: 'pulse' },
  ],
  [
    { title: 'NISAR science questions', lesson: 'NISAR observes changing land, ice, water, and vegetation. Its data support studies of surface motion, ecosystems, hazards, and other Earth processes.', prompt: 'Which is a NISAR science application?', choices: ['Monitoring surface deformation', 'Measuring starlight color', 'Mapping sound waves'], answer: 'Monitoring surface deformation', animation: 'change' },
    { title: 'L-band and S-band', lesson: 'NISAR carries L-band and S-band radars. Their different wavelengths provide complementary sensitivity to vegetation, soil, ice, and surface structure.', prompt: 'Why does NISAR use two radar bands?', choices: ['Their measurements respond differently to surfaces', 'One band is a visible camera', 'Two bands remove every uncertainty'], answer: 'Their measurements respond differently to surfaces', animation: 'wave' },
    { title: 'Repeat orbit observations', lesson: 'Repeated acquisitions let scientists compare the same region through time. Similar observation geometry makes it easier to separate real change from differences in viewing conditions.', prompt: 'What do repeat observations enable?', choices: ['Tracking change through time', 'Natural-color imaging', 'Skipping product calibration'], answer: 'Tracking change through time', animation: 'change' },
    { title: 'From echoes to products', lesson: 'Radar echoes are processed and calibrated into products such as backscatter imagery and complex data. The product type and processing level determine what analysis is appropriate.', prompt: 'What should you check before analyzing a SAR product?', choices: ['Its product type and metadata', 'Only its display palette', 'The file name alone'], answer: 'Its product type and metadata', animation: 'pulse' },
    { title: 'Finding mission data', lesson: 'NASA Earthdata and the Alaska Satellite Facility provide mission information, product access, and documentation. Verify acquisition, band, polarization, and processing details in the archive record.', prompt: 'Where should you verify a SAR scene’s acquisition details?', choices: ['The archive metadata and documentation', 'An unrelated image legend', 'A social post without a source'], answer: 'The archive metadata and documentation', animation: 'change' },
  ],
  [
    { title: 'Backscatter brightness', lesson: 'Backscatter is energy scattered back toward the sensor. Image brightness represents a processed radar measurement, not the natural color or temperature of the ground.', prompt: 'What does a bright pixel usually indicate in a backscatter image?', choices: ['A stronger radar return in that product', 'A naturally brighter surface color', 'A higher surface temperature'], answer: 'A stronger radar return in that product', animation: 'scatter' },
    { title: 'Smooth water response', lesson: 'Calm open water often reflects radar energy away from the antenna and appears dark. Wind, waves, shorelines, and nearby structures can produce different returns.', prompt: 'Why is calm open water often dark in SAR?', choices: ['Energy reflects away from the sensor', 'Water always absorbs all radar', 'SAR cannot observe water'], answer: 'Energy reflects away from the sensor', animation: 'scatter' },
    { title: 'Vegetation scattering', lesson: 'Leaves, branches, and trunks scatter energy within a canopy. Wavelength, canopy density, moisture, and viewing geometry all shape the return.', prompt: 'What can contribute to forest backscatter?', choices: ['Scattering within leaves and branches', 'Sunlight color alone', 'Cloud shadows alone'], answer: 'Scattering within leaves and branches', animation: 'scatter' },
    { title: 'Urban double bounce', lesson: 'A building wall and the ground can form a corner reflector that sends energy back toward the sensor. Street direction and building geometry make urban signals variable.', prompt: 'What can cause strong double-bounce scattering?', choices: ['A wall meeting the ground', 'A cloud above a road', 'A smooth open-water surface'], answer: 'A wall meeting the ground', animation: 'scatter' },
    { title: 'Polarization channels', lesson: 'Polarization labels describe transmitted and received wave orientations. HH and VV are co-polarized; HV and VH are cross-polarized and can reveal different scattering structures.', prompt: 'What does VH mean?', choices: ['Vertical transmit, horizontal receive', 'Visible heat from a surface', 'A vertical height measurement'], answer: 'Vertical transmit, horizontal receive', animation: 'wave' },
  ],
  [
    { title: 'Flood water mapping', lesson: 'Open floodwater often has low backscatter, but urban and vegetated flooding can be bright due to double-bounce scattering. Compare with a baseline and local context.', prompt: 'Why can flooded urban areas remain bright?', choices: ['Water and buildings can create double-bounce returns', 'All floodwater always increases returns', 'SAR records building color'], answer: 'Water and buildings can create double-bounce returns', animation: 'change' },
    { title: 'Forest structure and biomass', lesson: 'Radar responds to canopy, branches, trunks, and ground. Biomass estimates require models, calibration, and field validation; brightness is not biomass by itself.', prompt: 'Does one SAR brightness value directly equal biomass?', choices: ['No, estimates need models and validation', 'Yes, brightness is a biomass unit', 'Yes, if the image is false color'], answer: 'No, estimates need models and validation', animation: 'wave' },
    { title: 'Crop growth over time', lesson: 'Crop height, water content, planting, and harvest change radar response. A consistent time series reveals seasonal patterns better than a single image.', prompt: 'What best supports crop development analysis?', choices: ['Observations across the growing season', 'One image without a date', 'The basemap color'], answer: 'Observations across the growing season', animation: 'change' },
    { title: 'Glacier motion', lesson: 'Repeat SAR scenes support glacier and ice-sheet monitoring. Feature tracking and interferometry are distinct methods, each with limits related to texture and coherence.', prompt: 'What can repeat SAR observations help track on glaciers?', choices: ['Motion and change over time', 'Natural ice color only', 'Air temperature at the summit'], answer: 'Motion and change over time', animation: 'change' },
    { title: 'Fair before-and-after comparisons', lesson: 'Apparent differences may result from surface change or different geometry, season, moisture, or processing. Check compatible products and acquisition metadata before making a claim.', prompt: 'What should you verify before comparing two SAR scenes?', choices: ['Dates, geometry, and processing', 'Only equal pixel dimensions', 'Matching screen brightness'], answer: 'Dates, geometry, and processing', animation: 'change' },
  ],
  [
    { title: 'Radar phase', lesson: 'A coherent radar measurement records phase related to the distance traveled by the wave. Phase is wrapped and can include topographic, atmospheric, and noise contributions.', prompt: 'What does radar phase relate to?', choices: ['Signal path length and other phase contributions', 'Natural surface color', 'Building count in a pixel'], answer: 'Signal path length and other phase contributions', animation: 'phase' },
    { title: 'Form an interferogram', lesson: 'InSAR combines phase from two aligned acquisitions of the same area. The interferogram can contain topography, deformation, atmosphere, and noise.', prompt: 'What is compared to form an interferogram?', choices: ['Phase from two SAR acquisitions', 'Two optical color palettes', 'Temperature from weather stations'], answer: 'Phase from two SAR acquisitions', animation: 'phase' },
    { title: 'Coherence and decorrelation', lesson: 'Coherence describes how consistently the complex radar signal returns between acquisitions. Vegetation, water, surface change, and geometry can lower coherence.', prompt: 'What does low coherence warn you about?', choices: ['Phase interpretation may be unreliable', 'The ground definitely did not move', 'The image is naturally dark'], answer: 'Phase interpretation may be unreliable', animation: 'phase' },
    { title: 'Line-of-sight motion', lesson: 'A single InSAR viewing geometry measures motion projected along the radar line of sight. It does not independently recover the full three-dimensional motion vector.', prompt: 'What motion does one InSAR geometry measure?', choices: ['Motion projected along its line of sight', 'Full 3D motion without assumptions', 'Only north-south motion'], answer: 'Motion projected along its line of sight', animation: 'phase' },
    { title: 'Uncertainty and evidence', lesson: 'Reliable interpretation checks coherence, atmosphere, topography, processing, and reference choices. Report uncertainty and avoid claiming more than the observations support.', prompt: 'What strengthens an InSAR conclusion?', choices: ['Checking data quality and stating uncertainty', 'Treating every fringe as exact vertical motion', 'Ignoring acquisition geometry'], answer: 'Checking data quality and stating uncertainty', animation: 'phase' },
  ],
]

const chapterGuides: Record<string, string> = {
  'What satellites observe': 'A satellite sensor measures energy coming from Earth. A camera measures sunlight reflected from the ground, while a radar measures the microwave echo that returns after the satellite sends a pulse. Each measurement is a clue, not a complete description of a place. Scientists combine the signal with location, time, sensor settings, and other observations to explain what may be happening.',
  'Active radar pulses': 'A SAR satellite carries its own microwave transmitter. It sends a short pulse toward the ground, then records the returning echo. Clouds and darkness do not stop the radar from sending or receiving that signal, although heavy rain and the surface itself can still affect the measurement. Think of it like listening for an echo, except the instrument measures the wave very precisely.',
  'Echo time and range': 'A radar pulse travels from the antenna to the surface and back. The travel time tells the processor how far away the reflecting point is; a longer round trip means a greater distance. The satellite also moves while it collects echoes, so processing combines distance and motion to place each return in the right image location. This is why a SAR image is calculated from measurements rather than captured like a phone photo.',
  'Wavelength in the landscape': 'Wavelength is the distance from one wave peak to the next. Small features interact more strongly with shorter waves, while longer waves can interact with larger branches, trunks, and surface structures. Longer does not always mean “sees through everything”: moisture, density, shape, and viewing direction matter too. A wavelength is useful because it changes which parts of a landscape contribute to the echo.',
  'The synthetic aperture': 'A satellite antenna is too short to produce some of the fine detail scientists want from orbit. As the satellite flies, it records echoes from the same ground target at many positions. A computer combines those echoes as if they came from a much longer antenna. That processing step creates the “synthetic” aperture and improves detail along the flight direction; it is not a physically expanding antenna.',
  'NISAR science questions': 'NISAR repeatedly measures land, ice, water, and vegetation so scientists can study how they change. For example, two well-aligned radar observations can help reveal ground movement, while a time series can show seasonal changes in crops or wetlands. The satellite does not directly diagnose an earthquake, flood, or ecosystem. Researchers interpret its measurements alongside maps, field observations, and other evidence.',
  'L-band and S-band': 'NISAR carries two radar systems with different wavelengths. L-band is longer and can interact with larger vegetation structures; S-band is shorter and responds differently to leaves, crops, soil, and other surfaces. The two bands provide complementary measurements, not two copies of the same answer. Neither band is automatically better for every task, and scientists still need to account for surface conditions and sensor geometry.',
  'Repeat orbit observations': 'A repeat observation means the satellite measures the same place again later. Comparing dates can reveal movement or change, but the comparison is most useful when the viewing geometry and processing are compatible. A difference may come from real change, or from rain, vegetation growth, a different look angle, or noise. Dates and metadata are part of the evidence, not optional labels.',
  'From echoes to products': 'The satellite records complex measurements, not a ready-made map with labels such as “forest” or “flood.” Processing calibrates and organizes the echoes into products such as backscatter images, phase data, and coherence maps. Each product answers different questions. Before analysis, check the product name, units, polarization, acquisition time, processing level, and documented limitations.',
  'Finding mission data': 'A useful data search starts with the place, dates, sensor, and question you care about. NASA Earthdata and the Alaska Satellite Facility provide mission records, documentation, and access to SAR products. An archive listing tells you what was collected and how it was processed; it does not prove a scientific conclusion. Keep the product metadata and citation with the image so someone else can reproduce your interpretation.',
  'Backscatter brightness': 'Backscatter describes how much radar energy returns toward the sensor. A brighter pixel usually means a stronger return in that particular processed image, not a brighter-colored surface or a hotter place. Roughness, moisture, material, wavelength, polarization, and angle all affect the return. Always read the legend and product type before explaining a bright or dark patch.',
  'Smooth water response': 'Calm open water often looks dark because its smooth surface reflects much of the radar energy away from the satellite. Wind can roughen the water and send more energy back. Shorelines, bridges, boats, and buildings beside water can also create bright returns. “Water is dark” is a useful first guess for calm open water, not a rule that applies to every watery pixel.',
  'Vegetation scattering': 'Radar can interact with leaves, branches, trunks, and the ground beneath a canopy. Some energy bounces between parts of the plant and some travels deeper before returning. The balance depends on wavelength, polarization, moisture, plant type, and season. A forest’s brightness is therefore not a direct measurement of tree count or biomass; those estimates need calibrated methods and comparison with field data.',
  'Urban double bounce': 'A wall meeting the ground can act like a corner that sends radar energy back toward the satellite. This is called double-bounce scattering and can make some buildings or flooded streets appear bright. The effect changes with building orientation and the satellite’s look direction, so a city is not uniformly bright. Geometry helps explain the pattern, but does not identify a building by itself.',
  'Polarization channels': 'Polarization describes the direction in which the radar wave vibrates. The first letter in a channel label is the transmitted direction and the second is the received direction: H means horizontal and V means vertical. HH and VV are co-polarized; HV and VH are cross-polarized. Different channels emphasize different kinds of scattering, but the meaning still depends on wavelength, surface, and processing.',
  'Flood water mapping': 'SAR can map floods when clouds make optical images difficult to use. Open, smooth floodwater often has a weak return, while water between buildings or tree trunks can create a strong double bounce. To map an event, compare a flood observation with a suitable baseline and check local terrain, land cover, and acquisition dates. One dark patch alone is not proof of flooding.',
  'Forest structure and biomass': 'Radar responds to different parts of a forest, from leaves to trunks and ground. Longer wavelengths can interact with larger structures, which helps researchers study forest condition over broad areas. But radar brightness is not a biomass scale. Estimating carbon or biomass requires models, calibration, field measurements, and uncertainty estimates; the same return can have more than one possible cause.',
  'Crop growth over time': 'Growing crops change height, shape, water content, and spacing. Those changes affect radar echoes, so a sequence of observations can reveal planting, growth, and harvest patterns. A single date cannot show a season by itself. Compare observations from compatible dates and geometry, and remember that rainfall or irrigation can change the signal even when the crop has not visibly changed.',
  'Glacier motion': 'Glaciers flow, crack, melt, and shift debris over time. Repeat SAR images can track surface features, and interferometry can measure some small movements when the radar echoes remain coherent. These are different methods: feature tracking follows recognizable patterns, while InSAR compares signal phase. Snowfall, melting, and fast-changing ice can make measurements harder, so the method and confidence should be stated.',
  'Fair before-and-after comparisons': 'A fair comparison uses observations that are aligned and similar enough to isolate the change you care about. Check acquisition dates, look direction, incidence angle, polarization, resolution, calibration, and processing. Rain or seasonal growth may change the surface response even without a disaster. Displaying two images at the same brightness does not make the underlying measurements comparable.',
  'Radar phase': 'A coherent radar signal has both strength and phase. Phase describes where the wave is within its repeating cycle and is related to the distance the signal traveled. The recorded phase wraps around after each full cycle, so it is not a simple ruler reading. Topography, surface movement, atmosphere, orbit errors, and noise can all contribute to the measured phase.',
  'Form an interferogram': 'An interferogram is made by aligning two complex SAR observations of the same area and comparing their phase. The resulting color bands are called fringes. They may contain information about surface movement, but they can also include topography, atmospheric effects, and noise. An interferogram must be checked and processed before its colors can be interpreted as physical change.',
  'Coherence and decorrelation': 'Coherence measures how similar the radar signal remains between two observations. High coherence means phase is more consistently related between the dates; low coherence warns that phase-based interpretation may be unreliable. Vegetation, water, snowfall, construction, or a long time gap can reduce coherence. Low coherence does not prove that nothing moved; it means the phase comparison has less dependable information.',
  'Line-of-sight motion': 'One radar viewing direction measures only the part of movement toward or away from the satellite. Movement sideways across the viewing direction may be difficult or invisible to that observation. Combining different viewing directions or other measurements can help recover more of the motion, but assumptions are still needed. Do not describe a single line-of-sight map as complete three-dimensional movement.',
  'Uncertainty and evidence': 'A scientific map is an estimate, not a perfect picture of reality. Check data quality, coherence, atmospheric conditions, geometry, processing choices, and the reference used to calculate change. Compare the result with independent evidence when possible. A careful conclusion says what the data support, what remains uncertain, and what additional observation would improve confidence.',
}

const chapterAnswerWhys: Record<string, string> = {
  'What satellites observe': 'Remote sensing means measuring a target from a distance. Cameras and radar are different kinds of sensors, but both collect information without touching the ground.',
  'Active radar pulses': 'SAR provides its own microwave energy, so it does not need sunlight. That is why it can collect data at night; the returned signal still depends on the surface and weather conditions.',
  'Echo time and range': 'Radar waves travel at a known speed. Measuring the pulse’s round-trip time gives the distance to the reflecting surface using distance = speed × time ÷ 2.',
  'Wavelength in the landscape': 'Longer waves can interact with larger objects such as branches and trunks. The answer is “usually” because moisture, canopy shape, and viewing direction also change the result.',
  'The synthetic aperture': 'The processor combines echoes recorded from many satellite positions as the spacecraft moves. This creates the effect of a longer antenna without physically lengthening the antenna.',
  'NISAR science questions': 'NISAR measures changes in Earth’s land, ice, water, and vegetation. Surface deformation is one example of a question its repeated radar observations can help scientists investigate.',
  'L-band and S-band': 'The two wavelengths interact differently with surfaces, so their measurements complement one another. Having two bands adds information but does not remove every source of uncertainty.',
  'Repeat orbit observations': 'Observing the same place again makes it possible to compare measurements across dates. The comparison still needs compatible geometry and processing to separate change from viewing differences.',
  'From echoes to products': 'Product type and metadata explain what the values represent, how they were processed, and what analysis is appropriate. A display palette or filename alone cannot provide that information.',
  'Finding mission data': 'The archive record and documentation provide acquisition details, sensor settings, and processing information needed to interpret or reproduce an analysis.',
  'Backscatter brightness': 'In a backscatter product, brightness represents the strength of the processed radar return. It is not a direct measurement of visible color or temperature.',
  'Smooth water response': 'Calm, smooth water tends to reflect radar energy away from the sensor, leaving a weaker return. Wind, waves, and structures can make water areas brighter.',
  'Vegetation scattering': 'Radar waves interact with leaves, branches, and trunks, so these structures contribute to the echo. Sunlight and cloud shadows do not create the radar return.',
  'Urban double bounce': 'A radar wave can bounce between a wall and the ground and then return toward the sensor. This two-surface reflection is called double-bounce scattering.',
  'Polarization channels': 'In VH, the first letter V means the transmitted wave is vertical; the second letter H means the received wave is horizontal.',
  'Flood water mapping': 'Water next to vertical structures can bounce energy between the water and a wall or trunk, sending a strong return back to the radar. Flooded areas therefore are not always dark.',
  'Forest structure and biomass': 'Radar brightness is influenced by many factors and is not expressed in biomass units. A biomass estimate needs a validated model, calibration, and field measurements.',
  'Crop growth over time': 'Observations through a growing season show how the radar response changes with crop structure and water content. One undated image cannot show that development.',
  'Glacier motion': 'Comparing radar observations over time can reveal ice motion and surface change. A single image’s color does not measure motion or temperature.',
  'Fair before-and-after comparisons': 'Dates, viewing geometry, and processing affect the measured signal. Checking them helps avoid mistaking acquisition differences for actual ground change.',
  'Radar phase': 'Phase is related to the radar wave’s travel path, but it can also contain topographic, atmospheric, and noise contributions. It is not a direct surface-color or building-count measurement.',
  'Form an interferogram': 'An interferogram is produced by comparing phase from two aligned SAR acquisitions of the same area. Optical colors and weather-station temperatures are not the inputs.',
  'Coherence and decorrelation': 'Low coherence means the phase relationship between acquisitions is unreliable. It warns against a confident phase interpretation but does not prove that the ground stayed still.',
  'Line-of-sight motion': 'One radar view measures only the component of motion toward or away from its line of sight. Full three-dimensional movement needs additional viewing information or assumptions.',
  'Uncertainty and evidence': 'Checking data quality and reporting uncertainty shows how strong the evidence is and what could affect it. Ignoring geometry or treating every fringe as exact vertical motion overstates what the data say.',
}

const chapterWorkedExamples: Record<string, string> = {
  'What satellites observe': 'To check a farm after a cloudy week, an optical camera needs reflected sunlight and a clear view. SAR sends its own microwave pulse, so it can still measure a radar response through ordinary cloud cover. The two sensors answer different questions about the same field.',
  'Active radar pulses': 'At night over a coastline, SAR still sends a pulse and records the echo. No sunlight is needed. A strong return could come from rough water or structures, so the echo still needs interpretation rather than a quick label.',
  'Echo time and range': 'A pulse that takes 5,000 microseconds for the round trip travels about 1,499 kilometres in total. Divide by two and the slant range is about 749.5 kilometres. That is distance along the radar line, not vertical altitude.',
  'Wavelength in the landscape': 'NISAR L-band is about 24 centimetres and S-band about 9.4 centimetres. A branch may interact differently with those two waves. Real forest response also depends on branch size, leaves, water content, and the radar look direction.',
  'The synthetic aperture': 'Imagine a radar collecting echoes from one target at positions along a flight path. Combining those phase-linked observations synthesizes a longer aperture. Simply adding more positions does not fix poor signal quality or incorrect processing.',
  'NISAR science questions': 'If a slope moves after an earthquake, repeat NISAR observations can help measure some surface change. Scientists still compare the radar result with seismic records, maps, and field checks before explaining what happened.',
  'L-band and S-band': 'A forest can produce one response in L-band and another in S-band because the wavelengths interact with canopy parts differently. The comparison adds evidence about structure; it does not directly count trees.',
  'Repeat orbit observations': 'Comparing two observations 12 days apart may reveal a change between those dates. A longer sequence can show whether that change is persistent or seasonal, provided acquisitions are comparable.',
  'From echoes to products': 'A backscatter image is useful for comparing return strength. A complex single-look product preserves phase and is needed for interferometry. Choosing the wrong product can make a valid analysis impossible.',
  'Finding mission data': 'A useful archive search includes a region, date range, mission, and product type. The result’s metadata then tells you whether the acquisition geometry and processing fit your question.',
  'Backscatter brightness': 'If one pixel is brighter than nearby pixels in a calibrated backscatter image, it has a stronger return in that product. It does not automatically mean the ground is hotter, higher, or a particular material.',
  'Smooth water response': 'A calm lake may appear dark because the smooth surface reflects energy away. Wind ripples can redirect more energy toward the sensor and brighten the return without the lake changing into land.',
  'Vegetation scattering': 'At L-band, some energy can interact with larger branches and trunks. At shorter wavelengths, the upper canopy may contribute more. Neither observation alone is a direct biomass measurement.',
  'Urban double bounce': 'A radar-facing building wall beside a street can reflect energy between the wall and ground back toward the antenna. Turn the street away from the look direction and that bright pattern may weaken.',
  'Polarization channels': 'In a VH image, the sensor transmits a vertical wave and records horizontal returns. Comparing VH with VV can reveal different scattering behaviour, but the legend and product calibration still matter.',
  'Flood water mapping': 'A flooded open field may become darker, while water against building walls can create a bright double-bounce return. A pre-flood baseline and local context help distinguish both patterns.',
  'Forest structure and biomass': 'A biomass model might combine L-band measurements with field plots from a sample of forest sites. More representative plots can improve calibration, but uncertainty remains between sampled sites.',
  'Crop growth over time': 'A sequence across planting, peak growth, and harvest can show changing radar returns. A single wet observation after rain could look different even if crop growth is unchanged.',
  'Glacier motion': 'If a recognizable ice feature moves 120 metres between observations 30 days apart, its average tracked speed is 4 metres per day. The estimate depends on correct matching and the time interval.',
  'Fair before-and-after comparisons': 'Two images of the same place can differ because one was collected from another look direction. Before calling the difference ground change, compare dates, geometry, polarization, and processing.',
  'Radar phase': 'At L-band, a 120-millimetre line-of-sight displacement corresponds to one full phase cycle in a simplified two-way model. Phase wraps, so larger movement can look like a smaller repeated color cycle.',
  'Form an interferogram': 'Two well-aligned complex SAR images can be compared pixel by pixel to form an interferogram. Misalignment creates misleading phase patterns, even when the surface itself has not changed.',
  'Coherence and decorrelation': 'A stable rocky area may keep a similar radar signal between dates and have higher coherence. A changing field or water surface may decorrelate; low coherence means phase is less trustworthy.',
  'Line-of-sight motion': 'If a hillside moves mostly sideways across the radar view, one satellite pass may record only a small component of that motion. Another viewing direction can add information.',
  'Uncertainty and evidence': 'A deformation claim is stronger when phase quality is good, the atmosphere is considered, processing is documented, and an independent measurement agrees. If one check fails, report that limitation.',
}

const chapterWatchFors: Record<string, string> = {
  'What satellites observe': 'Do not treat every satellite image as a photograph; radar brightness is a measured signal.',
  'Active radar pulses': 'Cloud-penetrating does not mean every storm or surface condition has no effect.',
  'Echo time and range': 'Slant range follows the sensor viewing direction, not straight down to the ground.',
  'Wavelength in the landscape': 'Longer wavelengths do not always penetrate farther in every material or condition.',
  'The synthetic aperture': 'The antenna does not physically grow; software combines observations from the moving platform.',
  'NISAR science questions': 'A satellite measures signals; it does not diagnose a hazard by itself.',
  'L-band and S-band': 'Two bands add complementary evidence, not certainty or a guaranteed classification.',
  'Repeat orbit observations': 'A difference between dates can also come from weather, season, or geometry.',
  'From echoes to products': 'A colorful display is not enough; check what the pixels and units represent.',
  'Finding mission data': 'Finding a product is not the same as validating it for an analysis.',
  'Backscatter brightness': 'Brightness is not natural color, temperature, elevation, or a land-cover label.',
  'Smooth water response': 'Wind, waves, shorelines, and structures can make water return radar strongly.',
  'Vegetation scattering': 'Do not convert brightness directly into tree count or biomass.',
  'Urban double bounce': 'The effect depends on wall orientation and radar look direction.',
  'Polarization channels': 'The first channel letter is transmit; the second is receive.',
  'Flood water mapping': 'Flooded vegetation and streets may be bright, not dark.',
  'Forest structure and biomass': 'A model estimate must include calibration, validation, and uncertainty.',
  'Crop growth over time': 'Rain and irrigation can change radar returns independently of crop growth.',
  'Glacier motion': 'Feature tracking and InSAR are different methods with different failure modes.',
  'Fair before-and-after comparisons': 'Matching screen settings cannot correct mismatched acquisition geometry.',
  'Radar phase': 'A fringe cycle is periodic; it does not reveal unlimited displacement on its own.',
  'Form an interferogram': 'Phase differences can include atmosphere, topography, noise, and deformation.',
  'Coherence and decorrelation': 'Low coherence is not proof of no movement.',
  'Line-of-sight motion': 'One viewing direction does not independently recover a full 3D vector.',
  'Uncertainty and evidence': 'Do not report more precision than the data and processing support.',
}

const chapterPlaygrounds: Record<string, PlaygroundId> = {
  'What satellites observe': 'sensor-choice',
  'Active radar pulses': 'pulse-echo',
  'Echo time and range': 'range-calculator',
  'Wavelength in the landscape': 'band-comparator',
  'The synthetic aperture': 'aperture-builder',
  'NISAR science questions': 'science-question',
  'L-band and S-band': 'repeat-stack',
  'Repeat orbit observations': 'product-matcher',
  'From echoes to products': 'metadata-audit',
  'Finding mission data': 'archive-finder',
  'Backscatter brightness': 'backscatter-meter',
  'Smooth water response': 'water-roughness',
  'Vegetation scattering': 'vegetation-depth',
  'Urban double bounce': 'double-bounce',
  'Polarization channels': 'polarization-mixer',
  'Flood water mapping': 'flood-signal',
  'Forest structure and biomass': 'biomass-calibration',
  'Crop growth over time': 'crop-calendar',
  'Glacier motion': 'glacier-speed',
  'Fair before-and-after comparisons': 'comparison-audit',
  'Radar phase': 'phase-cycle',
  'Form an interferogram': 'interferogram-builder',
  'Coherence and decorrelation': 'coherence-check',
  'Line-of-sight motion': 'line-of-sight',
  'Uncertainty and evidence': 'uncertainty-budget',
}

function shuffledChapterChoices(chapter: Chapter) {
  let seed = chapter.id.split('').reduce((value, character) => (Math.imul(value, 31) + character.charCodeAt(0)) >>> 0, 2166136261)
  const choices = [...chapter.choices]
  for (let index = choices.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const swapIndex = seed % (index + 1)
    const currentChoice = requiredItem(choices, index, 'answer choice')
    const swapChoice = requiredItem(choices, swapIndex, 'answer choice')
    choices[index] = swapChoice
    choices[swapIndex] = currentChoice
  }
  return choices
}

function requiredItem<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index]
  if (item === undefined) throw new Error(`Missing ${label} at index ${index}.`)
  return item
}

const curriculum = learningLevels.map((level, levelIndex) => {
  const module = requiredItem(learningPathModules, levelIndex, 'learning module')
  const chapters = requiredItem(chapterContent, levelIndex, 'chapter collection')

  return {
    ...level,
    image: module.imageUrl,
    imageAlt: module.imageAlt,
    imageCredit: module.imageCredit,
    resourceUrl: module.resourceUrl,
    resourceLabel: module.resourceLabel,
    chapters: chapters.map((chapter, chapterIndex) => {
      const guide = chapterGuides[chapter.title]
      const workedExample = chapterWorkedExamples[chapter.title]
      const watchFor = chapterWatchFors[chapter.title]
      const answerWhy = chapterAnswerWhys[chapter.title]
      const playground = chapterPlaygrounds[chapter.title]
      if (!guide || !workedExample || !watchFor || !answerWhy || !playground) {
        throw new Error(`Missing supporting content for chapter "${chapter.title}".`)
      }

      return {
        ...chapter,
        id: `level-${level.id}-chapter-${chapterIndex + 1}`,
        guide,
        workedExample,
        watchFor,
        answerWhy,
        playground,
      }
    }),
  }
})

const locationData: LocationEntry[] = [
  {
    name: 'Mumbai, India',
    region: 'Coastal megacity',
    significance: 'High-density urban exposure and coastal flooding risk.',
    missionFocus: 'Flood extent, land subsidence, and urban change detection.',
    applications: ['Flood mapping', 'Infrastructure planning', 'Coastal resilience'],
    latitude: 19.1,
    longitude: 72.8,
  },
  {
    name: 'Himalayas',
    region: 'Mountain glacier region',
    significance: 'Cryosphere dynamics and melt-driven hazards.',
    missionFocus: 'Surface displacement, glacier motion, and snowpack variability.',
    applications: ['Glacier tracking', 'Landslide risk', 'Water resource studies'],
    latitude: 28.6,
    longitude: 83.9,
  },
  {
    name: 'Amazon Rainforest',
    region: 'Tropical forest',
    significance: 'Large-scale carbon storage and deforestation pressure.',
    missionFocus: 'Forest structure, canopy change, and biomass estimation.',
    applications: ['Deforestation monitoring', 'Carbon accounting', 'Habitat mapping'],
    latitude: -3.1,
    longitude: -60.0,
  },
  {
    name: 'Greenland',
    region: 'Ice sheet margin',
    significance: 'Rapid cryosphere change linked to sea-level rise.',
    missionFocus: 'Ice velocity and seasonal surface displacement.',
    applications: ['Ice melt analysis', 'Sea-level studies', 'Cryosphere modeling'],
    latitude: 71.7,
    longitude: -42.0,
  },
  {
    name: 'California',
    region: 'Fault and agricultural corridor',
    significance: 'Ground deformation and multi-use land surfaces.',
    missionFocus: 'Ground motion, agricultural stress, and wildfire recovery.',
    applications: ['Fault monitoring', 'Crop health', 'Fire impact assessment'],
    latitude: 36.7,
    longitude: -119.7,
  },
  {
    name: 'Japan',
    region: 'Seismically active arc',
    significance: 'Frequent tectonic deformation and urban earthquake risk.',
    missionFocus: 'Deformation mapping and rapid post-event assessment.',
    applications: ['Earthquake analysis', 'Infrastructure resilience', 'Risk modeling'],
    latitude: 36.2,
    longitude: 138.2,
  },
]

const missionDeck: Mission[] = [
  {
    title: 'Flood Detective',
    challenge: 'Map inundation patterns and identify risk hotspots.',
    evidence: 'Before/after radar backscatter and flood signatures.',
    tools: ['Backscatter change', 'Water mask', 'Hydrologic context'],
    score: 82,
    badge: 'Earth Explorer',
  },
  {
    title: 'Forest Guardian',
    challenge: 'Assess canopy loss and habitat stress across a basin.',
    evidence: 'Temporal SAR texture and vegetation backscatter drift.',
    tools: ['Change layers', 'Vegetation index', 'Deforestation tracking'],
    score: 91,
    badge: 'SAR Decoder',
  },
  {
    title: 'Earthquake Investigator',
    challenge: 'Estimate deformation and surface rupture patterns.',
    evidence: 'Interferometric fringes and coherence change.',
    tools: ['InSAR fringes', 'Unwrapped displacement', 'Ground motion map'],
    score: 74,
    badge: 'InSAR Scientist',
  },
  {
    title: 'Wetland Protector',
    challenge: 'Track inundation and vegetation transitions in a protected ecosystem.',
    evidence: 'Seasonal water coverage and soil moisture shifts.',
    tools: ['Soil moisture', 'Waterbody masks', 'Temporal profiles'],
    score: 88,
    badge: 'Radar Rookie',
  },
  {
    title: 'Glacier Tracker',
    challenge: 'Measure relative motion across a glacier system.',
    evidence: 'Surface displacement vectors and time-series change.',
    tools: ['Feature tracking', 'Velocity map', 'Seasonal trend'],
    score: 80,
    badge: 'NISAR Expert',
  },
]

const quizQuestions: Question[] = [
  {
    prompt: 'What does SAR most directly measure?',
    options: ['Visible sunlight reflected by vegetation', 'Microwave backscatter from the surface', 'Atmospheric temperature gradients', 'Volcanic ash concentration'],
    correct: 'Microwave backscatter from the surface',
    explanation: 'SAR sends active microwave pulses and records the signal reflected back from terrain, vegetation, or water.',
  },
  {
    prompt: 'Why is SAR useful in cloudy or nighttime conditions?',
    options: ['It does not use electromagnetic waves', 'It depends on passive thermal emission only', 'It uses active microwave energy that can penetrate clouds', 'It only works during full moon'],
    correct: 'It uses active microwave energy that can penetrate clouds',
    explanation: 'Microwaves are less affected by clouds and can operate day or night, making SAR highly reliable for repeated imaging.',
  },
  {
    prompt: 'InSAR mainly helps scientists study:',
    options: ['Atmospheric chemistry', 'Ocean salinity alone', 'Surface displacement through phase differences', 'Solar flare intensity'],
    correct: 'Surface displacement through phase differences',
    explanation: 'Interferometric SAR compares phase from two acquisitions to detect tiny movements of the ground surface.',
  },
  {
    prompt: 'Which factor generally increases radar return strength from a rougher surface?',
    options: ['Lower frequency', 'Greater surface roughness', 'More cloud cover', 'Lower incidence angle alone'],
    correct: 'Greater surface roughness',
    explanation: 'Rougher surfaces scatter energy more strongly back toward the sensor, increasing backscatter.',
  },
]

const defaultProgress = {
  xp: 0,
  level: 1,
  streak: 0,
  profileName: 'Guest learner',
  badges: [] as string[],
  completedLessons: [] as string[],
  completedChapters: [] as string[],
  lastVisitedLesson: '/',
  quizProgress: {} as Record<string, string>,
}

type StudentProgress = typeof defaultProgress

type GuestAccount = {
  id: string
  name: string
  progress: StudentProgress
}

const ProgressContext = createContext<{
  progress: StudentProgress
  setProgress: React.Dispatch<React.SetStateAction<StudentProgress>>
} | null>(null)

function learningStorageKey(_localNamespace: string, key: string): string {
  return key === 'progress' ? 'third-eye:learn-progress:v1' : `third-eye:learn-progress:v1:${key}`
}

function readProgress(userId: string): StudentProgress {
  try {
    const saved = window.localStorage.getItem(learningStorageKey(userId, 'progress'))
      ?? window.localStorage.getItem('third-eye:learn-progress:v1:progress')
    if (!saved) return defaultProgress
    const parsed = JSON.parse(saved) as Partial<StudentProgress>
    return {
      ...defaultProgress,
      ...parsed,
      badges: Array.isArray(parsed.badges) ? parsed.badges : [],
      completedLessons: Array.isArray(parsed.completedLessons) ? parsed.completedLessons : [],
      completedChapters: Array.isArray(parsed.completedChapters) ? parsed.completedChapters : [],
      lastVisitedLesson: typeof parsed.lastVisitedLesson === 'string' ? parsed.lastVisitedLesson : '/',
      quizProgress: parsed.quizProgress && typeof parsed.quizProgress === 'object' ? parsed.quizProgress : {},
    }
  } catch {
    return defaultProgress
  }
}

function readGuestAccounts(userId: string): GuestAccount[] {
  try {
    const saved = window.localStorage.getItem(learningStorageKey(userId, 'profiles'))
    if (saved) {
      const accounts = JSON.parse(saved) as Partial<GuestAccount>[]
      if (Array.isArray(accounts) && accounts.length) {
        const validAccounts = accounts.filter((account) => account.id && account.name).map((account) => ({
          id: account.id!,
          name: account.name!,
          progress: { ...defaultProgress, ...account.progress, completedChapters: account.progress?.completedChapters ?? [], completedLessons: account.progress?.completedLessons ?? [], badges: account.progress?.badges ?? [] },
        }))
        if (validAccounts.length) return validAccounts
      }
    }
  } catch {
    // Fall through and migrate progress from the original single-profile version.
  }
  const progress = readProgress(userId)
  return [{ id: 'guest-default', name: progress.profileName, progress }]
}

function readActiveGuestId(userId: string) {
  try {
    return window.localStorage.getItem(learningStorageKey(userId, 'active-profile')) ?? 'guest-default'
  } catch {
    return 'guest-default'
  }
}

type DisplayTheme = 'orbital' | 'fieldnotes' | 'orbittrack'

function readDisplayTheme(userId: string): DisplayTheme {
  try {
    const theme = window.localStorage.getItem(learningStorageKey(userId, 'display-theme'))
    if (theme === 'fieldnotes') return 'fieldnotes'
    if (theme === 'orbittrack') return 'orbittrack'
    return 'orbital'
  } catch {
    return 'orbital'
  }
}

function shouldShowIntro(userId: string) {
  try {
    return window.localStorage.getItem(learningStorageKey(userId, 'intro-seen')) !== 'true' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function useStudentProgress() {
  const context = useContext(ProgressContext)
  if (!context) throw new Error('Student progress is unavailable outside the app shell.')
  return context
}

const storyCards = [
  { title: 'Introduce Earth', text: 'The planet is a living system of climate, water, and human activity.' },
  { title: 'Reveal the mission', text: 'NISAR combines NASA and ISRO science to monitor Earth with a dual-band radar architecture.' },
  { title: 'See through clouds', text: 'Radar can detect movement and structure where visible imagery is limited or obscured.' },
  { title: 'Track change', text: 'From floods to glaciers, SAR helps scientists distinguish patterns and trends.' },
]

const chartData = [
  { name: 'L-band', value: 63 },
  { name: 'S-band', value: 51 },
  { name: 'Coherence', value: 74 },
  { name: 'Ground motion', value: 81 },
  { name: 'Moisture', value: 68 },
]

const badgeData = [
  { name: 'Earth Explorer', description: 'Complete the introductory mission path.', color: 'cyan' },
  { name: 'Radar Rookie', description: 'Master the basics of backscatter and SAR.', color: 'blue' },
  { name: 'SAR Decoder', description: 'Read radar patterns across land and water.', color: 'violet' },
  { name: 'Change Detective', description: 'Analyze before/after environmental change.', color: 'indigo' },
  { name: 'InSAR Scientist', description: 'Model displacement with interferometry.', color: 'teal' },
  { name: 'NISAR Expert', description: 'Interpret mission-grade Earth observation data.', color: 'slate' },
]

const researchResources: ResearchResource[] = [
  {
    title: 'What Is Synthetic Aperture Radar?',
    author: 'NASA Earthdata',
    year: 'Reference guide',
    topic: 'Fundamentals',
    level: 'Beginner',
    format: 'Web article',
    summary: 'A practical introduction to active radar, wavelength, polarization, scattering, speckle, and interferometry, with examples and data links.',
    citation: 'NASA Earthdata. Earth Observation Data Basics: Synthetic Aperture Radar.',
    url: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar',
  },
  {
    title: 'Spaceborne Synthetic Aperture Radar: Principles, Data Access, and Basic Processing Techniques',
    author: 'Franz Meyer',
    year: '2019',
    topic: 'Fundamentals',
    level: 'Beginner',
    format: 'NASA SAR Handbook chapter',
    summary: 'A foundation for understanding spaceborne SAR systems, common data products, access, and introductory processing steps.',
    citation: 'Meyer, F. (2019). SAR Handbook: Comprehensive Methodologies for Forest Monitoring and Biomass Estimation. NASA.',
    url: 'https://doi.org/10.25966/ez4f-mg98',
  },
  {
    title: 'Using SAR Data for Mapping Deforestation and Forest Degradation',
    author: 'Josef Kellndorfer',
    year: '2019',
    topic: 'Forests',
    level: 'Intermediate',
    format: 'NASA SAR Handbook chapter',
    summary: 'Explains how radar observations support forest-change analysis and what factors influence interpretation of canopy loss.',
    citation: 'Kellndorfer, J. (2019). SAR Handbook: Comprehensive Methodologies for Forest Monitoring and Biomass Estimation. NASA.',
    url: 'https://doi.org/10.25966/68c9-gw82',
  },
  {
    title: 'SAR Methods for Mapping and Monitoring Forest Biomass',
    author: 'Sassan Saatchi',
    year: '2019',
    topic: 'Forests',
    level: 'Advanced',
    format: 'NASA SAR Handbook chapter',
    summary: 'Reviews radar-based biomass methods, wavelength sensitivity, modeling, and the limitations of translating backscatter into biomass.',
    citation: 'Saatchi, S. (2019). SAR Handbook: Comprehensive Methodologies for Forest Monitoring and Biomass Estimation. NASA.',
    url: 'https://doi.org/10.25966/hbm1-ej07',
  },
  {
    title: 'NISAR Science Users’ Handbook',
    author: 'NASA / JPL and ISRO',
    year: 'Mission reference',
    topic: 'NISAR',
    level: 'Intermediate',
    format: 'Open mission handbook',
    summary: 'Mission-focused reference for NISAR science objectives, instruments, observation strategy, products, and applications.',
    citation: 'NASA Jet Propulsion Laboratory. NISAR Science Users’ Handbook, second edition.',
    url: 'https://dataverse.jpl.nasa.gov/api/access/datafile/97405?gbrecs=true',
  },
  {
    title: 'Interferometry with SAR',
    author: 'NASA Earthdata / ASF DAAC',
    year: 'Reference guide',
    topic: 'InSAR',
    level: 'Intermediate',
    format: 'Web guide with examples',
    summary: 'Introduces interferometric phase, repeat observations, deformation examples, coherence, and links to processing resources.',
    citation: 'NASA Earthdata. Earth Observation Data Basics: Synthetic Aperture Radar, Interferometry section.',
    url: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar#toc-interferometry',
  },
  {
    title: 'Radar Remote Sensing for Land, Water, and Disaster Applications',
    author: 'NASA Applied Remote Sensing Training (ARSET)',
    year: 'Training series',
    topic: 'Applications',
    level: 'Beginner–Intermediate',
    format: 'Free NASA training',
    summary: 'Applied training materials for interpreting radar across land, water, and disaster-response scenarios.',
    citation: 'NASA ARSET. Radar Remote Sensing for Land, Water, and Disaster Applications.',
    url: 'https://appliedsciences.nasa.gov/get-involved/training/english/arset-radar-remote-sensing-land-water-disaster-applications',
  },
]

function App() {
  return <AppShell />
}

function AppShell() {
  // This is a browser-local learning workspace, not an authenticated user identity.
  const userId = 'local';
  const section = useSearch({ from: '/learn', select: (search) => search.section ?? '/' })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [guestAccounts, setGuestAccounts] = useState(() => readGuestAccounts(userId))
  const [activeGuestId, setActiveGuestId] = useState(() => readActiveGuestId(userId))
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [newGuestName, setNewGuestName] = useState('')
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [displayTheme, setDisplayTheme] = useState<DisplayTheme>(() => readDisplayTheme(userId))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [introVisible, setIntroVisible] = useState(() => shouldShowIntro(userId))
  const [introSeconds, setIntroSeconds] = useState(10)
  const audioContextRef = useRef<AudioContext | null>(null)
  const activeGuest = guestAccounts.find((account) => account.id === activeGuestId) ?? requiredItem(guestAccounts, 0, 'learner profile')
  const progress = activeGuest.progress

  useEffect(() => {
    setGuestAccounts((accounts) => accounts.map((account) => account.id !== activeGuestId || account.progress.lastVisitedLesson === section
      ? account
      : { ...account, progress: { ...account.progress, lastVisitedLesson: section } }))
  }, [section, activeGuestId])

  const setProgress: React.Dispatch<React.SetStateAction<StudentProgress>> = (update) => {
    setGuestAccounts((accounts) => accounts.map((account) => account.id !== activeGuest.id
      ? account
      : { ...account, progress: typeof update === 'function' ? update(account.progress) : update }))
  }

  const createGuestAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newGuestName.trim()
    if (!name) return
    const account: GuestAccount = {
      id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      progress: { ...defaultProgress, profileName: name },
    }
    setGuestAccounts((accounts) => [...accounts, account])
    setActiveGuestId(account.id)
    setNewGuestName('')
    setProfileDialogOpen(false)
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(learningStorageKey(userId, 'profiles'), JSON.stringify(guestAccounts))
      window.localStorage.setItem(learningStorageKey(userId, 'active-profile'), activeGuest.id)
      window.localStorage.setItem(learningStorageKey(userId, 'progress'), JSON.stringify(progress))
    } catch {
      // Keep the learning experience available when browser storage is disabled.
    }
  }, [guestAccounts, activeGuest.id, progress, userId])

  useEffect(() => {
    try {
      window.localStorage.setItem(learningStorageKey(userId, 'display-theme'), displayTheme)
    } catch {
      // Theme selection remains usable when browser storage is disabled.
    }
  }, [displayTheme, userId])

  useEffect(() => {
    if (!introVisible) return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, 10 - Math.floor((Date.now() - startedAt) / 1000))
      setIntroSeconds(remaining)
      if (remaining === 0) {
        window.clearInterval(timer)
        setIntroVisible(false)
        try { window.localStorage.setItem(learningStorageKey(userId, 'intro-seen'), 'true') } catch { /* Continue without persisted preference. */ }
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [introVisible, userId])

  const skipIntro = () => {
    setIntroVisible(false)
    try { window.localStorage.setItem(learningStorageKey(userId, 'intro-seen'), 'true') } catch { /* Continue without persisted preference. */ }
  }

  useEffect(() => {
    if (!soundEnabled) return
    const handleUiClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('button, a')) return
      const context = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = context
      if (context.state === 'suspended') void context.resume()
      const oscillator = context.createOscillator()
      const volume = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(720, context.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(460, context.currentTime + 0.07)
      volume.gain.setValueAtTime(0.025, context.currentTime)
      volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.08)
      oscillator.connect(volume)
      volume.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.08)
    }
    document.addEventListener('click', handleUiClick)
    return () => document.removeEventListener('click', handleUiClick)
  }, [soundEnabled])

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link ${isActive ? 'nav-link-active' : ''}`
  return (
    <ProgressContext.Provider value={{ progress, setProgress }}>
    <div className={`app-shell theme-${displayTheme} min-h-screen text-slate-100`}>
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="p-5 border-b border-slate-800/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/sar-academy-mark.svg" alt="SAR Academy eye over Earth logo" className="h-11 w-11 object-contain" />
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">SAR</div>
                <div className="font-semibold">ACADEMY</div>
              </div>
            </div>
            <button className="sidebar-close md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
              <X size={18} />
            </button>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
          {navItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.path}
              className={navClass}
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <RouterLink to="/dashboard" className="nav-link mt-5">
            <Globe2 size={16} />
            <span>Earth Intelligence</span>
          </RouterLink>
        </nav>
      </aside>

      <div className="main-panel">
        <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1700px] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 md:hidden">
              <button className="rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-200" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
                <Menu size={18} />
              </button>
              <div className="flex items-center gap-2">
                <img src="/sar-academy-mark.svg" alt="" className="h-9 w-9 object-contain" />
                <div className="hidden sm:block">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">SAR</div>
                  <div className="font-semibold text-sm">ACADEMY</div>
                </div>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-3 text-sm text-slate-300">
              <div className="rounded-full border border-cyan-500/20 bg-cyan-400/10 px-3 py-1 text-cyan-200">Mission-ready learning</div>
              <span>Earth observation • radar science • NISAR</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
              <button
                className="inline-flex shrink-0 items-center gap-2 border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400/50"
                onClick={() => setSettingsOpen(true)}
                aria-label="Open display settings"
              >
                <Settings2 size={14} className="text-cyan-200" /><span className="hidden sm:inline">Display</span>
              </button>
              <button
                className="inline-flex shrink-0 items-center gap-2 border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400/50"
                onClick={() => setSoundEnabled((enabled) => !enabled)}
                aria-label={soundEnabled ? 'Turn interface sounds off' : 'Turn interface sounds on'}
                aria-pressed={soundEnabled}
                title={soundEnabled ? 'Interface sounds on' : 'Interface sounds off'}
              >
                {soundEnabled ? <Volume2 size={14} className="text-cyan-200" /> : <VolumeX size={14} className="text-slate-400" />}
                <span className="hidden sm:inline">Sound {soundEnabled ? 'on' : 'off'}</span>
              </button>
              <button
                className="inline-flex max-w-[72px] shrink-0 items-center gap-1.5 border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 transition hover:border-cyan-400/40 sm:max-w-none sm:gap-2 sm:px-3"
                onClick={() => setProfileDialogOpen(true)}
                aria-label="Manage local practice profiles"
              >
                <UserRound size={14} className="shrink-0 text-cyan-200" /><span className="truncate">{activeGuest.name}</span>
              </button>
              <div className="shrink-0 rounded-full border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs font-medium text-slate-300 sm:px-3">
                XP {progress.xp}
              </div>
              <Link to="/my-progress" aria-label="View progress" title="View progress" className="button-primary flex h-9 w-9 shrink-0 items-center justify-center p-0 sm:h-auto sm:w-auto sm:px-4 sm:py-2.5">
                <BarChart3 size={15} className="sm:hidden" />
                <span className="hidden sm:inline">View progress</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1700px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <LearnSection section={section} />
          </AnimatePresence>
        </main>
      </div>
      {profileDialogOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileDialogOpen(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="guest-profile-title" className="w-full max-w-md border border-slate-600 bg-[#08121d] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200">Local practice</div>
                <h2 id="guest-profile-title" className="mt-2 text-xl font-medium text-white">Practice profiles</h2>
              </div>
              <button className="sidebar-close" onClick={() => setProfileDialogOpen(false)} aria-label="Close guest profiles"><X size={16} /></button>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">Practice profiles and progress stay in this browser, separate from your Google sign-in. Progress is not synced to a server.</p>
            <div className="mt-5 space-y-2">
              {guestAccounts.map((account) => (
                <button key={account.id} className={`flex w-full items-center justify-between border px-3 py-2 text-sm ${account.id === activeGuest.id ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100' : 'border-slate-700 bg-slate-950 text-slate-300'}`} onClick={() => { setActiveGuestId(account.id); setProfileDialogOpen(false) }}>
                  <span>{account.name}</span><span>{account.progress.xp} XP</span>
                </button>
              ))}
            </div>
            <form className="mt-5 border-t border-slate-800 pt-4" onSubmit={createGuestAccount}>
              <label htmlFor="guest-name" className="text-sm text-slate-300">Create a practice profile</label>
              <input id="guest-name" value={newGuestName} onChange={(event) => setNewGuestName(event.target.value)} maxLength={32} required placeholder="Your display name" className="mt-2 w-full border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300" />
              <button type="submit" className="button-primary mt-3 w-full">Create profile</button>
            </form>
          </section>
        </div>
      )}
      {settingsOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="display-settings-title" className="w-full max-w-lg border border-slate-600 bg-[#08121d] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200">Personalize your workspace</div>
                <h2 id="display-settings-title" className="mt-2 text-xl font-medium text-white">Display settings</h2>
              </div>
              <button className="sidebar-close" onClick={() => setSettingsOpen(false)} aria-label="Close display settings"><X size={16} /></button>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">Choose the visual style that works best for your study session. Your choice is saved in this browser.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Choose theme">
              <button role="radio" aria-checked={displayTheme === 'orbital'} onClick={() => setDisplayTheme('orbital')} className={`border p-4 text-left ${displayTheme === 'orbital' ? 'border-cyan-300 bg-cyan-300/10 text-cyan-100' : 'border-slate-700 bg-slate-950 text-slate-300'}`}> 
                <Satellite size={20} />
                <span className="mt-3 block font-medium">Orbital console</span>
                <span className="mt-1 block text-xs leading-5 opacity-75">Dark satellite imagery, scan lines, and cool instrument colors.</span>
              </button>
              <button role="radio" aria-checked={displayTheme === 'fieldnotes'} onClick={() => setDisplayTheme('fieldnotes')} className={`border p-4 text-left ${displayTheme === 'fieldnotes' ? 'border-emerald-500 bg-emerald-100 text-emerald-950' : 'border-slate-700 bg-slate-950 text-slate-300'}`}> 
                <BookOpen size={20} />
                <span className="mt-3 block font-medium">Field journal</span>
                <span className="mt-1 block text-xs leading-5 opacity-75">Paper texture, hand-drawn accents, and ink-style cards.</span>
              </button>
              <button role="radio" aria-checked={displayTheme === 'orbittrack'} onClick={() => setDisplayTheme('orbittrack')} className={`border p-4 text-left ${displayTheme === 'orbittrack' ? 'border-blue-400 bg-blue-900/40 text-blue-100' : 'border-slate-700 bg-slate-950 text-slate-300'}`}> 
                <span role="img" aria-label="satellite" style={{fontSize: 20}}>🛰️</span>
                <span className="mt-3 block font-medium">OrbitTrack</span>
                <span className="mt-1 block text-xs leading-5 opacity-75">Modern dark dashboard, neon blue, glassy panels.</span>
              </button>
            </div>
            <button className="mt-5 flex w-full items-center justify-between border-t border-slate-800 pt-4 text-sm text-slate-300 hover:text-white" onClick={() => { setIntroSeconds(10); setIntroVisible(true); setSettingsOpen(false) }}>
              <span>Replay the 10-second intro</span><ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
      <AnimatePresence>
        {introVisible && (
          <motion.section key="sar-intro" className="sar-intro fixed inset-0 z-[100] overflow-hidden bg-[#030911]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }} aria-label="SAR Academy introduction">
            <div className="absolute inset-0"><IntroScene /></div>
            <div className="sar-intro-shade absolute inset-0" />
            <img src="/sar-academy-mark.svg" alt="SAR Academy eye over Earth logo" className="absolute left-5 top-5 z-10 h-12 w-12 object-contain sm:left-8 sm:top-8 sm:h-16 sm:w-16" />
            <div className="absolute right-5 top-5 z-10 text-right font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-100/80 sm:right-8 sm:top-8">
              <div className="text-slate-300/70">NASA + ISRO</div>
              <div className="mt-1">NISAR MISSION PREVIEW</div>
              <div className="mt-1">00:{String(introSeconds).padStart(2, '0')}</div>
            </div>
            <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-6 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-10 lg:p-14">
              <motion.div className="max-w-2xl" initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.8, ease: 'easeOut' }}>
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200"><RadarIcon size={15} /> EARTH OBSERVATION · ACTIVE MICROWAVE</div>
                <h1 className="mt-4 text-4xl font-semibold leading-tight text-white sm:text-6xl">One planet.<br />Signals that reveal change.</h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-slate-200 sm:text-base">A new view of our changing planet, from orbit.</p>
                <div className="mt-6 h-px max-w-md overflow-hidden bg-white/20"><div className="h-full bg-cyan-300 transition-[width] duration-300" style={{ width: `${(10 - introSeconds) * 10}%` }} /></div>
              </motion.div>
              <button onClick={skipIntro} className="inline-flex min-h-11 items-center gap-3 self-start border border-cyan-200/50 bg-black/35 px-5 text-sm text-white shadow-[0_0_24px_rgba(34,211,238,0.12)] transition hover:bg-cyan-200/10 sm:self-auto">
                Skip intro <ArrowRight size={16} />
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
    </ProgressContext.Provider>
  )
}

function LearnSection({ section }: { section: string }) {
  switch (section) {
    case '/academy': return <AcademyPage key={section} />
    case '/learning-paths': return <LearningPathsPage key={section} />
    case '/research-library': return <ResearchLibraryPage key={section} />
    case '/live-satellite': return <LiveSatellitePage key={section} />
    case '/nasa-eyes': return <NasaEyesPage key={section} />
    case '/earth-explorer': return <EarthExplorerPage key={section} />
    case '/nisar-mission': return <MissionCenterPage key={section} />
    case '/radar-simulator': return <RadarSimulatorPage key={section} />
    case '/sar-lab': return <SarImageLabPage key={section} />
    case '/change-detection': return <ChangeDetectionPage key={section} />
    case '/insar-lab': return <InSARPage key={section} />
    case '/scientific-missions': return <ScientificMissionsPage key={section} />
    case '/quiz-arena': return <QuizArenaPage key={section} />
    case '/achievements': return <AchievementsPage key={section} />
    case '/my-progress': return <ProgressPage key={section} />
    default: return <HomePage key="/" />
  }
}

function HomePage() {
  return (
    <motion.div
      key="home"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
    >
      <section className="hero-panel relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_38%),radial-gradient(circle_at_bottom_left,_rgba(124,58,237,0.2),_transparent_30%)]" />
        <div className="hero-grid absolute inset-0" />
        <div className="relative flex flex-col gap-8 px-4 py-8 md:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12 lg:py-12">
          <div className="max-w-2xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-cyan-200">
              <Sparkles size={14} />
              NASA–ISRO Earth observation learning platform
            </div>
            <div className="flex items-center gap-4">
              <img src="/sar-academy-mark.svg" alt="SAR Academy eye over Earth logo" className="h-16 w-16 shrink-0 object-contain sm:h-20 sm:w-20" />
              <h1 className="text-4xl font-semibold leading-none text-white md:text-6xl lg:text-7xl">SAR ACADEMY</h1>
            </div>
            <p className="mt-4 max-w-xl text-lg text-slate-300 md:text-xl">
              Discover What Your Eyes Cannot See.
            </p>
            <p className="mt-4 max-w-xl text-base text-slate-400">
              Explore Earth’s hidden movements through radar science, missions, and hands-on analysis built for students and scientists.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link to="/academy" className="button-primary">ENTER THE ACADEMY</Link>
              <Link to="/academy?level=2&chapter=1" className="button-secondary">LEARN ABOUT NISAR</Link>
              <Link to="/nasa-eyes" className="button-secondary">EXPLORE LIVE EARTH</Link>
            </div>
          </div>
          <div className="w-full max-w-[560px]">
            <div className="relative h-[420px] overflow-hidden rounded-[30px] border border-slate-700/70 bg-slate-950/70 shadow-2xl shadow-cyan-500/10">
              <EarthScene />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {storyCards.map((card) => (
          <motion.article key={card.title} className="panel p-5" whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
            <div className="mb-3 inline-flex rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2 text-cyan-300">
              <Target size={18} />
            </div>
            <h3 className="mb-2 text-xl font-medium text-white">{card.title}</h3>
            <p className="text-sm leading-6 text-slate-400">{card.text}</p>
          </motion.article>
        ))}
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="panel p-6">
          <div className="section-title">Mission Overview</div>
          <div className="mt-5 space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <MetricCard label="Mission" value="NISAR" accent="cyan" />
              <MetricCard label="Sensors" value="L & S band" accent="violet" />
              <MetricCard label="Objective" value="Change mapping" accent="blue" />
            </div>
            <p className="text-sm leading-7 text-slate-300">
              SAR uses active microwave systems to image the Earth in ways that conventional visible imagery cannot. It reveals movement, moisture, structure, and temporal change even when atmospheric conditions limit optical views.
            </p>
            <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-200">Educational simulation</span>
                <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-200">Not measured NISAR data</span>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <InfoPill icon={CloudRain} label="Cloud-penetrating" />
                <InfoPill icon={Waves} label="Night sensing" />
                <InfoPill icon={Map} label="Movement tracking" />
              </div>
            </div>
          </div>
        </div>

        <div className="panel p-6">
          <div className="section-title">Science at a glance</div>
          <p className="mt-2 text-xs leading-5 text-amber-200/80">Illustrative concept values only — not measurements from NISAR or another satellite.</p>
          <div className="mt-6 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="fillGlow" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="#22d3ee" fill="url(#fillGlow)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </motion.div>
  )
}

function AcademyPage() {
  const search = useSearch({ from: '/learn' })
  const navigate = useNavigate({ from: '/learn' })
  const activeLevelIndex = Math.min(
    curriculum.length,
    Math.max(1, Number(search.level ?? search.lesson ?? 1)),
  ) - 1
  const activeLevel = requiredItem(curriculum, activeLevelIndex, 'selected learning level')
  const activeChapterIndex = Math.min(
    activeLevel.chapters.length,
    Math.max(1, Number(search.chapter ?? 1)),
  ) - 1
  const activeChapter = requiredItem(activeLevel.chapters, activeChapterIndex, 'selected chapter')
  const chapterKey = `${activeLevelIndex}-${activeChapterIndex}`
  const [answerState, setAnswerState] = useState<{ chapterKey: string; answer: string } | null>(null)
  const selectedAnswer = answerState?.chapterKey === chapterKey ? answerState.answer : null
  const { progress, setProgress } = useStudentProgress()
  const answerChoices = shuffledChapterChoices(activeChapter)
  const completedChapters = progress.completedChapters
  const chapterCompleted = completedChapters.includes(activeChapter.id)

  const selectChapter = (levelIndex: number, chapterIndex: number) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        section: '/academy',
        level: levelIndex + 1,
        chapter: chapterIndex + 1,
      }),
    })
  }

  const answerChapter = (answer: string) => {
    setAnswerState({ chapterKey, answer })
    if (answer !== activeChapter.answer || chapterCompleted) return
    setProgress((current) => {
      if (current.completedChapters.includes(activeChapter.id)) return current
      const completedChapters = [...current.completedChapters, activeChapter.id]
      const completedLevel = activeLevel.chapters.every((chapter) => completedChapters.includes(chapter.id))
      const xp = current.xp + 30
      const badge = completedLevel && activeLevelIndex === 0
        ? 'Earth Explorer'
        : completedLevel && activeLevelIndex === 2
          ? 'Radar Rookie'
          : null
      return {
        ...current,
        xp,
        level: Math.floor(xp / 500) + 1,
        completedChapters,
        completedLessons: completedLevel && !current.completedLessons.includes(activeLevel.title)
          ? [...current.completedLessons, activeLevel.title]
          : current.completedLessons,
        badges: badge && !current.badges.includes(badge) ? [...current.badges, badge] : current.badges,
      }
    })
  }

  const continueChapter = () => {
    if (activeChapterIndex < activeLevel.chapters.length - 1) {
      selectChapter(activeLevelIndex, activeChapterIndex + 1)
    } else if (activeLevelIndex < curriculum.length - 1) {
      selectChapter(activeLevelIndex + 1, 0)
    }
  }

  const previousChapter = () => {
    if (activeChapterIndex > 0) {
      selectChapter(activeLevelIndex, activeChapterIndex - 1)
    } else if (activeLevelIndex > 0) {
      selectChapter(activeLevelIndex - 1, requiredItem(curriculum, activeLevelIndex - 1, 'previous learning level').chapters.length - 1)
    }
  }

  const canOpenLevel = (levelIndex: number) =>
    levelIndex === 0 || requiredItem(curriculum, levelIndex - 1, 'previous learning level').chapters.every((chapter) => completedChapters.includes(chapter.id))

  return (
    <motion.div
      key="academy"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="panel p-5 sm:p-6">
        <div className="section-title">One guided learning journey</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">Learn SAR from first pulse to real-world evidence</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Every chapter brings the explanation, visual, hands-on activity, and question together. Follow the sequence at your pace; completed work is saved to this profile.</p>
          </div>
          <div className="min-w-40 text-right text-xs text-cyan-100">{completedChapters.length} of 25 chapters complete</div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden bg-slate-800" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={25} aria-valuenow={Math.min(completedChapters.length, 25)}>
          <div className="h-full bg-cyan-300 transition-[width]" style={{ width: `${Math.min(completedChapters.length / 25 * 100, 100)}%` }} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="panel overflow-hidden p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="section-title">Course contents</div>
              <h2 className="mt-2 text-xl font-semibold text-white">5 levels · 25 chapters</h2>
            </div>
            <span className="text-xs text-cyan-200">{completedChapters.length}/25</span>
          </div>
          <div className="mt-4 max-h-[72vh] space-y-2 overflow-y-auto pr-1">
            {curriculum.map((level, levelIndex) => {
              const isLocked = !canOpenLevel(levelIndex)
              const levelCount = level.chapters.filter((chapter) => completedChapters.includes(chapter.id)).length
              return (
                <section key={level.id} className="border border-slate-700/80 bg-slate-950/60 p-2">
                  <button
                    className={`w-full text-left ${isLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                    disabled={isLocked}
                    onClick={() => selectChapter(levelIndex, 0)}
                  >
                    <span className="flex items-center justify-between text-xs uppercase tracking-[0.12em] text-cyan-200"><span>Level {String(level.id).padStart(2, '0')}</span><span>{levelCount}/5</span></span>
                    <span className="mt-1 block text-sm font-medium text-white">{level.title}</span>
                  </button>
                  {activeLevelIndex === levelIndex && (
                    <div className="mt-2 space-y-1 border-t border-slate-800 pt-2">
                      {level.chapters.map((chapter, chapterIndex) => {
                        const done = completedChapters.includes(chapter.id)
                        const locked = chapterIndex > 0 && !completedChapters.includes(requiredItem(level.chapters, chapterIndex - 1, 'previous chapter').id)
                        return (
                          <button key={chapter.id} disabled={locked} onClick={() => selectChapter(levelIndex, chapterIndex)} className={`flex w-full items-center gap-2 px-2 py-2 text-left text-xs ${activeChapter.id === chapter.id ? 'bg-cyan-400/10 text-cyan-100' : done ? 'text-emerald-300' : locked ? 'cursor-not-allowed text-slate-600' : 'text-slate-300 hover:bg-slate-800/70'}`}>
                            <span className="w-5 shrink-0 text-[10px] text-slate-500">{String(chapterIndex + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1">{chapter.title}</span><span>{done ? '✓' : locked ? '·' : ''}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          <div className="relative min-h-56 overflow-hidden border border-slate-700 bg-slate-950 sm:min-h-72">
            <img src={activeLevel.image} alt={activeLevel.imageAlt} className="absolute inset-0 h-full w-full object-cover opacity-65" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#050b13] via-[#050b13]/80 to-transparent" />
            <div className="relative max-w-2xl p-5 sm:p-8">
              <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200">Level {activeLevel.id} · Chapter {activeChapterIndex + 1} of 5</div>
              <h2 className="mt-3 text-3xl font-semibold text-white">{activeChapter.title}</h2>
              <p className="mt-2 text-xs font-medium text-cyan-100/80">{activeLevel.title} · {activeLevel.summary}</p>
              <p className="mt-3 text-sm leading-6 text-slate-200">{activeChapter.lesson}</p>
              <p className="mt-4 text-[10px] uppercase tracking-[0.14em] text-slate-400">Image source: {activeLevel.imageCredit}</p>
            </div>
          </div>

          <article className="panel p-5 sm:p-6">
            <div className="section-title">The lesson · plain language</div>
            <h3 className="mt-3 text-xl font-semibold text-white">How it works</h3>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-200">{activeChapter.guide}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="border border-slate-700 bg-slate-950/60 p-4">
                <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-200">Worked example</div>
                <p className="mt-2 text-sm leading-6 text-slate-300">{activeChapter.workedExample}</p>
              </div>
              <div className="border-l-2 border-amber-300/60 bg-amber-300/[0.04] p-4">
                <div className="text-[10px] uppercase tracking-[0.16em] text-amber-200">Watch out</div>
                <p className="mt-2 text-sm leading-6 text-slate-300">{activeChapter.watchFor}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]">
              <div className="border-l-2 border-cyan-300/60 pl-4">
                <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-200">How this fits the bigger picture</div>
                <p className="mt-2 text-sm leading-6 text-slate-300">{activeLevel.explanation}</p>
                <div className="mt-4 text-[10px] uppercase tracking-[0.16em] text-cyan-200">Key idea</div>
                <p className="mt-2 text-sm leading-6 text-slate-200">{activeLevel.takeaway}</p>
                <a href={activeLevel.resourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-cyan-200 underline decoration-cyan-500/40 underline-offset-4">Optional NASA reading: {activeLevel.resourceLabel} ↗</a>
              </div>
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-cyan-200">See the idea</div>
                <ChapterAnimation type={activeChapter.animation} image={activeLevel.image} alt={activeLevel.imageAlt} credit={activeLevel.imageCredit} />
                <p className="mt-2 text-xs leading-5 text-slate-400">Concept animation · schematic, not to scale or measured data.</p>
              </div>
            </div>
          </article>

          <ChapterFieldLab key={activeChapter.id} chapter={activeChapter} />

          <div className="panel max-w-4xl p-5 sm:p-6">
            <div className="section-title">Check your understanding · +30 XP</div>
            <h3 className="mt-3 text-lg font-medium text-white">{activeChapter.prompt}</h3>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {answerChoices.map((choice) => {
                const correct = choice === activeChapter.answer
                const selected = choice === selectedAnswer
                const answeredCorrectly = selectedAnswer === activeChapter.answer
                return (
                  <button key={choice} disabled={answeredCorrectly || chapterCompleted} onClick={() => answerChapter(choice)} className={`border px-3 py-3 text-left text-sm transition ${answeredCorrectly && correct ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100' : selected && !correct ? 'border-rose-500/50 bg-rose-500/10 text-rose-100' : 'border-slate-700 bg-slate-950 text-slate-200 hover:border-cyan-400/50'}`}>
                    {choice}
                  </button>
                )
              })}
            </div>
            {selectedAnswer && <p className={`mt-4 border-l-2 pl-3 text-sm leading-6 ${selectedAnswer === activeChapter.answer ? 'border-emerald-400 text-emerald-100' : 'border-amber-300 text-amber-100'}`}>{selectedAnswer === activeChapter.answer ? `That’s right. ${activeChapter.answerWhy}` : `Not quite. ${activeChapter.answerWhy} Choose another answer when you’re ready.`}</p>}
            {chapterCompleted && !selectedAnswer && <p className="mt-4 border-l-2 border-emerald-400 pl-3 text-sm leading-6 text-emerald-100">Already complete. Correct answer: {activeChapter.answer}. {activeChapter.answerWhy}</p>}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button className="button-secondary gap-2" onClick={previousChapter} disabled={activeLevelIndex === 0 && activeChapterIndex === 0}>
                <ArrowRight size={15} className="rotate-180" /> Previous chapter
              </button>
              {(selectedAnswer === activeChapter.answer || chapterCompleted) && (
                <button className="button-primary gap-2" onClick={continueChapter} disabled={activeLevelIndex === curriculum.length - 1 && activeChapterIndex === activeLevel.chapters.length - 1}>
                  {activeLevelIndex === curriculum.length - 1 && activeChapterIndex === activeLevel.chapters.length - 1 ? 'Curriculum complete' : 'Continue learning'} <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </motion.div>
  )
}

function ChapterAnimation({ type, image, alt, credit }: { type: Chapter['animation']; image: string; alt: string; credit: string }) {
  const motionByType: Record<Chapter['animation'], { x: number[]; scale: number[]; rotate: number[] }> = {
    pulse: { x: [-130, 130, -130], scale: [1, 1, 1], rotate: [0, 0, 0] },
    wave: { x: [0, 0, 0], scale: [0.65, 1.15, 0.65], rotate: [0, 0, 0] },
    scatter: { x: [-20, 20, -20], scale: [0.8, 1.2, 0.8], rotate: [0, 45, 0] },
    change: { x: [-35, 35, -35], scale: [1, 1.05, 1], rotate: [0, 0, 0] },
    phase: { x: [0, 0, 0], scale: [0.8, 1.25, 0.8], rotate: [0, 180, 360] },
  }

  return (
    <div className={`chapter-animation chapter-${type}`} role="img" aria-label={`${type} SAR concept animation over ${alt}`}>
      <img src={image} alt="" aria-hidden="true" className="chapter-image" />
      <div className="chapter-grid" />
      <div className="chapter-satellite"><Satellite size={20} /><span>SAR SENSOR</span></div>
      <div className="chapter-ground" />
      <motion.div className="chapter-energy" animate={motionByType[type]} transition={{ duration: type === 'pulse' ? 2 : 3.5, repeat: Infinity, ease: 'easeInOut' }} />
      {type === 'scatter' && Array.from({ length: 5 }, (_, index) => (
        <motion.span key={index} className="chapter-scatter-point" style={{ left: `${38 + index * 6}%` }} animate={{ y: [0, -22 - index * 4, 0], opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.8 + index * 0.2, repeat: Infinity, delay: index * 0.12 }} />
      ))}
      <div className="chapter-animation-label">{type === 'pulse' ? 'TRANSMIT → ECHO' : type === 'wave' ? 'WAVELENGTH' : type === 'scatter' ? 'SURFACE SCATTERING' : type === 'change' ? 'REPEAT OBSERVATION' : 'PHASE / COHERENCE'} · {credit}</div>
    </div>
  )
}

function ChapterFieldLab({ chapter }: { chapter: Chapter }) {
  const [selection, setSelection] = useState('')
  const [echoTimeMicroseconds, setEchoTimeMicroseconds] = useState(5000)
  const initialValue = chapter.playground === 'glacier-speed' ? 120
    : chapter.playground === 'crop-calendar' ? 6
      : chapter.playground === 'aperture-builder' ? 24
        : chapter.playground === 'range-calculator' ? 150
          : chapter.playground === 'repeat-stack' ? 0
            : 50
  const [value, setValue] = useState(initialValue)
  const [secondValue, setSecondValue] = useState(30)
  const [roughness, setRoughness] = useState(50)
  const [moisture, setMoisture] = useState(50)
  const [vegetation, setVegetation] = useState(50)
  const [incidenceAngle, setIncidenceAngle] = useState(35)
  const [checked, setChecked] = useState<string[]>([])
  const echoRangeKm = echoTimeMicroseconds * 0.149896229
  const rangeEchoMicroseconds = value * 2000 / 299.792458
  const band = selection === 'S-band' ? 'S-band' : 'L-band'
  const wavelengthCm = band === 'L-band' ? 24 : 9.4
  const frequencyGhz = 29.9792458 / wavelengthCm
  const phaseDegrees = ((value / 120 * 360) % 360 + 360) % 360
  const losProjection = value * Math.cos(secondValue * Math.PI / 180)
  const glacierSpeed = value / secondValue
  const backscatterDb = -18 + (roughness - 50) * 0.08 + (moisture - 50) * 0.1 + (vegetation - 50) * 0.06 - (incidenceAngle - 35) * 0.08
  const playgroundTitles: Record<PlaygroundId, string> = {
    'sensor-choice': 'Choose the sensor for the question',
    'pulse-echo': 'Send a pulse and receive its echo',
    'range-calculator': 'Convert range into echo time',
    'band-comparator': 'Compare the two NISAR bands',
    'aperture-builder': 'Build a synthetic aperture',
    'science-question': 'Match a target to a science question',
    'repeat-stack': 'Build a repeat-observation stack',
    'product-matcher': 'Choose the right SAR product',
    'metadata-audit': 'Audit a product before analysis',
    'archive-finder': 'Build a mission data search',
    'backscatter-meter': 'Explore a simplified backscatter model',
    'water-roughness': 'Change the roughness of water',
    'vegetation-depth': 'Explore wavelength and canopy structure',
    'double-bounce': 'Turn a building corner toward the radar',
    'polarization-mixer': 'Choose transmit and receive polarization',
    'flood-signal': 'Read flood signals by land cover',
    'biomass-calibration': 'Calibrate a biomass estimate',
    'crop-calendar': 'Follow a crop season',
    'glacier-speed': 'Estimate average glacier feature speed',
    'comparison-audit': 'Check whether two scenes are comparable',
    'phase-cycle': 'Convert displacement into phase cycles',
    'interferogram-builder': 'Align two acquisitions',
    'coherence-check': 'Test phase reliability',
    'line-of-sight': 'Project motion onto the radar view',
    'uncertainty-budget': 'Build an uncertainty checklist',
  }
  const bandName = band
  const toggleCheck = (item: string) => setChecked((items) => items.includes(item) ? items.filter((entry) => entry !== item) : [...items, item])
  const [, levelNumber = '1', chapterNumber = '1'] = chapter.id.match(/level-(\d+)-chapter-(\d+)/) ?? []
  const playgroundNumber = (Number(levelNumber) - 1) * 5 + Number(chapterNumber)
  const checkList = (items: string[]) => (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <label key={item} className="flex min-h-11 items-center gap-2 border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
          <input type="checkbox" checked={checked.includes(item)} onChange={() => toggleCheck(item)} className="accent-cyan-300" />
          <span>{item}</span>
        </label>
      ))}
    </div>
  )

  return (
    <section className="panel p-5 sm:p-6" aria-label={`${chapter.title} hands-on practice`}>
      <div className="section-title">Playground {playgroundNumber} of 25 · experiment</div>
      <h3 className="mt-2 text-xl font-semibold text-white">{playgroundTitles[chapter.playground]}</h3>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="min-h-44 border border-slate-700 bg-slate-950/70 p-5">
          {chapter.playground === 'sensor-choice' && (
            <>
              <ControlRow label="Sensor" value={selection || 'Optical'} options={['Optical', 'SAR']} onChange={setSelection} />
              <p className="mt-4 text-sm leading-6 text-slate-300">{(selection || 'Optical') === 'SAR' ? 'SAR sends and measures microwave echoes. It works at night and through most clouds; the return responds to surface structure and moisture.' : 'Optical sensors measure reflected or emitted sunlight. They show familiar color, but clouds and darkness can block a useful surface view.'}</p>
            </>
          )}
          {chapter.playground === 'pulse-echo' && (
            <>
              <div className="flex items-center justify-between gap-3 text-center text-xs text-slate-300">
                <span className="border border-cyan-400/30 bg-cyan-400/10 px-3 py-2">Transmit</span>
                <ArrowRight size={18} className="text-cyan-200" />
                <span className="border border-slate-600 bg-slate-800 px-3 py-2">Surface</span>
                <ArrowRight size={18} className="rotate-180 text-amber-200" />
                <span className="border border-amber-400/30 bg-amber-400/10 px-3 py-2">Echo</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">The antenna sends a pulse, then listens for energy that returns. The strength of that echo depends on the target and the viewing geometry.</p>
              <div className="mt-4 rounded border border-cyan-900/60 bg-cyan-950/30 p-3 text-sm text-cyan-100">Round-trip time {echoTimeMicroseconds} μs · approximate slant range {echoRangeKm.toFixed(1)} km</div>
              <div className="mt-4"><SliderRow label="Echo round-trip time (μs)" min={4000} max={6000} value={echoTimeMicroseconds} onChange={setEchoTimeMicroseconds} /></div>
              <p className="mt-3 text-xs text-slate-500">Range = speed of light × time ÷ 2. Slant range is not satellite altitude.</p>
            </>
          )}
          {chapter.playground === 'range-calculator' && (
            <>
              <SliderRow label="Target slant range (km)" min={600} max={900} value={value + 600} onChange={(next) => setValue(next - 600)} />
              <div className="mt-4 border-l-2 border-cyan-300 pl-3" aria-live="polite"><div className="text-lg font-medium text-cyan-100">Round-trip time ≈ {rangeEchoMicroseconds.toFixed(1)} μs</div><p className="mt-1 text-sm leading-6 text-slate-300">The signal travels to the target and back, so the distance is doubled before dividing by the speed of light.</p></div>
            </>
          )}
          {chapter.playground === 'band-comparator' && (
            <>
              <div className="py-3" aria-label={`${bandName}: wavelength ${wavelengthCm} centimeters, frequency approximately ${frequencyGhz.toFixed(2)} gigahertz`}>
                <div className="flex items-center justify-between text-xs text-slate-400"><span>Wavelength scale</span><span>Longer wave →</span></div>
                <div className="mt-2 h-3 w-full bg-slate-800"><div className="h-full bg-cyan-300" style={{ width: `${wavelengthCm / 24 * 100}%` }} /></div>
                <div className="mt-2 flex justify-between text-xs text-slate-300"><span>{bandName}</span><span>{wavelengthCm} cm · {frequencyGhz.toFixed(2)} GHz</span></div>
              </div>
              <ControlRow label="NISAR band" value={bandName} options={['L-band', 'S-band']} onChange={setSelection} />
              <p className="mt-4 text-sm leading-6 text-slate-300">Frequency and wavelength are inversely related. L-band is longer and S-band is shorter; different wavelengths interact with surface structures differently.</p>
            </>
          )}
          {chapter.playground === 'aperture-builder' && (
            <>
              <SliderRow label="Along-track observation positions" min={2} max={16} value={value / 6 + 2} onChange={(next) => setValue((next - 2) * 6)} />
              <div className="mt-5 flex items-center justify-between gap-1" aria-label={`${Math.round(value / 6 + 2)} satellite positions observe one target`}>
                {Array.from({ length: Math.round(value / 6 + 2) }, (_, index) => <span key={index} className="h-3 w-3 rounded-full bg-cyan-300" />)}
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">Each point represents a position along the flight path. Processing combines phase-linked echoes from these positions to synthesize a longer aperture.</p>
              <p className="mt-2 text-xs text-slate-500">Conceptual drawing only. More points do not guarantee better data.</p>
            </>
          )}
          {chapter.playground === 'science-question' && (
            <>
              <ControlRow label="Earth target" value={selection || 'Land'} options={['Land', 'Ice', 'Water', 'Vegetation']} onChange={setSelection} />
              <div className="mt-4 border-l-2 border-cyan-300 pl-3 text-sm leading-6 text-slate-300">{(selection || 'Land') === 'Land' ? 'Question: is the ground moving after an earthquake or landslide?' : (selection || 'Land') === 'Ice' ? 'Question: how are a glacier or ice sheet changing over time?' : (selection || 'Land') === 'Water' ? 'Question: where is flooding changing the land surface?' : 'Question: how is forest structure or crop growth changing?'}</div>
              <p className="mt-3 text-xs text-slate-500">A mission measures signals that help scientists investigate; the satellite does not answer the question alone.</p>
            </>
          )}
          {chapter.playground === 'repeat-stack' && (
            <>
              <SliderRow label="Number of repeat acquisitions" min={1} max={12} value={value / 9 + 1} onChange={(next) => setValue((next - 1) * 9)} />
              <div className="mt-5 flex items-center justify-between gap-1">{Array.from({ length: Math.round(value / 9 + 1) }, (_, index) => <span key={index} className={`h-3 w-3 rounded-full ${index === 0 ? 'bg-cyan-300' : 'bg-slate-500'}`} />)}</div>
              <p className="mt-4 text-sm leading-6 text-slate-300">One date is a snapshot. Two dates allow a comparison; a longer consistent time series can reveal trends and seasonality.</p>
              <p className="mt-2 text-xs text-slate-500">Example revisit interval varies by mission and observation plan.</p>
            </>
          )}
          {chapter.playground === 'product-matcher' && (
            <>
              <ControlRow label="Science goal" value={selection || 'Surface brightness'} options={['Surface brightness', 'Phase and motion', 'Signal stability']} onChange={setSelection} />
              <div className="mt-4 border-l-2 border-cyan-300 pl-3"><div className="text-sm font-medium text-cyan-100">Product to explore: {(selection || 'Surface brightness') === 'Surface brightness' ? 'calibrated backscatter' : (selection || 'Surface brightness') === 'Phase and motion' ? 'complex SLC pairs and an interferogram' : 'coherence map'}</div><p className="mt-2 text-sm leading-6 text-slate-300">A product is useful only when its measurements match your scientific question.</p></div>
            </>
          )}
          {chapter.playground === 'metadata-audit' && (
            <>
              <p className="text-sm text-slate-300">Select what you would verify before interpreting a product.</p>
              {checkList(['Acquisition date', 'Sensor and band', 'Polarization', 'Product and units', 'Look geometry', 'Processing level'])}
              <p className="mt-4 text-sm text-cyan-100" aria-live="polite">{checked.length}/6 metadata fields checked. {checked.length === 6 ? 'Ready for a documented interpretation.' : 'More context is needed before analysis.'}</p>
            </>
          )}
          {chapter.playground === 'archive-finder' && (
            <>
              <ControlRow label="Mission to search" value={selection || 'NISAR'} options={['NISAR', 'Sentinel-1', 'ALOS-2']} onChange={setSelection} />
              <a className="button-primary mt-5 gap-2" href={`https://search.earthdata.nasa.gov/search?q=${encodeURIComponent(selection || 'NISAR')}%20SAR`} target="_blank" rel="noreferrer">Search NASA Earthdata <ArrowRight size={15} /></a>
              <p className="mt-4 text-xs leading-5 text-slate-400">This opens a real catalog search. Confirm coverage, dates, product type, and access conditions in the result metadata.</p>
            </>
          )}
          {chapter.playground === 'backscatter-meter' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <SliderRow label="Surface roughness" value={roughness} onChange={setRoughness} />
                <SliderRow label="Surface moisture" value={moisture} onChange={setMoisture} />
                <SliderRow label="Vegetation amount" value={vegetation} onChange={setVegetation} />
                <SliderRow label="Incidence angle" min={15} max={60} value={incidenceAngle} onChange={setIncidenceAngle} />
              </div>
              <div className="mt-4 border-l-2 border-cyan-300 pl-3"><div className="text-lg font-medium text-cyan-100">Illustrative return: {backscatterDb.toFixed(1)} dB</div><p className="text-sm leading-6 text-slate-300">Move one control at a time to see how assumptions change the estimate.</p></div>
              <p className="mt-2 text-xs text-slate-500">Teaching model only; coefficients are not calibrated mission data.</p>
            </>
          )}
          {chapter.playground === 'water-roughness' && (
            <>
              <SliderRow label="Wind-driven surface roughness" value={value} onChange={setValue} />
              <div className="mt-4 h-10 border border-cyan-900/50" style={{ background: `repeating-linear-gradient(${170 - value / 2}deg, #08293a 0 7px, #1b7590 ${Math.max(8, 10 - value / 12)}px, #0b3547 12px 19px)` }} />
              <p className="mt-3 text-sm leading-6 text-slate-300">{value < 35 ? 'A smoother surface tends to reflect energy away, producing a weaker return.' : 'A rougher, wind-affected surface can return more energy toward the radar.'} This is a qualitative relationship; waves and viewing geometry complicate real water observations.</p>
            </>
          )}
          {chapter.playground === 'vegetation-depth' && (
            <>
              <ControlRow label="Radar band" value={selection || 'L-band'} options={['L-band', 'S-band']} onChange={setSelection} />
              <SliderRow label="Canopy density (illustrative)" value={vegetation} onChange={setVegetation} />
              <div className="mt-4 border border-emerald-900/50 bg-emerald-950/20 p-3 text-sm leading-6 text-slate-300">{(selection || 'L-band') === 'L-band' ? 'The longer L-band wavelength can interact with larger branches and trunks. A denser canopy still changes how much energy reaches and returns from lower layers.' : 'The shorter S-band wavelength tends to respond more to smaller canopy structures. It does not simply stop at the canopy top.'}</div>
            </>
          )}
          {chapter.playground === 'double-bounce' && (
            <>
              <ControlRow label="Building orientation" value={selection || 'Facing radar'} options={['Facing radar', 'Turned away']} onChange={setSelection} />
              <div className="mt-5 flex items-center justify-center gap-3 text-sm"><span className="border border-cyan-400/30 bg-cyan-400/10 px-3 py-3">Radar</span><ArrowRight className={(selection || 'Facing radar') === 'Turned away' ? 'rotate-12 text-slate-500' : 'text-cyan-200'} /><span className="h-16 w-5 border border-slate-400 bg-slate-700" /><span className="h-5 w-28 border border-amber-300/50 bg-amber-300/20" /></div>
              <p className="mt-4 text-sm leading-6 text-slate-300">{(selection || 'Facing radar') === 'Facing radar' ? 'When the wall-ground corner faces the radar, two reflections can send energy back strongly.' : 'Turning the corner away can weaken that return. Street orientation is one reason cities have mixed radar brightness.'}</p>
            </>
          )}
          {chapter.playground === 'polarization-mixer' && (
            <>
              <ControlRow label="Transmit / receive channel" value={selection || 'VH'} options={['HH', 'HV', 'VH', 'VV']} onChange={setSelection} />
              <div className="mt-4 grid grid-cols-2 gap-3 text-center text-sm"><div className="border border-slate-700 p-3"><span className="block text-xs text-slate-400">Transmit</span>{(selection || 'VH')[0] === 'H' ? 'Horizontal (H)' : 'Vertical (V)'}</div><div className="border border-slate-700 p-3"><span className="block text-xs text-slate-400">Receive</span>{(selection || 'VH')[1] === 'H' ? 'Horizontal (H)' : 'Vertical (V)'}</div></div>
              <p className="mt-3 text-sm text-slate-300">First letter is transmitted polarization; second letter is received polarization. HH/VV are co-polarized, while HV/VH are cross-polarized.</p>
            </>
          )}
          {chapter.playground === 'flood-signal' && (
            <>
              <ControlRow label="Flooded land cover" value={selection || 'Open water'} options={['Open water', 'Urban street', 'Vegetation']} onChange={setSelection} />
              <div className="mt-4 h-8 border border-slate-700 bg-slate-900"><div className={`h-full ${(selection || 'Open water') === 'Open water' ? 'w-1/4 bg-slate-700' : (selection || 'Open water') === 'Urban street' ? 'w-4/5 bg-cyan-300' : 'w-1/2 bg-emerald-400'}`} /></div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{(selection || 'Open water') === 'Open water' ? 'Open smooth water often gives a weak return.' : (selection || 'Open water') === 'Urban street' ? 'Water between buildings may create a strong double-bounce return.' : 'Flooded vegetation can have complex volume and double-bounce scattering.'} A baseline and local context are necessary for flood mapping.</p>
            </>
          )}
          {chapter.playground === 'biomass-calibration' && (
            <>
              <SliderRow label="Representative field plots" min={0} max={30} value={value * 0.3} onChange={(next) => setValue(next / 0.3)} />
              <div className="mt-4 flex items-end gap-1" aria-label={`${Math.round(value * 0.3)} representative field plots selected`}>{Array.from({ length: 10 }, (_, index) => <span key={index} className={`h-8 flex-1 ${index < Math.round(value / 10) ? 'bg-emerald-400' : 'bg-slate-700'}`} />)}</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{value < 35 ? 'Few field measurements: a biomass model cannot be well calibrated yet.' : value < 70 ? 'More plots help, if they represent the forest types and conditions being mapped.' : 'A larger representative sample can support calibration, but independent validation and uncertainty estimates are still needed.'}</p>
              <p className="mt-2 text-xs text-slate-500">Plot count alone does not guarantee a reliable biomass estimate.</p>
            </>
          )}
          {chapter.playground === 'crop-calendar' && (
            <>
              <SliderRow label="Month in the growing season" min={1} max={12} value={value} onChange={setValue} />
              <div className="mt-4 grid grid-cols-12 gap-1">{Array.from({ length: 12 }, (_, index) => <span key={index} className={`h-7 ${index + 1 <= value ? 'bg-emerald-400/80' : 'bg-slate-700'}`} />)}</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">Month {value} selected. Crop structure and water content change over a growing season, but rainfall and irrigation can also alter radar returns. Use local crop calendars.</p>
            </>
          )}
          {chapter.playground === 'glacier-speed' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2"><SliderRow label="Feature displacement (m)" min={0} max={500} value={value} onChange={setValue} /><SliderRow label="Time between scenes (days)" min={1} max={90} value={secondValue} onChange={setSecondValue} /></div>
              <div className="mt-4 border-l-2 border-cyan-300 pl-3"><div className="text-lg font-medium text-cyan-100">Average tracked speed: {glacierSpeed.toFixed(2)} m/day</div><p className="text-sm text-slate-300">Speed = matched feature displacement ÷ elapsed days.</p></div>
              <p className="mt-2 text-xs text-slate-500">Illustrative feature tracking, not a NISAR-derived glacier measurement.</p>
            </>
          )}
          {chapter.playground === 'comparison-audit' && (
            <>
              <p className="text-sm text-slate-300">Check the conditions you have verified for both scenes.</p>
              {checkList(['Same or compatible look direction', 'Matching polarization', 'Comparable product and units', 'Dates and season checked', 'Processing documented'])}
              <p className="mt-4 text-sm text-cyan-100" aria-live="polite">{checked.length}/5 checks done. {checked.length === 5 ? 'The comparison is better supported; still inspect the data and uncertainty.' : 'Hold off on a strong change claim until more checks are done.'}</p>
            </>
          )}
          {chapter.playground === 'phase-cycle' && (
            <>
              <SliderRow label="L-band line-of-sight displacement (mm)" min={-240} max={240} value={value * 4.8 - 240} onChange={(next) => setValue((next + 240) / 4.8)} />
              <div className="mt-4 flex h-10 overflow-hidden border border-slate-700" role="img" aria-label={`${phaseDegrees.toFixed(0)} degrees wrapped phase`}><div className="h-full bg-cyan-400" style={{ width: `${phaseDegrees / 3.6}%` }} /><div className="h-full flex-1 bg-slate-800" /></div>
              <p className="mt-3 text-sm leading-6 text-slate-300">Wrapped phase: {phaseDegrees.toFixed(0)}°. At L-band, about 120 mm of line-of-sight movement equals one full cycle in this simplified model. Multiple cycles wrap back around.</p>
            </>
          )}
          {chapter.playground === 'interferogram-builder' && (
            <>
              <ControlRow label="Acquisition alignment" value={selection || 'Aligned'} options={['Aligned', 'Misaligned']} onChange={setSelection} />
              <div className="mt-4 grid grid-cols-2 gap-2"><div className="border border-slate-700 bg-slate-900 p-3 text-center text-sm">Acquisition A<br /><span className="text-cyan-200">Phase φ₁</span></div><div className="border border-slate-700 bg-slate-900 p-3 text-center text-sm">Acquisition B<br /><span className="text-amber-200">Phase φ₂</span></div></div>
              <p className="mt-4 text-sm leading-6 text-slate-300">{(selection || 'Aligned') === 'Aligned' ? 'Matching pixels can be compared to calculate phase difference and form an interferogram.' : 'Misaligned pixels do not represent the same ground targets, so their phase difference is misleading.'}</p>
            </>
          )}
          {chapter.playground === 'coherence-check' && (
            <>
              <SliderRow label="Signal coherence (%)" value={value} onChange={setValue} />
              <div className="mt-4 h-3 bg-slate-800"><div className={`h-full transition-[width] ${value >= 70 ? 'bg-emerald-400' : value >= 40 ? 'bg-amber-300' : 'bg-rose-400'}`} style={{ width: `${value}%` }} /></div>
              <p className="mt-3 text-sm font-medium text-cyan-100">{value >= 70 ? 'Higher coherence: phase is more consistent.' : value >= 40 ? 'Mixed coherence: inspect the area carefully.' : 'Low coherence: phase interpretation is unreliable.'}</p>
              <p className="mt-2 text-xs text-slate-500">Thresholds here are teaching guides, not universal mission quality cutoffs.</p>
            </>
          )}
          {chapter.playground === 'line-of-sight' && (
            <>
              <SliderRow label="Movement magnitude (mm)" min={0} max={100} value={value} onChange={setValue} />
              <SliderRow label="Angle from radar line of sight (degrees)" min={0} max={90} value={secondValue} onChange={setSecondValue} />
              <div className="mt-4 border-l-2 border-cyan-300 pl-3"><div className="text-lg font-medium text-cyan-100">Measured component ≈ {losProjection.toFixed(1)} mm</div><p className="text-sm text-slate-300">Projection = movement × cos(angle from line of sight).</p></div>
              <p className="mt-2 text-xs text-slate-500">One view sees one projection, not the complete 3D movement vector.</p>
            </>
          )}
          {chapter.playground === 'uncertainty-budget' && (
            <>
              <p className="text-sm text-slate-300">Select issues that need checking before making a claim.</p>
              {checkList(['Low coherence', 'Atmospheric delay', 'Uncertain geometry', 'Poor image alignment', 'No independent validation'])}
              <div className="mt-4 border-l-2 border-amber-300 pl-3 text-sm leading-6 text-slate-300" aria-live="polite">{checked.length === 0 ? 'No listed issues selected. That does not mean uncertainty is zero; verify each item.' : `${checked.length} uncertainty source${checked.length === 1 ? '' : 's'} flagged. State how these could affect the result before reporting a conclusion.`}</div>
            </>
          )}
          {chapter.playground === 'water-roughness' && <p className="sr-only">Water scattering playground</p>}
        </div>
        <div className="flex flex-col justify-center">
          <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-200">What to notice</div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{chapter.guide}</p>
          <p className="mt-4 border-l border-cyan-300/50 pl-3 text-sm leading-6 text-slate-200"><span className="font-medium text-cyan-100">Try next:</span> {chapter.workedExample}</p>
          <p className="mt-4 border-l border-amber-300/50 pl-3 text-xs leading-5 text-amber-100/80">{chapter.watchFor} Simplified activity only; use documented, calibrated data for scientific conclusions.</p>
        </div>
      </div>
    </section>
  )
}

function EarthExplorerPage() {
  const [selectedLocation, setSelectedLocation] = useState<LocationEntry>(() => requiredItem(locationData, 0, 'Earth explorer location'))

  return (
    <motion.div
      key="earth"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="panel p-4 md:p-6">
        <div className="section-title">Interactive Earth Explorer</div>
        <div className="mt-5 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="relative h-[580px] overflow-hidden rounded-[28px] border border-slate-700 bg-slate-950">
            <EarthScene location={selectedLocation} />
          </div>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
              {locationData.map((location) => (
                <button
                  key={location.name}
                  onClick={() => setSelectedLocation(location)}
                  className={`rounded-xl border p-3 text-left transition ${selectedLocation.name === location.name ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-slate-700 bg-slate-900/60 hover:border-slate-600'}`}
                >
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{location.region}</div>
                  <div className="mt-1 font-medium text-white">{location.name}</div>
                </button>
              ))}
            </div>

            <div className="rounded-[24px] border border-slate-700 bg-slate-900/70 p-5">
              <div className="text-[10px] uppercase tracking-[0.25em] text-cyan-200">Selected site</div>
              <h3 className="mt-3 text-2xl font-semibold text-white">{selectedLocation.name}</h3>
              <p className="mt-2 text-sm text-slate-400">{selectedLocation.region}</p>
              <div className="mt-5 space-y-4">
                <div>
                  <div className="overline-label">Environmental significance</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{selectedLocation.significance}</p>
                </div>
                <div>
                  <div className="overline-label">NISAR mission focus</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{selectedLocation.missionFocus}</p>
                </div>
                <div>
                  <div className="overline-label">Key applications</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedLocation.applications.map((application) => (
                      <span key={application} className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-300">{application}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function LearningPathsPage() {
  const { progress } = useStudentProgress()
  const completedCount = curriculum.reduce((count, level) => count + level.chapters.filter((chapter) => progress.completedChapters.includes(chapter.id)).length, 0)

  return (
    <motion.div
      key="learning-paths"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="panel p-6">
        <div className="section-title">NASA-guided course · Beginner to applied SAR</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white">Read Earth with radar</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Five progressive levels, 25 short chapters, NASA mission imagery, and hands-on labs. Practice profiles keep learning progress in this browser.</p>
          </div>
          <div className="min-w-52 text-sm text-slate-300">
            <div className="flex justify-between"><span>Course progress</span><span>{completedCount}/25</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={25} aria-valuenow={completedCount}>
              <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${(completedCount / 25) * 100}%` }} />
            </div>
          </div>
        </div>

        <div className="mt-7 space-y-3">
          {curriculum.map((level, index) => {
            const levelDone = level.chapters.filter((chapter) => progress.completedChapters.includes(chapter.id)).length
            const isComplete = levelDone === level.chapters.length
            const previousComplete = index === 0 || requiredItem(curriculum, index - 1, 'previous learning level').chapters.every((chapter) => progress.completedChapters.includes(chapter.id))
            const isLocked = !isComplete && !previousComplete
            const nextChapterIndex = level.chapters.findIndex((chapter) => !progress.completedChapters.includes(chapter.id))
            const startChapter = nextChapterIndex < 0 ? 0 : nextChapterIndex
            const module = requiredItem(learningPathModules, index, 'learning module')

            return (
              <article key={level.id} className="grid gap-4 overflow-hidden border border-slate-700 bg-slate-950/60 p-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center sm:p-4">
                <img src={level.image} alt={level.imageAlt} loading="lazy" className="h-36 w-full object-cover sm:h-32" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-[0.16em] text-cyan-200">Level {String(level.id).padStart(2, '0')} · {levelDone}/5 chapters</div>
                    <span className={`text-xs ${isComplete ? 'text-emerald-300' : isLocked ? 'text-slate-500' : 'text-amber-200'}`}>{isComplete ? 'Level complete' : isLocked ? 'Complete previous level to unlock' : 'Ready'}</span>
                  </div>
                  <h2 className="mt-1 text-xl font-medium text-white">{level.title}</h2>
                  <p className="mt-1 text-sm leading-5 text-slate-400">{module.concept}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <a href={module.resourceUrl} target="_blank" rel="noreferrer" className="text-cyan-200 underline decoration-cyan-500/40 underline-offset-4 hover:text-white">{module.resourceLabel} ↗</a>
                    <Link to={module.labPath} className="text-slate-300 underline decoration-slate-600 underline-offset-4 hover:text-white">{module.labLabel}</Link>
                  <Link
                    to={isLocked ? '/learning-paths' : `/academy?level=${level.id}&chapter=${startChapter + 1}`}
                    aria-disabled={isLocked}
                    {...(isLocked ? { tabIndex: -1 } : {})}
                    onClick={(event) => { if (isLocked) event.preventDefault() }}
                    className={`ml-auto inline-flex min-h-9 items-center border px-3 text-xs transition ${isLocked ? 'pointer-events-none border-slate-800 text-slate-600' : 'border-cyan-400/40 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20'}`}
                  >
                    {isLocked ? 'Locked' : isComplete ? 'Review level' : `Start chapter ${startChapter + 1}`}
                  </Link>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <span>Course checkpoint: test your understanding in the SAR quiz.</span>
          <Link to="/quiz-arena" className="button-primary">Take the quiz</Link>
        </div>
      </div>
    </motion.div>
  )
}

function ResearchLibraryPage() {
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState('All topics')
  const [level, setLevel] = useState('All levels')
  const topics = ['All topics', ...new Set(researchResources.map((resource) => resource.topic))]
  const levels = ['All levels', 'Beginner', 'Intermediate', 'Advanced']
  const normalizedQuery = query.trim().toLowerCase()
  const filteredResources = researchResources.filter((resource) => {
    const matchesTopic = topic === 'All topics' || resource.topic === topic
    const matchesLevel = level === 'All levels' || resource.level.includes(level)
    const matchesQuery = !normalizedQuery || [resource.title, resource.author, resource.summary, resource.topic, resource.citation].some((value) => value.toLowerCase().includes(normalizedQuery))
    return matchesTopic && matchesLevel && matchesQuery
  })

  return (
    <motion.div key="research-library" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.35 }} className="space-y-6">
      <div className="panel p-6">
        <div className="section-title">Open research · NASA and peer-reviewed material</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white">SAR Research Library</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Find trusted SAR papers, mission handbooks, and learning references. Each item includes a short guide to what you will learn and a direct source link.</p>
          </div>
          <div className="text-xs uppercase tracking-[0.14em] text-cyan-200">{filteredResources.length} resources</div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_200px_180px]">
          <label className="text-xs text-slate-400">Search papers and authors
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try InSAR, forest, NISAR..." className="mt-1 block w-full border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" />
          </label>
          <label className="text-xs text-slate-400">Topic
            <select value={topic} onChange={(event) => setTopic(event.target.value)} className="mt-1 block w-full border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300">
              {topics.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Reading level
            <select value={level} onChange={(event) => setLevel(event.target.value)} className="mt-1 block w-full border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300">
              {levels.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-6 divide-y divide-slate-800 border-y border-slate-800">
          {filteredResources.length ? filteredResources.map((resource) => (
            <article key={resource.title} className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_160px]">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-cyan-200">
                  <span>{resource.topic}</span><span className="text-slate-600">/</span><span>{resource.level}</span><span className="text-slate-600">/</span><span className="text-slate-400">{resource.format}</span>
                </div>
                <h2 className="mt-2 text-lg font-medium text-white">{resource.title}</h2>
                <p className="mt-1 text-xs text-slate-400">{resource.author} · {resource.year}</p>
                <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">{resource.summary}</p>
                <p className="mt-3 text-xs leading-5 text-slate-500">{resource.citation}</p>
              </div>
              <div className="flex items-start md:justify-end">
                <a href={resource.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center border border-cyan-400/40 bg-cyan-300/10 px-3 text-sm text-cyan-100 transition hover:bg-cyan-300/20">Open source ↗</a>
              </div>
            </article>
          )) : (
            <p className="py-10 text-center text-sm text-slate-400">No resources match those filters. Try another topic or search term.</p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

const satelliteAreas: SatelliteArea[] = [
  { name: 'Whole Earth', bbox: '-90,-180,90,180' },
  { name: 'Mumbai, India', bbox: '18.7,72.2,19.5,73.4' },
  { name: 'Seattle, USA', bbox: '47.0,-123.2,48.0,-121.8' },
  { name: 'Amazon Basin', bbox: '-4,-61,-2,-59' },
  { name: 'Japan', bbox: '35.0,137.5,37.5,140.5' },
  { name: 'Maui, Hawaii', bbox: '20.4,-157.2,21.3,-155.8' },
]

const satelliteLayers = [
  { id: 'MODIS_Terra_CorrectedReflectance_TrueColor', name: 'Terra · true color', description: 'Daily visible and near-infrared surface context.' },
  { id: 'MODIS_Aqua_CorrectedReflectance_TrueColor', name: 'Aqua · true color', description: 'Daily visible and near-infrared surface context from the Aqua satellite.' },
  { id: 'MODIS_Terra_CorrectedReflectance_Bands721', name: 'Terra · bands 7-2-1', description: 'False-color composite that helps distinguish burn scars, vegetation, and water.' },
  { id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', name: 'NOAA-20 VIIRS · true color', description: 'Daily visible and near-infrared surface context at finer detail.' },
]

function zoomedBounds(bounds: string, zoom: number) {
  const coordinates = bounds.split(',').map(Number)
  if (coordinates.length !== 4 || coordinates.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error(`Invalid satellite area bounds: ${bounds}`)
  }
  const south = requiredItem(coordinates, 0, 'southern bound')
  const west = requiredItem(coordinates, 1, 'western bound')
  const north = requiredItem(coordinates, 2, 'northern bound')
  const east = requiredItem(coordinates, 3, 'eastern bound')
  const centerLat = (south + north) / 2
  const centerLon = (west + east) / 2
  const scale = 1 / 2 ** zoom
  const halfLat = ((north - south) * scale) / 2
  const halfLon = ((east - west) * scale) / 2
  return [centerLat - halfLat, centerLon - halfLon, centerLat + halfLat, centerLon + halfLon].join(',')
}

function LiveSatellitePage() {
  const [latestAvailableDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [areaIndex, setAreaIndex] = useState(0)
  const [layerId, setLayerId] = useState(requiredItem(satelliteLayers, 0, 'satellite layer').id)
  const [date, setDate] = useState(latestAvailableDate)
  const [zoom, setZoom] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [imageUnavailable, setImageUnavailable] = useState(false)
  const area = requiredItem(satelliteAreas, areaIndex, 'satellite area')
  const layer = satelliteLayers.find((item) => item.id === layerId) ?? requiredItem(satelliteLayers, 0, 'satellite layer')
  const imageUrl = `${worldviewSnapshotUrl(date, zoomedBounds(area.bbox, zoom), layerId)}&refresh=${refreshKey}`

  const refreshImage = () => {
    setImageUnavailable(false)
    setRefreshKey((key) => key + 1)
  }

  const bounds = zoomedBounds(area.bbox, zoom).split(',')
  const south = requiredItem(bounds, 0, 'southern bound')
  const west = requiredItem(bounds, 1, 'western bound')
  const north = requiredItem(bounds, 2, 'northern bound')
  const east = requiredItem(bounds, 3, 'eastern bound')
  const openWorldviewUrl = `https://worldview.earthdata.nasa.gov/?v=${west},${south},${east},${north}&t=${date}`

  return (
    <motion.div key="live-satellite" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.35 }} className="space-y-6">
      <div className="panel p-6">
        <div className="section-title">NASA GIBS · near-real-time satellite imagery</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white">Live Satellite View</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Browse the latest available NASA satellite snapshot by region, date, and layer. This is frequently updated imagery, not a live video feed; product availability can lag acquisition time.</p>
          </div>
          <a href={openWorldviewUrl} target="_blank" rel="noreferrer" className="border border-cyan-400/40 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-400/10">Open interactive NASA Worldview ↗</a>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div>
              <div className="overline-label">Observation region</div>
              <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-1">
                {satelliteAreas.map((item, index) => (
                  <button key={item.name} aria-pressed={areaIndex === index} onClick={() => { setAreaIndex(index); setZoom(0); refreshImage() }} className={`border px-3 py-2 text-left text-sm transition ${areaIndex === index ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-100' : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500'}`}>
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
            <label className="block text-xs text-slate-400">Satellite layer
              <select value={layerId} onChange={(event) => { setLayerId(event.target.value); setImageUnavailable(false) }} className="mt-1 block w-full border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
                {satelliteLayers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-slate-400">Observation date (UTC)
              <input type="date" value={date} max={latestAvailableDate} onChange={(event) => { setDate(event.target.value); setImageUnavailable(false) }} className="mt-1 block w-full border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white" />
            </label>
            <div className="flex gap-2">
              <button onClick={() => setZoom((value) => Math.max(0, value - 1))} disabled={zoom === 0} className="button-secondary flex-1 disabled:opacity-40">Zoom out</button>
              <button onClick={() => setZoom((value) => Math.min(5, value + 1))} disabled={zoom === 5} className="button-secondary flex-1 disabled:opacity-40">Zoom in</button>
            </div>
            <button onClick={refreshImage} className="button-primary w-full">Refresh image</button>
          </aside>

          <section className="min-w-0 border border-slate-700 bg-[#050b13] p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-medium text-white">{area.name}</h2>
                <p className="mt-1 text-xs text-slate-400">{layer.description}</p>
              </div>
              <span className="border border-cyan-300/30 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100">{date} UTC</span>
            </div>
            <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-black">
              {!imageUnavailable ? (
                <img key={imageUrl} src={imageUrl} alt={`${layer.name} satellite image over ${area.name} for ${date} UTC`} onError={() => setImageUnavailable(true)} className="h-full w-full object-contain" />
              ) : (
                <div className="max-w-md p-6 text-center text-sm text-slate-300">
                  <p>No image is available for this layer/date/region combination yet.</p>
                  <a href={openWorldviewUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-cyan-200 underline underline-offset-4">Check NASA Worldview directly</a>
                </div>
              )}
              <span className="absolute bottom-3 left-3 border border-white/15 bg-black/75 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-white">NASA GIBS / {layer.name}</span>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">Imagery can be delayed by processing and clouds. True-color layers are optical context, not SAR; select a radar product in NASA Worldview when you need microwave observations.</p>
          </section>
        </div>
      </div>
    </motion.div>
  )
}

function MissionCenterPage() {
  return (
    <motion.div
      key="mission"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="panel p-6">
        <div className="section-title">NISAR Mission Center</div>
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5 text-slate-300">
            <p>
              NASA and ISRO are collaborating on the NISAR mission to measure Earth’s changing surface with repeated radar observations. The mission is designed to study motion, land use, and ecosystems across a wide range of geographies.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <MetricCard label="Agency partnership" value="NASA + ISRO" accent="cyan" />
              <MetricCard label="Radar bands" value="L-band & S-band" accent="violet" />
              <MetricCard label="Mission focus" value="Surface change" accent="blue" />
              <MetricCard label="Coverage" value="Global repeat" accent="teal" />
            </div>
            <div>
              <div className="overline-label">Mission objectives</div>
              <ul className="mt-3 space-y-2 text-sm">
                <li>• Measure Earth deformation and surface motion with high precision.</li>
                <li>• Monitor ecosystem change, soil moisture, and structural shifts.</li>
                <li>• Support climate resilience, hazard monitoring, and land management.</li>
              </ul>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5">
            <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-200">Mission architecture</div>
            <div className="mt-4 space-y-4 text-sm text-slate-300">
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-3"><strong className="text-white">Radar antenna</strong> – Sends and receives microwave energy to build active observations.</div>
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-3"><strong className="text-white">L-band radar</strong> – Penetrates vegetation and captures broader structural information.</div>
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-3"><strong className="text-white">S-band radar</strong> – Provides complementary sensitivity to surface roughness and moisture.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel p-6">
        <div className="section-title">Official resources</div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['NASA mission page', 'https://science.nasa.gov/mission/nisar/'],
            ['NISAR JPL', 'https://nisar.jpl.nasa.gov/'],
            ['ASF data search', 'https://search.asf.alaska.edu/'],
            ['Bhoonidhi portal', 'https://bhoonidhi.nrsc.gov.in/'],
          ].map(([label, url]) => (
            <a key={label} href={url} target="_blank" rel="noreferrer" className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-300 transition hover:border-cyan-400/40 hover:text-white">
              {label}
            </a>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

function RadarSimulatorPage() {
  const [frequency, setFrequency] = useState('L-band')
  const [roughness, setRoughness] = useState(68)
  const [moisture, setMoisture] = useState(54)
  const [vegetation, setVegetation] = useState(46)
  const [angle, setAngle] = useState(35)
  const [surfaceType, setSurfaceType] = useState('Forest')

  const backscatterDb = useMemo(() => {
    const surfaceResponse: Record<string, { baseline: number; roughness: number; moisture: number; vegetation: number; angle: number }> = {
      Water: { baseline: -24, roughness: 8, moisture: 0.5, vegetation: 0.2, angle: 0.15 },
      Forest: { baseline: -11, roughness: 2.5, moisture: 2, vegetation: 6, angle: 0.055 },
      Urban: { baseline: -7, roughness: 1.5, moisture: 1.2, vegetation: 0.8, angle: 0.045 },
      Agriculture: { baseline: -14, roughness: 3, moisture: 6, vegetation: 3, angle: 0.08 },
      'Bare soil': { baseline: -17, roughness: 5, moisture: 7, vegetation: 0.4, angle: 0.12 },
    }
    const response = surfaceResponse[surfaceType] ?? {
      baseline: -11,
      roughness: 2.5,
      moisture: 2,
      vegetation: 6,
      angle: 0.055,
    }
    const lBandAdjustment: Record<string, number> = {
      Water: -0.8,
      Forest: 1.5,
      Urban: -0.3,
      Agriculture: 0.6,
      'Bare soil': 0.3,
    }
    const bandAdjustment = frequency === 'L-band' ? lBandAdjustment[surfaceType] ?? 0 : 0
    const roughnessEffect = ((roughness - 50) / 50) * response.roughness
    const moistureEffect = (moisture / 100) * response.moisture
    const vegetationEffect = (vegetation / 100) * response.vegetation
    const angleEffect = -(angle - 35) * response.angle
    return response.baseline + roughnessEffect + moistureEffect + vegetationEffect + angleEffect + bandAdjustment
  }, [frequency, roughness, moisture, vegetation, angle, surfaceType])

  const relativePower = Math.min(1, 10 ** (backscatterDb / 10))
  const relativePowerPercent = Math.round(relativePower * 100)
  const signalLevel = backscatterDb > -7 ? 'Strong' : backscatterDb > -15 ? 'Moderate' : 'Weak'

  const explanation = useMemo(() => {
    const surfaceExplanation: Record<string, string> = {
      Water: 'Calm water usually reflects energy away from the antenna. Wind roughening can increase the return, while a larger incidence angle generally weakens it.',
      Forest: 'Leaves, branches, and trunks scatter energy through the canopy. L-band can interact with larger vegetation structures; moisture and canopy density also matter.',
      Urban: 'Walls and streets can form corner reflectors that send a strong return toward the sensor. Building orientation makes real urban backscatter highly variable.',
      Agriculture: 'Crop structure and soil moisture change through the growing season. Repeated acquisitions help separate crop development from one-date conditions.',
      'Bare soil': 'Soil moisture and surface roughness are key controls. A wetter or rougher surface often returns more energy, depending on viewing geometry.',
    }
    const bandNote = frequency === 'L-band'
      ? 'L-band has a longer wavelength and can interact with larger vegetation structures.'
      : 'S-band has a shorter wavelength than L-band and responds differently to vegetation and surface structure.'
    return `${surfaceExplanation[surfaceType] ?? surfaceExplanation.Forest} ${bandNote} This simplified model reports relative backscatter in dB; it is for learning, not calibrated or measured satellite data.`
  }, [surfaceType, frequency])

  return (
    <motion.div
      key="radar"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="panel p-6">
        <div className="section-title">Radar Simulation Laboratory</div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">Explore how radar wavelength, surface structure, moisture, and viewing angle affect a backscatter return. This is a conceptual model, not NISAR data.</p>
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-200">Side-view · not to scale</div>
                <div className="mt-2 text-lg font-medium text-white">Transmit, scatter, receive</div>
              </div>
              <button className="button-secondary text-xs" onClick={() => { setFrequency('L-band'); setRoughness(68); setMoisture(54); setVegetation(46); setAngle(35); setSurfaceType('Forest') }}>Reset</button>
            </div>

            <div className="mt-6 rounded-[24px] border border-slate-700 bg-slate-950 p-4">
              <div className={`radar-scene terrain-${surfaceType.toLowerCase().replace(' ', '-')}`} role="img" aria-label={`${frequency} radar sends a pulse to a ${surfaceType.toLowerCase()} surface and receives a ${signalLevel.toLowerCase()} backscatter return`}>
                <div className="radar-grid" />
                <div className="radar-satellite"><Satellite size={25} /><span>SPACEBORNE SAR</span></div>
                <div className="radar-beam" style={{ '--beam-angle': `${31 - (angle - 35) * 0.1}deg` } as CSSProperties} />
                <div className="radar-target-pulse" style={{ opacity: 0.2 + relativePower * 0.8 }} />
                <div className="radar-target" />
                <div className="radar-return-beam" style={{ opacity: 0.25 + relativePower * 0.75 }} />
                <div className="radar-terrain" />
                <div className="radar-ground-label">{surfaceType} · {frequency}</div>
                <div className="radar-return-label">{signalLevel} return · {backscatterDb.toFixed(1)} dB</div>
              </div>
              <div className="mt-4 flex items-center gap-3 text-xs text-slate-400">
                <span className="shrink-0 uppercase tracking-[0.14em]">Relative return</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label="Relative return power" aria-valuemin={0} aria-valuemax={100} aria-valuenow={relativePowerPercent}>
                  <div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: `${relativePowerPercent}%` }} />
                </div>
                <span className="w-12 text-right text-slate-200">{relativePowerPercent}%</span>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <StatCard label="Relative backscatter" value={`${backscatterDb.toFixed(1)} dB`} />
              <StatCard label="Signal level" value={signalLevel} />
              <StatCard label="Incidence angle" value={`${angle}°`} />
              <StatCard label="Surface type" value={surfaceType} />
              <StatCard label="Band" value={frequency} />
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5">
              <div className="overline-label">Simulation controls</div>
              <div className="mt-4 space-y-5">
                <ControlRow label="Radar frequency" value={frequency} options={['L-band', 'S-band']} onChange={setFrequency} />
                <SliderRow label="Surface roughness" value={roughness} onChange={setRoughness} />
                <SliderRow label="Soil moisture" value={moisture} onChange={setMoisture} />
                <SliderRow label="Vegetation density" value={vegetation} onChange={setVegetation} />
                <SliderRow label="Incidence angle" min={15} max={60} value={angle} onChange={setAngle} />
                <ControlRow label="Surface type" value={surfaceType} options={['Water', 'Forest', 'Urban', 'Agriculture', 'Bare soil']} onChange={setSurfaceType} />
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5">
              <div className="overline-label">Scientific explanation</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{explanation}</p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function SarImageLabPage() {
  const scenes = [
    {
      name: 'Seattle, Washington',
      type: 'NISAR · L-band · false-color radar image',
      image: 'https://assets.science.nasa.gov/dynamicimage/assets/science/missions/nisar/1-PIA26670-NISAR_Views_Seattle.jpg?w=1400&h=900&fit=crop&crop=faces%2Cfocalpoint',
      alt: 'False-color NISAR radar view of Seattle, Puget Sound, and Lake Washington.',
      credit: 'NASA / JPL-Caltech',
      source: 'https://science.nasa.gov/mission/nisar/',
      question: 'Which regions in this false-color radar view are water?',
      choices: ['The deep blue regions', 'All bright green regions', 'The thin urban transport lines'],
      answer: 'The deep blue regions',
      explanation: 'Puget Sound and Lake Washington appear deep blue. Radar composites use assigned colors, so this is not a natural-color photograph.',
    },
    {
      name: 'Death Valley, California',
      type: 'SIR-C · spaceborne SAR · radar image',
      image: 'https://earthdata.nasa.gov/s3fs-public/styles/hero_background_745/public/2024-11/sar-hero.jpg?VersionId=08IXOuUcFy18YAvEWy4He36D6i8LClPv&itok=P5JeqHVC',
      alt: 'Color radar image of Death Valley, California, collected by the SIR-C mission.',
      credit: 'NASA Earthdata · SIR-C',
      source: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar',
      question: 'Why can this radar scene be collected at night?',
      choices: ['The instrument transmits its own microwave energy', 'It depends on sunlight reflected from the ground', 'The image only measures cloud temperature'],
      answer: 'The instrument transmits its own microwave energy',
      explanation: 'SAR is an active sensor: it sends microwave pulses and measures the returned signal, so it does not depend on sunlight.',
    },
    {
      name: 'Okmok Volcano, Alaska',
      type: 'ERS-2 · InSAR · deformation fringes',
      image: 'https://earthdata.nasa.gov/s3fs-public/styles/hds_large/public/2024-11/sar-interferometry-okmok-volcano.jpg?VersionId=h4oxvSWUowkSCVMfVsLQsq4LRvUrOqKY&itok=JMujJ3Sr',
      alt: 'ERS-2 interferometric SAR fringes showing surface deformation at Okmok Volcano, Alaska.',
      credit: 'NASA Earthdata · ASF DAAC',
      source: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar#toc-interferometry',
      question: 'In the NASA caption, what does one full color fringe cycle represent?',
      choices: ['2.8 cm of surface movement', '2.8 m of elevation', 'One day of satellite travel'],
      answer: '2.8 cm of surface movement',
      explanation: 'For this Okmok example, each color cycle represents 2.8 cm of ground-surface movement. Fringe interpretation depends on geometry and processing.',
    },
    {
      name: 'Hubbard Glacier · Nov 26, 2025',
      type: 'NISAR · L-band · glacier observation',
      image: 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/iotd/2026/landslide-and-avalanche-debris-litter-hubbard-glacier/hubbardearthquake_nisar_20251126_lrg.jpg',
      alt: 'NASA NISAR radar observation of Hubbard Glacier, Alaska, acquired November 26, 2025.',
      credit: 'NASA / JPL-Caltech · NISAR',
      source: 'https://science.nasa.gov/mission/nisar/',
      question: 'What is needed to measure glacier movement from radar observations?',
      choices: ['Repeat acquisitions and geophysical processing', 'A single image’s display color', 'Visible sunlight measurements only'],
      answer: 'Repeat acquisitions and geophysical processing',
      explanation: 'Motion is estimated by comparing radar observations over time and accounting for acquisition geometry and processing uncertainty.',
    },
    {
      name: 'Hubbard Glacier · Dec 8, 2025',
      type: 'NISAR · L-band · repeat observation',
      image: 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/iotd/2026/landslide-and-avalanche-debris-litter-hubbard-glacier/hubbardearthquake_nisar_20251208_lrg.jpg',
      alt: 'NASA NISAR radar observation of Hubbard Glacier, Alaska, acquired December 8, 2025.',
      credit: 'NASA / JPL-Caltech · NISAR',
      source: 'https://science.nasa.gov/mission/nisar/',
      question: 'Why is a second radar acquisition useful for studying a glacier?',
      choices: ['It allows scientists to compare surface conditions over time', 'It automatically turns radar into a true-color photo', 'It removes the need to know viewing geometry'],
      answer: 'It allows scientists to compare surface conditions over time',
      explanation: 'Repeat observations can reveal change, but interpreting motion requires suitable co-registration, processing, and geometric context.',
    },
    {
      name: 'SAR flight geometry',
      type: 'NASA SAR guide · look direction and ground range',
      image: 'https://earthdata.nasa.gov/s3fs-public/styles/hds_large/public/2024-06/sar-flight-path-geometry_data.png?VersionId=dbdohymUQ2_u..nUI8Q87hG3zxceGANR&itok=VG8uibMt',
      alt: 'Diagram of a left-looking SAR satellite and its observation geometry.',
      credit: 'NASA Earthdata · Scientific SAR User’s Guide',
      source: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar#toc-flight-and-directional-terminology',
      question: 'Which direction is across-track?',
      choices: ['Perpendicular to the satellite flight direction', 'Parallel to the satellite flight direction', 'The direction from Earth to the Sun'],
      answer: 'Perpendicular to the satellite flight direction',
      explanation: 'Across-track (range) is perpendicular to along-track (azimuth), which follows the satellite’s flight direction.',
    },
    {
      name: 'How SAR forms an image',
      type: 'NASA SAR guide · synthetic aperture geometry',
      image: 'https://earthdata.nasa.gov/s3fs-public/styles/hds_large/public/imported/SARticle_first-fig_redone-06.jpg?VersionId=11gBrO_Iu4iytCaQyFr07YjmZJp9OXRn&itok=KDTojCeZ',
      alt: 'NASA diagram showing radar observations of one target from multiple positions along a satellite flight path.',
      credit: 'NASA SAR Handbook · NASA Earthdata',
      source: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar#toc-what-s-synthetic-about-synthetic-aperture-radar',
      question: 'What makes the aperture “synthetic” in SAR?',
      choices: ['Echoes collected from multiple positions are combined', 'The instrument uses a synthetic color palette', 'The antenna changes its physical length in orbit'],
      answer: 'Echoes collected from multiple positions are combined',
      explanation: 'Processing combines echoes collected as the satellite moves to synthesize a much longer antenna and improve resolution.',
    },
    {
      name: 'Microwave bands',
      type: 'NASA SAR guide · wavelength and frequency',
      image: 'https://earthdata.nasa.gov/s3fs-public/styles/hds_large/public/imported/SARticle_microwave_fig-05.jpg?VersionId=IJhPiwT0hV00gAweSEwOeoES6rk239A0&itok=sMm7ureF',
      alt: 'Diagram of the electromagnetic spectrum highlighting microwave radar bands.',
      credit: 'NASA SAR Handbook · NASA Earthdata',
      source: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar#toc-the-roles-of-frequency-and-wavelength',
      question: 'Which microwave bands does NISAR use?',
      choices: ['L-band and S-band', 'Ultraviolet and X-ray', 'Visible red and green'],
      answer: 'L-band and S-band',
      explanation: 'NISAR carries L-band and S-band SAR instruments, which respond to different surface and vegetation properties.',
    },
    {
      name: 'Polarization and scattering',
      type: 'NASA SAR guide · polarimetric response',
      image: 'https://earthdata.nasa.gov/s3fs-public/styles/hds_large/public/2022-02/SARPolarization.jpg?VersionId=KyQ7vrmGXFfSLVdRu6r8oMCEiSy.uiuu&itok=TPctruIs',
      alt: 'NASA diagram illustrating radar polarization and surface scattering responses.',
      credit: 'NASA SAR Handbook · NASA Earthdata',
      source: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar#toc-polarization-and-scattering-mechanisms',
      question: 'What does HH polarization indicate?',
      choices: ['Horizontal transmit and horizontal receive', 'High-frequency transmit and high-frequency receive', 'Horizontal orbit and horizontal ground range'],
      answer: 'Horizontal transmit and horizontal receive',
      explanation: 'The first letter describes transmit polarization and the second describes receive polarization: H means horizontal, V means vertical.',
    },
    {
      name: 'Radar and forest structure',
      type: 'NASA SAR guide · wavelength and vegetation',
      image: 'https://earthdata.nasa.gov/s3fs-public/styles/hds_large/public/imported/SARtree_figure2.jpg?VersionId=39oxzCRneDXVdpdJUtc_MO.Rgwnr4cDd&itok=_u1-xSiS',
      alt: 'NASA diagram comparing how radar wavelengths interact with forest canopy and trunks.',
      credit: 'NASA SAR Handbook · NASA Earthdata',
      source: 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar#toc-polarization-and-scattering-mechanisms',
      question: 'Which wavelength generally interacts more deeply with forest structure?',
      choices: ['Longer L-band wavelengths', 'Visible green light in every condition', 'Shorter wavelengths in every condition'],
      answer: 'Longer L-band wavelengths',
      explanation: 'Longer wavelengths such as L-band can interact more deeply with branches and trunks, though the response also depends on forest structure and conditions.',
    },
  ]
  const [sceneIndex, setSceneIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)
  const [contrast, setContrast] = useState(50)
  const [brightness, setBrightness] = useState(50)
  const [zoom, setZoom] = useState(0)
  const [imageUnavailable, setImageUnavailable] = useState(false)
  const scene = requiredItem(scenes, sceneIndex, 'interpretation scene')

  const selectScene = (index: number) => {
    setSceneIndex(index)
    setSelectedAnswer(null)
    setImageUnavailable(false)
  }

  return (
    <motion.div
      key="sar-lab"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="panel p-6">
        <div className="section-title">SAR image lab · scenes and signal guide</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white">Explore SAR scenes and concepts</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Explore real NASA radar observations and learning figures, adjust their display, then answer a short interpretation question. Display controls do not alter the underlying data.</p>
          </div>
          <span className="border border-cyan-400/30 bg-cyan-400/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-cyan-100">10 NASA learning views · credited</span>
        </div>

        <div className="mt-6 grid overflow-hidden border border-cyan-900/60 bg-[#030b14] xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.5fr)]">
          <div className="relative min-h-[300px] sm:min-h-[420px]" aria-label="Interactive 3D Earth with an orbiting satellite">
            <SatelliteEarthScene />
            <div className="pointer-events-none absolute left-4 top-4 border-l border-cyan-300/60 bg-[#030b14]/70 py-1 pl-3 pr-4 backdrop-blur-sm">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">Earth · orbital view</div>
              <div className="mt-1 text-xs text-slate-300">Drag to rotate · scroll to zoom</div>
            </div>
          </div>
          <aside className="flex flex-col justify-between border-t border-cyan-900/50 p-5 xl:border-l xl:border-t-0 sm:p-7">
            <div>
              <div className="section-title">Earth observation</div>
              <h2 className="mt-3 text-2xl font-semibold text-white">See the planet from orbit.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">Explore a textured Earth with surface detail, moving cloud cover, and an inclined SAR satellite orbit.</p>
              <p className="mt-4 border-l border-slate-600 pl-3 text-xs leading-5 text-slate-400">The 3D orbit is illustrative, not live spacecraft telemetry. NASA Eyes provides live mission tracking.</p>
            </div>
            <a href="https://eyes.nasa.gov/apps/earth/#/" target="_blank" rel="noreferrer" className="button-primary mt-6 w-full gap-2">
              Open NASA Eyes <ArrowRight size={15} />
            </a>
          </aside>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="tablist" aria-label="SAR practice scenes">
          {scenes.map((item, index) => (
            <button key={item.name} role="tab" aria-selected={sceneIndex === index} onClick={() => selectScene(index)} className={`min-h-16 border px-3 py-2 text-left text-sm transition ${sceneIndex === index ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-100' : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500'}`}>
              <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-400">View {String(index + 1).padStart(2, '0')} / 10</span>
              <span className="mt-1 block">{item.name}</span>
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <section className="min-w-0 border border-slate-700 bg-[#050b13] p-3 sm:p-4" aria-label={`${scene.name} image viewer`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-medium text-white">{scene.name}</h2>
                <div className="mt-1 text-xs uppercase tracking-[0.13em] text-cyan-200">{scene.type}</div>
              </div>
              <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">NASA source material · credited</span>
            </div>
            <figure className="mt-3">
              <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-black">
                {!imageUnavailable ? (
                  <img src={scene.image} alt={scene.alt} className="h-full w-full object-contain transition-transform duration-200" style={{ filter: `brightness(${0.6 + brightness / 100}) contrast(${0.6 + contrast / 100})`, transform: `scale(${1 + zoom / 100})` }} onError={() => setImageUnavailable(true)} />
                ) : (
                  <div className="p-6 text-center text-sm text-slate-300"><p>NASA image could not be loaded from the source right now.</p><a href={scene.source} target="_blank" rel="noreferrer" className="mt-3 inline-block text-cyan-200 underline underline-offset-4">Open NASA source</a></div>
                )}
                <span className="absolute left-3 top-3 border border-white/15 bg-black/70 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-white">{scene.type}</span>
              </div>
              <figcaption className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-400"><span>{scene.alt}</span><span>{scene.credit}</span></figcaption>
            </figure>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <SliderRow label="Display brightness" value={brightness} onChange={setBrightness} />
              <SliderRow label="Display contrast" value={contrast} onChange={setContrast} />
              <SliderRow label="Zoom" value={zoom} onChange={setZoom} max={60} />
            </div>
            <a href={scene.source} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-cyan-200 underline decoration-cyan-500/40 underline-offset-4 hover:text-white">NASA source and image context ↗</a>
          </section>

          <section className="border border-slate-700 bg-slate-900/50 p-5" aria-label="Image interpretation exercise">
            <div className="text-[10px] uppercase tracking-[0.17em] text-cyan-200">Field interpretation · {sceneIndex + 1} / {scenes.length}</div>
            <h2 className="mt-3 text-xl font-medium text-white">What do you see?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">{scene.question}</p>
            <div className="mt-5 space-y-2">
              {scene.choices.map((choice) => {
                const isCorrect = choice === scene.answer
                const isSelected = selectedAnswer === choice
                const answeredCorrectly = selectedAnswer === scene.answer
                return (
                  <button key={choice} disabled={answeredCorrectly} onClick={() => setSelectedAnswer(choice)} className={`w-full border p-3 text-left text-sm transition ${answeredCorrectly && isCorrect ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100' : isSelected && !isCorrect ? 'border-rose-500/50 bg-rose-500/10 text-rose-100' : 'border-slate-700 bg-slate-950/70 text-slate-200 hover:border-cyan-400/50'}`}>
                    {choice}
                  </button>
                )
              })}
            </div>
            {selectedAnswer && <p className={`mt-4 border-l-2 pl-3 text-sm leading-6 ${selectedAnswer === scene.answer ? 'border-emerald-400 text-emerald-100' : 'border-amber-300 text-amber-100'}`}>{selectedAnswer === scene.answer ? `Correct. ${scene.explanation}` : `Not quite. Try another answer. ${scene.explanation}`}</p>}
            <div className="mt-6 border-t border-slate-800 pt-4">
              <div className="text-[10px] uppercase tracking-[0.15em] text-slate-400">Reading method</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">Check the product type and legend first. Interpret brightness, color, or fringes in the context of the sensor and processing; display colors are not automatically land-cover classes.</p>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  )
}

function NasaEyesPage() {
  return (
    <motion.div
      key="nasa-eyes"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="section-title">NASA · Earth observing system</div>
          <h1 className="mt-2 text-3xl font-semibold text-white">Eyes on the Earth</h1>
          <p className="mt-2 text-sm text-slate-300">Explore NASA’s live Earth data, current events, and satellite missions.</p>
        </div>
        <a href="https://eyes.nasa.gov/apps/earth/#/" target="_blank" rel="noreferrer" className="button-primary gap-2">
          Open in new tab <ArrowRight size={15} />
        </a>
      </div>
      <div className="overflow-hidden border border-cyan-900/60 bg-[#02070d] shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
        <iframe
          title="NASA Eyes on the Earth interactive globe and satellite tracker"
          src="https://eyes.nasa.gov/apps/earth/#/"
          allow="accelerometer; autoplay; gyroscope"
          allowFullScreen
          className="block h-[calc(100dvh-230px)] min-h-[480px] w-full bg-[#02070d]"
        />
      </div>
      <p className="text-xs text-slate-500">NASA Eyes is an external NASA application. If the embedded globe is unavailable, use “Open in new tab”.</p>
    </motion.div>
  )
}

function worldviewSnapshotUrl(date: string, bbox: string, layer = 'MODIS_Terra_CorrectedReflectance_TrueColor') {
  const params = new URLSearchParams({
    REQUEST: 'GetSnapshot',
    TIME: `${date}T00:00:00Z`,
    BBOX: bbox,
    CRS: 'EPSG:4326',
    LAYERS: layer,
    FORMAT: 'image/jpeg',
    WIDTH: '1200',
    HEIGHT: '700',
    AUTOSCALE: 'TRUE',
  })
  return `https://wvs.earthdata.nasa.gov/api/v1/snapshot?${params.toString()}`
}

function worldviewMapUrl(date: string, latitudeFirstBounds: string) {
  const [south, west, north, east] = latitudeFirstBounds.split(',')
  return `https://worldview.earthdata.nasa.gov/?v=${west},${south},${east},${north}&t=${date}`
}

function ChangeDetectionPage() {
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const studies = [
    { title: 'Maui wildfire', region: 'Hawaii, USA', summary: 'Compare landscape context around the August 2023 Maui fires.', impact: 'Wildfire impacts vegetation, infrastructure, and slope stability.', task: 'Look for broad surface patterns that differ between the dates. Clouds and smoke can obscure optical imagery.', bbox: '20.4,-157.2,21.3,-155.8', before: '2023-08-05', after: '2023-08-12' },
    { title: 'Mumbai monsoon', region: 'Maharashtra, India', summary: 'Inspect optical context around the Mumbai monsoon season.', impact: 'Flooding affects transport, housing, and coastal infrastructure.', task: 'Check whether clouds limit what can be concluded. SAR is often more useful for flood mapping during cloudy weather.', bbox: '18.7,72.2,19.5,73.4', before: '2023-07-20', after: '2023-07-27' },
    { title: 'Amazon dry season', region: 'Amazonas, Brazil', summary: 'Compare seasonal conditions in a forest and river landscape.', impact: 'Forest loss affects habitat, carbon storage, and water cycling.', task: 'Separate seasonal color changes from actual land-cover change. Optical color alone does not confirm deforestation.', bbox: '-4,-61,-2,-59', before: '2023-08-01', after: '2023-08-15' },
    { title: 'Iceland eruption region', region: 'Reykjanes Peninsula, Iceland', summary: 'Inspect a volcanic landscape before and after the January 2024 eruption.', impact: 'Lava flows and volcanic hazards can alter land and threaten nearby communities.', task: 'Identify new dark or textured flow areas, then check the dates and cloud cover.', bbox: '63.7,-23.3,64.3,-21.5', before: '2024-01-10', after: '2024-01-20' },
    { title: 'Himalayan glaciers', region: 'Nepal Himalaya', summary: 'Compare seasonal optical context around high mountain ice.', impact: 'Glacier change influences downstream water resources and geohazard risk.', task: 'Look for seasonal snow differences, but do not infer glacier velocity from two color images.', bbox: '27.5,83,29,85', before: '2023-10-01', after: '2023-11-01' },
    { title: 'Agriculture near the Nile', region: 'Nile Delta, Egypt', summary: 'Compare agricultural and water patterns across two observations.', impact: 'Crop and water conditions support food and resource planning.', task: 'Track field and shoreline patterns while accounting for season and acquisition date.', bbox: '30.5,30.2,31.5,31.8', before: '2023-06-01', after: '2023-07-01' },
  ]
  const [selectedCase, setSelectedCase] = useState(0)
  const [beforeAfter, setBeforeAfter] = useState(50)
  const initialStudy = requiredItem(studies, 0, 'change-detection study')
  const [beforeDate, setBeforeDate] = useState(initialStudy.before)
  const [afterDate, setAfterDate] = useState(initialStudy.after)
  const [imagesUnavailable, setImagesUnavailable] = useState(false)
  const caseStudy = requiredItem(studies, selectedCase, 'selected change-detection study')
  const beforeImage = worldviewSnapshotUrl(beforeDate, caseStudy.bbox)
  const afterImage = worldviewSnapshotUrl(afterDate, caseStudy.bbox)

  const selectStudy = (index: number) => {
    const study = requiredItem(studies, index, 'change-detection study')
    setSelectedCase(index)
    setBeforeDate(study.before)
    setAfterDate(study.after)
    setBeforeAfter(50)
    setImagesUnavailable(false)
  }

  return (
    <motion.div key="change" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.35 }} className="space-y-6">
      <div className="panel p-6">
        <div className="section-title">NASA Worldview · satellite change lab</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-white">Compare satellite observations</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Load NASA MODIS true-color snapshots for the same region on two dates, then inspect differences with the wipe control.</p>
          </div>
          <a href="https://worldview.earthdata.nasa.gov/" target="_blank" rel="noreferrer" className="border border-cyan-400/40 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-400/10">Open NASA Worldview ↗</a>
        </div>
        <p className="mt-4 border-l-2 border-amber-300/70 pl-3 text-xs leading-5 text-amber-100">This viewer uses optical MODIS imagery for broad context. Clouds and smoke may hide the surface; these images are not SAR data or calibrated radar change measurements.</p>

        <div className="mt-6 grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-2">
            {studies.map((item, index) => (
              <button key={item.title} onClick={() => selectStudy(index)} className={`w-full border p-3 text-left transition ${selectedCase === index ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-slate-700 bg-slate-900/60 hover:border-slate-600'}`}>
                <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-400">{item.region}</span>
                <span className="mt-1 block text-sm font-medium text-white">{item.title}</span>
              </button>
            ))}
          </div>

          <section className="min-w-0 border border-slate-700 bg-slate-900/60 p-4 sm:p-5">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-200">Study area · {caseStudy.region}</div>
              <h2 className="mt-1 text-xl font-medium text-white">{caseStudy.title}</h2>
              <p className="mt-2 text-sm text-slate-300">{caseStudy.summary}</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-400">Before date
                <input type="date" value={beforeDate} max={afterDate} onChange={(event) => { setBeforeDate(event.target.value); setImagesUnavailable(false) }} className="mt-1 block w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs text-slate-400">After date
                <input type="date" value={afterDate} min={beforeDate} max={today} onChange={(event) => { setAfterDate(event.target.value); setImagesUnavailable(false) }} className="mt-1 block w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              </label>
            </div>

            <div className="mt-4">
              {imagesUnavailable ? (
                <div className="flex aspect-video items-center justify-center border border-slate-700 bg-black p-6 text-center text-sm text-slate-300">NASA Worldview could not return an image for these dates. Try other dates or open the region in Worldview.</div>
              ) : (
                <div className="before-after-slider relative aspect-video" aria-label={`NASA satellite image comparison, ${beforeDate} and ${afterDate}`}>
                  <img src={beforeImage} alt={`NASA MODIS true-color image on ${beforeDate}`} onError={() => setImagesUnavailable(true)} className="absolute inset-0 h-full w-full object-cover" />
                  <img src={afterImage} alt={`NASA MODIS true-color image on ${afterDate}`} onError={() => setImagesUnavailable(true)} className="absolute inset-0 h-full w-full object-cover" style={{ clipPath: `inset(0 0 0 ${beforeAfter}%)` }} />
                  <span className="absolute left-3 top-3 border border-white/20 bg-black/75 px-2 py-1 text-xs text-white">{beforeDate}</span>
                  <span className="absolute right-3 top-3 border border-white/20 bg-black/75 px-2 py-1 text-xs text-white">{afterDate}</span>
                  <div className="slider-handle" style={{ left: `${beforeAfter}%` }} />
                </div>
              )}
              <label className="mt-3 block text-xs text-slate-400">Wipe comparison · drag to reveal the after image
                <input aria-label="Before and after image wipe" className="mt-2 w-full accent-cyan-300" type="range" min={0} max={100} value={beforeAfter} onChange={(event) => setBeforeAfter(Number(event.target.value))} />
              </label>
              <div className="mt-2 text-[10px] uppercase tracking-[0.13em] text-slate-500">Source: NASA GIBS / MODIS Terra Corrected Reflectance · true color</div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div><div className="overline-label">Environmental context</div><p className="mt-2 text-sm leading-6 text-slate-300">{caseStudy.impact}</p></div>
              <div><div className="overline-label">Investigation task</div><p className="mt-2 text-sm leading-6 text-slate-300">{caseStudy.task}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <a href={worldviewMapUrl(afterDate, caseStudy.bbox)} target="_blank" rel="noreferrer" className="text-cyan-200 underline underline-offset-4">Open region in NASA Worldview ↗</a>
              <a href="https://www.earthdata.nasa.gov/learn/backgrounders/what-is-sar" target="_blank" rel="noreferrer" className="text-slate-300 underline underline-offset-4">How SAR helps when optical imagery is cloudy ↗</a>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  )
}

function InSARPage() {
  const [displacement, setDisplacement] = useState(22)
  const [coherence, setCoherence] = useState(68)
  const coherenceLabel = coherence >= 70 ? 'Good phase quality' : coherence >= 40 ? 'Mixed phase quality' : 'Low phase quality'
  const fringeSpacing = 5 + displacement / 12

  return (
    <motion.div
      key="insar"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="panel p-6">
        <div className="section-title">InSAR Laboratory</div>
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[30px] border border-slate-700 bg-slate-900/80 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-200">Simulated interferogram</div>
                <div className="mt-2 text-lg font-medium text-white">Phase differences and displacement</div>
              </div>
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-200">Synthetic</span>
            </div>
            <div
              className="interferogram"
              role="img"
              aria-label={`Synthetic interferogram with ${displacement} millimeters of line-of-sight displacement and ${coherence} percent coherence`}
              style={{
                background: `radial-gradient(circle at center, rgba(34,211,238,${0.04 + coherence / 700}), rgba(15,23,42,0.65) 58%), repeating-radial-gradient(circle at center, rgba(34,211,238,${0.08 + coherence / 400}) 0 ${fringeSpacing}px, rgba(15,23,42,0.9) ${fringeSpacing + 1}px ${fringeSpacing * 2}px)`,
              }}
            >
              <div className="interferogram-wave" style={{ transform: `scale(${0.8 + displacement / 60})`, opacity: coherence / 100 }} />
              <div className="interferogram-noise" style={{ opacity: (100 - coherence) / 180 }} />
              <div className="absolute bottom-3 left-3 border border-white/10 bg-black/70 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-200">{coherenceLabel}</div>
              <div className="absolute bottom-3 right-3 border border-white/10 bg-black/70 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-100">{displacement} mm · illustrative</div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">Synthetic teaching pattern only. Real interferograms depend on acquisition geometry, topography, atmosphere, processing, and reference choice.</p>
          </div>

          <div className="space-y-5">
            <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5">
              <div className="overline-label">Observation controls</div>
              <div className="mt-4 space-y-5">
                <SliderRow label="Line-of-sight displacement (mm)" min={0} max={60} value={displacement} onChange={setDisplacement} />
                <SliderRow label="Coherence (%)" value={coherence} onChange={setCoherence} />
                <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-sm">
                  <span className="text-slate-400">Phase quality</span>
                  <span className={coherence >= 70 ? 'text-emerald-300' : coherence >= 40 ? 'text-amber-200' : 'text-rose-300'}>{coherenceLabel}</span>
                </div>
              </div>
            </div>
            <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5">
              <div className="overline-label">Scientific explanation</div>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                <p>{coherence >= 40 ? 'The phase pattern is visible at this coherence. ' : 'Low coherence obscures the phase pattern, so displacement interpretation is unreliable. '}An interferogram compares phase from two SAR acquisitions; phase is not displacement without geometry and processing.</p>
                <p>Increasing the synthetic displacement changes the fringe pattern. Coherence describes how consistently the radar signal returns between acquisitions, and can decrease over vegetation, water, or changing surfaces.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function ScientificMissionsPage() {
  return (
    <motion.div
      key="missions"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="panel p-6">
        <div className="section-title">Scientific Missions</div>
        <div className="mt-6 grid gap-5">
          {missionDeck.map((mission) => (
            <div key={mission.title} className="rounded-[24px] border border-slate-700 bg-slate-900/80 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-200">{mission.badge}</div>
                  <h3 className="mt-2 text-2xl font-medium text-white">{mission.title}</h3>
                </div>
                <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">Score {mission.score}</div>
              </div>
              <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <div>
                    <div className="overline-label">Mission briefing</div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{mission.challenge}</p>
                  </div>
                  <div>
                    <div className="overline-label">Evidence</div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{mission.evidence}</p>
                  </div>
                </div>
                <div>
                  <div className="overline-label">Investigation tools</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {mission.tools.map((tool) => (
                      <span key={tool} className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-300">{tool}</span>
                    ))}
                  </div>
                  <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                    Final report: evidence supports targeted intervention planning and continued monitoring.
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

function QuizArenaPage() {
  const [index, setIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)
  const [score, setScore] = useState(0)
  const [completed, setCompleted] = useState(false)
  const { setProgress } = useStudentProgress()

  const question = requiredItem(quizQuestions, index, 'quiz question')

  const handleAnswer = (option: string) => {
    if (selectedAnswer) return
    setSelectedAnswer(option)
    if (option === question.correct) {
      setScore((current) => current + 1)
    }
  }

  const handleNext = () => {
    if (index === quizQuestions.length - 1) {
      setCompleted(true)
      setProgress((current) => {
        const xp = current.xp + score * 120
        const badges = score >= 3 && !current.badges.includes('SAR Decoder')
          ? [...current.badges, 'SAR Decoder']
          : current.badges
        return { ...current, xp, level: Math.floor(xp / 500) + 1, badges }
      })
      return
    }
    setIndex((current) => current + 1)
    setSelectedAnswer(null)
  }

  const statusMessage = selectedAnswer
    ? selectedAnswer === question.correct
      ? 'Correct answer — good reasoning.'
      : `Not quite. ${question.explanation}`
    : 'Choose the best answer.'

  return (
    <motion.div
      key="quiz"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="panel p-6">
        <div className="section-title">Quiz Arena</div>
        {!completed ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.9fr]">
            <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                <span>Question {index + 1}/{quizQuestions.length}</span>
                <span>Score {score}</span>
              </div>
              <h3 className="mt-4 text-2xl font-medium text-white">{question.prompt}</h3>
              <div className="mt-5 space-y-3">
                {question.options.map((option) => {
                  const isCorrect = option === question.correct
                  const isSelected = option === selectedAnswer
                  const reveal = selectedAnswer !== null

                  return (
                    <button
                      key={option}
                      onClick={() => handleAnswer(option)}
                      className={`w-full rounded-2xl border p-3 text-left text-sm transition ${
                        reveal && isCorrect
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                          : reveal && isSelected && !isCorrect
                          ? 'border-rose-500/40 bg-rose-500/10 text-rose-100'
                          : 'border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-600'
                      }`}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
              <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-300">{statusMessage}</div>
              {selectedAnswer && (
                <div className="mt-5 flex justify-end">
                  <button className="button-primary" onClick={handleNext}>
                    {index === quizQuestions.length - 1 ? 'View results' : 'Next question'}
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5">
              <div className="overline-label">Progress</div>
              <div className="mt-5 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={quizQuestions.map((_, i) => ({ name: `Q${i + 1}`, value: i < index ? 100 : i === index ? 50 : 0 }))}>
                    <Line type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={3} dot={{ r: 4 }} />
                    <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-[28px] border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
            <div className="text-[10px] uppercase tracking-[0.22em] text-emerald-200">Mission complete</div>
            <h3 className="mt-3 text-3xl font-semibold text-white">Final score: {score}/{quizQuestions.length}</h3>
            <p className="mt-3 text-slate-200">
              You earned {score * 120} XP{score >= 3 ? ' and unlocked the SAR Decoder badge.' : '. Score at least 3 to unlock the SAR Decoder badge.'}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function AchievementsPage() {
  const { progress } = useStudentProgress()

  return (
    <motion.div
      key="achievements"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="panel p-6">
        <div className="section-title">Achievements</div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {badgeData.map((badge) => (
            <div key={badge.name} className={`rounded-[24px] border p-5 ${progress.badges.includes(badge.name) ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-700 bg-slate-900/80 opacity-70'}`}>
              <div className="mb-4 inline-flex rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-2 text-cyan-300"><Award size={18} /></div>
              <h3 className="text-xl font-medium text-white">{badge.name}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{badge.description}</p>
              <p className="mt-4 text-xs text-slate-400">{progress.badges.includes(badge.name) ? 'Unlocked' : 'Locked'}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

function ProgressPage() {
  const { progress } = useStudentProgress()
  const completedChapters = curriculum.reduce((count, level) => count + level.chapters.filter((chapter) => progress.completedChapters.includes(chapter.id)).length, 0)

  return (
    <motion.div key="progress" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.35 }} className="space-y-6">
      <div className="panel p-6">
        <div className="section-title">Student Dashboard</div>
        <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/10 text-xl font-bold text-cyan-200">{progress.profileName.slice(0, 1).toUpperCase()}</div>
              <div><div className="text-lg font-medium text-white">{progress.profileName}</div><div className="text-sm text-slate-400">Guest practice profile · saved in this browser</div></div>
            </div>
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between"><span className="text-sm text-slate-300">Level</span><span className="text-sm font-medium text-cyan-200">{progress.level}</span></div>
              <div className="flex items-center justify-between"><span className="text-sm text-slate-300">XP</span><span className="text-sm font-medium text-cyan-200">{progress.xp}</span></div>
              <div className="flex items-center justify-between"><span className="text-sm text-slate-300">Learning streak</span><span className="text-sm font-medium text-cyan-200">{progress.streak} days</span></div>
              <div className="flex items-center justify-between"><span className="text-sm text-slate-300">Chapters completed</span><span className="text-sm font-medium text-cyan-200">{completedChapters}/25</span></div>
            </div>
          </div>
          <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5">
            <div className="overline-label">Course progress by level</div>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={curriculum.map((level) => ({ name: `L${level.id}`, value: Math.round(level.chapters.filter((chapter) => progress.completedChapters.includes(chapter.id)).length / level.chapters.length * 100) }))}>
                  <defs><linearGradient id="progressFill" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="#22d3ee" stopOpacity={0.8} /><stop offset="95%" stopColor="#22d3ee" stopOpacity={0.1} /></linearGradient></defs>
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} />
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="value" stroke="#22d3ee" fill="url(#progressFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {progress.badges.map((badge) => <div key={badge} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-200">{badge}</div>)}
        </div>
      </div>
    </motion.div>
  )
}

function latLonToVector3(latitude: number, longitude: number, radius: number) {
  const phi = (90 - latitude) * (Math.PI / 180)
  const theta = (longitude + 180) * (Math.PI / 180)
  return [
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ] as [number, number, number]
}

function EarthModel({ location }: { location?: LocationEntry | undefined }) {
  const groupRef = useRef<THREE.Group>(null)
  const [earthMap, normalMap, cloudMap] = useTexture([
    'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',
    'https://threejs.org/examples/textures/planets/earth_normal_2048.jpg',
    'https://threejs.org/examples/textures/planets/earth_clouds_1024.png',
  ])

  useEffect(() => {
    if (!groupRef.current || !location) return
    const [x, , z] = latLonToVector3(location.latitude, location.longitude, 1)
    groupRef.current.rotation.y = Math.atan2(-x, z)
  }, [location])

  useFrame((state) => {
    if (!groupRef.current || location) return
    groupRef.current.rotation.y = state.clock.elapsedTime * 0.18
  })

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[1.7, 128, 128]} />
        <meshStandardMaterial map={earthMap ?? null} normalMap={normalMap ?? null} color="#ffffff" emissive="#10253a" emissiveIntensity={0.22} roughness={0.92} metalness={0} />
      </mesh>
      <mesh scale={1.02}>
        <sphereGeometry args={[1.71, 128, 128]} />
        <meshStandardMaterial map={cloudMap ?? null} transparent opacity={0.38} depthWrite={false} />
      </mesh>
      <mesh scale={1.035}>
        <sphereGeometry args={[1.7, 64, 64]} />
        <meshBasicMaterial color="#7dd3fc" side={THREE.BackSide} transparent opacity={0.15} />
      </mesh>
      {location && (
        <mesh position={latLonToVector3(location.latitude, location.longitude, 1.85)}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={1.2} />
        </mesh>
      )}
    </group>
  )
}

function IntroSatellite({ orbitRadius = 2.85, centerX = 1.05, satelliteScale = 1 }: { orbitRadius?: number; centerX?: number; satelliteScale?: number } = {}) {
  const satelliteRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (!satelliteRef.current) return
    const phase = state.clock.elapsedTime * 0.22 + 0.8
    satelliteRef.current.position.set(centerX + Math.cos(phase) * orbitRadius, Math.sin(phase) * orbitRadius * 0.28, Math.sin(phase) * orbitRadius * 0.96)
    satelliteRef.current.rotation.set(0.16 + Math.sin(phase) * 0.08, -phase - 0.5, 0.12)
  })

  return (
    <group ref={satelliteRef} scale={satelliteScale}>
      <mesh>
        <boxGeometry args={[0.26, 0.18, 0.22]} />
        <meshStandardMaterial color="#d9edf0" metalness={0.75} roughness={0.28} emissive="#174e63" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[-0.34, 0, 0]}>
        <boxGeometry args={[0.42, 0.035, 0.24]} />
        <meshStandardMaterial color="#087f9d" metalness={0.35} roughness={0.4} emissive="#0b536a" emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[0.34, 0, 0]}>
        <boxGeometry args={[0.42, 0.035, 0.24]} />
        <meshStandardMaterial color="#087f9d" metalness={0.35} roughness={0.4} emissive="#0b536a" emissiveIntensity={0.5} />
      </mesh>
      {[-0.34, 0.34].flatMap((side) => [-0.08, 0, 0.08].map((offset) => (
        <mesh key={`${side}-${offset}`} position={[side, offset, 0.125]}>
          <boxGeometry args={[0.39, 0.006, 0.006]} />
          <meshBasicMaterial color="#56d9ef" />
        </mesh>
      )))}
      <mesh position={[0, 0, 0.17]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.32, 12]} />
        <meshStandardMaterial color="#f0c66a" emissive="#b87a23" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.34]} rotation={[Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial color="#c9d7dc" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  )
}

function IntroRadarPulse() {
  const pulseRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!pulseRef.current) return
    const phase = (state.clock.elapsedTime % 2.4) / 2.4
    pulseRef.current.scale.setScalar(1 + phase * 44)
    const material = pulseRef.current.material as THREE.MeshBasicMaterial
    material.opacity = (1 - phase) * 0.5
  })

  return (
    <mesh ref={pulseRef} position={[1.05, -0.15, 1.82]}>
      <ringGeometry args={[0.025, 0.032, 64]} />
      <meshBasicMaterial color="#67e8f9" side={THREE.DoubleSide} transparent opacity={0.62} depthWrite={false} />
    </mesh>
  )
}

function IntroCameraMove({ compositionRef }: { compositionRef: React.RefObject<THREE.Group | null> }) {
  const { size } = useThree()

  useFrame((state) => {
    const portrait = size.width / size.height < 0.9
    const progress = THREE.MathUtils.smoothstep(state.clock.elapsedTime, 0, 9)
    compositionRef.current?.position.set(portrait ? -1.05 : 0, portrait ? 0.65 : 0, 0)
    state.camera.position.set(0, 0.05, THREE.MathUtils.lerp(portrait ? 9.6 : 8, portrait ? 9.2 : 7.4, progress))
    state.camera.lookAt(0, 0, 0)
  })

  return null
}

function IntroScene() {
  const compositionRef = useRef<THREE.Group>(null)

  return (
    <Canvas camera={{ position: [0, 0, 8], fov: 42 }} dpr={[1, 1.5]}>
      <color attach="background" args={['#02070d']} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[4, 3, 5]} intensity={2} color="#d9f7ff" />
      <pointLight position={[-4, -2, -3]} intensity={28} color="#0ba9c4" />
      <Stars radius={70} depth={45} count={2600} factor={4} saturation={0.25} fade speed={0.35} />
      <group ref={compositionRef}>
        <mesh position={[1.05, 0, 0]} rotation={[0.88, 0.2, 0.48]}>
          <torusGeometry args={[2.55, 0.012, 8, 160]} />
          <meshBasicMaterial color="#3dd6e8" transparent opacity={0.55} />
        </mesh>
        <group position={[1.05, 0, 0]} scale={1.28}>
          <EarthModel />
        </group>
        <IntroSatellite />
        <IntroRadarPulse />
      </group>
      <IntroCameraMove compositionRef={compositionRef} />
    </Canvas>
  )
}

function EarthScene({ location }: { location?: LocationEntry }) {
  return (
    <Canvas camera={{ position: [0, 0, 5.8], fov: 42 }}>
      <color attach="background" args={['#020817']} />
      <ambientLight intensity={1.5} />
      <directionalLight position={[5, 3, 5]} intensity={1.3} />
      <Stars radius={60} depth={30} count={4000} factor={4} saturation={0} fade speed={1} />
      <EarthModel location={location} />
      <OrbitControls enablePan enableZoom autoRotate={false} minDistance={4} maxDistance={9} />
    </Canvas>
  )
}

function SatelliteEarthScene() {
  return (
    <Canvas camera={{ position: [0, 0, 6.5], fov: 42 }} dpr={[1, 1.5]}>
      <color attach="background" args={['#02070d']} />
      <ambientLight intensity={1.05} />
      <directionalLight position={[4, 3, 5]} intensity={2.2} color="#e4f7ff" />
      <pointLight position={[-4, -2, -3]} intensity={18} color="#087ca3" />
      <Stars radius={70} depth={45} count={1800} factor={3} saturation={0.2} fade speed={0.2} />
      <mesh rotation={[Math.PI / 2 - 0.28, 0, 0]}>
        <torusGeometry args={[2.45, 0.009, 8, 160]} />
        <meshBasicMaterial color="#43c9e8" transparent opacity={0.48} />
      </mesh>
      <EarthModel />
      <IntroSatellite orbitRadius={2.45} centerX={0} satelliteScale={0.8} />
      <OrbitControls enablePan={false} enableDamping dampingFactor={0.06} minDistance={4.4} maxDistance={10} />
    </Canvas>
  )
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent: 'cyan' | 'violet' | 'blue' | 'teal' }) {
  const accentClasses = {
    cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
    teal: 'border-teal-500/30 bg-teal-500/10 text-teal-200',
  }

  return (
    <div className={`rounded-2xl border p-4 ${accentClasses[accent]}`}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-300">{label}</div>
      <div className="mt-2 text-lg font-medium text-white">{value}</div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950 p-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-2 text-base font-medium text-white">{value}</div>
    </div>
  )
}

function InfoPill({ icon: Icon, label }: { icon: IconType; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-200">
      <Icon size={14} className="text-cyan-300" />
      <span>{label}</span>
    </div>
  )
}

function ControlRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
        <span>{label}</span>
        <span className="text-cyan-200">{value}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${value === option ? 'border-cyan-400/60 bg-cyan-500/10 text-cyan-100' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'}`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

function SliderRow({ label, value, onChange, min = 0, max = 100 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
        <span>{label}</span>
        <span className="text-cyan-200">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="slider-input w-full"
      />
    </div>
  )
}

export default App
