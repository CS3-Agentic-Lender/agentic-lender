import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { toLoanFileApplication, toLoanFileReview, type LoanFileReview } from '../../services/loanFileService';
import { ValuationBreakdown } from './ValuationBreakdown';

const application = toLoanFileApplication('LN-1001', {
  property: { county: 'Cork', propertyType: 'Semi-D', bedrooms: 3, floorAreaSqm: 120, berRating: 'C2', eircode: 'T12 ABCD' },
});
const detail = {
  baselineEur: 250000,
  contributions: { ber: -1300, eircode_area: 800, county: 18500, property_type: -4600, floor_area: 31200, bedrooms: 9800, unknown_feature: -400 },
  estimatedValueEur: 304000,
};

function renderBreakdown(review: LoanFileReview = toLoanFileReview({ valuationDetail: detail })) {
  return render(<ValuationBreakdown application={application} review={review} />);
}

afterEach(cleanup);

describe('valuation breakdown', () => {
  it('shows every feature, input and signed amount in magnitude order with the stored baseline and estimate', () => {
    renderBreakdown();

    expect(screen.getByRole('heading', { name: 'Valuation' })).toBeInTheDocument();
    expect(screen.getByText(/compared with a typical listing/)).toBeInTheDocument();
    expect(screen.getByText('Typical listing').nextElementSibling).toHaveTextContent('€250,000');
    expect(screen.getByText('Estimate').nextElementSibling).toHaveTextContent('€304,000');
    expect(screen.getByText(/Each bar is how much that feature moved/)).toHaveTextContent(
      'Each bar is how much that feature moved the estimate away from a typical listing. It is an estimate of a 2024 asking price, not a valuation.',
    );

    const rows = within(screen.getByRole('list', { name: 'Valuation contributions' })).getAllByRole('listitem');
    const expected = [
      ['Floor area', '120 m²', '+€31,200'],
      ['County', 'Cork', '+€18,500'],
      ['Bedrooms', '3', '+€9,800'],
      ['Property type', 'Semi-D', '−€4,600'],
      ['BER rating', 'C2', '−€1,300'],
      ['Eircode area', null, '+€800'],
      ['unknown_feature', null, '−€400'],
    ];
    expect(rows).toHaveLength(expected.length);
    expected.forEach(([label, input, amount], index) => {
      expect(within(rows[index]).getByText(label!)).toBeVisible();
      expect(within(rows[index]).getByText(amount!)).toBeVisible();
      if (input !== null) {
        expect(within(rows[index]).getByText(input)).toBeVisible();
      } else {
        expect(rows[index]).toHaveTextContent(`${label}${amount}`);
      }
    });
    expect(screen.queryByText('T12 ABCD')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('draws proportional bars to either side of zero and hides only the graphics from screen readers', () => {
    renderBreakdown(toLoanFileReview({ valuationDetail: {
      baselineEur: 250000,
      contributions: { county: 100, ber: -50, bedrooms: 0 },
    } }));

    const rows = screen.getAllByRole('listitem');
    const bars = rows.map((row) => row.querySelector('[aria-hidden="true"]')!.firstElementChild);
    expect(bars[0]).toHaveClass('left-1/2', 'bg-success');
    expect(bars[0]).toHaveStyle({ width: '50%' });
    expect(bars[1]).toHaveClass('right-1/2', 'bg-error');
    expect(bars[1]).toHaveStyle({ width: '25%' });
    expect(bars[2]).toHaveStyle({ width: '0%' });
    expect(within(rows[1]).getByText('−€50')).toBeVisible();
  });

  it('handles all-zero effects without inventing input values or dividing by zero', () => {
    render(<ValuationBreakdown
      application={toLoanFileApplication('empty', {})}
      review={toLoanFileReview({ valuationDetail: { baselineEur: 0, contributions: { floor_area: 0, bedrooms: 0 }, estimatedValueEur: 0 } })}
    />);

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(/^Floor area€0$/);
    expect(rows[1]).toHaveTextContent(/^Bedrooms€0$/);
    for (const row of rows) {
      expect(row.querySelector('[aria-hidden="true"]')!.firstElementChild).toHaveStyle({ width: '0%' });
    }
  });

  it('keeps a stored zero input', () => {
    render(<ValuationBreakdown
      application={toLoanFileApplication('studio', { property: { bedrooms: 0 } })}
      review={toLoanFileReview({ valuationDetail: detail })}
    />);
    expect(within(screen.getByText('Bedrooms').closest('li')!).getByText('0')).toBeInTheDocument();
  });

  it.each([-500, -1.01, 1.01, 500])('warns when the stored total is off by %s euro', (discrepancy) => {
    renderBreakdown(toLoanFileReview({ valuationDetail: { ...detail, estimatedValueEur: detail.estimatedValueEur + discrepancy } }));

    expect(screen.getByRole('status')).toHaveTextContent('The stored breakdown does not add up to the estimate: it is off by');
    if (Math.abs(discrepancy) === 500) {
      expect(screen.getByRole('status')).toHaveTextContent('it is off by €500.');
    }
  });

  it.each([-1, -0.5, 0, 0.5, 1])('does not warn within the one euro tolerance (%s)', (discrepancy) => {
    renderBreakdown(toLoanFileReview({ valuationDetail: { ...detail, estimatedValueEur: detail.estimatedValueEur + discrepancy } }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows Unavailable for a missing estimate and does not report a discrepancy', () => {
    renderBreakdown(toLoanFileReview({ valuationDetail: { ...detail, estimatedValueEur: undefined } }));

    expect(screen.getByText('Estimate').nextElementSibling).toHaveTextContent('Unavailable');
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a loading line while the review is pending', () => {
    renderBreakdown({ state: 'pending' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading the valuation breakdown.');
    expect(screen.queryByText('Valuation breakdown not available')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it.each([
    [{ state: 'absent' }, 'once the underwriting review is written'],
    [{ state: 'unavailable' }, 'could not be read'],
    [toLoanFileReview({}), 'not stored with this application yet'],
  ] satisfies [LoanFileReview, string][])('explains an unavailable breakdown (%j)', (review, reason) => {
    renderBreakdown(review);
    expect(screen.getByText('Valuation breakdown not available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(reason);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
