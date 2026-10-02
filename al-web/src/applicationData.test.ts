import { describe, expect, it } from 'vitest';
import { applications, filterApplications } from './applicationData';

describe('application queue filtering', () => {
  it('combines status and borrower search without hiding a matching reference', () => {
    expect(filterApplications(applications, 'AL-1046', 'waiting').map((item) => item.name)).toEqual(['Samir Patel']);
    expect(filterApplications(applications, 'AL-1046', 'review')).toEqual([]);
  });
});
