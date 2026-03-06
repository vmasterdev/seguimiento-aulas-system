import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  entity = 'payload',
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const path = issue.path.length ? issue.path.join('.') : '(root)';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new BadRequestException(`Invalid ${entity}: ${details}`);
  }
  return parsed.data;
}
