import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { directoryNames, toDirectoryUser } from './userDirectoryService';

describe('user directory', () => {
  it('reads a borrower and a disabled broker', () => {
    const createdAt = new Date('2026-09-20T09:00:00Z');
    expect(
      toDirectoryUser('borrower1', {
        role: 'borrower',
        fullName: 'Alice Byrne',
        email: 'alice@test.com',
        brokerId: 'broker1',
        county: 'Cork',
        createdAt: Timestamp.fromDate(createdAt),
      }),
    ).toEqual({
      uid: 'borrower1',
      role: 'borrower',
      fullName: 'Alice Byrne',
      email: 'alice@test.com',
      firm: null,
      brokerId: 'broker1',
      disabled: false,
      createdAt,
    });
    expect(toDirectoryUser('broker3', { role: 'broker', firm: 'Quinn', disabled: true })).toMatchObject({
      firm: 'Quinn',
      disabled: true,
    });
  });

  it('names a user by full name, then email, and knows no one else', () => {
    const nameOf = directoryNames([
      toDirectoryUser('a', { fullName: 'Alice Byrne', email: 'alice@test.com' }),
      toDirectoryUser('b', { email: 'ben@test.com' }),
    ]);
    expect([nameOf('a'), nameOf('b'), nameOf('c'), nameOf(null)]).toEqual(['Alice Byrne', 'ben@test.com', null, null]);
  });
});
