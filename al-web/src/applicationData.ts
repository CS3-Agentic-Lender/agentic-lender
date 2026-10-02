export type Application = {
  id: string;
  name: string;
  type: string;
  amount: string;
  due: string;
  status: 'Ready for review' | 'Needs documents' | 'In review';
};

export const applications: Application[] = [
  { id: 'AL-1048', name: 'Aisling Murphy', type: 'First-time buyer', amount: '€320,000', due: 'Review next', status: 'Ready for review' },
  { id: 'AL-1046', name: 'Samir Patel', type: 'Home mover', amount: '€410,000', due: 'Waiting on payslip', status: 'Needs documents' },
  { id: 'AL-1042', name: 'Maeve Byrne', type: 'Home equity loan', amount: '€85,000', due: 'Continue review', status: 'In review' },
];

export function filterApplications(rows: Application[], query: string, status: 'all' | 'review' | 'waiting') {
  const normalized = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    const matchesText = `${row.name} ${row.id}`.toLocaleLowerCase().includes(normalized);
    const matchesStatus = status === 'all' || (status === 'waiting' ? row.status === 'Needs documents' : row.status !== 'Needs documents');
    return matchesText && matchesStatus;
  });
}
