import type { ReactNode } from 'react';
import { PortalHeader } from '../PortalHeader';

interface AdminPageProps {
  title: string;
  description: ReactNode;
  // Buttons beside the heading, such as "New staff member".
  actions?: ReactNode;
  // A section's own navigation, under the heading.
  subnav?: ReactNode;
  children: ReactNode;
}

// The frame every admin page shares, laid out like the underwriter's pipeline page.
export function AdminPage({ title, description, actions, subnav, children }: AdminPageProps) {
  return (
    <div className="min-h-screen bg-oat text-ink">
      <PortalHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0 max-w-2xl">
            <p className="font-mono text-xs font-medium tracking-widest text-muted uppercase">Admin portal</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-4 leading-7 text-muted">{description}</p>
          </div>
          {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
        </div>
        {subnav ? <div className="mt-8">{subnav}</div> : null}
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
