import fs from 'node:fs';
import path from 'node:path';

const API_BASE =
  process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const SYSTEM_ROOT = path.resolve(process.cwd(), '..', '..');
const BATCH_DIR = path.join(SYSTEM_ROOT, 'storage', 'outputs', 'banner-batches');
const PAGE_SIZE = 5000;

export type BannerBatchSource = 'ALL' | 'MISSING_TEACHER' | 'PENDING_BANNER';

export type PrepareBannerBatchInput = {
  periodCodes: string[];
  source: BannerBatchSource;
  limit?: number;
};

export type StartBannerBatchFromSystemOptions = PrepareBannerBatchInput & {
  queryName?: string;
  queryId?: string;
  workers?: number;
  resume?: boolean;
};

export type PrepareBannerBatchFromCourseIdsInput = {
  courseIds: string[];
  limit?: number;
};

export type StartBannerBatchFromCourseIdsOptions = PrepareBannerBatchFromCourseIdsInput & {
  queryName?: string;
  queryId?: string;
  workers?: number;
  resume?: boolean;
};

type CourseListItem = {
  id: string;
  nrc: string;
  moment: string | null;
  subjectName: string | null;
  teacherId: string | null;
  programCode: string | null;
  programName: string | null;
  bannerReviewStatus?: string | null;
  rawJson?: unknown;
  teacher?: {
    id: string;
    fullName: string | null;
  } | null;
  period: {
    code: string;
    label: string;
    modality: string;
  };
};

type CoursesListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: CourseListItem[];
};

export type BannerBatchOptions = {
  sources: Array<{
    code: BannerBatchSource;
    label: string;
    description: string;
  }>;
  years: Array<{
    year: string;
    periodCodes: string[];
    courseCount: number;
  }>;
  periods: Array<{
    code: string;
    label: string;
    modality: string;
    year: string;
    courseCount: number;
  }>;
  defaults: {
    source: BannerBatchSource;
    selectedPeriodCodes: string[];
    latestYear: string | null;
  };
};

export type BannerBatchPreview = {
  filters: {
    source: BannerBatchSource;
    periodCodes: string[];
    limit: number | null;
  };
  total: number;
  byPeriod: Record<string, number>;
  byYear: Record<string, number>;
  byBannerStatus: Record<string, number>;
  sample: Array<{
    courseId: string;
    nrc: string;
    periodCode: string;
    periodLabel: string;
    year: string;
    moment: string | null;
    subjectName: string | null;
    teacherName: string | null;
    teacherId: string | null;
    bannerReviewStatus: string | null;
    sourceFile: string | null;
  }>;
};

export type PreparedBannerBatch = BannerBatchPreview & {
  batchId: string;
  inputPath: string;
  manifestPath: string;
};

type PreparedCourseRow = BannerBatchPreview['sample'][number] & {
  programCode: string | null;
  programName: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeBannerStatus(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
}

function deriveYear(periodCode: string) {
  return /^\d{4}/.test(periodCode) ? periodCode.slice(0, 4) : 'SIN_ANO';
}

function readSourceFile(rawJson: unknown) {
  const raw = asRecord(rawJson);
  const direct = raw.sourceFile;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const importInfo = asRecord(raw.rpacaImport);
  const fromImport = importInfo.sourceFile;
  if (typeof fromImport === 'string' && fromImport.trim()) return fromImport.trim();

  return null;
}

function isRpacaBackedCourse(course: CourseListItem) {
  const raw = asRecord(course.rawJson);
  return Boolean(readSourceFile(raw) || raw.rpacaImport || raw.row);
}

function matchesSource(course: CourseListItem, source: BannerBatchSource) {
  if (source === 'ALL') return true;
  if (source === 'MISSING_TEACHER') return !String(course.teacherId ?? '').trim();

  return normalizeBannerStatus(course.bannerReviewStatus) !== 'ENCONTRADO';
}

function countBy<T>(items: T[], pick: (item: T) => string) {
  const output: Record<string, number> = {};
  for (const item of items) {
    const key = pick(item);
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}

function escapeCsv(value: string | null | undefined) {
  const text = String(value ?? '');
  if (!/[",;\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
    },
  });

  const data = (await response.json()) as T & { message?: string | string[] };
  if (!response.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join('; ')
      : (data?.message ?? `HTTP ${response.status}`);
    throw new Error(message);
  }

  return data as T;
}

async function fetchAllCourses() {
  const items: CourseListItem[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await fetchJson<CoursesListResponse>(`${API_BASE}/courses?limit=${PAGE_SIZE}&offset=${offset}`);
    items.push(...page.items);
    total = page.total;
    if (!page.items.length) break;
    offset += page.items.length;
  }

  return items;
}

function toPreparedRow(course: CourseListItem): PreparedCourseRow {
  return {
    courseId: course.id,
    nrc: course.nrc,
    periodCode: course.period.code,
    periodLabel: course.period.label,
    year: deriveYear(course.period.code),
    moment: course.moment?.trim() || null,
    subjectName: course.subjectName?.trim() || null,
    teacherName: course.teacher?.fullName?.trim() || null,
    teacherId: String(course.teacherId ?? '').trim() || null,
    bannerReviewStatus: normalizeBannerStatus(course.bannerReviewStatus),
    sourceFile: readSourceFile(course.rawJson),
    programCode: course.programCode?.trim() || null,
    programName: course.programName?.trim() || null,
  };
}

async function collectPreparedRows(input: PrepareBannerBatchInput) {
  const selectedPeriods = [...new Set((input.periodCodes ?? []).map((value) => String(value).trim()).filter(Boolean))];
  if (!selectedPeriods.length) {
    throw new Error('Debes seleccionar al menos un periodo para armar el lote Banner.');
  }

  const allCourses = await fetchAllCourses();
  const filtered = allCourses
    .filter(isRpacaBackedCourse)
    .filter((course) => selectedPeriods.includes(course.period.code))
    .filter((course) => matchesSource(course, input.source))
    .sort((left, right) => {
      const byPeriod = right.period.code.localeCompare(left.period.code);
      if (byPeriod !== 0) return byPeriod;
      return left.nrc.localeCompare(right.nrc);
    });

  const limited = input.limit && input.limit > 0 ? filtered.slice(0, input.limit) : filtered;

  return {
    rows: limited.map(toPreparedRow),
    periodCodes: selectedPeriods,
  };
}

async function collectPreparedRowsByCourseIds(input: PrepareBannerBatchFromCourseIdsInput) {
  const selectedCourseIds = [...new Set((input.courseIds ?? []).map((value) => String(value).trim()).filter(Boolean))];
  if (!selectedCourseIds.length) {
    throw new Error('Debes indicar al menos un curso para armar el lote Banner.');
  }

  const selectedSet = new Set(selectedCourseIds);
  const allCourses = await fetchAllCourses();
  const filtered = allCourses
    .filter(isRpacaBackedCourse)
    .filter((course) => selectedSet.has(course.id))
    .sort((left, right) => {
      const byPeriod = right.period.code.localeCompare(left.period.code);
      if (byPeriod !== 0) return byPeriod;
      return left.nrc.localeCompare(right.nrc);
    });

  const limited = input.limit && input.limit > 0 ? filtered.slice(0, input.limit) : filtered;

  return {
    rows: limited.map(toPreparedRow),
    periodCodes: [...new Set(limited.map((course) => course.period.code))],
  };
}

function buildPreview(
  input: PrepareBannerBatchInput,
  prepared: {
    rows: PreparedCourseRow[];
    periodCodes: string[];
  },
): BannerBatchPreview {
  return {
    filters: {
      source: input.source,
      periodCodes: prepared.periodCodes,
      limit: input.limit ?? null,
    },
    total: prepared.rows.length,
    byPeriod: countBy(prepared.rows, (row) => row.periodCode),
    byYear: countBy(prepared.rows, (row) => row.year),
    byBannerStatus: countBy(prepared.rows, (row) => row.bannerReviewStatus ?? 'SIN_DATO'),
    sample: prepared.rows.slice(0, 20),
  };
}

export async function getBannerBatchOptions(): Promise<BannerBatchOptions> {
  const courses = (await fetchAllCourses()).filter(isRpacaBackedCourse);
  const periodMap = new Map<
    string,
    {
      code: string;
      label: string;
      modality: string;
      year: string;
      courseCount: number;
    }
  >();

  for (const course of courses) {
    const key = course.period.code;
    const current = periodMap.get(key) ?? {
      code: course.period.code,
      label: course.period.label,
      modality: course.period.modality,
      year: deriveYear(course.period.code),
      courseCount: 0,
    };
    current.courseCount += 1;
    periodMap.set(key, current);
  }

  const periods = [...periodMap.values()].sort((left, right) => right.code.localeCompare(left.code));
  const yearMap = new Map<string, { year: string; periodCodes: string[]; courseCount: number }>();

  for (const period of periods) {
    const current = yearMap.get(period.year) ?? {
      year: period.year,
      periodCodes: [],
      courseCount: 0,
    };
    current.periodCodes.push(period.code);
    current.courseCount += period.courseCount;
    yearMap.set(period.year, current);
  }

  const years = [...yearMap.values()].sort((left, right) => right.year.localeCompare(left.year));
  const latestYear = years[0]?.year ?? null;
  const defaultPeriods = latestYear ? years.find((item) => item.year === latestYear)?.periodCodes ?? [] : [];

  return {
    sources: [
      {
        code: 'MISSING_TEACHER',
        label: 'Solo NRC sin docente enlazado',
        description: 'Usa Banner para completar los cursos que todavia no tienen docente en la base.',
      },
      {
        code: 'PENDING_BANNER',
        label: 'NRC que Banner aun no resuelve',
        description: 'Incluye cursos sin revision Banner o con resultado distinto a ENCONTRADO.',
      },
      {
        code: 'ALL',
        label: 'Todos los NRC cargados por RPACA',
        description: 'Recorre todos los cursos importados desde RPACA para los periodos seleccionados.',
      },
    ],
    years,
    periods,
    defaults: {
      source: 'MISSING_TEACHER',
      selectedPeriodCodes: defaultPeriods,
      latestYear,
    },
  };
}

export async function previewBannerBatchFromSystem(input: PrepareBannerBatchInput): Promise<BannerBatchPreview> {
  const prepared = await collectPreparedRows(input);
  return buildPreview(input, prepared);
}

export async function prepareBannerBatchFromSystem(input: PrepareBannerBatchInput): Promise<PreparedBannerBatch> {
  const prepared = await collectPreparedRows(input);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const batchId = `${stamp}_${input.source.toLowerCase()}`;
  const batchDir = path.join(BATCH_DIR, batchId);
  fs.mkdirSync(batchDir, { recursive: true });

  const csvRows = ['periodo,momento,nrc,programa_codigo,programa_nombre,asignatura'];
  for (const row of prepared.rows) {
    csvRows.push(
      [
        escapeCsv(row.periodCode),
        escapeCsv(row.moment ?? ''),
        escapeCsv(row.nrc),
        escapeCsv(row.programCode),
        escapeCsv(row.programName),
        escapeCsv(row.subjectName),
      ].join(','),
    );
  }

  const inputPath = path.join(batchDir, 'nrc_banner_batch.csv');
  fs.writeFileSync(inputPath, `${csvRows.join('\n')}\n`, 'utf8');

  const preview = buildPreview(input, prepared);
  const manifestPath = path.join(batchDir, 'manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        batchId,
        preparedAt: new Date().toISOString(),
        inputPath,
        ...preview,
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    batchId,
    inputPath,
    manifestPath,
    ...preview,
  };
}

export async function prepareBannerBatchFromCourseIds(
  input: PrepareBannerBatchFromCourseIdsInput,
): Promise<PreparedBannerBatch> {
  const prepared = await collectPreparedRowsByCourseIds(input);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const batchId = `${stamp}_moodle_followup`;
  const batchDir = path.join(BATCH_DIR, batchId);
  fs.mkdirSync(batchDir, { recursive: true });

  const csvRows = ['periodo,momento,nrc,programa_codigo,programa_nombre,asignatura'];
  for (const row of prepared.rows) {
    csvRows.push(
      [
        escapeCsv(row.periodCode),
        escapeCsv(row.moment ?? ''),
        escapeCsv(row.nrc),
        escapeCsv(row.programCode),
        escapeCsv(row.programName),
        escapeCsv(row.subjectName),
      ].join(','),
    );
  }

  const inputPath = path.join(batchDir, 'nrc_banner_batch.csv');
  fs.writeFileSync(inputPath, `${csvRows.join('\n')}\n`, 'utf8');

  const preview = buildPreview({ source: 'ALL', periodCodes: prepared.periodCodes, limit: input.limit }, prepared);
  const manifestPath = path.join(batchDir, 'manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        batchId,
        preparedAt: new Date().toISOString(),
        inputPath,
        source: 'MOODLE_FOLLOWUP',
        ...preview,
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    batchId,
    inputPath,
    manifestPath,
    ...preview,
  };
}
