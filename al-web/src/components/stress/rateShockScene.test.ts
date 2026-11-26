import { describe, expect, it } from 'vitest';
import { heightOf, towerLabelText } from './rateShockScene';

describe('the rate shock tower label', () => {
  it('shows the real debt to income above the height cap, not the capped height', () => {
    expect(heightOf(120)).toBe(heightOf(90));
    expect(towerLabelText(120, heightOf(120), heightOf(120))).toBe('120.0%');
  });

  it('shows the real debt to income for a tower under the cap', () => {
    expect(towerLabelText(46.25, heightOf(46.25), heightOf(46.25))).toBe('46.3%');
  });

  it('counts with the height while the tower is still growing', () => {
    expect(towerLabelText(120, heightOf(40), heightOf(120))).toBe('40.0%');
  });

  it('is empty for a tower with no current figure', () => {
    expect(towerLabelText(null, heightOf(40), heightOf(40))).toBe('');
  });
});
