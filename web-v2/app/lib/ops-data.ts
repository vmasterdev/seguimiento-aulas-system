import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { getBannerProjectRoot, getBannerRunnerStatus } from './banner-runner';
import type {
  ApiHealth,
  ApiStats,
  BannerExportRecord,
  BannerExportSummary,
  CourseRecord,
  FileEntry,
  OpsData,
  OutboxItem,
  QueueStats,
  SidecarCourseRecord,
  SidecarSummary,
  UrlValidationRecord,
  UrlValidationSummary,
} from './types';

const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');
const BANNER_ROOT = getBannerProjectRoot();
const API_BASE =
  process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';

const SYSTEM_OUTPUT_DIR = path.join(PROJECT_ROOT, 'storage', 'outputs');
const VALIDATION_DIR = path.join(SYSTEM_OUTPUT_DIR, 'validation');
const REPORTS_DIR = path.join(SYSTEM_OUTPUT_DIR, 'reports');
const OK_DIR = path.join(SYSTEM_OUTPUT_DIR, 'ok');
const PENDING_DIR = path.join(SYSTEM_OUTPUT_DIR, 'pending');
const GAPS_DIR = path.join(SYSTEM_OUTPUT_DIR, 'gaps');
const BANNER_EXPORTS_DIR = path.join(BANNER_ROOT, 'storage', 'exports');
const BANNER_LOGS_DIR = path.join(BANNER_ROOT, 'storage', 'logs');

type ApiCourseResponse = {
  total: number;
  items: Array<Record<string, unknown>>;
};

type ApiOutboxResponse = {
  total: number;
  items: Array<Record<string, unknown>>;
};

function normalizeNrcKey(value: unknown): string {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  const relevant = digits.length > 5 ? digits.slice(-5) : digits;
  return String(Number(relevant));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function asNumber(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = text.replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function asBoolean(value: unknown): boolean {
  return ['1', 'true', 'si', 'yes', 'ok'].includes(String(value ?? '').trim().toLowerCase());
}

function detectDelimiter(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  if (tabs > semicolons && tabs > commas) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

function toIso(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(dirPath: string, maxDepth = 2): Promise<string[]> {
  if (!(await exists(dirPath))) return [];
  const results: string[] = [];

  async function visit(currentPath: string, depth: number) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) {
          await visit(fullPath, depth + 1);
        }
        continue;
      }
      results.push(fullPath);
    }
  }

  await visit(dirPath, 0);
  return results;
}

async function sortByModifiedDesc(filePaths: string[]) {
  const withStats = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const stats = await fs.stat(filePath);
        return {
          filePath,
          stats,
        };
      } catch {
        return null;
      }
    }),
  );

  return withStats
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
}

async function loadCsvRecords(filePath: string) {
  const content = await fs.readFile(filePath, 'utf8');
  const delimiter = detectDelimiter(content);
  return parse(content, {
    bom: true,
    columns: true,
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, unknown>>;
}

async function findLatestByPredicate(
  filePaths: string[],
  predicate: (headers: string[]) => boolean,
): Promise<string | null> {
  const ranked = await sortByModifiedDesc(filePaths);
  for (const entry of ranked) {
    try {
      const content = await fs.readFile(entry.filePath, 'utf8');
      const records = parse(content, {
        bom: true,
        columns: true,
        delimiter: detectDelimiter(content),
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
        to_line: 2,
      }) as Array<Record<string, unknown>>;
      const headers = Object.keys(records[0] ?? {});
      if (predicate(headers)) {
        return entry.filePath;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function getSidecarSummary(): Promise<SidecarSummary> {
  const files = (await walkFiles(VALIDATION_DIR, 3)).filter((filePath) => filePath.toLowerCase().endsWith('.csv'));
  const latestFile = await findLatestByPredicate(files, (headers) => headers.includes('TIPO_AULA'));

  if (!latestFile) {
    return {
      latestFile: null,
      modifiedAt: null,
      rowCount: 0,
      okCount: 0,
      errorCount: 0,
      emptyClassrooms: 0,
      typeCounts: {},
      statusCounts: {},
      participantAverage: null,
      preview: [],
      sampleByNrc: {},
    };
  }

  const [records, stats] = await Promise.all([loadCsvRecords(latestFile), fs.stat(latestFile)]);
  const typeCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  let okCount = 0;
  let errorCount = 0;
  let emptyClassrooms = 0;
  let participantsTotal = 0;
  let participantsCount = 0;
  const sampleByNrc: Record<string, SidecarCourseRecord> = {};

  for (const row of records) {
    const type = asString(row.TIPO_AULA);
    const status = asString(row.ESTADO);
    const participants = asNumber(row.TOTAL_PARTICIPANTES);
    const item: SidecarCourseRecord = {
      nrc: String(row.NRC ?? '').trim(),
      type,
      participants,
      participantsDetected: asNumber(row.PARTICIPANTES_DETECTADOS),
      empty:
        asBoolean(row.ES_VACIA_AMBOS_CRITERIOS) || asBoolean(row.ES_VACIA) || asString(row.TIPO_AULA) === 'vacia',
      confidence: asString(row.CONFIANZA),
      status,
      error: asString(row.ERROR),
      moodleCourseName: asString(row.NOMBRE_CURSO_MOODLE),
      moodleCourseId: asString(row.COURSE_ID),
      moodleLinks: asString(row.MOD_LINKS),
      queryUsed: asString(row.CONSULTA_USADA),
      modality: asString(row.MODALIDAD_DONDE_SE_ENCONTRO),
    };

    if (type) typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    if (status) statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (status === 'OK') okCount += 1;
    if (status && status !== 'OK') errorCount += 1;
    if (item.empty) emptyClassrooms += 1;
    if (participants !== null) {
      participantsTotal += participants;
      participantsCount += 1;
    }

    const nrcKey = normalizeNrcKey(item.nrc);
    if (nrcKey && !sampleByNrc[nrcKey]) {
      sampleByNrc[nrcKey] = item;
    }
  }

  const preview = records.slice(0, 18).map((row) => sampleByNrc[normalizeNrcKey(row.NRC)]).filter(Boolean);

  return {
    latestFile,
    modifiedAt: toIso(stats.mtime),
    rowCount: records.length,
    okCount,
    errorCount,
    emptyClassrooms,
    typeCounts,
    statusCounts,
    participantAverage: participantsCount ? Number((participantsTotal / participantsCount).toFixed(1)) : null,
    preview,
    sampleByNrc,
  };
}

async function getUrlValidationSummary(): Promise<UrlValidationSummary> {
  const files = (await walkFiles(VALIDATION_DIR, 3)).filter((filePath) => filePath.toLowerCase().endsWith('.csv'));
  const latestFile = await findLatestByPredicate(files, (headers) => headers.includes('URL_MOODLE'));

  if (!latestFile) {
    return {
      latestFile: null,
      modifiedAt: null,
      rowCount: 0,
      withUrlCount: 0,
      preview: [],
      sampleByNrc: {},
    };
  }

  const [records, stats] = await Promise.all([loadCsvRecords(latestFile), fs.stat(latestFile)]);
  let withUrlCount = 0;
  const sampleByNrc: Record<string, UrlValidationRecord> = {};

  for (const row of records) {
    const item: UrlValidationRecord = {
      nrc: String(row.NRC ?? '').trim(),
      period: asString(row.PERIODO),
      teacherName: asString(row.DOCENTE),
      subjectName: asString(row.ASIGNATURA),
      modality: asString(row.MODALIDAD_RESUELTA),
      moodleUrl: asString(row.URL_MOODLE),
    };
    if (item.moodleUrl) withUrlCount += 1;
    const nrcKey = normalizeNrcKey(item.nrc);
    if (nrcKey && !sampleByNrc[nrcKey]) {
      sampleByNrc[nrcKey] = item;
    }
  }

  const preview = records.slice(0, 18).map((row) => sampleByNrc[normalizeNrcKey(row.NRC)]).filter(Boolean);

  return {
    latestFile,
    modifiedAt: toIso(stats.mtime),
    rowCount: records.length,
    withUrlCount,
    preview,
    sampleByNrc,
  };
}

async function getBannerExportSummary(): Promise<BannerExportSummary> {
  const files = (await walkFiles(BANNER_EXPORTS_DIR, 2)).filter((filePath) => filePath.toLowerCase().endsWith('.csv'));
  const latestFile = await findLatestByPredicate(files, (headers) => headers.includes('query_id'));

  if (!latestFile) {
    return {
      latestFile: null,
      modifiedAt: null,
      rowCount: 0,
      statusCounts: {},
      preview: [],
      sampleByNrc: {},
    };
  }

  const [records, stats] = await Promise.all([loadCsvRecords(latestFile), fs.stat(latestFile)]);
  const statusCounts: Record<string, number> = {};
  const sampleByNrc: Record<string, BannerExportRecord> = {};

  for (const row of records) {
    const status = asString(row.status);
    if (status) statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const item: BannerExportRecord = {
      nrc: String(row.nrc ?? '').trim(),
      period: asString(row.period),
      teacherName: asString(row.teacher_name),
      teacherId: asString(row.teacher_id),
      programName: asString(row.program_name),
      status,
      checkedAt: asString(row.checked_at),
      errorMessage: asString(row.error_message),
    };
    const nrcKey = normalizeNrcKey(item.nrc);
    if (nrcKey && !sampleByNrc[nrcKey]) {
      sampleByNrc[nrcKey] = item;
    }
  }

  const preview = records.slice(0, 18).map((row) => sampleByNrc[normalizeNrcKey(row.nrc)]).filter(Boolean);

  return {
    latestFile,
    modifiedAt: toIso(stats.mtime),
    rowCount: records.length,
    statusCounts,
    preview,
    sampleByNrc,
  };
}

async function getRecentFiles(): Promise<FileEntry[]> {
  const sources = [
    { root: REPORTS_DIR, label: 'system', category: 'reportes' },
    { root: VALIDATION_DIR, label: 'system', category: 'validacion' },
    { root: OK_DIR, label: 'system', category: 'ok' },
    { root: PENDING_DIR, label: 'system', category: 'pendientes' },
    { root: GAPS_DIR, label: 'system', category: 'faltantes' },
    { root: BANNER_EXPORTS_DIR, label: 'banner', category: 'exports' },
    { root: BANNER_LOGS_DIR, label: 'banner', category: 'logs' },
  ] as const;

  const files = (
    await Promise.all(
      sources.map(async (source) => {
        const filePaths = await walkFiles(source.root, 3);
        return filePaths.map((filePath) => ({ filePath, source }));
      }),
    )
  ).flat();

  const enriched = await Promise.all(
    files.map(async ({ filePath, source }) => {
      try {
        const stats = await fs.stat(filePath);
        return {
          name: path.basename(filePath),
          path: filePath,
          relativePath: path.relative(source.root, filePath),
          sizeBytes: stats.size,
          sizeLabel: formatBytes(stats.size),
          modifiedAt: stats.mtime.toISOString(),
          source: source.label,
          category: source.category,
        } as FileEntry;
      } catch {
        return null;
      }
    }),
  );

  return enriched
    .filter((entry): entry is FileEntry => Boolean(entry))
    .sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime())
    .slice(0, 24);
}

async function fetchApiJson<T>(resource: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_BASE}${resource}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function sanitizeCourse(
  item: Record<string, unknown>,
  integrations: {
    sidecar: SidecarSummary;
    urlValidation: UrlValidationSummary;
    bannerExport: BannerExportSummary;
  },
): CourseRecord {
  const nrc = String(item.nrc ?? '');
  const nrcKey = normalizeNrcKey(nrc);
  const teacher = asRecord(item.teacher);
  const moodleCheck = asRecord(item.moodleCheck);
  const period = asRecord(item.period);
  const evaluationSummary = asRecord(item.evaluationSummary);
  const checklistTemporal = asRecord(item.checklistTemporal);
  const selectedSampleGroups = Array.isArray(item.selectedSampleGroups)
    ? item.selectedSampleGroups.map((group) => {
        const record = asRecord(group);
        return {
          id: String(record.id ?? ''),
          moment: String(record.moment ?? ''),
          template: String(record.template ?? ''),
          modality: String(record.modality ?? ''),
          programCode: String(record.programCode ?? ''),
        };
      })
    : [];

  return {
    id: String(item.id ?? ''),
    nrc,
    period: {
      code: String(period.code ?? ''),
      modality: asString(period.modality),
    },
    moment: asString(item.moment),
    subjectName: asString(item.subjectName),
    programCode: asString(item.programCode),
    programName: asString(item.programName),
    teacherId: asString(item.teacherId),
    teacher: teacher.fullName
      ? {
          id: String(teacher.id ?? ''),
          sourceId: asString(teacher.sourceId),
          documentId: asString(teacher.documentId),
          fullName: String(teacher.fullName),
          email: asString(teacher.email),
          costCenter: asString(teacher.costCenter),
          coordination: asString(teacher.coordination),
        }
      : null,
    moodleCheck: Object.keys(moodleCheck).length
      ? {
          status: String(moodleCheck.status ?? 'SIN_CHECK'),
          detectedTemplate: asString(moodleCheck.detectedTemplate),
          errorCode: asString(moodleCheck.errorCode),
          moodleCourseUrl: asString(moodleCheck.moodleCourseUrl),
          moodleCourseId: asString(moodleCheck.moodleCourseId),
          resolvedModality: asString(moodleCheck.resolvedModality),
          searchQuery: asString(moodleCheck.searchQuery),
          notes: asString(moodleCheck.notes),
        }
      : null,
    bannerReviewStatus: asString(item.bannerReviewStatus),
    reviewExcluded: Boolean(item.reviewExcluded),
    reviewExcludedReason: asString(item.reviewExcludedReason),
    selectedForChecklist: Boolean(item.selectedForChecklist),
    selectedSampleGroups,
    checklistTemporal: {
      active: Boolean(checklistTemporal.active),
      reason: asString(checklistTemporal.reason),
      at: asString(checklistTemporal.at),
    },
    evaluationSummary: {
      alistamientoScore: asNumber(evaluationSummary.alistamientoScore),
      ejecucionScore: asNumber(evaluationSummary.ejecucionScore),
      latestPhase: asString(evaluationSummary.latestPhase),
      latestScore: asNumber(evaluationSummary.latestScore),
      latestObservations: asString(evaluationSummary.latestObservations),
      latestComputedAt: asString(evaluationSummary.latestComputedAt),
      latestReplicatedFromCourseId: asString(evaluationSummary.latestReplicatedFromCourseId),
    },
    integrations: {
      moodleSidecar: integrations.sidecar.sampleByNrc[nrcKey] ?? null,
      urlValidation: integrations.urlValidation.sampleByNrc[nrcKey] ?? null,
      bannerExport: integrations.bannerExport.sampleByNrc[nrcKey] ?? null,
    },
  };
}

function sanitizeOutbox(items: Array<Record<string, unknown>>): OutboxItem[] {
  return items.slice(0, 16).map((item) => {
    const teacher = asRecord(item.teacher);
    const coordinator = asRecord(item.coordinator);
    return {
      status: String(item.status ?? ''),
      subject: String(item.subject ?? ''),
      recipientName: asString(item.recipientName),
      recipientEmail: asString(item.recipientEmail),
      teacher: teacher.fullName ? { fullName: String(teacher.fullName) } : null,
      coordinator: coordinator.fullName ? { fullName: String(coordinator.fullName) } : null,
    };
  });
}

function buildDerived(data: {
  courses: CourseRecord[];
  stats: ApiStats | null;
  bannerSummary: BannerExportSummary;
  urlValidation: UrlValidationSummary;
  outbox: OutboxItem[];
}) {
  const withTeacher = data.courses.filter((course) => course.teacherId).length;
  const withoutTeacher = data.courses.length - withTeacher;
  const moodleOk = data.courses.filter((course) => course.moodleCheck?.status === 'OK').length;
  const moodlePending = data.courses.filter((course) =>
    ['PENDIENTE', 'ERROR_REINTENTABLE', 'REVISAR_MANUAL'].includes(course.moodleCheck?.status ?? ''),
  ).length;
  const moodleErrors = data.courses.filter(
    (course) =>
      Boolean(course.moodleCheck?.errorCode) ||
      ['ERROR_REINTENTABLE', 'REVISAR_MANUAL', 'DESCARTADO_NO_EXISTE'].includes(course.moodleCheck?.status ?? ''),
  ).length;
  const withMoodleUrl = data.courses.filter(
    (course) => course.integrations.urlValidation?.moodleUrl || course.moodleCheck?.moodleCourseUrl,
  ).length;
  const withSidecarData = data.courses.filter((course) => course.integrations.moodleSidecar).length;
  const bannerFound =
    data.bannerSummary.statusCounts.ENCONTRADO ??
    data.courses.filter((course) => course.bannerReviewStatus === 'ENCONTRADO').length;
  const bannerWithoutTeacher =
    data.bannerSummary.statusCounts.SIN_DOCENTE ??
    data.courses.filter((course) => course.bannerReviewStatus === 'SIN_DOCENTE').length;
  const outboxDrafts = data.outbox.filter((item) => item.status === 'DRAFT').length;
  const reviewExcluded = data.courses.filter((course) => course.reviewExcluded).length;

  const attention = data.courses
    .map((course) => {
      const reasons: string[] = [];
      if (!course.teacherId) reasons.push('Sin docente vinculado');
      if (!course.integrations.urlValidation?.moodleUrl && !course.moodleCheck?.moodleCourseUrl) reasons.push('Sin URL final Moodle');
      if (course.moodleCheck?.status && course.moodleCheck.status !== 'OK') reasons.push(`Moodle ${course.moodleCheck.status}`);
      if (course.bannerReviewStatus === 'SIN_DOCENTE') reasons.push('Banner sin docente');
      if (course.integrations.moodleSidecar?.empty) reasons.push('Aula vacia');
      if (course.reviewExcluded) reasons.push(course.reviewExcludedReason ?? 'Excluido de revision');
      return reasons.length
        ? {
            id: course.id,
            nrc: course.nrc,
            subjectName: course.subjectName,
            periodCode: course.period.code,
            teacherName: course.teacher?.fullName ?? null,
            reason: reasons.join(' | '),
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 14);

  return {
    withTeacher,
    withoutTeacher,
    moodleOk,
    moodlePending,
    moodleErrors,
    withMoodleUrl,
    withSidecarData,
    bannerFound,
    bannerWithoutTeacher,
    outboxDrafts,
    reviewExcluded,
    attention,
  };
}

export async function getOpsData(): Promise<OpsData> {
  const [sidecarSummary, urlValidation, bannerExport, files, health, stats, queue, coursesResponse, outboxResponse, sidecarConfig, sidecarRunner] =
    await Promise.all([
      getSidecarSummary(),
      getUrlValidationSummary(),
      getBannerExportSummary(),
      getRecentFiles(),
      fetchApiJson<ApiHealth>('/health'),
      fetchApiJson<ApiStats>('/stats/overview'),
      fetchApiJson<QueueStats>('/queue/stats'),
      fetchApiJson<ApiCourseResponse>('/courses?limit=5000'),
      fetchApiJson<ApiOutboxResponse>('/outbox?status=DRAFT'),
      fetchApiJson<Record<string, unknown>>('/integrations/moodle-sidecar/config'),
      fetchApiJson<Record<string, unknown>>('/integrations/moodle-sidecar/run/status'),
    ]);

  const rawCourses = coursesResponse?.items ?? [];
  const courses = rawCourses.map((item) =>
    sanitizeCourse(item, {
      sidecar: sidecarSummary,
      urlValidation,
      bannerExport,
    }),
  );
  const outbox = sanitizeOutbox(outboxResponse?.items ?? []);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: PROJECT_ROOT,
    bannerProjectRoot: BANNER_ROOT,
    apiBase: API_BASE,
    apiReachable: Boolean(health?.ok || stats || queue || coursesResponse || outboxResponse),
    health,
    stats,
    queue,
    courses: {
      total: coursesResponse?.total ?? courses.length,
      items: courses,
    },
    outbox: {
      total: outboxResponse?.total ?? outbox.length,
      items: outbox,
    },
    sidecar: {
      config: sidecarConfig,
      runner: sidecarRunner,
      summary: sidecarSummary,
      urlValidation,
    },
    banner: {
      runner: getBannerRunnerStatus(),
      exportSummary: bannerExport,
    },
    files,
    derived: buildDerived({
      courses,
      stats,
      bannerSummary: bannerExport,
      urlValidation,
      outbox,
    }),
  };
}
