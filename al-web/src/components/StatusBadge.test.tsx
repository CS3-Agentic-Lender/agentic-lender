import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

afterEach(cleanup);

describe('status badge classes', () => {
  it.each([
    ['Draft', 'bg-neutral', 'text-neutral-text'],
    ['Applied', 'bg-neutral', 'text-neutral-text'],
    ['Closed', 'bg-neutral', 'text-neutral-text'],
    ['AI Deliberated', 'bg-tint', 'text-pine'],
    ['Underwriter Approved', 'bg-success-soft', 'text-success'],
    ['Funded', 'bg-success-soft', 'text-success'],
    ['Declined', 'bg-danger-soft', 'text-error'],
    ['Unknown', 'bg-neutral', 'text-neutral-text'],
  ])('renders %s with its semantic background and text classes', (status, background, text) => {
    render(<StatusBadge status={status} />);

    expect(screen.getByText(status)).toHaveClass(background, text);
  });
});
