import type { EventEnvelope, JsonObject, TenantContext, TenantRole } from '@queueforge/contracts';

export const SYNTHETIC_IDS = Object.freeze({
  tenantAcme: '018f4f77-8df8-7f20-b735-e307671e9110',
  tenantGlobex: '018f4f77-8df8-7f20-b735-e307671e9111',
  adminUser: '018f4f77-8df8-7f20-b735-e307671e9120',
  approverUser: '018f4f77-8df8-7f20-b735-e307671e9121',
  operatorUser: '018f4f77-8df8-7f20-b735-e307671e9122',
  workflow: '018f4f77-8df8-7f20-b735-e307671e9130',
  workflowVersion: '018f4f77-8df8-7f20-b735-e307671e9131',
  request: '018f4f77-8df8-7f20-b735-e307671e9140',
  event: '018f4f77-8df8-7f20-b735-e307671e9150',
  correlation: '018f4f77-8df8-7f20-b735-e307671e9160',
} as const);

export const SECRET_CANARIES = Object.freeze([
  'qf-password-canary-never-log',
  'qf-refresh-canary-never-log',
  'qf-webhook-canary-never-log',
  'qf-api-key-canary-never-log',
]);

export function tenantContextFixture(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: SYNTHETIC_IDS.tenantAcme,
    principalId: SYNTHETIC_IDS.operatorUser,
    principalKind: 'user',
    role: 'operator',
    sessionId: '018f4f77-8df8-7f20-b735-e307671e9170',
    ...overrides,
  };
}

export function tenantContextForRole(role: TenantRole): TenantContext {
  return tenantContextFixture({ role });
}

export function eventEnvelopeFixture(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    schemaVersion: 1,
    eventId: SYNTHETIC_IDS.event,
    tenantId: SYNTHETIC_IDS.tenantAcme,
    eventType: 'request.queued',
    aggregateType: 'workflow_request',
    aggregateId: SYNTHETIC_IDS.request,
    correlationId: SYNTHETIC_IDS.correlation,
    occurredAt: '2026-08-24T08:00:00.000Z',
    payload: {},
    ...overrides,
  };
}

export function requestPayloadFixture(overrides: JsonObject = {}): JsonObject {
  return {
    amount: 1_250,
    currency: 'AED',
    costCenter: 'ENG-PLATFORM',
    justification: 'Synthetic queue durability demonstration',
    ...overrides,
  };
}
