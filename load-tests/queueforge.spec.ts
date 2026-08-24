/* global __ENV, __ITER, __VU */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- k6 transpiles this portable script without local k6 type packages. */

import { check, fail } from 'k6';
import crypto from 'k6/crypto';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

import { sanitizeSummaryJson } from './summary-sanitizer.ts';

const API_ORIGIN = (__ENV.K6_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const WEB_ORIGIN = (__ENV.K6_WEB_ORIGIN || 'http://127.0.0.1:3100').replace(/\/$/, '');
const PROFILE = __ENV.K6_PROFILE || 'smoke';
const ACME_TENANT_ID = '10000000-0000-4000-8000-000000000001';
const SEEDED_WEBHOOK_ENDPOINT_ID =
  __ENV.K6_INBOUND_ENDPOINT_ID || '50000000-0000-4000-8000-000000000001';
const APPROVER_EMAIL = __ENV.K6_APPROVER_EMAIL || 'approver@queueforge.local';

const correctnessErrors = new Rate('queueforge_correctness_errors');
const submissionDuration = new Trend('queueforge_submission_duration', true);
const idempotencyDuration = new Trend('queueforge_idempotency_duration', true);
const listDuration = new Trend('queueforge_list_duration', true);
const approvalDuration = new Trend('queueforge_approval_duration', true);
const webhookDuration = new Trend('queueforge_webhook_duration', true);
const acceptedSubmissions = new Counter('queueforge_accepted_submissions');
const acceptedWebhooks = new Counter('queueforge_accepted_webhooks');

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = __ENV[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

const loadVus = boundedInteger('K6_LOAD_VUS', 2, 1, 8);
const loadIterations = boundedInteger('K6_LOAD_ITERATIONS', 12, 1, 120);

const smokeScenarios = {
  request_submission: {
    executor: 'shared-iterations',
    exec: 'requestSubmission',
    vus: 1,
    iterations: 1,
    maxDuration: '1m',
    tags: { scenario: 'request_submission' },
  },
  idempotency_replay: {
    executor: 'shared-iterations',
    exec: 'idempotencyReplay',
    vus: 1,
    iterations: 1,
    maxDuration: '1m',
    tags: { scenario: 'idempotency_replay' },
  },
  request_listing: {
    executor: 'shared-iterations',
    exec: 'requestListing',
    vus: 1,
    iterations: 1,
    maxDuration: '1m',
    tags: { scenario: 'request_listing' },
  },
  concurrent_approvals: {
    executor: 'shared-iterations',
    exec: 'concurrentApproval',
    vus: 1,
    iterations: 1,
    maxDuration: '1m',
    tags: { scenario: 'concurrent_approvals' },
  },
  inbound_webhooks: {
    executor: 'shared-iterations',
    exec: 'inboundWebhook',
    vus: 1,
    iterations: 1,
    maxDuration: '1m',
    tags: { scenario: 'inbound_webhooks' },
  },
};

const loadScenarios = {
  request_submission: {
    executor: 'shared-iterations',
    exec: 'requestSubmission',
    vus: loadVus,
    iterations: loadIterations,
    maxDuration: '2m',
    tags: { scenario: 'request_submission' },
  },
  idempotency_replay: {
    executor: 'shared-iterations',
    exec: 'idempotencyReplay',
    vus: loadVus,
    iterations: Math.max(2, Math.ceil(loadIterations / 2)),
    maxDuration: '2m',
    tags: { scenario: 'idempotency_replay' },
  },
  request_listing: {
    executor: 'shared-iterations',
    exec: 'requestListing',
    vus: loadVus,
    iterations: loadIterations * 3,
    maxDuration: '2m',
    tags: { scenario: 'request_listing' },
  },
  concurrent_approvals: {
    executor: 'shared-iterations',
    exec: 'concurrentApproval',
    vus: loadVus,
    iterations: Math.max(2, Math.ceil(loadIterations / 3)),
    maxDuration: '2m',
    tags: { scenario: 'concurrent_approvals' },
  },
  inbound_webhooks: {
    executor: 'shared-iterations',
    exec: 'inboundWebhook',
    vus: loadVus,
    iterations: loadIterations,
    maxDuration: '2m',
    tags: { scenario: 'inbound_webhooks' },
  },
};

if (!['smoke', 'load'].includes(PROFILE)) {
  throw new Error('K6_PROFILE must be smoke or load');
}

export const options = {
  scenarios: PROFILE === 'load' ? loadScenarios : smokeScenarios,
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    queueforge_correctness_errors: ['rate==0'],
    queueforge_submission_duration: ['p(95)<1500'],
    queueforge_idempotency_duration: ['p(95)<1500'],
    queueforge_list_duration: ['p(95)<1000'],
    queueforge_approval_duration: ['p(95)<2000'],
    queueforge_webhook_duration: ['p(95)<2000'],
  },
};

function uuidV4() {
  const bytes = new Uint8Array(crypto.randomBytes(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requiredEnvironment(name) {
  const value = __ENV[name];
  if (!value) fail(`${name} must be loaded from .env before k6 starts`);
  return value;
}

function bearerHeaders(token, extra = {}) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function verify(subject, checks) {
  const correct = check(subject, checks);
  correctnessErrors.add(!correct);
  return correct;
}

function parseJson(response) {
  try {
    return response.json();
  } catch {
    correctnessErrors.add(true);
    return null;
  }
}

function reportUnexpectedResponse(operation, response, expectedStatuses) {
  if (expectedStatuses.includes(response.status)) return;
  let problemCode = 'UNPARSEABLE_RESPONSE';
  let requestId = 'unavailable';
  let correlationId = 'unavailable';
  try {
    const body = response.json();
    if (body && body.error && typeof body.error.code === 'string') {
      problemCode = body.error.code;
    }
    if (body && typeof body.requestId === 'string') requestId = body.requestId;
    if (body && typeof body.correlationId === 'string') correlationId = body.correlationId;
  } catch {
    // Keep diagnostics deliberately limited to status and a non-sensitive problem code.
  }
  console.error(
    `${operation} returned HTTP ${response.status} (${problemCode}); requestId=${requestId}; correlationId=${correlationId}`,
  );
}

function uniqueLabel(prefix) {
  return `${prefix}-${exec.scenario.name}-${__VU}-${__ITER}-${uuidV4()}`;
}

function expenseCommand(label) {
  return {
    workflowKey: 'expense_review',
    payload: {
      amount: 25,
      costCenter: 'QA',
      summary: `k6 ${label}`,
    },
  };
}

function postRequest(token, command, idempotencyKey, tags) {
  return http.post(`${API_ORIGIN}/api/v1/requests`, JSON.stringify(command), {
    headers: bearerHeaders(token, { 'Idempotency-Key': idempotencyKey }),
    tags,
  });
}

function login(email, password) {
  const response = http.post(
    `${API_ORIGIN}/api/v1/auth/login`,
    JSON.stringify({ email, password, tenantId: ACME_TENANT_ID }),
    {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: WEB_ORIGIN,
      },
      tags: { operation: 'login', scenario: 'setup' },
    },
  );
  if (response.status < 200 || response.status >= 300) {
    fail(`QueueForge login failed with HTTP ${response.status}`);
  }
  const body = parseJson(response);
  if (!body || typeof body.accessToken !== 'string' || body.accessToken.length === 0) {
    fail('QueueForge login returned no access token');
  }
  return body.accessToken;
}

export function setup() {
  const password = requiredEnvironment('BOOTSTRAP_ADMIN_PASSWORD');
  const adminEmail = requiredEnvironment('BOOTSTRAP_ADMIN_EMAIL');
  requiredEnvironment('BOOTSTRAP_TENANT_SLUG');
  requiredEnvironment('SINK_SECRET');
  return {
    adminToken: login(adminEmail, password),
    approverToken: login(APPROVER_EMAIL, password),
  };
}

export function handleSummary(data) {
  const summaryPath = requiredEnvironment('K6_SUMMARY_PATH');
  return {
    [summaryPath]: sanitizeSummaryJson(data),
    stdout: `Sanitized k6 ${PROFILE} summary written to ${summaryPath}\n`,
  };
}

export function requestSubmission(data) {
  const response = postRequest(
    data.adminToken,
    expenseCommand(uniqueLabel('submission')),
    uuidV4(),
    { operation: 'submit', scenario: 'request_submission' },
  );
  submissionDuration.add(response.timings.duration);
  reportUnexpectedResponse('request submission', response, [201]);
  const body = parseJson(response);
  if (
    verify(response, {
      'submission is created': (result) => result.status === 201,
      'submission has a request id': () => Boolean(body && typeof body.id === 'string'),
      'submission awaits approval': () => body && body.status === 'pending_approval',
    })
  ) {
    acceptedSubmissions.add(1);
  }
}

export function idempotencyReplay(data) {
  const key = uuidV4();
  const command = expenseCommand(uniqueLabel('idempotency'));
  const first = postRequest(data.adminToken, command, key, {
    operation: 'idempotency_first',
    scenario: 'idempotency_replay',
  });
  const replay = postRequest(data.adminToken, command, key, {
    operation: 'idempotency_replay',
    scenario: 'idempotency_replay',
  });
  idempotencyDuration.add(first.timings.duration + replay.timings.duration);
  const firstBody = parseJson(first);
  const replayBody = parseJson(replay);
  verify(replay, {
    'idempotency calls both succeed': () =>
      first.status >= 200 && first.status < 300 && replay.status >= 200 && replay.status < 300,
    'idempotency reuses the request id': () =>
      Boolean(firstBody && replayBody && firstBody.id === replayBody.id),
    'first request is not marked replayed': () => first.headers['Idempotency-Replayed'] === 'false',
    'second request is marked replayed': () => replay.headers['Idempotency-Replayed'] === 'true',
  });
}

export function requestListing(data) {
  const response = http.get(`${API_ORIGIN}/api/v1/requests?page=1&pageSize=25`, {
    headers: bearerHeaders(data.adminToken),
    tags: { operation: 'list', scenario: 'request_listing' },
  });
  listDuration.add(response.timings.duration);
  const body = parseJson(response);
  verify(response, {
    'request list succeeds': (result) => result.status === 200,
    'request list is paged': () => Boolean(body && Array.isArray(body.items) && body.meta),
    'request list respects page size': () => Boolean(body && body.items.length <= 25),
  });
}

export function concurrentApproval(data) {
  const command = expenseCommand(uniqueLabel('approval'));
  const submission = postRequest(data.adminToken, command, uuidV4(), {
    operation: 'approval_fixture',
    scenario: 'concurrent_approvals',
  });
  const request = parseJson(submission);
  if (
    !verify(submission, {
      'approval fixture is created': (result) => result.status === 201,
      'approval fixture has an id': () => Boolean(request && typeof request.id === 'string'),
    })
  ) {
    return;
  }

  const approvalList = http.get(`${API_ORIGIN}/api/v1/approvals?page=1&pageSize=100`, {
    headers: bearerHeaders(data.approverToken),
    tags: { operation: 'approval_list', scenario: 'concurrent_approvals' },
  });
  const listBody = parseJson(approvalList);
  const task = listBody && listBody.items.find((candidate) => candidate.requestId === request.id);
  if (
    !verify(approvalList, {
      'approval list succeeds': (result) => result.status === 200,
      'approval fixture is visible': () => Boolean(task && task.status === 'pending'),
    })
  ) {
    return;
  }

  const url = `${API_ORIGIN}/api/v1/approvals/${task.id}/decide`;
  const decisionBody = JSON.stringify({
    decision: 'approved',
    expectedRevision: task.revision,
    note: 'Concurrent k6 approval verification',
  });
  const startedAt = Date.now();
  const decisions = http.batch([
    [
      'POST',
      url,
      decisionBody,
      {
        headers: bearerHeaders(data.approverToken, { 'Idempotency-Key': uuidV4() }),
        tags: { operation: 'approval_decide_a', scenario: 'concurrent_approvals' },
      },
    ],
    [
      'POST',
      url,
      decisionBody,
      {
        headers: bearerHeaders(data.approverToken, { 'Idempotency-Key': uuidV4() }),
        tags: { operation: 'approval_decide_b', scenario: 'concurrent_approvals' },
      },
    ],
  ]);
  approvalDuration.add(Date.now() - startedAt);
  decisions.forEach((response, index) => {
    reportUnexpectedResponse(`concurrent approval ${index + 1}`, response, [200, 201]);
  });
  const bodies = decisions.map(parseJson);
  const replayFlags = bodies.map((body) => body && body.replayed).sort();
  const bothSucceed = decisions.every((result) => result.status >= 200 && result.status < 300);
  const sameRequest = bodies.every((body) => body && body.requestId === request.id);
  const oneCommitOneReplay =
    replayFlags.length === 2 && replayFlags[0] === false && replayFlags[1] === true;
  if (!bothSucceed || !sameRequest || !oneCommitOneReplay) {
    console.error(
      `concurrent approval invariant failed; statuses=${decisions.map((result) => result.status).join(',')}; replayFlags=${replayFlags.join(',')}; sameRequest=${sameRequest}`,
    );
  }
  verify(decisions, {
    'concurrent approvals both succeed': () => bothSucceed,
    'concurrent approvals bind one request': () => sameRequest,
    'concurrent approval has one commit and one replay': () => oneCommitOneReplay,
  });
}

export function inboundWebhook() {
  const tenantSlug = requiredEnvironment('BOOTSTRAP_TENANT_SLUG');
  const signingSecret = requiredEnvironment('SINK_SECRET');
  const eventId = uuidV4();
  const idempotencyKey = uuidV4();
  const keyId = __ENV.SINK_KEY_ID || 'local-v1';
  const nonce = uuidV4();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify(expenseCommand(uniqueLabel('webhook')));
  const signature = crypto.hmac(
    'sha256',
    signingSecret,
    `${timestamp}.${nonce}.${eventId}.${idempotencyKey}.${keyId}.${rawBody}`,
    'hex',
  );
  const response = http.post(
    `${API_ORIGIN}/api/v1/inbound/webhooks/${tenantSlug}/${SEEDED_WEBHOOK_ENDPOINT_ID}`,
    rawBody,
    {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Correlation-Id': uuidV4(),
        'X-QueueForge-Event-Id': eventId,
        'X-QueueForge-Key-Id': keyId,
        'X-QueueForge-Nonce': nonce,
        'X-QueueForge-Signature': signature,
        'X-QueueForge-Timestamp': timestamp,
      },
      tags: { operation: 'inbound_webhook', scenario: 'inbound_webhooks' },
    },
  );
  webhookDuration.add(response.timings.duration);
  reportUnexpectedResponse('inbound webhook', response, [202]);
  const body = parseJson(response);
  if (
    verify(response, {
      'signed webhook is accepted': (result) => result.status === 202,
      'signed webhook retains event id': () => Boolean(body && body.eventId === eventId),
      'signed webhook creates one request': () =>
        Boolean(body && body.accepted === true && body.duplicate === false && body.requestId),
    })
  ) {
    acceptedWebhooks.add(1);
  }
}
