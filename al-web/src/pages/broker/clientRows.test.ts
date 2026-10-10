import { describe, expect, it } from 'vitest';
import type { BrokerClient } from '../../services/clientsService';
import { ALL_STATUSES, filterClientRows, toClientRows } from './clientRows';

const clients: BrokerClient[] = [
  {
    id: 'borrower-1',
    profile: { uid: 'borrower-1', fullName: 'Alice Byrne', email: null, county: null },
    applications: [
      {
        id: 'app-applied',
        borrowerId: 'borrower-1',
        status: 'Applied',
        loanType: 'mortgage',
        loanAmountEur: 230000,
        ltvPct: 82.5,
        updatedAt: null,
      },
      {
        id: 'app-funded',
        borrowerId: 'borrower-1',
        status: 'Funded',
        loanType: 'mortgage',
        loanAmountEur: 180000,
        ltvPct: 70,
        updatedAt: null,
      },
    ],
  },
  {
    id: 'borrower-2',
    profile: { uid: 'borrower-2', fullName: 'Ben Walsh', email: null, county: null },
    applications: [],
  },
];

const rows = toClientRows(clients);

describe('client rows', () => {
  it('makes one row per application and one for a client with none', () => {
    expect(rows.map(({ client, application }) => [client.id, application?.id ?? null])).toEqual([
      ['borrower-1', 'app-applied'],
      ['borrower-1', 'app-funded'],
      ['borrower-2', null],
    ]);
  });

  it('returns every row when no filter is set', () => {
    expect(filterClientRows(rows, { search: '', status: ALL_STATUSES })).toHaveLength(3);
  });

  it('filters by status, which drops clients with no application', () => {
    const filtered = filterClientRows(rows, { search: '', status: 'Funded' });

    expect(filtered.map(({ application }) => application?.id)).toEqual(['app-funded']);
  });

  it.each([
    ['client name', 'ben', ['borrower-2']],
    ['client ID', 'BORROWER-1', ['borrower-1', 'borrower-1']],
    ['application ID', 'app-fund', ['borrower-1']],
  ] as const)('searches by %s without caring about case', (_label, search, expectedClients) => {
    const filtered = filterClientRows(rows, { search, status: ALL_STATUSES });

    expect(filtered.map(({ client }) => client.id)).toEqual(expectedClients);
  });

  it('combines the search and the status filter', () => {
    expect(filterClientRows(rows, { search: 'alice', status: 'Applied' })).toHaveLength(1);
    expect(filterClientRows(rows, { search: 'ben', status: 'Applied' })).toHaveLength(0);
  });
});
