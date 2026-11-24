import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from './services/apiClient';
import { FakeStaffService, expectLoading, renderAdmin, seededStaff, staffMember } from './test/adminHarness';

afterEach(cleanup);

async function staffTable() {
  return screen.findByRole('table', { name: 'Staff accounts' });
}

function rowOf(name: string) {
  return screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')!;
}

const STILL_HAS_WORK = 'Bob Murphy still has borrowers or applications. Disable the account instead.';

describe('admin routing', () => {
  it('opens the admin dashboard for an admin', async () => {
    renderAdmin('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin portal' })).toBeInTheDocument();
  });

  it.each(['broker', 'underwriter', 'borrower'] as const)('keeps a %s out of the admin pages', async (role) => {
    const { staff } = renderAdmin('/admin/staff', { role, uid: `${role}-1` });
    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Staff' })).not.toBeInTheDocument();
    expect(staff.listCalls).toBe(0);
  });

  it.each(['/broker', '/broker/clients', '/underwriter', '/underwriter/pipeline'])(
    'keeps an admin out of %s and offers the admin portal',
    async (path) => {
      renderAdmin(path);
      expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Go to the admin portal' })).toHaveAttribute('href', '/admin');
    },
  );

  it('shows the not-found page for an unknown admin path', async () => {
    renderAdmin('/admin/nothing-here');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('staff list', () => {
  it('lists every staff account with its role, firm and status', async () => {
    renderAdmin('/admin/staff');
    const table = await staffTable();
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    const bob = rowOf('Bob Murphy');
    expect(within(bob).getByText('bob@test.com')).toBeInTheDocument();
    expect(within(bob).getByText('Broker')).toBeInTheDocument();
    expect(within(bob).getByText('Murphy Mortgages')).toBeInTheDocument();
    expect(within(bob).getByText('Enabled')).toBeInTheDocument();
  });

  it('shows admin rows without actions, and marks the signed-in admin', async () => {
    renderAdmin('/admin/staff');
    await staffTable();
    const ada = rowOf('Ada Admin');
    expect(within(ada).getByText('You')).toBeInTheDocument();
    expect(within(ada).getByText('Managed by script')).toBeInTheDocument();
    expect(within(ada).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rowOf('Bob Murphy')).getByRole('button', { name: 'Delete Bob Murphy' })).toBeInTheDocument();
  });

  it('filters by role from the URL and by search', async () => {
    const { user } = renderAdmin('/admin/staff?role=broker');
    const table = await staffTable();
    expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      expect.stringContaining('Bob Murphy'),
      expect.stringContaining('Ciara Kelly'),
    ]);
    await user.type(screen.getByLabelText('Search staff'), 'nobody');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search staff'));
    await user.type(screen.getByLabelText('Search staff'), 'kelly fin');
    expect(await screen.findByText('Showing 1 of 4 staff accounts.')).toBeInTheDocument();
    expect(within(await staffTable()).getAllByRole('rowheader')).toHaveLength(1);
  });

  it('sorts by a column when its header is pressed', async () => {
    const { user } = renderAdmin('/admin/staff');
    const table = await staffTable();
    await user.click(within(table).getByRole('button', { name: 'Name' }));
    expect(within(table).getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending');
    expect(within(table).getAllByRole('rowheader')[0]).toHaveTextContent('Ada Admin');
    await user.click(within(table).getByRole('button', { name: 'Name' }));
    expect(within(table).getAllByRole('rowheader')[0]).toHaveTextContent('Uma Nolan');
  });

  it('shows the list in placeholders while the staff accounts load', async () => {
    const staff = new FakeStaffService();
    staff.list = () => new Promise(() => {});
    renderAdmin('/admin/staff', { staff });
    await expectLoading('Loading the staff accounts');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says why the list failed and loads it again on request', async () => {
    const staff = new FakeStaffService(seededStaff());
    staff.listError = new ApiError('http', 'Only admins can manage staff accounts', 403);
    const { user } = renderAdmin('/admin/staff', { staff });
    expect(await screen.findByText('Only admins can manage staff accounts')).toBeInTheDocument();
    staff.listError = null;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await staffTable()).toBeInTheDocument();
  });
});

describe('creating a staff account', () => {
  it('creates a broker with a firm and sends the set-your-password email', async () => {
    const { user, staff } = renderAdmin('/admin/staff');
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'New staff member' }));
    const dialog = screen.getByRole('dialog', { name: 'New staff member' });
    await user.type(within(dialog).getByLabelText('Full name'), 'Dan Hayes');
    await user.type(within(dialog).getByLabelText('Email'), 'dan@example.com');
    await user.type(within(dialog).getByLabelText('Phone'), '087 123 4599');
    await user.type(within(dialog).getByLabelText('Firm'), 'Hayes Home Loans');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(staff.emails).toEqual(['dan@example.com']));
    expect(staff.created).toEqual([
      { fullName: 'Dan Hayes', email: 'dan@example.com', phone: '+353871234599', role: 'broker', firm: 'Hayes Home Loans' },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rowOf('Dan Hayes')).toHaveTextContent('Hayes Home Loans');
    expect(
      await screen.findByText(
        'Dan Hayes was added as a broker. A set-your-password email is on its way to dan@example.com.',
      ),
    ).toBeInTheDocument();
  });

  it('creates an underwriter with no firm', async () => {
    const { user, staff } = renderAdmin('/admin/staff');
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'New staff member' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Underwriter' }));
    expect(within(dialog).queryByLabelText('Firm')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Full name'), 'Una Byrne');
    await user.type(within(dialog).getByLabelText('Email'), 'una@example.com');
    await user.type(within(dialog).getByLabelText('Phone'), '871234598');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(staff.created).toHaveLength(1));
    expect(staff.created[0]).toMatchObject({ role: 'underwriter', firm: null, phone: '+353871234598' });
  });

  it('opens straight into the form from the dashboard shortcut', async () => {
    renderAdmin('/admin/staff?new');
    expect(await screen.findByRole('dialog', { name: 'New staff member' })).toBeInTheDocument();
  });

  it('checks the form before sending anything', async () => {
    const { user, staff } = renderAdmin('/admin/staff');
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'New staff member' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Phone'), '12');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(within(dialog).getByText('Enter their full name.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter an email address like name@example.com.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the 7 to 9 digits after +353, for example 87 123 4567.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the firm this broker works for.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Full name')).toHaveFocus();
    expect(staff.created).toEqual([]);
  });

  it('shows a refused create exactly as the API words it, beside the field it names', async () => {
    const staff = new FakeStaffService(seededStaff());
    staff.createError = new ApiError('http', 'phone: must be +353 then 7 to 9 digits', 422, 'phone');
    const { user } = renderAdmin('/admin/staff', { staff });
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'New staff member' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Underwriter' }));
    await user.type(within(dialog).getByLabelText('Full name'), 'Una Byrne');
    await user.type(within(dialog).getByLabelText('Email'), 'una@example.com');
    await user.type(within(dialog).getByLabelText('Phone'), '871234598');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await within(dialog).findByText('phone: must be +353 then 7 to 9 digits')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Phone')).toHaveAttribute('aria-invalid', 'true');

    staff.createError = new ApiError('http', 'An account with this email already exists', 409);
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('An account with this email already exists');
    expect(screen.queryByRole('rowheader', { name: /Una Byrne/ })).not.toBeInTheDocument();
  });

  it('offers to send the email again when it could not be sent', async () => {
    const staff = new FakeStaffService(seededStaff());
    staff.emailError = new Error('auth/network-request-failed');
    const { user } = renderAdmin('/admin/staff', { staff });
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'New staff member' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Underwriter' }));
    await user.type(within(dialog).getByLabelText('Full name'), 'Una Byrne');
    await user.type(within(dialog).getByLabelText('Email'), 'una@example.com');
    await user.type(within(dialog).getByLabelText('Phone'), '871234598');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(
      await screen.findByText("Una Byrne's account was created, but the set-your-password email could not be sent."),
    ).toBeInTheDocument();
    staff.emailError = null;
    await user.click(screen.getByRole('button', { name: 'Send the email again' }));
    await waitFor(() => expect(staff.emails).toEqual(['una@example.com', 'una@example.com']));
  });
});

describe('changing a staff account', () => {
  it('disables an account after a confirm dialog naming the person', async () => {
    const { user, staff } = renderAdmin('/admin/staff');
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'Disable Bob Murphy' }));
    const dialog = screen.getByRole('dialog', { name: 'Disable Bob Murphy?' });
    await user.click(within(dialog).getByRole('button', { name: 'Disable account' }));
    await waitFor(() => expect(staff.updates).toEqual([{ uid: 'broker1', change: { disabled: true } }]));
    expect(within(rowOf('Bob Murphy')).getByText('Disabled')).toBeInTheDocument();
    expect(await screen.findByText('Bob Murphy is disabled and signed out.')).toBeInTheDocument();
  });

  it('enables a disabled account', async () => {
    const staff = new FakeStaffService([
      staffMember({ uid: 'broker1', fullName: 'Bob Murphy', firm: 'Murphy Mortgages', enabled: false }),
    ]);
    const { user } = renderAdmin('/admin/staff', { staff });
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'Enable Bob Murphy' }));
    await user.click(screen.getByRole('button', { name: 'Enable account' }));
    await waitFor(() => expect(staff.updates).toEqual([{ uid: 'broker1', change: { disabled: false } }]));
    expect(within(rowOf('Bob Murphy')).getByText('Enabled')).toBeInTheDocument();
  });

  it('sends nothing when the dialog is cancelled or escaped', async () => {
    const { user, staff } = renderAdmin('/admin/staff');
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'Delete Bob Murphy' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Disable Bob Murphy' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(staff.updates).toEqual([]);
    expect(staff.removed).toEqual([]);
  });

  it('moves an underwriter to broker only with a firm', async () => {
    const { user, staff } = renderAdmin('/admin/staff');
    await staffTable();
    await user.click(screen.getByRole('button', { name: "Change Uma Nolan's role" }));
    const dialog = screen.getByRole('dialog', { name: "Change Uma Nolan's role?" });
    await user.click(within(dialog).getByRole('button', { name: 'Make a broker' }));
    expect(within(dialog).getByText('Enter the firm this broker works for.')).toBeInTheDocument();
    expect(staff.updates).toEqual([]);
    await user.type(within(dialog).getByLabelText('Firm'), 'Nolan Finance');
    await user.click(within(dialog).getByRole('button', { name: 'Make a broker' }));
    await waitFor(() =>
      expect(staff.updates).toEqual([{ uid: 'underwriter1', change: { role: 'broker', firm: 'Nolan Finance' } }]),
    );
    expect(within(rowOf('Uma Nolan')).getByText('Nolan Finance')).toBeInTheDocument();
    expect(
      await screen.findByText('Uma Nolan is now a broker. The new role applies at their next sign-in.'),
    ).toBeInTheDocument();
  });

  it('shows a refused role change as the API words it and offers to disable instead', async () => {
    const staff = new FakeStaffService(seededStaff());
    staff.updateError = new ApiError('http', STILL_HAS_WORK, 409);
    const { user } = renderAdmin('/admin/staff', { staff });
    await staffTable();
    await user.click(screen.getByRole('button', { name: "Change Bob Murphy's role" }));
    await user.click(screen.getByRole('button', { name: 'Make an underwriter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(STILL_HAS_WORK);
    expect(staff.updates).toEqual([{ uid: 'broker1', change: { role: 'underwriter' } }]);
    expect(within(rowOf('Bob Murphy')).getByText('Broker')).toBeInTheDocument();

    staff.updateError = null;
    await user.click(screen.getByRole('button', { name: 'Disable instead' }));
    const dialog = screen.getByRole('dialog', { name: 'Disable Bob Murphy?' });
    await user.click(within(dialog).getByRole('button', { name: 'Disable account' }));
    await waitFor(() => expect(staff.updates.at(-1)).toEqual({ uid: 'broker1', change: { disabled: true } }));
  });

  it('deletes an account with nothing attached', async () => {
    const { user, staff } = renderAdmin('/admin/staff');
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'Delete Uma Nolan' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Uma Nolan?' })).getByRole('button', { name: 'Delete account' }),
    );
    await waitFor(() => expect(staff.removed).toEqual(['underwriter1']));
    expect(screen.queryByRole('rowheader', { name: /Uma Nolan/ })).not.toBeInTheDocument();
    expect(await screen.findByText('Uma Nolan was deleted.')).toBeInTheDocument();
  });

  it('keeps the row and shows the reason when a delete is refused', async () => {
    const staff = new FakeStaffService(seededStaff());
    staff.removeError = new ApiError('http', STILL_HAS_WORK, 409);
    const { user } = renderAdmin('/admin/staff', { staff });
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'Delete Bob Murphy' }));
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(STILL_HAS_WORK);
    expect(screen.getByRole('button', { name: 'Disable instead' })).toBeInTheDocument();
    expect(rowOf('Bob Murphy')).toBeInTheDocument();
  });

  it('does not offer "Disable instead" for a refusal that is not about attached work', async () => {
    const staff = new FakeStaffService(seededStaff());
    staff.removeError = new ApiError('http', 'No such staff account', 404);
    const { user } = renderAdmin('/admin/staff', { staff });
    await staffTable();
    await user.click(screen.getByRole('button', { name: 'Delete Bob Murphy' }));
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No such staff account');
    expect(screen.queryByRole('button', { name: 'Disable instead' })).not.toBeInTheDocument();
  });
});
