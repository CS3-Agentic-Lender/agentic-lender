import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BandChip } from './DtiBreakdown';

describe('BandChip', () => {
  it.each([
    ['Comfortable', 'bg-success-soft'],
    ['Caution', 'bg-neutral'],
    ['Adverse', 'bg-danger-soft'],
  ])('gives %s its tone and writes it out', (band, tone) => {
    render(<BandChip value={band} />);
    expect(screen.getByText(band)).toHaveClass(tone);
  });

  it('falls back to neutral for an unknown band and still shows it', () => {
    render(<BandChip value="Stretched" />);
    expect(screen.getByText('Stretched')).toHaveClass('bg-neutral', 'text-neutral-text');
  });
});
