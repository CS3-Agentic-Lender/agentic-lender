import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { toLoanFileApplication, toLoanFileReview, type LoanFileReview } from '../../services/loanFileService';
import { MortgageCollateral } from './MortgageCollateral';

const valuationDetail = {
  estimatedValueEur: 343_968.2,
  displayEstimateEur: 344_000,
  askingPriceGap: 0.064,
  priceNeedsReview: false,
  supportWarnings: [],
  modelVersion: 'v2',
  baselineEur: null,
  contributions: null,
};

function application(overrides: Record<string, unknown> = {}) {
  return toLoanFileApplication('LN-1001', {
    loanType: 'mortgage',
    loanAmountEur: 290_000,
    purchaseLtvPct: 79.5,
    ltvPct: 84.3,
    property: { askingPriceEur: 365_000 },
    ...overrides,
  });
}

function renderPanel(
  detail: Record<string, unknown> | null = valuationDetail,
  app = application(),
  review: LoanFileReview = toLoanFileReview(detail === null ? {} : { valuationDetail: detail }),
) {
  return render(<MortgageCollateral application={app} review={review} />);
}

// A term may hold a note under its label, so match the term by how it starts.
function fact(label: string) {
  const term = within(screen.getByRole('region', { name: 'Collateral' }))
    .getAllByRole('term')
    .find((element) => element.textContent?.startsWith(label));
  if (!term) {
    throw new Error(`No term starting with ${label}`);
  }
  return term.nextElementSibling;
}

afterEach(cleanup);

describe('mortgage collateral panel', () => {
  it('shows the asking price, the display estimate with its label and model version, and the signed gap', () => {
    renderPanel();

    expect(fact('Asking price')).toHaveTextContent('€365,000');
    expect(fact('Model estimate')).toHaveTextContent('€344,000');
    expect(screen.getByText('indicative estimate of a 2024 asking price, not a valuation')).toBeInTheDocument();
    expect(screen.getByText('Model v2')).toBeInTheDocument();
    expect(screen.getByText('Asking price 6.4% above the estimate')).toBeInTheDocument();
  });

  it.each([
    [true, true],
    [false, false],
    [null, false],
  ])('shows the Price needs review badge only when the flag is true (flag %s)', (priceNeedsReview, shown) => {
    renderPanel({ ...valuationDetail, priceNeedsReview });

    if (shown) {
      expect(screen.getByText('Price needs review')).toBeInTheDocument();
    } else {
      expect(screen.queryByText('Price needs review')).not.toBeInTheDocument();
    }
  });

  it.each([
    [-0.0525, 'Asking price 5.3% below the estimate'],
    [0, 'Asking price matches the estimate'],
    [null, 'Gap unavailable'],
  ])('words a gap of %s without changing its sign', (askingPriceGap, text) => {
    renderPanel({ ...valuationDetail, askingPriceGap });

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows both LTVs with their denominators against the 90% limit', () => {
    renderPanel();

    expect(fact('Purchase-price LTV')).toHaveTextContent('79.5%');
    expect(screen.getByText('loan / asking price')).toBeInTheDocument();
    expect(fact('Indicative LTV on the estimate')).toHaveTextContent('84.3%');
    expect(screen.getByText('loan / model estimate')).toBeInTheDocument();
    expect(screen.queryByText('Above the 90% limit')).not.toBeInTheDocument();
  });

  it('treats exactly 90% as within the limit and 90.1% as above it', () => {
    renderPanel(valuationDetail, application({ purchaseLtvPct: 90, ltvPct: 90.1 }));

    expect(screen.getAllByText('Above the 90% limit')).toHaveLength(1);
    expect(fact('Indicative LTV on the estimate')?.parentElement?.parentElement).toHaveTextContent('Above the 90% limit');
  });

  it('shows Unavailable for a missing LTV', () => {
    renderPanel(valuationDetail, application({ purchaseLtvPct: undefined, ltvPct: undefined }));

    expect(fact('Purchase-price LTV')).toHaveTextContent('Unavailable');
    expect(fact('Indicative LTV on the estimate')).toHaveTextContent('Unavailable');
  });

  it('lists the support warnings beside the estimate and shows none when the list is empty', () => {
    renderPanel({ ...valuationDetail, supportWarnings: ['Few sample homes in this Eircode area.'] });
    expect(screen.getByText('Why this estimate may be less reliable')).toBeInTheDocument();
    expect(screen.getByText('Few sample homes in this Eircode area.')).toBeInTheDocument();
    cleanup();

    renderPanel();
    expect(screen.queryByText('Why this estimate may be less reliable')).not.toBeInTheDocument();
  });

  it('falls back to the stored estimate when there is no display estimate', () => {
    renderPanel({ ...valuationDetail, displayEstimateEur: null });

    expect(fact('Model estimate')).toHaveTextContent('€343,968');
  });

  it('says the estimate is not stored, never a zero gap, when the valuation is missing', () => {
    renderPanel(null);

    expect(screen.getByText('The model estimate is not stored with this application yet.')).toBeInTheDocument();
    expect(screen.getByText('Gap unavailable')).toBeInTheDocument();
    expect(fact('Asking price')).toHaveTextContent('€365,000');
    expect(fact('Purchase-price LTV')).toHaveTextContent('79.5%');
  });

  it('shows a loading line while the review is pending', () => {
    renderPanel(valuationDetail, application(), { state: 'pending' });

    expect(screen.getByText('Loading the model estimate.')).toBeInTheDocument();
  });
});
