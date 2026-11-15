export const INTRO_DURATION = 9_500;
export const SCENES = [
  { start: 0, end: 1400, id: 'unknown', name: '' },
  { start: 1400, end: 2800, id: 'earth', name: '' },
  { start: 2800, end: 4200, id: 'radar', name: '' },
  { start: 4200, end: 5500, id: 'flood', name: '' },
  { start: 5500, end: 6500, id: 'wetland', name: '' },
  { start: 6500, end: 7600, id: 'surface', name: '' },
  { start: 7600, end: 9500, id: 'initialize', name: "THIRD EYE" },
] as const;
export const CREW = [
  { id: 'nishit', name: 'NISHIT' },
  { id: 'nikhil', name: 'NIKHIL (RAVANA)' },
  { id: 'saunak', name: 'SAUNAK' },
  { id: 'srayan', name: 'SRAYAN' },
  { id: 'soham', name: 'SOHAM' },
] as const;
export function sceneAt(ms: number) {
  return SCENES.findIndex((scene) => ms >= scene.start && ms < scene.end);
}
export function introFinished(ms: number) { return ms >= INTRO_DURATION; }