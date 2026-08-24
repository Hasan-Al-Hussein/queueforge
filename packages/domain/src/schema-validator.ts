import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

import type { JsonObject } from '@queueforge/contracts';

import { DomainError } from './errors.js';

export interface PayloadValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ErrorObject[];
}

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
});

export function compilePayloadSchema(schema: JsonObject): ValidateFunction {
  try {
    return ajv.compile(schema);
  } catch {
    throw new DomainError(
      'PAYLOAD_SCHEMA_INVALID',
      'Request schema is not a supported JSON Schema',
    );
  }
}

export function validatePayload(schema: JsonObject, payload: JsonObject): PayloadValidationResult {
  const validator = compilePayloadSchema(schema);
  const valid = validator(payload);
  return {
    valid: valid === true,
    errors: Object.freeze([...(validator.errors ?? [])]),
  };
}
