const API_PREFIX = '/api/v1';

export const routes = {
  auth: {
    login: `${API_PREFIX}/auth/login`,
    logout: `${API_PREFIX}/auth/logout`,
    refresh: `${API_PREFIX}/auth/refresh`,
    selectTenant: `${API_PREFIX}/auth/tenant-select`,
    session: `${API_PREFIX}/session/me`,
  },
  dashboard: `${API_PREFIX}/dashboard/overview`,
  requests: `${API_PREFIX}/requests`,
  request: (id: string): string => `${API_PREFIX}/requests/${encodeURIComponent(id)}`,
  requestTimeline: (id: string): string =>
    `${API_PREFIX}/requests/${encodeURIComponent(id)}/timeline`,
  requestCancel: (id: string): string => `${API_PREFIX}/requests/${encodeURIComponent(id)}/cancel`,
  requestRetry: (id: string): string => `${API_PREFIX}/requests/${encodeURIComponent(id)}/retry`,
  approvals: `${API_PREFIX}/approvals`,
  approvalDecision: (id: string): string =>
    `${API_PREFIX}/approvals/${encodeURIComponent(id)}/decide`,
  workflows: `${API_PREFIX}/workflows`,
  workflow: (id: string): string => `${API_PREFIX}/workflows/${encodeURIComponent(id)}`,
  workflowDraft: (id: string): string => `${API_PREFIX}/workflows/${encodeURIComponent(id)}/draft`,
  workflowActivate: (id: string): string =>
    `${API_PREFIX}/workflows/${encodeURIComponent(id)}/activate`,
  workflowCloneDraft: (id: string): string =>
    `${API_PREFIX}/workflows/${encodeURIComponent(id)}/clone-draft`,
  webhookEndpoints: `${API_PREFIX}/webhooks/endpoints`,
  webhookDeliveries: `${API_PREFIX}/webhooks/deliveries`,
  replayWebhookDelivery: (id: string): string =>
    `${API_PREFIX}/webhooks/deliveries/${encodeURIComponent(id)}/replay`,
  queues: `${API_PREFIX}/operations/queues`,
  deadLetters: `${API_PREFIX}/operations/dead-letters`,
  retryDeadLetter: (id: string): string =>
    `${API_PREFIX}/operations/dead-letters/${encodeURIComponent(id)}/retry`,
  notifications: `${API_PREFIX}/notifications`,
  notification: (id: string): string => `${API_PREFIX}/notifications/${encodeURIComponent(id)}`,
  audit: `${API_PREFIX}/audit`,
  team: `${API_PREFIX}/team/memberships`,
  teamMember: (id: string): string => `${API_PREFIX}/team/memberships/${encodeURIComponent(id)}`,
} as const;
