import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { worstFirst } from './rateShockFigures';
import { shockFixture } from './rateShockFixture';
import { DtiDumbbellChart, SurplusChangeChart } from './ShockCharts';

afterEach(cleanup);

const ordered = () => worstFirst(shockFixture().applications);

describe('the debt-to-income chart', () => {
  it('draws one row per application, in the order given, as a keyboard stop each', () => {
    render(<DtiDumbbellChart applications={ordered()} />);

    const rows = screen.getAllByRole('button');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'LN-1004: debt to income 54% to 61%, Adverse to Adverse',
      'LN-1003: debt to income 46% to 53%, Caution to Adverse',
      'LN-1002: debt to income 38% to 44%, Comfortable to Caution',
      'LN-1001: debt to income 30% to 34%, Comfortable to Comfortable',
    ]);
    for (const row of rows) {
      expect(row).toHaveAttribute('tabindex', '0');
    }
  });

  it('marks only the rows that cross the 40% limit', () => {
    render(<DtiDumbbellChart applications={ordered()} />);

    expect(screen.getByTestId('chart-row-LN-1002')).toHaveAttribute('data-over-limit', 'true');
    for (const id of ['LN-1001', 'LN-1003', 'LN-1004']) {
      expect(screen.getByTestId(`chart-row-${id}`)).not.toHaveAttribute('data-over-limit');
    }
  });

  it('places the after dot further right than where it travels from', () => {
    render(<DtiDumbbellChart applications={ordered()} />);

    const after = screen.getAllByTestId('dti-after')[0];
    const to = Number(after.style.transform.match(/translateX\(([\d.]+)px\)/)?.[1]);
    const from = Number(after.style.getPropertyValue('--shock-from-x').replace('px', ''));
    expect(to).toBeGreaterThan(from);
  });

  it('shows a tooltip on hover and on focus, and Escape or leaving hides it', () => {
    render(<DtiDumbbellChart applications={ordered()} />);
    const row = screen.getByRole('button', { name: /^LN-1002/ });

    fireEvent.mouseEnter(row);
    expect(screen.getByTestId('chart-tip')).toHaveTextContent('LN-1002');
    expect(screen.getByTestId('chart-tip')).toHaveTextContent('Crosses the 40% limit');
    fireEvent.mouseLeave(row);
    expect(screen.queryByTestId('chart-tip')).not.toBeInTheDocument();

    fireEvent.focus(row);
    expect(screen.getByTestId('chart-tip')).toHaveTextContent(/DTI\s*38%\s*→\s*44%/);
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(screen.queryByTestId('chart-tip')).not.toBeInTheDocument();
  });

  it('opens a tooltip with a tap and closes it with a second tap or a tap elsewhere', () => {
    render(<DtiDumbbellChart applications={ordered()} />);
    const row = screen.getByRole('button', { name: /^LN-1004/ });

    fireEvent.click(row);
    expect(screen.getByTestId('chart-tip')).toHaveTextContent('LN-1004');
    fireEvent.click(row);
    expect(screen.queryByTestId('chart-tip')).not.toBeInTheDocument();

    fireEvent.click(row);
    fireEvent.click(document.body);
    expect(screen.queryByTestId('chart-tip')).not.toBeInTheDocument();
  });
});

describe('the surplus change chart', () => {
  it('labels each bar with the monthly change and describes the before and after', () => {
    render(<SurplusChangeChart applications={ordered()} />);

    expect(screen.getByRole('button', { name: /^LN-1003: surplus €300 to .€50 a month$/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Change in monthly surplus/ })).toHaveTextContent('−€350');
    expect(screen.getAllByTestId('surplus-bar')).toHaveLength(4);
  });

  it('shows the repayment and the change in its tooltip', () => {
    render(<SurplusChangeChart applications={ordered()} />);

    fireEvent.focus(screen.getByRole('button', { name: /^LN-1001/ }));
    expect(screen.getByTestId('chart-tip')).toHaveTextContent(/Repayment\s*€1,432\s*→\s*€1,799/);
    expect(screen.getByTestId('chart-tip')).toHaveTextContent('−€200 a month');
  });
});
