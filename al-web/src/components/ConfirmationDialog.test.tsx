import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmationDialog } from './ConfirmationDialog';

afterEach(cleanup);

// A page with a heading and a row whose button opens the dialog; "Delete" removes the row as the dialog closes.
function Page() {
  const [open, setOpen] = useState(false);
  const [rowGone, setRowGone] = useState(false);
  return (
    <main>
      <h1>Staff</h1>
      {rowGone ? null : <button onClick={() => setOpen(true)} type="button">Open</button>}
      {open ? (
        <ConfirmationDialog onClose={() => setOpen(false)} title="Delete Bob?">
          <button onClick={() => setOpen(false)} type="button">Cancel</button>
          <button onClick={() => { setRowGone(true); setOpen(false); }} type="button">Delete</button>
        </ConfirmationDialog>
      ) : null}
    </main>
  );
}

describe('confirmation dialog', () => {
  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('dialog', { name: 'Delete Bob?' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
  });

  it('hands focus back to the button that opened it', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('moves focus to the page heading when the button that opened it is gone', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Staff' })).toHaveFocus();
  });
});
