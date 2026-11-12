import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { toLoanFileApplication, type PolicyGate } from '../../services/loanFileService';
import { HelocCollateral } from './HelocCollateral';

const surveyorCondition = "Requires an independent surveyor's valuation (HELOC)";
const exceptionLine = 'Requires lender exception review: the combined LTV is above the 80% cap (CLTV_CAP).';
const decisionNote = "Conditions are for the underwriter's decision; they do not approve or mint the loan.";
const gate: PolicyGate = {
  original: 'Approve',
  effective: 'Conditionally Approve',
  conditions: [surveyorCondition],
  breaches: [],
};

function renderCollateral(policyGate: PolicyGate | null | undefined, loanAmountEur = 100000, ltvPct: number | null = 62.5) {
  const application = toLoanFileApplication('LN-1001', {
    loanType: 'heloc', estimatedValueEur: 400000, existingMortgageBalanceEur: 150000,
    loanAmountEur, ltvPct,
  });
  return render(<HelocCollateral application={application} policyGate={policyGate} />);
}

afterEach(cleanup);

describe('HELOC collateral policy conditions', () => {
  it.each([
    { limit: 100000, ltv: 62.5, breaches: [] },
    { limit: 170000, ltv: 80, breaches: [] },
    { limit: 180000, ltv: 82.5, breaches: ['CLTV_CAP'] },
  ])('shows the stored figures and breach for limit $limit at $ltv%', ({ limit, ltv, breaches }) => {
    renderCollateral({ ...gate, breaches }, limit, ltv);

    expect(screen.getByText('€400,000')).toBeInTheDocument();
    expect(screen.getByText('€150,000')).toBeInTheDocument();
    expect(screen.getByText(new Intl.NumberFormat('en-IE', {
      style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
    }).format(limit))).toBeInTheDocument();
    expect(screen.getByText(`Combined LTV ${ltv}% against the 80% cap`)).toBeInTheDocument();
    expect(Boolean(screen.queryByText('Above the 80% combined LTV cap'))).toBe(ltv > 80);
    expect(Boolean(screen.queryByText(exceptionLine))).toBe(breaches.includes('CLTV_CAP'));
    expect(screen.getByText(surveyorCondition)).toBeInTheDocument();
  });

  it.each([62.5, null])('shows a stored CLTV_CAP breach even when combined LTV is %s', (ltv) => {
    renderCollateral({ ...gate, breaches: ['CLTV_CAP'] }, 100000, ltv);

    expect(screen.getByText(exceptionLine)).toHaveClass('text-error', 'bg-danger-soft');
    expect(screen.queryByText('Above the 80% combined LTV cap')).not.toBeInTheDocument();
  });

  it.each([{ breaches: [] }, { breaches: ['LTI_CAP', 'LTV_CAP'] }])('does not infer a CLTV_CAP breach from an over-cap figure ($breaches)', ({ breaches }) => {
    renderCollateral({ ...gate, breaches }, 180000, 82.5);

    expect(screen.getByText('Above the 80% combined LTV cap')).toBeInTheDocument();
    expect(screen.queryByText(exceptionLine)).not.toBeInTheDocument();
  });

  it('lists all conditions verbatim in stored order, including the surveyor condition', () => {
    const conditions = ['Provide updated income evidence.', 'Requires lender exception review (CLTV_CAP)', surveyorCondition];
    renderCollateral({ ...gate, conditions, breaches: ['CLTV_CAP'] });

    expect(screen.getByRole('heading', { level: 3, name: 'Conditions' })).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((item) => item.textContent)).toEqual(conditions);
    expect(screen.getByText(decisionNote)).toHaveClass('text-muted');
  });

  it('reports a missing gate without inventing conditions or approval wording', () => {
    renderCollateral(null);

    expect(screen.getByText('The policy check is not stored with this application yet.')).toBeInTheDocument();
    expect(screen.queryByText(surveyorCondition)).not.toBeInTheDocument();
    expect(screen.queryByText(exceptionLine)).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(decisionNote)).not.toBeInTheDocument();
  });

  it('says nothing about the policy check while the review is not loaded', () => {
    renderCollateral(undefined);

    expect(screen.queryByText('The policy check is not stored with this application yet.')).not.toBeInTheDocument();
    expect(screen.queryByText(exceptionLine)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Conditions' })).not.toBeInTheDocument();
  });

  it('keeps a declined gate breach visible without adding conditions or their decision note', () => {
    renderCollateral({ original: 'Decline', effective: 'Decline', conditions: [], breaches: ['CLTV_CAP'] });

    expect(screen.getByText(exceptionLine)).toBeInTheDocument();
    expect(screen.queryByText(surveyorCondition)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Conditions' })).not.toBeInTheDocument();
    expect(screen.queryByText(decisionNote)).not.toBeInTheDocument();
    expect(screen.queryByText('The policy check is not stored with this application yet.')).not.toBeInTheDocument();
  });
});
