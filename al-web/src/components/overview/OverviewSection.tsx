import type { ReactNode } from 'react';

interface OverviewSectionProps {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}

// One titled block of an overview page.
export function OverviewSection({ id, title, description, children }: OverviewSectionProps) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight" id={id}>
        {title}
      </h2>
      <p className="mt-2 text-muted">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}
