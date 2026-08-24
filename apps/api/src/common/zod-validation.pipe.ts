import { Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

import { ApplicationError } from '@queueforge/application';

interface RuntimeSchema<T> {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: T }
    | {
        readonly success: false;
        readonly error: {
          readonly issues: readonly {
            readonly code: string;
            readonly message: string;
            readonly path: readonly PropertyKey[];
          }[];
        };
      };
}

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  public constructor(private readonly schema: RuntimeSchema<T>) {}

  public transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new ApplicationError('VALIDATION_FAILED', 'Request validation failed', {
      issues: result.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.map(String),
      })),
    });
  }
}
