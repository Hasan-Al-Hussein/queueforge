import { describe, expect, it } from 'vitest';

import {
  buildWorkflowPayload,
  initialWorkflowPayload,
  readWorkflowSchema,
  writeWorkflowSchema,
} from './workflow-schema';

const expenseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'costCenter', 'summary'],
  properties: {
    amount: { type: 'number', minimum: 1, maximum: 100_000 },
    costCenter: { type: 'string', minLength: 2, maxLength: 40 },
    summary: { type: 'string', minLength: 3, maxLength: 500 },
  },
};

describe('workflow schema helpers', () => {
  it('turns the seeded expense schema into friendly fields and a valid payload', () => {
    const result = readWorkflowSchema({
      ...expenseSchema,
      // PostgreSQL JSONB may return object keys in a different order. The required list preserves
      // the administrator's intended question sequence for this all-required form.
      properties: {
        amount: expenseSchema.properties.amount,
        summary: expenseSchema.properties.summary,
        costCenter: expenseSchema.properties.costCenter,
      },
    });
    expect(result.supported).toBe(true);
    expect(result.fields.map((field) => [field.key, field.label, field.kind])).toEqual([
      ['amount', 'Amount', 'number'],
      ['costCenter', 'Cost Center', 'short_text'],
      ['summary', 'Summary', 'long_text'],
    ]);
    expect(initialWorkflowPayload(result.fields)).toEqual({
      amount: '',
      costCenter: '',
      summary: '',
    });
    expect(
      buildWorkflowPayload(result.fields, {
        amount: '1250',
        costCenter: 'OPS-42',
        summary: 'Team equipment',
      }),
    ).toEqual({
      errors: {},
      payload: { amount: 1250, costCenter: 'OPS-42', summary: 'Team equipment' },
    });
  });

  it('reports field-level errors before submission', () => {
    const fields = readWorkflowSchema(expenseSchema).fields;
    const result = buildWorkflowPayload(fields, { amount: '0', costCenter: 'X', summary: '' });
    expect(result.payload).toBeUndefined();
    expect(result.errors).toEqual({
      amount: 'Amount must be at least 1.',
      costCenter: 'Cost Center must contain at least 2 characters.',
      summary: 'Summary is required.',
    });
  });

  it('round-trips fields created by the visual builder', () => {
    const fields = readWorkflowSchema(expenseSchema).fields;
    expect(readWorkflowSchema(writeWorkflowSchema(fields)).fields).toEqual(fields);
  });

  it('keeps unsupported nested schemas in advanced mode', () => {
    const result = readWorkflowSchema({
      type: 'object',
      properties: { owner: { type: 'object', properties: {} } },
    });
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/advanced|nested/);
  });
});
