import { normalizeTeacherId } from '@seguimiento/shared';

const PROGRAM_DISPLAY_MAP: Record<string, string> = {
  'ADM EMP TURISTICAS Y HOTELERAS': 'Administración de Empresas Turísticas y Hoteleras',
  'ADMIN SEGURIDAD SALUD TRABAJO': 'Administración en Seguridad y Salud en el Trabajo',
  'ADMINISTRACION DE EMPRESAS': 'Administración de Empresas',
  'ADMINISTRACION FINANCIERA': 'Administración Financiera',
  'COMUNICACION SOCIAL': 'Comunicación Social',
  'CONTADURIA PUBLICA DISTANCIA': 'Contaduría Pública Distancia',
  DERECHO: 'Derecho',
  'INGENIERO DE SISTEMAS': 'Ingeniería de Sistemas',
  LICENCIATURAS: 'Licenciaturas',
  MERCADEO: 'Mercadeo',
  'MS GERENCIA INNOVACION PROYECT': 'MS Gerencia Innovación Proyect',
  POSGRADOS: 'Posgrados',
  PSICOLOGIA: 'Psicología',
  'TRABAJADOR SOCIAL DISTANCIA': 'Trabajo Social Distancia',
  'TRABAJO SOCIAL': 'Trabajo Social',
};

const CAMPUS_DISPLAY_MAP: Record<string, string> = {
  CENTRO: 'Centro',
  SUR: 'Sur',
};

type TeacherProgramOverride = {
  program: string;
  teacherIds?: string[];
  sourceIds?: string[];
  documentIds?: string[];
  names?: string[];
};

const TEACHER_PROGRAM_OVERRIDES: TeacherProgramOverride[] = [
  {
    program: 'Licenciaturas - Sur',
    teacherIds: ['1063958', '001063958'],
    sourceIds: ['1063958', '001063958'],
    documentIds: ['1075238728'],
    names: ['RODRIGUEZ VASQUEZ ALVARO JAVIER'],
  },
];

function normalizeProgramMatchKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function normalizeTeacherNameKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function includesIdentifier(candidates: string[] | undefined, value: string | null | undefined): boolean {
  const normalizedValue = normalizeTeacherId(value ?? '');
  if (!normalizedValue) return false;
  return (candidates ?? []).some((candidate) => normalizeTeacherId(candidate) === normalizedValue);
}

function includesName(candidates: string[] | undefined, value: string | null | undefined): boolean {
  const normalizedValue = normalizeTeacherNameKey(value ?? '');
  if (!normalizedValue) return false;
  return (candidates ?? []).some((candidate) => normalizeTeacherNameKey(candidate) === normalizedValue);
}

export function normalizeProgramValue(value: string | null | undefined): string | null {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalized) return null;

  const parts = normalized.split(/\s+-\s+/);
  const campusCandidate = parts.length > 1 ? parts[parts.length - 1] ?? '' : '';
  const campusKey = normalizeProgramMatchKey(campusCandidate);
  const hasCampus = Boolean(CAMPUS_DISPLAY_MAP[campusKey]);
  const baseValue = hasCampus ? parts.slice(0, -1).join(' - ').trim() : normalized;
  const canonicalBase = PROGRAM_DISPLAY_MAP[normalizeProgramMatchKey(baseValue)] ?? baseValue;

  if (!hasCampus) return canonicalBase;

  return `${canonicalBase} - ${CAMPUS_DISPLAY_MAP[campusKey]}`;
}

export function resolveTeacherProgramOverride(input: {
  teacherId?: string | null;
  teacherSourceId?: string | null;
  teacherDocumentId?: string | null;
  teacherName?: string | null;
  teacherCostCenter?: string | null;
}): string | null {
  const override = TEACHER_PROGRAM_OVERRIDES.find((candidate) => {
    if (includesIdentifier(candidate.teacherIds, input.teacherId)) return true;
    if (includesIdentifier(candidate.sourceIds, input.teacherSourceId)) return true;
    if (includesIdentifier(candidate.documentIds, input.teacherDocumentId)) return true;
    if (includesName(candidate.names, input.teacherName)) return true;
    return false;
  });

  return normalizeProgramValue(override?.program ?? input.teacherCostCenter ?? null);
}

export function hasTeacherProgramOverride(input: {
  teacherId?: string | null;
  teacherSourceId?: string | null;
  teacherDocumentId?: string | null;
  teacherName?: string | null;
}): boolean {
  return TEACHER_PROGRAM_OVERRIDES.some((candidate) => {
    if (includesIdentifier(candidate.teacherIds, input.teacherId)) return true;
    if (includesIdentifier(candidate.sourceIds, input.teacherSourceId)) return true;
    if (includesIdentifier(candidate.documentIds, input.teacherDocumentId)) return true;
    if (includesName(candidate.names, input.teacherName)) return true;
    return false;
  });
}

export function resolveProgramValue(input: {
  teacherId?: string | null;
  teacherSourceId?: string | null;
  teacherDocumentId?: string | null;
  teacherName?: string | null;
  teacherCostCenter?: string | null;
  teacherLinked?: boolean;
  courseProgramCode?: string | null;
  courseProgramName?: string | null;
}) {
  const teacherProgram = resolveTeacherProgramOverride(input);
  if (teacherProgram) {
    return {
      programCode: teacherProgram,
      programName: teacherProgram,
    };
  }

  if (input.teacherLinked) {
    return {
      programCode: null,
      programName: null,
    };
  }

  const programName = normalizeProgramValue(input.courseProgramName);
  const programCode = normalizeProgramValue(input.courseProgramCode) ?? programName;

  return {
    programCode,
    programName: programName ?? programCode,
  };
}
