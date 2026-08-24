import { describe, expect, it } from 'vitest';

import { requestListSearchParams, requestSortFromTable } from './requests-screen';

describe('request list server query policy', () => {
  it('builds a bounded global search and sort query', () => {
    const query = requestListSearchParams({
      page: 3,
      pageSize: 25,
      search: '  expense failed  ',
      sortBy: 'workflowName',
      sortDirection: 'asc',
      status: 'failed',
    });

    expect(Object.fromEntries(query)).toEqual({
      page: '3',
      pageSize: '25',
      search: 'expense failed',
      sortBy: 'workflowName',
      sortDirection: 'asc',
      status: 'failed',
    });
  });

  it('omits blank search/all-status and rejects unsupported table sort IDs', () => {
    const query = requestListSearchParams({
      page: 1,
      pageSize: 20,
      search: '   ',
      sortBy: 'submittedAt',
      sortDirection: 'desc',
      status: 'all',
    });

    expect(query.has('search')).toBe(false);
    expect(query.has('status')).toBe(false);
    expect(requestSortFromTable([{ desc: false, id: 'versionNo' }])).toEqual({
      sortBy: 'submittedAt',
      sortDirection: 'desc',
    });
  });
});
