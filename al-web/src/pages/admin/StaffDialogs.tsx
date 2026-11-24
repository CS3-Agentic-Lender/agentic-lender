import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { fieldClass } from '../../components/admin/SearchField';
import { useToast } from '../../components/admin/Toasts';
import { useStaff } from '../../context/StaffContext';
import { ApiError } from '../../services/apiClient';
import {
  staffFailureMessage,
  staffRoleLabels,
  type ManagedRole,
  type NewStaffMember,
  type StaffChange,
  type StaffMember,
} from '../../services/staffService';

// Which dialog is open, and for whom. One value, so two dialogs can never be open at once.
export type StaffDialog =
  | { kind: 'create' }
  | { kind: 'disable' | 'enable' | 'role' | 'delete'; member: StaffMember };

const primaryClass = 'btn btn-primary';
const secondaryClass = 'btn btn-secondary';
const dangerClass = 'btn bg-error text-surface shadow-card hover:not-disabled:bg-error/90';

function roleWord(role: ManagedRole) {
  return staffRoleLabels[role].toLowerCase();
}

function otherRole(role: ManagedRole): ManagedRole {
  return role === 'broker' ? 'underwriter' : 'broker';
}

interface Refusal {
  message: string;
  // al-core answers 409 when work is still attached, and points to disabling instead.
  canDisableInstead: boolean;
}

function toRefusal(error: unknown, member: StaffMember): Refusal {
  return {
    message: staffFailureMessage(error),
    canDisableInstead: error instanceof ApiError && error.status === 409 && member.enabled,
  };
}

function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-wrap justify-end gap-3">{children}</div>;
}

function RefusalNotice({ refusal, onDisableInstead }: { refusal: Refusal; onDisableInstead(): void }) {
  return (
    <div className="mt-5 rounded-lg bg-danger-soft p-4 text-error" role="alert">
      <p>{refusal.message}</p>
      {refusal.canDisableInstead ? (
        <button
          className="mt-3 min-h-9 cursor-pointer font-semibold underline underline-offset-4 hover:no-underline"
          onClick={onDisableInstead}
          type="button"
        >
          Disable instead
        </button>
      ) : null}
    </div>
  );
}

// A change to one account (disable, enable, role, delete), confirmed by name before it is sent.
function ChangeDialog({
  dialog,
  onClose,
  onSwitch,
}: {
  dialog: Exclude<StaffDialog, { kind: 'create' }>;
  onClose(): void;
  onSwitch(next: StaffDialog): void;
}) {
  const { service, upsert, drop } = useStaff();
  const toast = useToast();
  const { member } = dialog;
  const role = member.role === 'admin' ? null : member.role;
  const firmId = useId();
  const [firm, setFirm] = useState('');
  const [firmError, setFirmError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // A synchronous lock also covers a double click before React renders the disabled button.
  const sending = useRef(false);

  if (role === null) {
    // Admin accounts are made and changed only by script; the page never opens a dialog for one.
    return null;
  }

  const target = otherRole(role);
  const copy = {
    disable: {
      title: `Disable ${member.fullName}?`,
      body: `${member.fullName} is signed out now and can't sign in until an admin enables the account again. Their work stays as it is.`,
      confirm: 'Disable account',
      done: `${member.fullName} is disabled and signed out.`,
    },
    enable: {
      title: `Enable ${member.fullName}?`,
      body: `${member.fullName} can sign in again with their existing password.`,
      confirm: 'Enable account',
      done: `${member.fullName} can sign in again.`,
    },
    role: {
      title: `Change ${member.fullName}'s role?`,
      body: `${member.fullName} moves from ${roleWord(role)} to ${roleWord(target)}. They are signed out now, and the new role applies at their next sign-in.${
        role === 'broker' ? ' Their firm is removed from the profile.' : ''
      }`,
      confirm: `Make ${target === 'broker' ? 'a broker' : 'an underwriter'}`,
      done: `${member.fullName} is now ${target === 'broker' ? 'a broker' : 'an underwriter'}. The new role applies at their next sign-in.`,
    },
    delete: {
      title: `Delete ${member.fullName}?`,
      body: `This removes ${member.fullName}'s account and profile for good. Applications, decisions and the chain records are never touched.`,
      confirm: 'Delete account',
      done: `${member.fullName} was deleted.`,
    },
  }[dialog.kind];

  async function confirm() {
    if (sending.current) {
      return;
    }

    let change: StaffChange | null = null;
    if (dialog.kind === 'disable' || dialog.kind === 'enable') {
      change = { disabled: dialog.kind === 'disable' };
    } else if (dialog.kind === 'role') {
      if (target === 'broker' && !firm.trim()) {
        setFirmError('Enter the firm this broker works for.');
        return;
      }
      change = target === 'broker' ? { role: 'broker', firm: firm.trim() } : { role: 'underwriter' };
    }

    sending.current = true;
    setPending(true);
    setRefusal(null);
    try {
      if (change) {
        upsert(await service.update(member.uid, change));
      } else {
        await service.remove(member.uid);
        drop(member.uid);
      }
      toast({ tone: 'success', message: copy.done });
      onClose();
    } catch (error) {
      sending.current = false;
      setPending(false);
      setRefusal(toRefusal(error, member));
    }
  }

  return (
    <ConfirmationDialog onClose={pending ? () => undefined : onClose} title={copy.title}>
      <p className="mt-4 leading-7 text-muted">{copy.body}</p>
      <dl className="mt-5 grid gap-3 rounded-xl bg-oat p-4 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-muted">Email</dt>
          <dd className="break-words">{member.email}</dd>
        </div>
        <div>
          <dt className="text-muted">Role</dt>
          <dd>
            {staffRoleLabels[role]}
            {member.firm ? `, ${member.firm}` : ''}
          </dd>
        </div>
      </dl>
      {dialog.kind === 'role' && target === 'broker' ? (
        <div className="mt-5">
          <label className="mb-2 block font-semibold" htmlFor={firmId}>
            Firm
          </label>
          <input
            aria-describedby={firmError ? `${firmId}-error` : undefined}
            aria-invalid={firmError ? true : undefined}
            className={fieldClass}
            disabled={pending}
            id={firmId}
            maxLength={100}
            onChange={(event) => {
              setFirm(event.target.value);
              setFirmError(null);
            }}
            value={firm}
          />
          {firmError ? (
            <p className="mt-1.5 text-sm text-error" id={`${firmId}-error`}>
              {firmError}
            </p>
          ) : null}
        </div>
      ) : null}
      {refusal ? (
        <RefusalNotice onDisableInstead={() => onSwitch({ kind: 'disable', member })} refusal={refusal} />
      ) : null}
      <DialogActions>
        <button className={secondaryClass} disabled={pending} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className={dialog.kind === 'delete' || dialog.kind === 'disable' ? dangerClass : primaryClass}
          disabled={pending}
          onClick={() => void confirm()}
          type="button"
        >
          {pending ? 'Saving…' : copy.confirm}
        </button>
      </DialogActions>
    </ConfirmationDialog>
  );
}

type FormField = 'fullName' | 'email' | 'phone' | 'firm';
type FieldErrors = Partial<Record<FormField, string>>;

// al-core names the field it refused in snake_case.
const apiFields: Record<string, FormField> = { full_name: 'fullName', email: 'email', phone: 'phone', firm: 'firm' };

// The digits after +353. A leading 0, as in 087, is the trunk prefix and is dropped.
export function irishPhoneDigits(input: string) {
  return input.replace(/\D/g, '').replace(/^0/, '');
}

export function validateNewStaff(form: { fullName: string; email: string; phone: string; role: ManagedRole; firm: string }) {
  const errors: FieldErrors = {};
  const digits = irishPhoneDigits(form.phone);

  if (!form.fullName.trim()) errors.fullName = 'Enter their full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter an email address like name@example.com.';
  if (digits.length < 7 || digits.length > 9) errors.phone = 'Enter the 7 to 9 digits after +353, for example 87 123 4567.';
  if (form.role === 'broker' && !form.firm.trim()) errors.firm = 'Enter the firm this broker works for.';

  return errors;
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block font-semibold" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-sm text-error" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-sm text-muted" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error: string | undefined, hint: boolean) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

function CreateDialog({ onClose }: { onClose(): void }) {
  const { service, upsert } = useStaff();
  const toast = useToast();
  const baseId = useId();
  const ids = { fullName: `${baseId}-name`, email: `${baseId}-email`, phone: `${baseId}-phone`, firm: `${baseId}-firm` };
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', role: 'broker' as ManagedRole, firm: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function sendSetPasswordEmail(member: StaffMember) {
    try {
      await service.sendSetPasswordEmail(member.email);
      toast({
        tone: 'success',
        message: `${member.fullName} was added as ${member.role === 'broker' ? 'a broker' : 'an underwriter'}. A set-your-password email is on its way to ${member.email}.`,
      });
    } catch {
      toast({
        tone: 'error',
        message: `${member.fullName}'s account was created, but the set-your-password email could not be sent.`,
        action: { label: 'Send the email again', onAction: () => void sendSetPasswordEmail(member) },
      });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) {
      return;
    }

    const found = validateNewStaff(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      document.getElementById(ids[Object.keys(found)[0] as FormField])?.focus();
      return;
    }

    const member: NewStaffMember = {
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      phone: `+353${irishPhoneDigits(form.phone)}`,
      role: form.role,
      firm: form.role === 'broker' ? form.firm.trim() : null,
    };

    sending.current = true;
    setPending(true);
    setFailure(null);
    try {
      const created = await service.create(member);
      upsert(created);
      onClose();
      void sendSetPasswordEmail(created);
    } catch (error) {
      sending.current = false;
      setPending(false);
      const field = error instanceof ApiError && error.field ? apiFields[error.field] : undefined;
      if (field) {
        setErrors({ [field]: staffFailureMessage(error) });
      } else {
        setFailure(staffFailureMessage(error));
      }
    }
  }

  return (
    <ConfirmationDialog onClose={pending ? () => undefined : onClose} title="New staff member">
      <p className="mt-2 leading-7 text-muted">
        They get an email with a link to set their own password. Admin accounts are made by script, not here.
      </p>
      <form className="mt-6 grid gap-5" noValidate onSubmit={(event) => void submit(event)}>
        <fieldset className="min-w-0" disabled={pending}>
          <legend className="mb-2 font-semibold">Role</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['broker', 'underwriter'] as const).map((role) => (
              <label
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-4 py-2 transition-colors hover:bg-tint has-[:checked]:border-pine has-[:checked]:bg-tint"
                key={role}
              >
                <input
                  checked={form.role === role}
                  className="accent-pine"
                  name={`${baseId}-role`}
                  onChange={() => set('role', role)}
                  type="radio"
                  value={role}
                />
                <span className="font-medium">{staffRoleLabels[role]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field error={errors.fullName} id={ids.fullName} label="Full name">
          <input
            aria-describedby={describedBy(ids.fullName, errors.fullName, false)}
            aria-invalid={errors.fullName ? true : undefined}
            autoComplete="off"
            className={fieldClass}
            disabled={pending}
            id={ids.fullName}
            maxLength={100}
            onChange={(event) => set('fullName', event.target.value)}
            value={form.fullName}
          />
        </Field>
        <Field error={errors.email} id={ids.email} label="Email">
          <input
            aria-describedby={describedBy(ids.email, errors.email, false)}
            aria-invalid={errors.email ? true : undefined}
            autoComplete="off"
            className={fieldClass}
            disabled={pending}
            id={ids.email}
            inputMode="email"
            onChange={(event) => set('email', event.target.value)}
            type="email"
            value={form.email}
          />
        </Field>
        <Field error={errors.phone} hint="Irish mobile or landline, without the +353." id={ids.phone} label="Phone">
          <div className="flex">
            <span className="inline-flex min-h-11 items-center rounded-l-lg border border-r-0 border-line bg-oat px-3 font-mono text-sm text-muted">
              +353
            </span>
            <input
              aria-describedby={describedBy(ids.phone, errors.phone, true)}
              aria-invalid={errors.phone ? true : undefined}
              autoComplete="off"
              className={`${fieldClass} rounded-l-none`}
              disabled={pending}
              id={ids.phone}
              inputMode="tel"
              onChange={(event) => set('phone', event.target.value)}
              type="tel"
              value={form.phone}
            />
          </div>
        </Field>
        {form.role === 'broker' ? (
          <Field error={errors.firm} hint="Shown to borrowers when they choose a broker." id={ids.firm} label="Firm">
            <input
              aria-describedby={describedBy(ids.firm, errors.firm, true)}
              aria-invalid={errors.firm ? true : undefined}
              className={fieldClass}
              disabled={pending}
              id={ids.firm}
              maxLength={100}
              onChange={(event) => set('firm', event.target.value)}
              value={form.firm}
            />
          </Field>
        ) : null}
        {failure ? (
          <p className="rounded-lg bg-danger-soft p-4 text-error" role="alert">
            {failure}
          </p>
        ) : null}
        <DialogActions>
          <button className={secondaryClass} disabled={pending} onClick={onClose} type="button">
            Cancel
          </button>
          <button className={primaryClass} disabled={pending} type="submit">
            {pending ? 'Creating…' : 'Create account'}
          </button>
        </DialogActions>
      </form>
    </ConfirmationDialog>
  );
}

export function StaffDialogHost({ dialog, onChange }: { dialog: StaffDialog | null; onChange(next: StaffDialog | null): void }) {
  if (dialog === null) {
    return null;
  }

  if (dialog.kind === 'create') {
    return <CreateDialog onClose={() => onChange(null)} />;
  }

  // Keyed so that switching from a refused delete to "Disable instead" starts a fresh dialog.
  return (
    <ChangeDialog
      dialog={dialog}
      key={`${dialog.kind}-${dialog.member.uid}`}
      onClose={() => onChange(null)}
      onSwitch={onChange}
    />
  );
}
