import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchField } from './SearchField';

afterEach(cleanup);

describe('search field', () => {
  it('keeps every keystroke while its owner has not caught up yet', async () => {
    // A list that keeps its search in the URL gets the new value a render later, in a transition.
    const onChange = vi.fn();
    render(<SearchField label="Search" onChange={onChange} value="" />);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'ben walsh');

    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('ben walsh');
    expect(onChange).toHaveBeenLastCalledWith('ben walsh');
  });

  it('shows a value changed from outside, such as Clear filters', async () => {
    function Harness() {
      const [value, setValue] = useState('');
      return (
        <>
          <SearchField label="Search" onChange={setValue} value={value} />
          <button onClick={() => setValue('')} type="button">
            Clear
          </button>
        </>
      );
    }
    render(<Harness />);
    const box = screen.getByRole('searchbox', { name: 'Search' });

    await userEvent.type(box, 'alice');
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(box).toHaveValue('');
  });
});
