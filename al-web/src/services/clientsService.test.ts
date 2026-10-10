import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import {
  buildBrokerClients,
  toBrokerApplication,
  type BrokerApplication,
  type ClientProfile,
} from './clientsService';

function application(overrides: Partial<BrokerApplication> & Pick<BrokerApplication, 'id' | 'borrowerId'>) {
  return {
    status: 'Applied',
    loanType: null,
    loanAmountEur: null,
    ltvPct: null,
    updatedAt: null,
    ...overrides,
  } satisfies BrokerApplication;
}

function profile(uid: string, fullName: string | null): ClientProfile {
  return { uid, fullName, email: null, county: null };
}

describe('building the broker client list', () => {
  it('groups applications under the borrower who made them', () => {
    const clients = buildBrokerClients(
      [profile('borrower-1', 'Alice Byrne')],
      [
        application({ id: 'app-1', borrowerId: 'borrower-1' }),
        application({ id: 'app-2', borrowerId: 'borrower-1' }),
      ],
    );

    expect(clients).toHaveLength(1);
    expect(clients[0].profile?.fullName).toBe('Alice Byrne');
    expect(clients[0].applications.map(({ id }) => id)).toEqual(['app-1', 'app-2']);
  });

  it('lists a borrower who chose the broker but has not applied yet', () => {
    const clients = buildBrokerClients([profile('borrower-2', 'Ben Walsh')], []);

    expect(clients).toEqual([
      { id: 'borrower-2', profile: profile('borrower-2', 'Ben Walsh'), applications: [] },
    ]);
  });

  it('keeps a client whose profile cannot be read', () => {
    const clients = buildBrokerClients([], [application({ id: 'app-1', borrowerId: 'borrower-1' })]);

    expect(clients).toHaveLength(1);
    expect(clients[0].profile).toBeNull();
  });

  it('orders named clients by name and puts the most recently updated application first', () => {
    const clients = buildBrokerClients(
      [profile('borrower-2', 'Ben Walsh'), profile('borrower-1', 'Alice Byrne')],
      [
        application({ id: 'older', borrowerId: 'borrower-1', updatedAt: new Date('2026-10-01') }),
        application({ id: 'newer', borrowerId: 'borrower-1', updatedAt: new Date('2026-10-05') }),
        application({ id: 'unnamed', borrowerId: 'borrower-3' }),
      ],
    );

    expect(clients.map(({ id }) => id)).toEqual(['borrower-1', 'borrower-2', 'borrower-3']);
    expect(clients[0].applications.map(({ id }) => id)).toEqual(['newer', 'older']);
  });
});

describe('reading an application document', () => {
  it('maps the stored fields and falls back to createdAt when updatedAt is missing', () => {
    const createdAt = Timestamp.fromDate(new Date('2026-10-05T10:00:00Z'));

    expect(
      toBrokerApplication('app-1', {
        borrowerId: 'borrower-1',
        brokerId: 'broker-1',
        status: 'AI Deliberated',
        loanAmountEur: 230000,
        ltvPct: 82.5,
        createdAt,
      }),
    ).toEqual({
      id: 'app-1',
      borrowerId: 'borrower-1',
      status: 'AI Deliberated',
      loanType: null,
      loanAmountEur: 230000,
      ltvPct: 82.5,
      updatedAt: createdAt.toDate(),
    });
  });

  it('leaves out values that are missing or the wrong type instead of guessing them', () => {
    const result = toBrokerApplication('app-1', {
      borrowerId: 'borrower-1',
      loanAmountEur: '230000',
      ltvPct: Number.NaN,
    });

    expect(result).toMatchObject({ status: 'Unknown', loanAmountEur: null, ltvPct: null, updatedAt: null });
  });

  it('skips a document with no borrower', () => {
    expect(toBrokerApplication('app-1', { status: 'Applied' })).toBeNull();
  });
});
