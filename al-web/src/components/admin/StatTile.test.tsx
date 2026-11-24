import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { StatTile } from './StatTile';

afterEach(cleanup);

describe('stat tile', () => {
  it('reads a linked figure as one sentence and then where it goes', () => {
    render(
      <MemoryRouter>
        <StatTile detail="0 closed requests so far." label="Open support requests" to="/admin/inbox" value={2} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('link', { name: 'Open support requests 2 0 closed requests so far. Open the list.' }),
    ).toHaveAttribute('href', '/admin/inbox');
  });
});
