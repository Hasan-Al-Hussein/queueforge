import { describe, expect, it } from 'vitest';

import { activityPresentation, formattedTechnicalSummary } from './activity-presentation';

describe('activity presentation', () => {
  it('turns request completion metadata into a concise explanation', () => {
    expect(
      activityPresentation({
        eventType: 'request.succeeded',
        resourceType: 'workflow_request',
        summary: '{"attemptNo":1,"notifications":1,"webhookDeliveries":2}',
      }),
    ).toEqual({
      action: 'Request completed',
      category: 'Requests',
      resource: 'request',
      summary: 'Finished on attempt 1. 1 notification created. 2 result deliveries created.',
    });
  });

  it('explains delivery results while retaining the HTTP code', () => {
    expect(
      activityPresentation({
        eventType: 'webhook.delivery.delivered',
        resourceType: 'webhook_delivery',
        summary: '{"attemptNo":1,"responseStatus":202}',
      }).summary,
    ).toBe('Delivered on attempt 1; the receiver replied with HTTP 202.');
  });

  it('keeps unknown activity understandable and technical metadata inspectable', () => {
    expect(
      activityPresentation({
        eventType: 'invoice.export_ready',
        resourceType: 'invoice_export',
        summary: '{"batch":3}',
      }),
    ).toMatchObject({
      action: 'Invoice export ready',
      category: 'Other',
      resource: 'Invoice export',
    });
    expect(formattedTechnicalSummary('{"batch":3}')).toBe('{\n  "batch": 3\n}');
  });

  it('does not expose raw malformed text in the plain-language summary', () => {
    expect(
      activityPresentation({
        eventType: 'request.succeeded',
        resourceType: 'workflow_request',
        summary: 'not-json',
      }).summary,
    ).toBe('QueueForge recorded this activity.');
    expect(formattedTechnicalSummary('not-json')).toBe('not-json');
  });

  it('uses a complete sentence when optional completion counts are absent', () => {
    expect(
      activityPresentation({
        eventType: 'request.succeeded',
        resourceType: 'workflow_request',
        summary: '{}',
      }).summary,
    ).toBe('The request finished successfully.');
  });
});
