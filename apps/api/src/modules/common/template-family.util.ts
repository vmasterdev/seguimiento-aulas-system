import { normalizeTemplate } from '@seguimiento/shared';

export function getTemplateReplicationFamily(template: string | null | undefined): string {
  const normalized = normalizeTemplate(template ?? 'UNKNOWN');
  if (normalized === 'INNOVAME' || normalized === 'D4') {
    return 'INNOVAME_D4';
  }
  return normalized;
}

export function areTemplatesReplicationCompatible(
  leftTemplate: string | null | undefined,
  rightTemplate: string | null | undefined,
): boolean {
  return getTemplateReplicationFamily(leftTemplate) === getTemplateReplicationFamily(rightTemplate);
}
