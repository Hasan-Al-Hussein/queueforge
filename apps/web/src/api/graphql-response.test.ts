import { describe, expect, it } from 'vitest';

import { stripGraphqlTypenames } from './graphql-response';

describe('stripGraphqlTypenames', () => {
  it('removes Apollo metadata from declared envelope nodes only', () => {
    expect(
      stripGraphqlTypenames(
        {
          __typename: 'DashboardOverview',
          rows: [
            { __typename: 'WorkflowRequest', payload: { __typename: 'DomainPayload', ok: true } },
          ],
        },
        [['rows', '*']],
      ),
    ).toEqual({
      rows: [{ payload: { __typename: 'DomainPayload', ok: true } }],
    });
  });

  it('preserves legitimate typename keys anywhere inside an opaque JSON scalar', () => {
    const payload = {
      __typename: 'CustomerSuppliedValue',
      nested: { __typename: 'StillCustomerSupplied', count: 2 },
    };

    const result = stripGraphqlTypenames(
      {
        __typename: 'RequestDetail',
        request: { __typename: 'WorkflowRequest', payload },
        unlisted: { __typename: 'NotAnEnvelope' },
      },
      [['request']],
    );

    expect(result).toEqual({
      request: { payload },
      unlisted: { __typename: 'NotAnEnvelope' },
    });
  });
});
