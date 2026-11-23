import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KeyFigures } from './KeyFigures';
import { StatusTimeline } from './StatusTimeline';

afterEach(cleanup);

// Each stage's caption in order: Application, AI committee, Underwriter decision, Funding.
function captions() {
  const list = screen.getByRole('list', { name: 'Application progress' });
  return within(list).getAllByRole('listitem').map((item) => item.querySelectorAll('p')[1]?.textContent);
}

describe('status timeline', () => {
  it.each([
    ['Draft', false, false, ['In hand', 'Next', 'Next', 'Next']],
    ['Applied', false, false, ['Done', 'In hand', 'Next', 'Next']],
    ['AI Deliberated', false, false, ['Done', 'Done', 'In hand', 'Next']],
    ['Underwriter Approved', false, false, ['Done', 'Done', 'Done', 'In hand']],
    ['Funded', false, true, ['Done', 'Done', 'Done', 'Done']],
    ['Declined', true, false, ['Done', 'Done', 'Stopped here', 'Not reached']],
    // Closed follows either Funded or Declined, so the timeline reads the note and the decision, not the status.
    ['Closed', false, true, ['Done', 'Done', 'Done', 'Done']],
    ['Closed', true, false, ['Done', 'Done', 'Stopped here', 'Not reached']],
    ['Closed', false, false, ['Done', 'Done', 'Not recorded', 'Not recorded']],
  ] as const)('shows %s (declined %s, minted %s) as %j', (status, declined, minted, expected) => {
    render(<StatusTimeline declined={declined} minted={minted} status={status} />);
    expect(captions()).toEqual(expected);
  });

  it('marks only the stage in hand as the current step', () => {
    render(<StatusTimeline declined={false} minted={false} status="AI Deliberated" />);
    const current = screen.getAllByRole('listitem').filter((item) => item.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Underwriter decision');
  });

  it('draws nothing for a status outside the agreed list', () => {
    render(<StatusTimeline declined={false} minted={false} status="Pending review" />);
    expect(screen.queryByRole('list', { name: 'Application progress' })).not.toBeInTheDocument();
  });
});

describe('key figures', () => {
  it('writes out every figure and note, and says Unavailable for a missing figure', () => {
    render(
      <KeyFigures
        figures={[
          { label: 'Amount requested', value: '€265,000' },
          { label: 'Indicative LTV', value: '86.6%', note: '>80% to 90%' },
          { label: 'Stressed DTI', value: null },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: 'Key figures' });
    const terms = within(region).getAllByRole('term').map((term) => term.textContent);
    expect(terms).toEqual(['Amount requested', 'Indicative LTV', 'Stressed DTI']);
    expect(region).toHaveTextContent('€265,000');
    expect(region).toHaveTextContent('>80% to 90%');
    expect(within(region).getByText('Unavailable')).toBeInTheDocument();
  });
});
