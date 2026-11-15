import { describe, expect, it } from 'vitest';
import { INTRO_DURATION, SCENES, sceneAt, introFinished } from './timeline';

describe('Requested cinematic timing', () => {
  it('finishes under ten seconds and enters the home handoff scene', () => {
    expect(INTRO_DURATION).toBe(9500);
    expect(INTRO_DURATION).toBeLessThan(10000);
    expect(introFinished(INTRO_DURATION - 1)).toBe(false);
    expect(introFinished(INTRO_DURATION)).toBe(true);
    expect(sceneAt(INTRO_DURATION)).toBe(-1);
    expect(SCENES[SCENES.length - 1]?.id).toBe('initialize');
  });
  for (const [id,start,end] of [['unknown',0,1400],['earth',1400,2800],['radar',2800,4200],['flood',4200,5500],['wetland',5500,6500],['surface',6500,7600],['initialize',7600,9500]] as const) {
    it(`${id} occupies its exact requested boundary`, () => {
      expect(SCENES[sceneAt(start)]?.id).toBe(id);
      expect(SCENES[sceneAt(end-1)]?.id).toBe(id);
      expect(SCENES[sceneAt(end)]?.id).not.toBe(id);
    });
  }
});