import { Inject, Injectable } from '@nestjs/common';
import { normalizeMoment, normalizeTemplate } from '@seguimiento/shared';
import { PrismaService } from '../prisma.service';
import { isCourseExcludedFromReview } from '../common/review-eligibility.util';
import { isReviewerEnrollmentExcludedFromReview } from '../common/reviewer-enrollment.util';
import { resolveProjectRoot } from './adapter.logic';
import fs from 'node:fs/promises';
import path from 'node:path';

export type SidecarBatchSource = 'PENDING' | 'SAMPLING' | 'ALL';

export type PrepareSidecarBatchInput = {
  periodCodes: string[];
  moments?: string[];
  source: SidecarBatchSource;
  templates?: string[];
  limit?: number;
};

export type SidecarExtractionKind = 'attendance' | 'activity' | 'participants';

export type PrepareExtractionBatchInput = {
  periodCodes: string[];
  moments?: string[];
  templates?: string[];
  source?: SidecarBatchSource;
  nrcs?: string[];
  limit?: number;
};

export type RevalidateMode = 'sin_matricula' | 'aulas_vacias' | 'ambos';

export type PrepareRevalidateBatchInput = {
  periodCodes: string[];
  moments?: string[];
  mode: RevalidateMode;
  limit?: number;
};

type RawRow = Record<string, unknown>;

type BatchCandidate = {
  id: string;
  nrc: string;
  moment: string | null;
  subjectName: string | null;
  programCode: string | null;
  programName: string | null;
  period: {
    code: string;
    label: string;
    modality: string;
  };
  moodleCheck: {
    status: string;
    detectedTemplate: string | null;
    errorCode: string | null;
  } | null;
  rawJson: unknown;
  selectedInGroups: Array<{
    id: string;
    moment: string;
  }>;
};

type BatchPreviewItem = {
  courseId: string;
  nrc: string;
  periodCode: string;
  periodLabel: string;
  moment: string;
  title: string;
  program: string;
  method: string;
  status: string;
  template: string;
  sourceFile: string;
};

type ExtractionCandidate = {
  id: string;
  nrc: string;
  moment: string | null;
  subjectName: string | null;
  programCode: string | null;
  programName: string | null;
  period: {
    code: string;
    label: string;
    modality: string;
  };
  rawJson: unknown;
  moodleCheck: {
    status: string;
    detectedTemplate: string | null;
    errorCode: string | null;
    moodleCourseUrl: string | null;
    moodleCourseId: string | null;
    resolvedModality: string | null;
    resolvedBaseUrl: string | null;
  } | null;
  selectedInGroups: Array<{
    id: string;
    moment: string;
  }>;
};

type ExtractionPreviewItem = {
  courseId: string;
  nrc: string;
  periodCode: string;
  periodLabel: string;
  moment: string;
  title: string;
  program: string;
  template: string;
  status: string;
  moodleCourseUrl: string | null;
  moodleCourseId: string | null;
  resolvedModality: string | null;
  resolvedBaseUrl: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sanitizeFileToken(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '_');
}

@Injectable()
export class MoodleSidecarBatchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getOptions() {
    const [periods, momentsRaw, templatesRaw] = await Promise.all([
      this.prisma.period.findMany({
        orderBy: { code: 'desc' },
        include: {
          _count: {
            select: {
              courses: true,
            },
          },
        },
      }),
      this.prisma.course.findMany({
        distinct: ['moment'],
        select: { moment: true },
        where: { moment: { not: null } },
        orderBy: { moment: 'asc' },
      }),
      this.prisma.moodleCheck.groupBy({
        by: ['detectedTemplate'],
        _count: { _all: true },
        orderBy: {
          _count: {
            detectedTemplate: 'desc',
          },
        },
      }),
    ]);

    const moments = momentsRaw
      .map((item) => String(item.moment ?? '').trim())
      .filter(Boolean)
      .map((item) => normalizeMoment(item))
      .filter((value, index, values) => values.indexOf(value) === index);

    return {
      sources: [
        { code: 'PENDING', label: 'Pendientes / reintentos / revision manual' },
        { code: 'SAMPLING', label: 'Muestreo seleccionado' },
        { code: 'ALL', label: 'Todos los NRC elegibles' },
      ],
      periods: periods.map((period) => ({
        code: period.code,
        label: period.label,
        modality: period.modality,
        courseCount: period._count.courses,
      })),
      moments,
      templates: templatesRaw.map((row) => {
        const code = String(row.detectedTemplate ?? 'SIN_TIPO').trim().toUpperCase() || 'SIN_TIPO';
        return {
          code,
          label: code === 'SIN_TIPO' ? 'Sin tipo detectado' : code,
          count: row._count._all,
        };
      }),
    };
  }

  async preview(input: PrepareSidecarBatchInput) {
    const prepared = await this.collectCandidates(input);
    return {
      filters: {
        source: input.source,
        periodCodes: prepared.periodCodes,
        moments: prepared.moments,
        templates: prepared.templates,
        limit: input.limit ?? null,
      },
      total: prepared.items.length,
      byPeriod: this.countBy(prepared.items, (item) => item.periodCode),
      byMoment: this.countBy(prepared.items, (item) => item.moment || 'SIN_MOMENTO'),
      byStatus: this.countBy(prepared.items, (item) => item.status || 'PENDIENTE'),
      byTemplate: this.countBy(prepared.items, (item) => item.template || 'SIN_TIPO'),
      sample: prepared.items.slice(0, 20),
    };
  }

  async previewRevalidate(input: PrepareRevalidateBatchInput) {
    const prepared = await this.collectRevalidateCandidates(input);
    return {
      filters: {
        periodCodes: prepared.periodCodes,
        moments: prepared.moments,
        mode: input.mode,
        limit: input.limit ?? null,
      },
      total: prepared.items.length,
      byPeriod: this.countBy(prepared.items, (item) => item.periodCode),
      byMoment: this.countBy(prepared.items, (item) => item.moment || 'SIN_MOMENTO'),
      byStatus: this.countBy(prepared.items, (item) => item.status || 'PENDIENTE'),
      byTemplate: this.countBy(prepared.items, (item) => item.template || 'SIN_TIPO'),
      sample: prepared.items.slice(0, 20),
    };
  }

  async previewExtraction(input: PrepareExtractionBatchInput) {
    const prepared = await this.collectExtractionCandidates(input);
    return {
      filters: {
        source: input.source ?? 'ALL',
        periodCodes: prepared.periodCodes,
        moments: prepared.moments,
        templates: prepared.templates,
        nrcs: prepared.nrcs,
        limit: input.limit ?? null,
      },
      total: prepared.items.length,
      byPeriod: this.countByExtraction(prepared.items, (item) => item.periodCode),
      byMoment: this.countByExtraction(prepared.items, (item) => item.moment || 'SIN_MOMENTO'),
      byStatus: this.countByExtraction(prepared.items, (item) => item.status || 'PENDIENTE'),
      byTemplate: this.countByExtraction(prepared.items, (item) => item.template || 'SIN_TIPO'),
      byModality: this.countByExtraction(prepared.items, (item) => item.resolvedModality || 'SIN_MODALIDAD'),
      sample: prepared.items.slice(0, 20),
    };
  }

  async prepareBatch(input: PrepareSidecarBatchInput) {
    const prepared = await this.collectCandidates(input);
    const root = resolveProjectRoot();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batchId = `${stamp}_${input.source.toLowerCase()}`;
    const batchDir = path.join(root, 'storage', 'outputs', 'validation', 'sidecar-batches', batchId);
    await fs.mkdir(batchDir, { recursive: true });

    const groups = new Map<string, BatchPreviewItem[]>();
    for (const item of prepared.items) {
      const key = this.buildSourceFileName(item.periodCode, item.periodLabel, item.method);
      const current = groups.get(key) ?? [];
      current.push(item);
      groups.set(key, current);
    }

    const generatedFiles: Array<{ name: string; rows: number }> = [];
    for (const [fileName, rows] of groups.entries()) {
      const csv = ['PERIODO;NRC;TITULO;METODO_EDUCATIVO'];
      for (const row of rows) {
        csv.push(
          [
            row.periodCode,
            row.nrc,
            this.escapeCsv(row.title),
            this.escapeCsv(row.method),
          ].join(';'),
        );
      }
      await fs.writeFile(path.join(batchDir, fileName), `${csv.join('\n')}\n`, 'utf8');
      generatedFiles.push({ name: fileName, rows: rows.length });
    }

    const manifest = {
      batchId,
      preparedAt: new Date().toISOString(),
      filters: {
        source: input.source,
        periodCodes: prepared.periodCodes,
        moments: prepared.moments,
        templates: prepared.templates,
        limit: input.limit ?? null,
      },
      total: prepared.items.length,
      files: generatedFiles,
      byPeriod: this.countBy(prepared.items, (item) => item.periodCode),
      byMoment: this.countBy(prepared.items, (item) => item.moment || 'SIN_MOMENTO'),
      byStatus: this.countBy(prepared.items, (item) => item.status || 'PENDIENTE'),
      byTemplate: this.countBy(prepared.items, (item) => item.template || 'SIN_TIPO'),
      sample: prepared.items.slice(0, 20),
    };

    const manifestPath = path.join(batchDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    return {
      batchId,
      inputDir: batchDir,
      manifestPath,
      total: prepared.items.length,
      files: generatedFiles,
      byPeriod: manifest.byPeriod,
      byMoment: manifest.byMoment,
      byStatus: manifest.byStatus,
      byTemplate: manifest.byTemplate,
      sample: manifest.sample,
    };
  }

  async prepareBackupBatch(input: PrepareSidecarBatchInput) {
    const prepared = await this.collectCandidates(input);
    const root = resolveProjectRoot();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batchId = `${stamp}_${input.source.toLowerCase()}_backup`;
    const batchDir = path.join(root, 'storage', 'outputs', 'validation', 'sidecar-backups', batchId);
    await fs.mkdir(batchDir, { recursive: true });

    const csvPath = path.join(batchDir, 'nrcs_backup.csv');
    const csv = ['NRC;PERIODO;NOMBRE CURSO;PROGRAMA'];
    for (const row of prepared.items) {
      csv.push(
        [
          this.escapeCsv(row.nrc),
          this.escapeCsv(row.periodCode),
          this.escapeCsv(row.title),
          this.escapeCsv(row.program),
        ].join(';'),
      );
    }
    await fs.writeFile(csvPath, `${csv.join('\n')}\n`, 'utf8');

    const manifest = {
      batchId,
      preparedAt: new Date().toISOString(),
      filters: {
        source: input.source,
        periodCodes: prepared.periodCodes,
        moments: prepared.moments,
        templates: prepared.templates,
        limit: input.limit ?? null,
      },
      total: prepared.items.length,
      csvPath,
      byPeriod: this.countBy(prepared.items, (item) => item.periodCode),
      byMoment: this.countBy(prepared.items, (item) => item.moment || 'SIN_MOMENTO'),
      byStatus: this.countBy(prepared.items, (item) => item.status || 'PENDIENTE'),
      byTemplate: this.countBy(prepared.items, (item) => item.template || 'SIN_TIPO'),
      sample: prepared.items.slice(0, 20),
    };

    await fs.writeFile(path.join(batchDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    return manifest;
  }

  async prepareRevalidateBatch(input: PrepareRevalidateBatchInput) {
    const prepared = await this.collectRevalidateCandidates(input);
    const root = resolveProjectRoot();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batchId = `${stamp}_revalidate_${input.mode}`;
    const batchDir = path.join(root, 'storage', 'outputs', 'validation', 'sidecar-batches', batchId);
    await fs.mkdir(batchDir, { recursive: true });

    const csvPath = path.join(batchDir, 'input_revalidate.csv');
    const csv = ['PERIODO;NRC;TITULO;METODO_EDUCATIVO'];
    for (const row of prepared.items) {
      csv.push(
        [
          row.periodCode,
          row.nrc,
          this.escapeCsv(row.title),
          this.escapeCsv(row.method),
        ].join(';'),
      );
    }
    await fs.writeFile(csvPath, `${csv.join('\n')}\n`, 'utf8');

    const manifest = {
      batchId,
      preparedAt: new Date().toISOString(),
      filters: {
        periodCodes: prepared.periodCodes,
        moments: prepared.moments,
        mode: input.mode,
        limit: input.limit ?? null,
      },
      total: prepared.items.length,
      inputDir: batchDir,
      csvPath,
      byPeriod: this.countBy(prepared.items, (item) => item.periodCode),
      byMoment: this.countBy(prepared.items, (item) => item.moment || 'SIN_MOMENTO'),
      byStatus: this.countBy(prepared.items, (item) => item.status || 'PENDIENTE'),
      byTemplate: this.countBy(prepared.items, (item) => item.template || 'SIN_TIPO'),
      sample: prepared.items.slice(0, 20),
    };

    await fs.writeFile(path.join(batchDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    return manifest;
  }

  async prepareExtractionBatch(input: PrepareExtractionBatchInput, kind: SidecarExtractionKind) {
    const prepared = await this.collectExtractionCandidates(input);
    const root = resolveProjectRoot();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batchId = `${stamp}_${kind}`;
    const batchDir = path.join(root, 'storage', 'outputs', 'validation', 'sidecar-extract-batches', batchId);
    await fs.mkdir(batchDir, { recursive: true });

    const inputPath = path.join(batchDir, `${kind}_input.json`);
    const outputDir = path.join(batchDir, `${kind}_exports`);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(inputPath, JSON.stringify(prepared.items, null, 2), 'utf8');

    const manifest = {
      batchId,
      kind,
      preparedAt: new Date().toISOString(),
      filters: {
        source: input.source ?? 'ALL',
        periodCodes: prepared.periodCodes,
        moments: prepared.moments,
        templates: prepared.templates,
        limit: input.limit ?? null,
      },
      total: prepared.items.length,
      inputPath,
      outputDir,
      byPeriod: this.countByExtraction(prepared.items, (item) => item.periodCode),
      byMoment: this.countByExtraction(prepared.items, (item) => item.moment || 'SIN_MOMENTO'),
      byStatus: this.countByExtraction(prepared.items, (item) => item.status || 'PENDIENTE'),
      byTemplate: this.countByExtraction(prepared.items, (item) => item.template || 'SIN_TIPO'),
      byModality: this.countByExtraction(prepared.items, (item) => item.resolvedModality || 'SIN_MODALIDAD'),
      sample: prepared.items.slice(0, 20),
    };

    await fs.writeFile(path.join(batchDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    return {
      ...manifest,
      manifestPath: path.join(batchDir, 'manifest.json'),
    };
  }

  private async collectCandidates(input: PrepareSidecarBatchInput) {
    const periodCodes = [...new Set((input.periodCodes ?? []).map((value) => String(value).trim()).filter(Boolean))];
    const moments = [...new Set((input.moments ?? []).map((value) => normalizeMoment(String(value).trim())))];
    const templates = [...new Set((input.templates ?? []).map((value) => String(value).trim().toUpperCase()).filter(Boolean))];

    const where =
      input.source === 'SAMPLING'
        ? {
            period: { code: { in: periodCodes } },
            selectedInGroups: {
              some: moments.length ? { moment: { in: moments } } : {},
            },
          }
        : {
            period: { code: { in: periodCodes } },
            ...(moments.length ? { moment: { in: moments } } : {}),
          };

    const rows = await this.prisma.course.findMany({
      where,
      select: {
        id: true,
        nrc: true,
        moment: true,
        subjectName: true,
        programCode: true,
        programName: true,
        rawJson: true,
        period: {
          select: {
            code: true,
            label: true,
            modality: true,
          },
        },
        moodleCheck: {
          select: {
            status: true,
            detectedTemplate: true,
            errorCode: true,
          },
        },
        selectedInGroups: {
          select: {
            id: true,
            moment: true,
          },
          ...(input.source === 'SAMPLING' && moments.length ? { where: { moment: { in: moments } } } : {}),
        },
      },
      orderBy: [{ periodId: 'asc' }, { nrc: 'asc' }],
    });

    const filtered = rows
      .filter((course) => this.matchesSource(course, input.source))
      .filter((course) => {
        const template = course.moodleCheck?.detectedTemplate ?? this.readRawText(course.rawJson, ['template']) ?? null;
        return !isCourseExcludedFromReview({
          rawJson: course.rawJson,
          template,
          moodleCheck: course.moodleCheck,
        });
      })
      .map((course) => this.toPreviewItem(course))
      .filter((course) => (templates.length ? templates.includes(course.template) : true))
      .slice(0, input.limit && input.limit > 0 ? input.limit : undefined);

    return {
      items: filtered,
      periodCodes,
      moments,
      templates,
    };
  }

  private async collectRevalidateCandidates(input: PrepareRevalidateBatchInput) {
    const periodCodes = [...new Set((input.periodCodes ?? []).map((value) => String(value).trim()).filter(Boolean))];
    const moments = [...new Set((input.moments ?? []).map((value) => normalizeMoment(String(value).trim())))];

    const rows = await this.prisma.course.findMany({
      where: {
        period: { code: { in: periodCodes } },
        ...(moments.length ? { moment: { in: moments } } : {}),
      },
      select: {
        id: true,
        nrc: true,
        moment: true,
        subjectName: true,
        programCode: true,
        programName: true,
        rawJson: true,
        period: {
          select: {
            code: true,
            label: true,
            modality: true,
          },
        },
        moodleCheck: {
          select: {
            status: true,
            detectedTemplate: true,
            errorCode: true,
            moodleCourseUrl: true,
            moodleCourseId: true,
          },
        },
        selectedInGroups: {
          select: {
            id: true,
            moment: true,
          },
        },
      },
      orderBy: [{ periodId: 'asc' }, { nrc: 'asc' }],
    });

    const filtered = rows
      .filter((course) => this.matchesRevalidateMode(course, input.mode))
      .map((course) => this.toPreviewItem(course))
      .slice(0, input.limit && input.limit > 0 ? input.limit : undefined);

    return {
      items: filtered,
      periodCodes,
      moments,
      mode: input.mode,
    };
  }

  private async collectExtractionCandidates(input: PrepareExtractionBatchInput) {
    const periodCodes = [...new Set((input.periodCodes ?? []).map((value) => String(value).trim()).filter(Boolean))];
    const moments = [...new Set((input.moments ?? []).map((value) => normalizeMoment(String(value).trim())))];
    const templates = [...new Set((input.templates ?? []).map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
    const nrcs = [...new Set((input.nrcs ?? []).map((value) => String(value).trim()).filter(Boolean))];
    const source = input.source ?? 'ALL';

    const rows = await this.prisma.course.findMany({
      where: {
        period: { code: { in: periodCodes } },
        ...(moments.length ? { moment: { in: moments } } : {}),
      },
      select: {
        id: true,
        nrc: true,
        moment: true,
        subjectName: true,
        programCode: true,
        programName: true,
        rawJson: true,
        period: {
          select: {
            code: true,
            label: true,
            modality: true,
          },
        },
        moodleCheck: {
          select: {
            status: true,
            detectedTemplate: true,
            errorCode: true,
            moodleCourseUrl: true,
            moodleCourseId: true,
            resolvedModality: true,
            resolvedBaseUrl: true,
          },
        },
        selectedInGroups: {
          select: {
            id: true,
            moment: true,
          },
        },
      },
      orderBy: [{ periodId: 'asc' }, { nrc: 'asc' }],
    });

    const filtered = rows
      .filter((course) => (source === 'SAMPLING' ? course.selectedInGroups.length > 0 : true))
      .filter((course) => (nrcs.length ? this.matchesRequestedNrc(course.nrc, nrcs) : true))
      .filter((course) => this.hasResolvedMoodleReference(course))
      .map((course) => this.toExtractionItem(course))
      .filter((course) => (templates.length ? templates.includes(course.template) : true))
      .slice(0, input.limit && input.limit > 0 ? input.limit : undefined);

    return {
      items: filtered,
      periodCodes,
      moments,
      templates,
      nrcs,
      source,
    };
  }

  private matchesRequestedNrc(currentNrc: string, requestedNrcs: string[]) {
    const current = String(currentNrc ?? '').trim().toUpperCase();
    if (!current) return false;
    return requestedNrcs.some((token) => {
      const needle = String(token ?? '').trim().toUpperCase();
      return Boolean(needle) && (current === needle || current.endsWith(needle));
    });
  }

  private matchesSource(course: BatchCandidate, source: SidecarBatchSource) {
    if (source === 'ALL') return true;
    if (source === 'SAMPLING') return course.selectedInGroups.length > 0;

    const status = String(course.moodleCheck?.status ?? 'PENDIENTE').trim().toUpperCase();
    return ['PENDIENTE', 'ERROR_REINTENTABLE', 'REVISAR_MANUAL'].includes(status);
  }

  private matchesRevalidateMode(course: BatchCandidate, mode: RevalidateMode) {
    const template = normalizeTemplate(
      course.moodleCheck?.detectedTemplate ?? this.readRawText(course.rawJson, ['template']) ?? 'UNKNOWN',
    );
    const noEnrollment = this.isNoEnrollmentCandidate(course);
    const vacio = template === 'VACIO';

    if (mode === 'sin_matricula') return noEnrollment;
    if (mode === 'aulas_vacias') return vacio;
    return noEnrollment || vacio;
  }

  private isNoEnrollmentCandidate(course: BatchCandidate) {
    if (isReviewerEnrollmentExcludedFromReview(course.rawJson)) return true;

    const errorCode = String(course.moodleCheck?.errorCode ?? '').trim().toUpperCase();
    if (errorCode === 'SIN_ACCESO') return true;

    const status = String(course.moodleCheck?.status ?? '').trim().toUpperCase();
    const hasCourseId = Boolean(String((course.moodleCheck as { moodleCourseId?: string | null } | null)?.moodleCourseId ?? '').trim());
    const hasCourseUrl = /\/course\/view\.php\?id=\d+/.test(
      String((course.moodleCheck as { moodleCourseUrl?: string | null } | null)?.moodleCourseUrl ?? ''),
    );

    return status === 'REVISAR_MANUAL' && !hasCourseId && !hasCourseUrl;
  }

  private toPreviewItem(course: BatchCandidate): BatchPreviewItem {
    const raw = asRecord(course.rawJson);
    const row = asRecord(raw.row);
    const title =
      course.subjectName?.trim() ||
      this.readRawText(row, ['titulo', 'asignatura', 'materia', 'subject_name', 'subject']) ||
      'SIN_TITULO';
    const method =
      this.readRawText(row, ['metodo_educativo', 'metodoeducativo', 'metodo', 'modalidad']) ||
      this.defaultMethodByPeriod(course.period.code, course.period.modality);
    const sourceFile =
      this.readRawText(raw, ['sourceFile']) ||
      this.buildSourceFileName(course.period.code, course.period.label, method);
    const program =
      course.programName?.trim() ||
      course.programCode?.trim() ||
      this.readRawText(row, ['programa', 'program_name', 'programcode', 'program_code']) ||
      'SIN_PROGRAMA';
    const template =
      String(course.moodleCheck?.detectedTemplate ?? this.readRawText(course.rawJson, ['template']) ?? 'SIN_TIPO')
        .trim()
        .toUpperCase() || 'SIN_TIPO';

    return {
      courseId: course.id,
      nrc: course.nrc,
      periodCode: course.period.code,
      periodLabel: course.period.label,
      moment: normalizeMoment(String(course.moment ?? '1')),
      title,
      program,
      method,
      status: String(course.moodleCheck?.status ?? 'PENDIENTE').trim().toUpperCase() || 'PENDIENTE',
      template,
      sourceFile,
    };
  }

  private toExtractionItem(course: ExtractionCandidate): ExtractionPreviewItem {
    const raw = asRecord(course.rawJson);
    const row = asRecord(raw.row);
    const title =
      course.subjectName?.trim() ||
      this.readRawText(row, ['titulo', 'asignatura', 'materia', 'subject_name', 'subject']) ||
      'SIN_TITULO';
    const program =
      course.programName?.trim() ||
      course.programCode?.trim() ||
      this.readRawText(row, ['programa', 'program_name', 'programcode', 'program_code']) ||
      'SIN_PROGRAMA';
    const template =
      String(course.moodleCheck?.detectedTemplate ?? this.readRawText(course.rawJson, ['template']) ?? 'SIN_TIPO')
        .trim()
        .toUpperCase() || 'SIN_TIPO';

    return {
      courseId: course.id,
      nrc: course.nrc,
      periodCode: course.period.code,
      periodLabel: course.period.label,
      moment: normalizeMoment(String(course.moment ?? '1')),
      title,
      program,
      template,
      status: String(course.moodleCheck?.status ?? 'PENDIENTE').trim().toUpperCase() || 'PENDIENTE',
      moodleCourseUrl: course.moodleCheck?.moodleCourseUrl ?? null,
      moodleCourseId: course.moodleCheck?.moodleCourseId ?? null,
      resolvedModality: course.moodleCheck?.resolvedModality ?? null,
      resolvedBaseUrl: course.moodleCheck?.resolvedBaseUrl ?? null,
    };
  }

  private hasResolvedMoodleReference(course: ExtractionCandidate) {
    const url = String(course.moodleCheck?.moodleCourseUrl ?? '').trim();
    const courseId = String(course.moodleCheck?.moodleCourseId ?? '').trim();
    const baseUrl = String(course.moodleCheck?.resolvedBaseUrl ?? '').trim();
    return /\/course\/view\.php\?id=\d+/i.test(url) || (Boolean(courseId) && Boolean(baseUrl));
  }

  private buildSourceFileName(periodCode: string, periodLabel: string, method: string) {
    const upperLabel = String(periodLabel ?? '').toUpperCase();
    let hint = '';
    if (upperLabel.includes('PREGRADO PRESENCIAL') || periodCode.endsWith('10')) hint = 'PREGRADO PRESENCIAL';
    else if (upperLabel.includes('PREGRADO DISTANCIA') || periodCode.endsWith('15')) hint = 'PREGRADO DISTANCIA';
    else if (upperLabel.includes('POSGRADO DISTANCIA')) hint = 'POSGRADO DISTANCIA';
    else if (upperLabel.includes('POSGRADO PRESENCIAL') || ['11', '21'].includes(periodCode.slice(-2))) {
      hint = 'POSGRADO PRESENCIAL';
    } else if (upperLabel.includes('CUATRIMESTRAL') || periodCode.endsWith('41')) {
      hint = 'CUATRIMESTRAL';
    } else if (upperLabel.includes('INTERSEMESTRAL') || periodCode.endsWith('80')) {
      hint = 'INTERSEMESTRAL';
    } else if ((method || '').toUpperCase() === 'DIST') {
      hint = 'PREGRADO DISTANCIA';
    } else {
      hint = `PERIODO ${periodCode}`;
    }
    return `${sanitizeFileToken(`RPACA_GENERADO_${hint}_${periodCode}`)}.csv`;
  }

  private defaultMethodByPeriod(periodCode: string, periodModality: string) {
    if (periodCode.endsWith('15') || periodModality === 'PD') return 'DIST';
    if (periodCode.endsWith('80')) return 'MOOCS';
    if (periodCode.endsWith('41') || periodCode.endsWith('11') || periodCode.endsWith('21')) return 'POS';
    return 'PRES';
  }

  private readRawText(raw: unknown, keys: string[]) {
    const row = asRecord(raw);
    const normalized = new Map<string, string>();
    for (const [key, value] of Object.entries(row)) {
      normalized.set(
        key
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^A-Za-z0-9]/g, '')
          .toLowerCase(),
        String(value ?? '').trim(),
      );
    }

    for (const key of keys) {
      const normalizedKey = key
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toLowerCase();
      const direct = normalized.get(normalizedKey);
      if (direct) return direct;
    }

    for (const [key, value] of normalized.entries()) {
      if (!value) continue;
      if (keys.some((candidate) => key.includes(candidate.replace(/[^A-Za-z0-9]/g, '').toLowerCase()))) {
        return value;
      }
    }

    return '';
  }

  private escapeCsv(value: string) {
    return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  }

  private countBy(items: BatchPreviewItem[], selector: (item: BatchPreviewItem) => string) {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const key = selector(item) || 'SIN_VALOR';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  private countByExtraction(items: ExtractionPreviewItem[], selector: (item: ExtractionPreviewItem) => string) {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const key = selector(item) || 'SIN_VALOR';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }
}
