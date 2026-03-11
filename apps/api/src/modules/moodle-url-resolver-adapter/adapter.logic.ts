import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { normalizeTemplate } from '@seguimiento/shared';

export type SidecarAdapterConfig = {
  paths: {
    adapterDefaultInput?: string;
  };
  modalityBaseUrls?: Record<string, string>;
};

type AdapterInputRow = {
  nrcRaw: string;
  periodsRaw: string;
  templateRaw: string;
  statusRaw: string;
  courseIdRaw: string;
  modalityRaw: string;
  urlFinalRaw: string;
  errorRaw: string;
};

export type AdapterRunOptions = {
  inputPath?: string;
  dryRun?: boolean;
  sourceLabel?: string;
  config?: SidecarAdapterConfig;
};

export type AdapterRunResult = {
  ok: true;
  inputPath?: string;
  dryRun: boolean;
  parsedRows: number;
  processedRows: number;
  updatedRows: number;
  skippedRows: number;
  skippedNoPeriod: number;
  noMatch: number;
  ambiguous: number;
  before: {
    totalNrc: number;
    urlsFinalResueltas: number;
    pendientes: number;
    tiposUtiles: number;
  };
  after: {
    totalNrc: number;
    urlsFinalResueltas: number;
    pendientes: number;
    tiposUtiles: number;
  };
  statusBreakdown: Record<string, number>;
  notes: string[];
};

function isProjectRootCandidate(candidate: string): boolean {
  if (!candidate) return false;
  const root = path.resolve(candidate);
  return (
    fs.existsSync(path.join(root, 'package.json')) &&
    fs.existsSync(path.join(root, 'apps', 'api')) &&
    fs.existsSync(path.join(root, 'tools', 'moodle-sidecar'))
  );
}

type PrismaLike = {
  course: {
    findMany: (args: any) => Promise<any[]>;
  };
  moodleCheck: {
    upsert: (args: any) => Promise<any>;
  };
};

type MappedStatus = {
  status: 'OK' | 'ERROR_REINTENTABLE' | 'DESCARTADO_NO_EXISTE' | 'REVISAR_MANUAL';
  errorCode: 'NO_EXISTE' | 'SIN_ACCESO' | 'TIMEOUT' | 'OTRO' | null;
};

function normalizeKey(key: string): string {
  return String(key ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const v = row[normalizeKey(key)] ?? '';
    if (String(v).trim()) return String(v).trim();
  }
  return '';
}

function normalizePeriod(raw: string): string {
  return String(raw ?? '').replace(/[^\d]/g, '').slice(0, 6);
}

function parsePeriods(raw: string): string[] {
  const vals = String(raw ?? '')
    .replace(/\|/g, ',')
    .split(',')
    .map((v) => normalizePeriod(v))
    .filter(Boolean);
  return [...new Set(vals)];
}

function normalizeNrcNumeric(raw: string): string | null {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits.slice(-5));
  if (Number.isNaN(n)) return null;
  return String(n);
}

function canonicalNrcByPeriod(periodCode: string, nrcRaw: string): string | null {
  const period = normalizePeriod(periodCode);
  const prefix = period.slice(-2);
  if (!prefix) return null;

  const explicit = String(nrcRaw ?? '').trim().match(/^(\d{2})\s*-\s*(\d+)$/);
  if (explicit) {
    const n = Number(explicit[2]);
    if (Number.isNaN(n)) return null;
    return `${prefix}-${String(n)}`;
  }

  const num = normalizeNrcNumeric(nrcRaw);
  if (!num) return null;
  return `${prefix}-${num}`;
}

function mapStatus(statusRaw: string, hasUrlOrCourseId: boolean): MappedStatus | null {
  const status = String(statusRaw ?? '').trim().toUpperCase();
  if (!status) {
    if (hasUrlOrCourseId) {
      return { status: 'OK', errorCode: null };
    }
    return null;
  }

  if (status === 'OK') return { status: 'OK', errorCode: null };
  if (status === 'SIN_MATRICULA') return { status: 'REVISAR_MANUAL', errorCode: 'SIN_ACCESO' };
  if (status === 'NO_ENCONTRADO_MODALIDAD_OBJETIVO' || status === 'DESCARTADO_NO_EXISTE') {
    return { status: 'DESCARTADO_NO_EXISTE', errorCode: 'NO_EXISTE' };
  }
  if (status.startsWith('ERROR')) return { status: 'ERROR_REINTENTABLE', errorCode: 'OTRO' };

  return { status: 'REVISAR_MANUAL', errorCode: null };
}

function isFinalCourseUrl(url: string): boolean {
  return /\/course\/view\.php\?id=\d+/.test(String(url ?? ''));
}

function inferCourseId(rawCourseId: string, rawUrl: string): string | null {
  const id = String(rawCourseId ?? '').trim();
  if (/^\d+$/.test(id)) return id;
  const m = String(rawUrl ?? '').match(/[?&]id=(\d+)/);
  return m?.[1] ?? null;
}

function inferModality(raw: string): 'PRESENCIAL' | 'DISTANCIA' | 'POSGRADOS' | 'MOOCS' | null {
  const txt = String(raw ?? '').trim().toUpperCase();
  if (!txt) return null;
  if (txt.includes('PRESENCIAL')) return 'PRESENCIAL';
  if (txt.includes('DISTANCIA')) return 'DISTANCIA';
  if (txt.includes('POSGRADO')) return 'POSGRADOS';
  if (txt.includes('MOOC')) return 'MOOCS';
  return null;
}

function buildFinalUrl(
  rawUrl: string,
  rawCourseId: string,
  modality: ReturnType<typeof inferModality>,
  config?: SidecarAdapterConfig,
): string | null {
  const direct = String(rawUrl ?? '').trim();
  if (isFinalCourseUrl(direct)) return direct;

  const courseId = inferCourseId(rawCourseId, direct);
  if (!courseId || !modality) return null;

  const base =
    config?.modalityBaseUrls?.[modality] ||
    {
      PRESENCIAL: 'https://presencial.aulasuniminuto.edu.co',
      DISTANCIA: 'https://distancia.aulasuniminuto.edu.co',
      POSGRADOS: 'https://posgrados.aulasuniminuto.edu.co',
      MOOCS: 'https://moocs.aulasuniminuto.edu.co',
    }[modality];

  if (!base) return null;
  return `${base.replace(/\/$/, '')}/course/view.php?id=${courseId}`;
}

function normalizeTemplateSafe(raw: string): 'VACIO' | 'CRIBA' | 'INNOVAME' | 'D4' | 'UNKNOWN' {
  return normalizeTemplate(raw) as 'VACIO' | 'CRIBA' | 'INNOVAME' | 'D4' | 'UNKNOWN';
}

function parseCsvRows(inputPath: string): AdapterInputRow[] {
  const content = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.split(';').length >= firstLine.split(',').length ? ';' : ',';

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    delimiter,
    trim: true,
    relax_column_count: true,
  }) as Array<Record<string, unknown>>;

  return records.map((raw) => {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      row[normalizeKey(k)] = String(v ?? '').trim();
    }

    return {
      nrcRaw: pick(row, ['NRC', 'ID_NRC']),
      periodsRaw: pick(row, ['PERIODOS', 'PERIODO']),
      templateRaw: pick(row, ['TIPO_AULA', 'TIPOAULA', 'TEMPLATE']),
      statusRaw: pick(row, ['ESTADO', 'STATUS']),
      courseIdRaw: pick(row, ['COURSE_ID', 'COURSEID']),
      modalityRaw: pick(row, ['MODALIDAD_DONDE_SE_ENCONTRO', 'MODALIDAD', 'RESOLVED_MODALITY']),
      urlFinalRaw: pick(row, ['URL_FINAL', 'MOODLE_COURSE_URL', 'URL', 'COURSE_URL']),
      errorRaw: pick(row, ['ERROR', 'ERROR_CODE']),
    };
  });
}

function parseJsonRows(inputPath: string): AdapterInputRow[] {
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as Array<Record<string, unknown>>;
  if (!Array.isArray(raw)) {
    throw new Error('El JSON de entrada debe ser un arreglo de objetos.');
  }

  return raw.map((item) => {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(item ?? {})) {
      row[normalizeKey(k)] = String(v ?? '').trim();
    }

    return {
      nrcRaw: pick(row, ['NRC', 'ID_NRC']),
      periodsRaw: pick(row, ['PERIODOS', 'PERIODO']),
      templateRaw: pick(row, ['TIPO_AULA', 'TIPOAULA', 'TEMPLATE']),
      statusRaw: pick(row, ['ESTADO', 'STATUS']),
      courseIdRaw: pick(row, ['COURSE_ID', 'COURSEID']),
      modalityRaw: pick(row, ['MODALIDAD_DONDE_SE_ENCONTRO', 'MODALIDAD', 'RESOLVED_MODALITY']),
      urlFinalRaw: pick(row, ['URL_FINAL', 'MOODLE_COURSE_URL', 'URL', 'COURSE_URL']),
      errorRaw: pick(row, ['ERROR', 'ERROR_CODE']),
    };
  });
}

function parseXlsxRows(inputPath: string): AdapterInputRow[] {
  const workbook = XLSX.readFile(inputPath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(`El archivo XLSX no contiene hojas: ${inputPath}`);
  }

  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    raw: false,
    defval: '',
  });

  return records.map((raw) => {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      row[normalizeKey(k)] = String(v ?? '').trim();
    }

    return {
      nrcRaw: pick(row, ['NRC', 'ID_NRC']),
      periodsRaw: pick(row, ['PERIODOS', 'PERIODO']),
      templateRaw: pick(row, ['TIPO_AULA', 'TIPOAULA', 'TEMPLATE']),
      statusRaw: pick(row, ['ESTADO', 'STATUS']),
      courseIdRaw: pick(row, ['COURSE_ID', 'COURSEID']),
      modalityRaw: pick(row, ['MODALIDAD_DONDE_SE_ENCONTRO', 'MODALIDAD', 'RESOLVED_MODALITY']),
      urlFinalRaw: pick(row, ['URL_FINAL', 'MOODLE_COURSE_URL', 'URL', 'COURSE_URL']),
      errorRaw: pick(row, ['ERROR', 'ERROR_CODE']),
    };
  });
}

function parseInputRows(inputPath: string): AdapterInputRow[] {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') return parseXlsxRows(inputPath);
  if (ext === '.json') return parseJsonRows(inputPath);
  return parseCsvRows(inputPath);
}

function usefulTemplate(value: string | null | undefined): boolean {
  return ['VACIO', 'CRIBA', 'INNOVAME', 'D4'].includes(String(value ?? '').toUpperCase());
}

export function resolveProjectRoot(fromCwd = process.cwd()): string {
  const envRoot = process.env.SEGUIMIENTO_PROJECT_ROOT?.trim();
  if (envRoot && isProjectRootCandidate(envRoot)) {
    return path.resolve(envRoot);
  }

  let current = path.resolve(fromCwd);
  for (let i = 0; i < 8; i += 1) {
    if (isProjectRootCandidate(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(fromCwd, '../..');
}

export function loadSidecarConfig(projectRoot: string): SidecarAdapterConfig {
  const cfgPath = path.join(projectRoot, 'storage', 'archive', 'system', 'moodle_sidecar.config.json');
  if (!fs.existsSync(cfgPath)) {
    return { paths: {}, modalityBaseUrls: {} };
  }
  return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as SidecarAdapterConfig;
}

export function resolveAdapterInputPath(projectRoot: string, rawInputPath: string): string {
  if (path.isAbsolute(rawInputPath)) return rawInputPath;
  return path.resolve(projectRoot, rawInputPath);
}

export async function runMoodleUrlResolverAdapter(
  prisma: PrismaLike,
  options: AdapterRunOptions,
): Promise<AdapterRunResult> {
  const dryRun = Boolean(options.dryRun);
  if (!options.inputPath) {
    throw new Error("inputPath es requerido para ejecutar adapter.");
  }
  const rows = parseInputRows(options.inputPath);

  const statusBreakdown: Record<string, number> = {};
  const notes: string[] = [];

  let processedRows = 0;
  let updatedRows = 0;
  let skippedRows = 0;
  let skippedNoPeriod = 0;
  let noMatch = 0;
  let ambiguous = 0;

  const nrcInputKeys = new Set<string>();

  const beforeByCourse = new Map<string, { status: string; template: string; url: string }>();
  const afterByCourse = new Map<string, { status: string; template: string; url: string }>();

  for (const row of rows) {
    const nrcRaw = String(row.nrcRaw ?? '').trim();
    if (!nrcRaw) {
      skippedRows += 1;
      continue;
    }

    const periods = parsePeriods(row.periodsRaw);
    if (!periods.length) {
      skippedNoPeriod += 1;
      continue;
    }

    const pairList = periods
      .map((periodCode) => {
        const canonical = canonicalNrcByPeriod(periodCode, nrcRaw);
        if (!canonical) return null;
        nrcInputKeys.add(`${periodCode}::${canonical}`);
        return { periodCode, canonical };
      })
      .filter((item): item is { periodCode: string; canonical: string } => Boolean(item));

    if (!pairList.length) {
      skippedRows += 1;
      continue;
    }

    const found = await prisma.course.findMany({
      where: {
        OR: pairList.map((pair) => ({
          nrc: pair.canonical,
          period: { code: pair.periodCode },
        })),
      },
      select: {
        id: true,
        nrc: true,
        period: { select: { code: true } },
        moodleCheck: {
          select: {
            status: true,
            detectedTemplate: true,
            moodleCourseUrl: true,
            attempts: true,
          },
        },
      },
      take: 3,
    });

    if (!found.length) {
      noMatch += 1;
      continue;
    }

    if (found.length > 1) {
      ambiguous += 1;
      continue;
    }

    const target = found[0];
    processedRows += 1;

    const before = {
      status: target.moodleCheck?.status ?? 'PENDIENTE',
      template: target.moodleCheck?.detectedTemplate ?? 'UNKNOWN',
      url: target.moodleCheck?.moodleCourseUrl ?? '',
    };
    beforeByCourse.set(target.id, before);

    const template = normalizeTemplateSafe(row.templateRaw);
    const modality = inferModality(row.modalityRaw);
    const finalUrl = buildFinalUrl(row.urlFinalRaw, row.courseIdRaw, modality, options.config);
    const statusMapped = mapStatus(row.statusRaw, Boolean(finalUrl || inferCourseId(row.courseIdRaw, row.urlFinalRaw)));
    const nextStatus = statusMapped?.status ?? before.status;
    statusBreakdown[nextStatus] = (statusBreakdown[nextStatus] ?? 0) + 1;

    const after = {
      status: nextStatus,
      template: template === 'UNKNOWN' ? before.template : template,
      url: finalUrl || before.url,
    };
    afterByCourse.set(target.id, after);

    if (!dryRun) {
      const courseId = inferCourseId(row.courseIdRaw, row.urlFinalRaw);
      const updateData: Record<string, unknown> = {
        notes: `Actualizado via moodle_url_resolver_adapter${options.sourceLabel ? ` (${options.sourceLabel})` : ''}.`,
        lastAttemptAt: new Date(),
        resolvedAt: finalUrl ? new Date() : undefined,
        searchQuery: target.nrc,
        attempts: { increment: 1 },
      };

      if (statusMapped) {
        updateData.status = statusMapped.status;
        updateData.errorCode = statusMapped.errorCode;
      }

      if (template !== 'UNKNOWN') {
        updateData.detectedTemplate = template;
      }
      if (finalUrl) {
        updateData.moodleCourseUrl = finalUrl;
      }
      if (courseId) {
        updateData.moodleCourseId = courseId;
      }
      if (modality) {
        updateData.resolvedModality = modality;
        updateData.resolvedBaseUrl =
          options.config?.modalityBaseUrls?.[modality] ||
          {
            PRESENCIAL: 'https://presencial.aulasuniminuto.edu.co',
            DISTANCIA: 'https://distancia.aulasuniminuto.edu.co',
            POSGRADOS: 'https://posgrados.aulasuniminuto.edu.co',
            MOOCS: 'https://moocs.aulasuniminuto.edu.co',
          }[modality];
      }

      const createData: Record<string, unknown> = {
        courseId: target.id,
        status: statusMapped?.status ?? 'PENDIENTE',
        detectedTemplate: template === 'UNKNOWN' ? null : template,
        errorCode: statusMapped?.errorCode ?? null,
        notes: `Actualizado via moodle_url_resolver_adapter${options.sourceLabel ? ` (${options.sourceLabel})` : ''}.`,
        moodleCourseUrl: finalUrl,
        moodleCourseId: courseId,
        resolvedModality: modality,
        resolvedBaseUrl: modality
          ? options.config?.modalityBaseUrls?.[modality] ||
            {
              PRESENCIAL: 'https://presencial.aulasuniminuto.edu.co',
              DISTANCIA: 'https://distancia.aulasuniminuto.edu.co',
              POSGRADOS: 'https://posgrados.aulasuniminuto.edu.co',
              MOOCS: 'https://moocs.aulasuniminuto.edu.co',
            }[modality]
          : null,
        searchQuery: target.nrc,
        resolvedAt: finalUrl ? new Date() : null,
        lastAttemptAt: new Date(),
        attempts: 1,
      };

      await prisma.moodleCheck.upsert({
        where: { courseId: target.id },
        create: createData,
        update: updateData,
      });
      updatedRows += 1;
    } else {
      updatedRows += 1;
    }
  }

  const beforeList = [...beforeByCourse.values()];
  const afterList = [...afterByCourse.values()];

  const beforeStats = {
    totalNrc: nrcInputKeys.size,
    urlsFinalResueltas: beforeList.filter((item) => isFinalCourseUrl(item.url)).length,
    pendientes: beforeList.filter((item) => item.status !== 'OK').length,
    tiposUtiles: beforeList.filter((item) => usefulTemplate(item.template)).length,
  };

  const afterStats = {
    totalNrc: nrcInputKeys.size,
    urlsFinalResueltas: afterList.filter((item) => isFinalCourseUrl(item.url)).length,
    pendientes: afterList.filter((item) => item.status !== 'OK').length,
    tiposUtiles: afterList.filter((item) => usefulTemplate(item.template)).length,
  };

  if (ambiguous > 0) {
    notes.push(`Se detectaron ${ambiguous} filas ambiguas (mas de un curso candidato).`);
  }
  if (noMatch > 0) {
    notes.push(`Sin match en BD para ${noMatch} filas.`);
  }

  return {
    ok: true,
    inputPath: options.inputPath,
    dryRun,
    parsedRows: rows.length,
    processedRows,
    updatedRows,
    skippedRows,
    skippedNoPeriod,
    noMatch,
    ambiguous,
    before: beforeStats,
    after: afterStats,
    statusBreakdown,
    notes,
  };
}
