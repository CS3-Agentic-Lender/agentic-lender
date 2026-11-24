import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BandCounts } from '../../services/stressService';
import { AffordabilityBandsChart } from './AffordabilityBandsChart';

afterEach(cleanup);

const before: BandCounts = {
  Comfortable: { count: 6, sharePct: 60 },
  Caution: { count: 3, sharePct: 30 },
  Adverse: { count: 1, sharePct: 10 },
};

const after: BandCounts = {
  Comfortable: { count: 3, sharePct: 30 },
  Caution: { count: 4, sharePct: 40 },
  Adverse: { count: 3, sharePct: 30 },
};

function band(name: string) {
  return screen.getByRole('listitem', { name });
}

describe('the affordability bands chart', () => {
  it('shows the before and after count and share of every band from the result', () => {
    render(<AffordabilityBandsChart after={after} before={before} shockLabel="+2 points" />);

    expect(screen.getByText(/before and after a \+2 points rise/)).toBeInTheDocument();
    expect(band('Comfortable')).toHaveTextContent(/Before\s*6 6 applications,\s*60%/);
    expect(band('Comfortable')).toHaveTextContent(/After\s*3 3 applications,\s*30%/);
    expect(band('Caution')).toHaveTextContent(/Before\s*3 3 applications,\s*30%/);
    expect(band('Caution')).toHaveTextContent(/After\s*4 4 applications,\s*40%/);
    expect(band('Adverse')).toHaveTextContent(/Before\s*1 1 application,\s*10%/);
    expect(band('Adverse')).toHaveTextContent(/After\s*3 3 applications,\s*30%/);
  });

  it('draws each bar against the largest count, so the tallest bar is full height', () => {
    render(<AffordabilityBandsChart after={after} before={before} shockLabel="+2 points" />);

    expect(within(band('Comfortable')).getByTestId('bar-before-Comfortable')).toHaveStyle({ height: '100%' });
    expect(within(band('Comfortable')).getByTestId('bar-after-Comfortable')).toHaveStyle({ height: '50%' });
    expect(within(band('Adverse')).getByTestId('bar-before-Adverse')).toHaveStyle({ height: `${(1 / 6) * 100}%` });
  });

  it('draws no bars for an empty portfolio instead of dividing by zero', () => {
    const none = { count: 0, sharePct: 0 };
    const empty: BandCounts = { Comfortable: none, Caution: none, Adverse: none };

    render(<AffordabilityBandsChart after={empty} before={empty} shockLabel="+1 point" />);

    expect(screen.getByTestId('bar-after-Caution')).toHaveStyle({ height: '0%' });
  });
});
