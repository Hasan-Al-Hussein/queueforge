import { ApolloLink, Observable } from '@apollo/client';

import { showcaseDashboard, showcaseRequestDetail } from './store';

export function createShowcaseApolloLink(): ApolloLink {
  return new ApolloLink(
    (operation) =>
      new Observable((observer) => {
        try {
          if (operation.operationName === 'DashboardOverview') {
            observer.next({ data: { dashboardOverview: showcaseDashboard() } });
            observer.complete();
            return;
          }
          if (operation.operationName === 'RequestDetail') {
            const variables: Readonly<Record<string, unknown>> = operation.variables;
            const id = variables['id'];
            if (typeof id !== 'string') throw new Error('Request ID is required.');
            observer.next({ data: { requestDetail: showcaseRequestDetail(id) } });
            observer.complete();
            return;
          }
          throw new Error(`Unsupported showcase query: ${operation.operationName}`);
        } catch (error) {
          observer.error(error);
        }
      }),
  );
}
