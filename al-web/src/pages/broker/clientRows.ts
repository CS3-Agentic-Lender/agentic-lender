import type { BrokerApplication, BrokerClient } from '../../services/clientsService';

export interface ClientRow {
  client: BrokerClient;
  application: BrokerApplication | null;
}

export interface ClientRowFilters {
  search: string;
  status: string;
}

export const ALL_STATUSES = 'all';

// One row per application; a client who has not applied yet still gets a row.
export function toClientRows(clients: readonly BrokerClient[]): ClientRow[] {
  return clients.flatMap<ClientRow>((client) =>
    client.applications.length === 0
      ? [{ client, application: null }]
      : client.applications.map((application) => ({ client, application })),
  );
}

export function filterClientRows(rows: readonly ClientRow[], filters: ClientRowFilters) {
  const search = filters.search.trim().toLowerCase();

  return rows.filter(({ client, application }) => {
    if (filters.status !== ALL_STATUSES && application?.status !== filters.status) {
      return false;
    }

    if (search === '') {
      return true;
    }

    return [client.profile?.fullName, client.id, application?.id].some((value) =>
      value?.toLowerCase().includes(search),
    );
  });
}
