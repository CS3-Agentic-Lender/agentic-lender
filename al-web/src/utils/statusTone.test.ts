import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES } from '../services/clientsService';
import { statusTone } from './statusTone';

describe('status badge tone', () => {
  it('gives every agreed lifecycle status its tone', () => {
    expect(APPLICATION_STATUSES.map((status) => [status, statusTone(status)])).toEqual([
      ['Draft', 'neutral'],
      ['Applied', 'neutral'],
      ['AI Deliberated', 'tint'],
      ['Underwriter Approved', 'success'],
      ['Declined', 'danger'],
      ['Funded', 'success'],
      ['Closed', 'neutral'],
    ]);
  });

  it('keeps a status outside the agreed list neutral', () => {
    expect(statusTone('Unknown')).toBe('neutral');
    expect(statusTone('declined')).toBe('neutral');
  });
});
