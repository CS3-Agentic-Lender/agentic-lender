import { describe, expect, it } from 'vitest';
import { heightOf, towerLabelText } from './housePriceScene';
import { ltvBand } from './HousePriceStage';

describe('house price tower figures', () => {
  it('caps extreme tower heights while keeping the true label to two decimal places', () => {
    expect(heightOf(220.25)).toBe(heightOf(160));
    expect(towerLabelText(220.25, heightOf(220.25), heightOf(220.25))).toBe('220.25%');
  });
  it('preserves a value just above 90 instead of labelling it exactly 90', () => {
    expect(towerLabelText(90.01, heightOf(90.01), heightOf(90.01))).toBe('90.01%');
  });
  it('animates from the starting height and clears failed figures', () => {
    expect(towerLabelText(100, heightOf(80), heightOf(100))).toBe('80.00%');
    expect(towerLabelText(null, heightOf(80), heightOf(80))).toBe('');
  });
  it.each([
    [{ ltv_pct: 80, above_80: false, above_90: false }, 'Comfortable'],
    [{ ltv_pct: 80.01, above_80: true, above_90: false }, 'Caution'],
    [{ ltv_pct: 90, above_80: true, above_90: false }, 'Caution'],
    [{ ltv_pct: 90.01, above_80: true, above_90: true }, 'Adverse'],
  ] as const)('uses the supplied flags at the boundaries', (figures, band) => {
    expect(ltvBand(figures)).toBe(band);
  });
});
