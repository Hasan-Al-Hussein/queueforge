import type { JsonObject } from '@queueforge/contracts';

export type WorkflowFieldKind =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'choice'
  | 'email'
  | 'url'
  | 'date';

export interface WorkflowField {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly kind: WorkflowFieldKind;
  readonly required: boolean;
  readonly options: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly defaultValue?: string | number | boolean;
}

export interface WorkflowSchemaResult {
  readonly fields: readonly WorkflowField[];
  readonly supported: boolean;
  readonly reason?: string;
}

export interface WorkflowPayloadResult {
  readonly errors: Readonly<Record<string, string>>;
  readonly payload?: JsonObject;
}

const ROOT_KEYS = new Set([
  '$schema',
  'additionalProperties',
  'description',
  'properties',
  'required',
  'title',
  'type',
]);
const PROPERTY_KEYS = new Set([
  'default',
  'description',
  'enum',
  'format',
  'maximum',
  'maxLength',
  'minimum',
  'minLength',
  'title',
  'type',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function humanizeKey(key: string): string {
  const spaced = key
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/[_-]+/g, ' ')
    .trim();
  return spaced === '' ? 'Untitled field' : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function inferKind(property: Record<string, unknown>): WorkflowFieldKind | null {
  if (property.type === 'boolean') return 'boolean';
  if (property.type === 'number') return 'number';
  if (property.type === 'integer') return 'integer';
  if (property.type !== 'string') return null;
  if (Array.isArray(property.enum) && property.enum.every((item) => typeof item === 'string')) {
    return 'choice';
  }
  if (property.format === 'email') return 'email';
  if (property.format === 'uri' || property.format === 'url') return 'url';
  if (property.format === 'date') return 'date';
  return typeof property.maxLength === 'number' && property.maxLength > 120
    ? 'long_text'
    : 'short_text';
}

export function readWorkflowSchema(schema: Record<string, unknown>): WorkflowSchemaResult {
  if (schema.type !== 'object' || !isRecord(schema.properties)) {
    return {
      fields: [],
      reason: 'Guided forms currently support object schemas with named properties.',
      supported: false,
    };
  }
  if (Object.keys(schema).some((key) => !ROOT_KEYS.has(key))) {
    return {
      fields: [],
      reason: 'This schema uses advanced root rules. Open Advanced JSON to edit it safely.',
      supported: false,
    };
  }
  const requiredKeys = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  const required = new Set(requiredKeys);
  const requiredOrder = new Map(requiredKeys.map((key, index) => [key, index]));
  const propertyEntries = Object.entries(schema.properties).sort(([left], [right]) => {
    const leftOrder = requiredOrder.get(left);
    const rightOrder = requiredOrder.get(right);
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return left.localeCompare(right);
  });
  const fields: WorkflowField[] = [];
  for (const [key, value] of propertyEntries) {
    if (
      !isRecord(value) ||
      Object.keys(value).some((propertyKey) => !PROPERTY_KEYS.has(propertyKey))
    ) {
      return {
        fields: [],
        reason: `The “${humanizeKey(key)}” field uses advanced validation rules.`,
        supported: false,
      };
    }
    const kind = inferKind(value);
    if (kind === null) {
      return {
        fields: [],
        reason: `The “${humanizeKey(key)}” field uses a nested or unsupported type.`,
        supported: false,
      };
    }
    const options =
      kind === 'choice' && Array.isArray(value.enum)
        ? value.enum.filter((item): item is string => typeof item === 'string')
        : [];
    const defaultValue =
      typeof value.default === 'string' ||
      typeof value.default === 'number' ||
      typeof value.default === 'boolean'
        ? value.default
        : undefined;
    fields.push({
      key,
      label: typeof value.title === 'string' ? value.title : humanizeKey(key),
      description: typeof value.description === 'string' ? value.description : '',
      kind,
      required: required.has(key),
      options,
      minimum: optionalNumber(value.minimum),
      maximum: optionalNumber(value.maximum),
      minLength: optionalNumber(value.minLength),
      maxLength: optionalNumber(value.maxLength),
      defaultValue,
    });
  }
  return { fields, supported: true };
}

function propertyFromField(field: WorkflowField): Record<string, unknown> {
  const property: Record<string, unknown> = {};
  if (field.kind === 'number') property.type = 'number';
  else if (field.kind === 'integer') property.type = 'integer';
  else if (field.kind === 'boolean') property.type = 'boolean';
  else property.type = 'string';
  if (field.label.trim() !== humanizeKey(field.key)) {
    property.title = field.label;
  }
  if (field.description.trim() !== '') property.description = field.description.trim();
  if (field.kind === 'choice') property.enum = [...field.options];
  if (field.kind === 'email') property.format = 'email';
  if (field.kind === 'url') property.format = 'uri';
  if (field.kind === 'date') property.format = 'date';
  if (field.minimum !== undefined) property.minimum = field.minimum;
  if (field.maximum !== undefined) property.maximum = field.maximum;
  if (field.minLength !== undefined) property.minLength = field.minLength;
  if (field.maxLength !== undefined) property.maxLength = field.maxLength;
  if (field.defaultValue !== undefined) property.default = field.defaultValue;
  return property;
}

export function writeWorkflowSchema(fields: readonly WorkflowField[]): JsonObject {
  const properties: Record<string, unknown> = {};
  for (const field of fields) properties[field.key] = propertyFromField(field);
  const required = fields.filter((field) => field.required).map((field) => field.key);
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required }),
  };
}

export function initialWorkflowPayload(fields: readonly WorkflowField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.defaultValue ?? (field.kind === 'boolean' ? false : ''),
    ]),
  );
}

function validateText(field: WorkflowField, value: string): string | null {
  if (field.required && value.trim() === '') return `${field.label} is required.`;
  if (value === '') return null;
  if (field.minLength !== undefined && value.length < field.minLength) {
    return `${field.label} must contain at least ${String(field.minLength)} characters.`;
  }
  if (field.maxLength !== undefined && value.length > field.maxLength) {
    return `${field.label} must contain no more than ${String(field.maxLength)} characters.`;
  }
  if (field.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return `Enter a valid email address for ${field.label}.`;
  }
  if (field.kind === 'url') {
    try {
      new URL(value);
    } catch {
      return `Enter a valid URL for ${field.label}.`;
    }
  }
  return null;
}

export function buildWorkflowPayload(
  fields: readonly WorkflowField[],
  values: Readonly<Record<string, unknown>>,
): WorkflowPayloadResult {
  const errors: Record<string, string> = {};
  const payload: JsonObject = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (field.kind === 'boolean') {
      payload[field.key] = raw === true;
      continue;
    }
    if (field.kind === 'number' || field.kind === 'integer') {
      if (raw === '' || raw === undefined || raw === null) {
        if (field.required) errors[field.key] = `${field.label} is required.`;
        continue;
      }
      const number = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(number) || (field.kind === 'integer' && !Number.isInteger(number))) {
        errors[field.key] =
          `${field.label} must be ${field.kind === 'integer' ? 'a whole' : 'a valid'} number.`;
        continue;
      }
      if (field.minimum !== undefined && number < field.minimum) {
        errors[field.key] = `${field.label} must be at least ${String(field.minimum)}.`;
        continue;
      }
      if (field.maximum !== undefined && number > field.maximum) {
        errors[field.key] = `${field.label} must be no more than ${String(field.maximum)}.`;
        continue;
      }
      payload[field.key] = number;
      continue;
    }
    const text = typeof raw === 'string' ? raw : '';
    const textError = validateText(field, text);
    if (textError !== null) {
      errors[field.key] = textError;
      continue;
    }
    if (text !== '') payload[field.key] = text;
  }
  return Object.keys(errors).length === 0 ? { errors, payload } : { errors };
}

export function fieldKindLabel(kind: WorkflowFieldKind): string {
  return {
    boolean: 'Yes / no',
    choice: 'Choice list',
    date: 'Date',
    email: 'Email',
    integer: 'Whole number',
    long_text: 'Long text',
    number: 'Number',
    short_text: 'Short text',
    url: 'Web address',
  }[kind];
}

export function nextWorkflowFieldKey(fields: readonly WorkflowField[]): string {
  const used = new Set(fields.map((field) => field.key));
  let number = fields.length + 1;
  while (used.has(`field_${String(number)}`)) number += 1;
  return `field_${String(number)}`;
}

export function normalizeWorkflowFieldKey(value: string): string {
  return value
    .trim()
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/[^a-zA-Z0-9_]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .toLowerCase();
}

export function workflowFieldLabel(key: string): string {
  return humanizeKey(key);
}
