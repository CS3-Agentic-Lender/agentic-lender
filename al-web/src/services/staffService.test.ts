import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient, type JsonRequest } from './apiClient';
import { createStaffService, toStaffMember } from './staffService';

const DAN = {
  uid: 'k3J9',
  full_name: 'Dan Hayes',
  email: 'dan@example.com',
  role: 'broker',
  firm: 'Hayes Home Loans',
  phone: '+353871234599',
  enabled: true,
  created_at: '2026-11-24T12:00:00.000Z',
};

function client(answer: unknown) {
  const calls: Array<{ path: string; request: JsonRequest }> = [];
  const api: ApiClient = {
    async request<T>(path: string, request: JsonRequest) {
      calls.push({ path, request });
      if (answer instanceof Error) throw answer;
      return answer as T;
    },
  };
  return { api, calls };
}

describe('staff accounts API', () => {
  it('reads an account from the API shape', () => {
    expect(toStaffMember(DAN)).toEqual({
      uid: 'k3J9',
      fullName: 'Dan Hayes',
      email: 'dan@example.com',
      role: 'broker',
      firm: 'Hayes Home Loans',
      phone: '+353871234599',
      enabled: true,
      createdAt: new Date('2026-11-24T12:00:00.000Z'),
    });
  });

  it.each([
    ['a borrower', { ...DAN, role: 'borrower' }],
    ['no uid', { ...DAN, uid: '' }],
    ['not an object', 'k3J9'],
  ])('leaves out an account with %s', (_label, raw) => {
    expect(toStaffMember(raw)).toBeNull();
  });

  it('lists accounts admins first, then brokers, then underwriters, each by name', async () => {
    const { api, calls } = client([
      { ...DAN, uid: 'u1', full_name: 'Uma Nolan', role: 'underwriter', firm: null },
      { ...DAN, uid: 'b2', full_name: 'Ciara Kelly' },
      { ...DAN, uid: 'a1', full_name: 'Ada Admin', role: 'admin', firm: null },
      { ...DAN, uid: 'b1', full_name: 'Bob Murphy' },
      { ...DAN, uid: 'x', role: 'borrower' },
    ]);
    const staff = await createStaffService(api, vi.fn()).list();
    expect(staff.map((member) => member.fullName)).toEqual(['Ada Admin', 'Bob Murphy', 'Ciara Kelly', 'Uma Nolan']);
    expect(calls).toEqual([{ path: '/core/admin/staff', request: { method: 'GET' } }]);
  });

  it('refuses a list that is not a list', async () => {
    const { api } = client({ staff: [] });
    await expect(createStaffService(api, vi.fn()).list()).rejects.toMatchObject({ kind: 'response' });
  });

  it('sends a new broker with its firm, and an underwriter without one', async () => {
    const { api, calls } = client(DAN);
    const service = createStaffService(api, vi.fn());
    await service.create({ fullName: 'Dan Hayes', email: 'dan@example.com', phone: '+353871234599', role: 'broker', firm: 'Hayes Home Loans' });
    await service.create({ fullName: 'Una Byrne', email: 'una@example.com', phone: '+353871234598', role: 'underwriter', firm: null });
    expect(calls).toEqual([
      {
        path: '/core/admin/staff',
        request: {
          method: 'POST',
          body: { full_name: 'Dan Hayes', email: 'dan@example.com', phone: '+353871234599', role: 'broker', firm: 'Hayes Home Loans' },
        },
      },
      {
        path: '/core/admin/staff',
        request: {
          method: 'POST',
          body: { full_name: 'Una Byrne', email: 'una@example.com', phone: '+353871234598', role: 'underwriter' },
        },
      },
    ]);
  });

  it('patches and deletes one account by its uid', async () => {
    const { api, calls } = client(DAN);
    const service = createStaffService(api, vi.fn());
    await expect(service.update('k3J9/x', { disabled: true })).resolves.toMatchObject({ uid: 'k3J9' });
    await service.update('k3J9', { role: 'broker', firm: 'Quinn Finance' });
    await service.remove('k3J9');
    expect(calls).toEqual([
      { path: '/core/admin/staff/k3J9%2Fx', request: { method: 'PATCH', body: { disabled: true } } },
      { path: '/core/admin/staff/k3J9', request: { method: 'PATCH', body: { role: 'broker', firm: 'Quinn Finance' } } },
      { path: '/core/admin/staff/k3J9', request: { method: 'DELETE' } },
    ]);
  });

  it('passes a refusal on unchanged', async () => {
    const refusal = new ApiError('http', 'No such staff account', 404);
    const { api } = client(refusal);
    await expect(createStaffService(api, vi.fn()).remove('nobody')).rejects.toBe(refusal);
  });

  it('asks Firebase to email the set-your-password link', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await createStaffService(client(null).api, send).sendSetPasswordEmail('dan@example.com');
    expect(send).toHaveBeenCalledExactlyOnceWith('dan@example.com');
  });
});
