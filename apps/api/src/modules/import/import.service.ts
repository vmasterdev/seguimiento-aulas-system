import { Inject, Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { read, utils } from 'xlsx';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  inferModality,
  inferSemesterFromPeriod,
  normalizeHeader,
  normalizeMoment,
  normalizeProgramKey,
  normalizeTeacherId,
  normalizeTemplate,
  sanitizeId,
} from '@seguimiento/shared';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { normalizeProgramValue, resolveProgramValue, resolveTeacherProgramOverride } from '../common/program.util';
import { resolveProjectRoot } from '../moodle-url-resolver-adapter/adapter.logic';

const ImportBodySchema = z.object({
  periodCode: z.string().trim().optional(),
  periodLabel: z.string().trim().optional(),
  modality: z.string().trim().optional(),
  semester: z.coerce.number().int().min(1).max(2).optional(),
  executionPolicy: z.enum(['APPLIES', 'AUTO_PASS']).optional(),
  preserveTeacherAssignment: z.preprocess((v) => v === 'true' || v === true ? true : v === 'false' || v === false ? false : v, z.boolean()).optional().default(true),
  createOnly: z.preprocess((v) => v === 'true' || v === true ? true : v === 'false' || v === false ? false : v, z.boolean()).optional().default(false),
});

const ImportTeachersBodySchema = z.object({
  sheetName: z.string().trim().optional(),
  includeCoordinators: z.preprocess((v) => v === 'true' || v === true ? true : v === 'false' || v === false ? false : v, z.boolean()).optional().default(true),
});

const NRC_KEYS = ['nrc', 'id_nrc', 'codigo_nrc'];
const PERIOD_KEYS = ['periodo', 'period_code', 'codigo_periodo', 'indicativo'];
const PERIOD_LABEL_KEYS = ['periodo_label', 'label', 'modalidad', 'tipo_programa'];

const TEACHER_SOURCE_ID_KEYS = ['id_docente', 'docente_id', 'id'];
const TEACHER_DOCUMENT_ID_KEYS = [
  'identificacion',
  'cedula',
  'identificacion_docente',
  'cedula_docente',
];
const TEACHER_NAME_KEYS = [
  'docente',
  'nombre_docente',
  'nombre_profesor',
  'profesor',
  'nombre_del_profesor',
  'nombre',
];
const TEACHER_EMAIL_KEYS = ['email', 'correo', 'correo_docente', 'email_docente', 'correo_del_docente'];

const CAMPUS_KEYS = ['sede', 'campus', 'campus_code', 'desc_sede'];
const PROGRAM_CODE_KEYS = ['programa_codigo', 'codigo_programa', 'program_code', 'alfa'];
const PROGRAM_NAME_KEYS = [
  'programa',
  'program_name',
  'nombre_programa',
  'departamento_responsable',
  'facultad_responsable',
  'centrocosto',
];
const SUBJECT_KEYS = ['asignatura', 'materia', 'subject_name', 'titulo'];
const MOMENT_KEYS = ['momento', 'moment', 'parte_periodo'];
const START_DATE_KEYS = ['fecha_inicial_1', 'fecha_inicio', 'start_date', 'fecha_inicial'];
const END_DATE_KEYS = ['fecha_final_1', 'fecha_fin', 'end_date', 'fecha_final'];
const SALON_KEYS = ['salon'];
const SALON1_KEYS = ['salon1'];
const EDIFICIO_KEYS = ['edificio', 'edif'];
const HORA_INICIO_KEYS = ['hi', 'hora_inicio', 'hora_inicial'];
const HORA_FIN_KEYS = ['hf', 'hora_fin', 'hora_final'];
const DIA_L_KEYS = ['l', 'lunes'];
const DIA_M_KEYS = ['m', 'martes'];
const DIA_I_KEYS = ['i', 'miercoles', 'miércoles'];
const DIA_J_KEYS = ['j', 'jueves'];
const DIA_V_KEYS = ['v', 'viernes'];
const DIA_S_KEYS = ['s', 'sabado', 'sábado'];
const DIA_D_KEYS = ['d', 'domingo'];
const TEMPLATE_KEYS = ['tipo_aula', 'plantilla', 'template'];
const D4_KEYS = ['d4', 'd4_flag', 'distancia_4_0'];
const COORDINATOR_PROGRAM_KEYS = ['id', 'programa', 'centrocosto', 'responsable'];
const COORDINATOR_EMAIL_KEYS = ['email', 'correo'];
const COORDINATOR_NAME_KEYS = ['nombre', 'coordinador', 'responsable'];
const COORDINATION_KEYS = ['responsable', 'centrocosto', 'programa'];

type RpacaImportAction = 'CREATED' | 'UPDATED' | 'SKIPPED_EXISTING';

type RpacaImportChange = {
  action: RpacaImportAction;
  periodCode: string;
  nrc: string;
  sourceFile: string;
  rowNumber: number;
  courseId: string | null;
  teacherIdBefore: string | null;
  teacherIdAfter: string | null;
  teacherPreserved: boolean;
  subjectNameBefore: string | null;
  subjectNameAfter: string | null;
  momentBefore: string | null;
  momentAfter: string | null;
};

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiters = [',', ';', '\t', '|'];
  return delimiters
    .map((delimiter) => ({ delimiter, score: firstLine.split(delimiter).length }))
    .sort((a, b) => b.score - a.score)[0]?.delimiter ?? ',';
}

function normalizeRowKeys(input: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    normalized[normalizeHeader(key)] = String(value ?? '').trim();
  }
  return normalized;
}

function pickValue(row: Record<string, string>, candidates: string[]): string {
  for (const candidate of candidates) {
    const value = row[candidate];
    if (value) return value;
  }

  const keys = Object.keys(row);
  // Case-insensitive exact match
  for (const candidate of candidates) {
    const exactKey = keys.find((key) => key.trim().toLowerCase() === candidate.toLowerCase());
    if (exactKey && row[exactKey]) return row[exactKey];
  }

  // Fuzzy: only if candidate is longer than 2 chars (avoid single-letter false matches)
  for (const candidate of candidates) {
    if (candidate.length <= 2) continue;
    const fuzzyKey = keys.find((key) => key.toLowerCase().includes(candidate.toLowerCase()));
    if (fuzzyKey && row[fuzzyKey]) return row[fuzzyKey];
  }

  return '';
}

function toBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ['1', 'si', 'sí', 'true', 'x', 'yes', 'ok'].includes(normalized);
}

function uniqueTeacherIdentifiers(values: Array<string | null | undefined>): string[] {
  const identifiers: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeTeacherId(value ?? '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    identifiers.push(normalized);
  }

  return identifiers;
}

function inferPeriodLabelFromFilename(fileName: string, periodCode: string): string {
  const base = fileName.replace(/\.csv$/i, '').trim();
  const clean = base.replace(/^[^_]*_/, '');

  if (clean.includes(periodCode)) {
    const rest = clean.replace(periodCode, '').trim();
    if (rest) return rest;
  }

  return `PERIODO ${periodCode}`;
}

function inferProgramCode(row: Record<string, string>): string | null {
  const direct = pickValue(row, PROGRAM_CODE_KEYS);
  if (direct) return direct;

  const alfa = row.alfa;
  const num = row.num;
  if (alfa && num) return `${alfa}-${num}`;
  if (alfa) return alfa;
  return null;
}

function canonicalNrcByPeriod(periodCodeRaw: string, rawNrc: string): string | null {
  const periodCode = sanitizeId(periodCodeRaw).replace(/[^\d]/g, '').slice(0, 6);
  const nrcRaw = String(rawNrc ?? '').trim();
  if (!periodCode || !nrcRaw) return null;

  const explicit = nrcRaw.match(/^(\d{2})\s*-\s*(\d+)$/);
  const periodPrefix = periodCode.slice(-2);
  if (explicit) {
    const number = String(Number(explicit[2]));
    return `${periodPrefix}-${number}`;
  }

  const digits = nrcRaw.replace(/[^\d]/g, '');
  if (!digits) return null;
  const number = String(Number(digits));
  return `${periodPrefix}-${number}`;
}

function hasTeacherLikeColumns(row: Record<string, string>): boolean {
  const keys = Object.keys(row);
  const hasTeacherName = keys.some((k) => ['profesor', 'docente'].some((x) => k.includes(x)));
  const hasCedulaOrIdentificacion = keys.some((k) =>
    ['cedula', 'identificacion'].some((x) => k.includes(x)),
  );
  const hasId = keys.includes('id');
  const hasTeacherContext = keys.some((k) =>
    ['centrocosto', 'sede', 'responsable'].some((x) => k.includes(x)),
  );
  const hasMail = keys.some((k) => k.includes('email') || k.includes('correo'));

  return (
    hasMail &&
    ((hasCedulaOrIdentificacion && hasTeacherName) || (hasId && hasTeacherName && hasTeacherContext))
  );
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private resolveRpacaHistoryDir() {
    return path.join(resolveProjectRoot(), 'storage', 'archive', 'imports', 'rpaca');
  }

  private buildCourseRawJson(input: {
    existingRawJson: unknown;
    fileName: string;
    rowNumber: number;
    row: Record<string, string>;
    importId: string;
    importedAt: string;
    preserveTeacherAssignment: boolean;
    createOnly: boolean;
    teacherPreserved: boolean;
  }): Prisma.InputJsonValue {
    const raw = { ...this.asRecord(input.existingRawJson) } as Record<string, unknown>;

    raw.sourceFile = input.fileName;
    raw.rowNumber = input.rowNumber;
    raw.row = input.row;
    raw.rpacaImport = {
      importId: input.importId,
      importedAt: input.importedAt,
      preserveTeacherAssignment: input.preserveTeacherAssignment,
      createOnly: input.createOnly,
      teacherPreserved: input.teacherPreserved,
    };

    return raw as Prisma.InputJsonValue;
  }

  private async writeRpacaImportHistory(input: {
    importId: string;
    files: Express.Multer.File[];
    startedAt: string;
    finishedAt: string;
    options: {
      preserveTeacherAssignment: boolean;
      createOnly: boolean;
      periodCode?: string;
      periodLabel?: string;
      modality?: string;
      semester?: number;
      executionPolicy?: 'APPLIES' | 'AUTO_PASS';
    };
    summary: {
      totalRows: number;
      createdCourses: number;
      updatedCourses: number;
      skippedRows: number;
      failedRows: number;
      skippedExistingCourses: number;
      preservedTeacherAssignments: number;
      periodsTouched: string[];
      errors: string[];
    };
    changes: RpacaImportChange[];
  }) {
    const dir = this.resolveRpacaHistoryDir();
    await fs.mkdir(dir, { recursive: true });

    const fileName = `${input.importId}.json`;
    const absolutePath = path.join(dir, fileName);
    const payload = {
      ok: true,
      importId: input.importId,
      source: 'RPACA',
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      files: input.files.map((file) => ({
        originalName: file.originalname,
        size: file.size,
      })),
      options: input.options,
      summary: input.summary,
      changes: input.changes,
    };

    await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2), 'utf8');

    return {
      historyPath: absolutePath,
      historyRelativePath: path.join('storage', 'archive', 'imports', 'rpaca', fileName),
    };
  }

  private async findTeacherByIdentifiers(identifiers: string[]) {
    if (!identifiers.length) return null;

    const teachers = await this.prisma.teacher.findMany({
      where: {
        OR: [
          { id: { in: identifiers } },
          { sourceId: { in: identifiers } },
          { documentId: { in: identifiers } },
        ],
      },
      select: {
        id: true,
        sourceId: true,
        documentId: true,
        fullName: true,
        email: true,
        campus: true,
        region: true,
        costCenter: true,
        coordination: true,
      },
      take: 50,
    });

    if (!teachers.length) return null;

    for (const identifier of identifiers) {
      const direct = teachers.find((teacher) => teacher.id === identifier);
      if (direct) return direct;
      const bySourceId = teachers.find((teacher) => teacher.sourceId === identifier);
      if (bySourceId) return bySourceId;
      const byDocumentId = teachers.find((teacher) => teacher.documentId === identifier);
      if (byDocumentId) return byDocumentId;
    }

    return teachers[0];
  }

  private async syncTeacherProgramToCourses(teacherId: string, program: string | null) {
    const resolved = resolveProgramValue({ teacherId, teacherCostCenter: program });
    if (!resolved.programCode && !resolved.programName) return;

    await this.prisma.course.updateMany({
      where: { teacherId },
      data: {
        programCode: resolved.programCode,
        programName: resolved.programName,
      },
    });
  }

  async importCsvFiles(files: Express.Multer.File[], payload: unknown) {
    const body = parseWithSchema(ImportBodySchema, payload, 'import body');
    const importStartedAt = new Date();
    const importStartedAtIso = importStartedAt.toISOString();
    const importId = `rpaca_${importStartedAt.toISOString().replace(/[:.]/g, '-')}`;
    const preserveTeacherAssignment = body.preserveTeacherAssignment === false ? false : true;
    const createOnly = body.createOnly === true;

    let totalRows = 0;
    let createdCourses = 0;
    let updatedCourses = 0;
    let skippedRows = 0;
    let failedRows = 0;
    let skippedExistingCourses = 0;
    let preservedTeacherAssignments = 0;
    const periodsTouched = new Set<string>();
    const errors: string[] = [];
    const changes: RpacaImportChange[] = [];

    for (const file of files) {
      const sourceText = file.buffer.toString('utf8');
      const delimiter = detectDelimiter(sourceText);

      const records = parse(sourceText, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        delimiter,
        trim: true,
        relax_column_count: true,
      }) as Array<Record<string, unknown>>;

      totalRows += records.length;

      for (let idx = 0; idx < records.length; idx += 1) {
        const rawRow = records[idx];
        const row = normalizeRowKeys(rawRow);

        try {
          const periodCode = sanitizeId(pickValue(row, PERIOD_KEYS) || body.periodCode || '');
          if (!periodCode) {
            skippedRows += 1;
            continue;
          }

          const nrc = canonicalNrcByPeriod(periodCode, pickValue(row, NRC_KEYS));
          if (!nrc) {
            skippedRows += 1;
            continue;
          }

          const periodLabel =
            pickValue(row, PERIOD_LABEL_KEYS) ||
            body.periodLabel ||
            inferPeriodLabelFromFilename(file.originalname, periodCode);

          const semester = body.semester ?? inferSemesterFromPeriod(periodCode);
          const modality = (body.modality ?? inferModality(periodCode, periodLabel)).toUpperCase();
          const executionPolicy =
            body.executionPolicy ?? (modality === 'PP' ? 'AUTO_PASS' : 'APPLIES');

          const period = await this.prisma.period.upsert({
            where: { code: periodCode },
            create: {
              code: periodCode,
              label: periodLabel,
              semester,
              modality,
              executionPolicy,
            },
            update: {
              label: periodLabel,
              semester,
              modality,
              executionPolicy,
            },
          });
          periodsTouched.add(period.code);

          const uniqueCourseWhere = { nrc_periodId: { nrc, periodId: period.id } };
          const existing = await this.prisma.course.findUnique({
            where: uniqueCourseWhere,
            select: {
              id: true,
              teacherId: true,
              subjectName: true,
              moment: true,
              rawJson: true,
              bannerStartDate: true,
              bannerEndDate: true,
            },
          });

          if (createOnly && existing) {
            skippedExistingCourses += 1;
            changes.push({
              action: 'SKIPPED_EXISTING',
              periodCode: period.code,
              nrc,
              sourceFile: file.originalname,
              rowNumber: idx + 2,
              courseId: existing.id,
              teacherIdBefore: existing.teacherId ?? null,
              teacherIdAfter: existing.teacherId ?? null,
              teacherPreserved: false,
              subjectNameBefore: existing.subjectName ?? null,
              subjectNameAfter: existing.subjectName ?? null,
              momentBefore: existing.moment ?? null,
              momentAfter: existing.moment ?? null,
            });
            continue;
          }

          const teacherSourceId = normalizeTeacherId(pickValue(row, TEACHER_SOURCE_ID_KEYS));
          const teacherDocumentId = normalizeTeacherId(pickValue(row, TEACHER_DOCUMENT_ID_KEYS));
          const teacherIdentifiers = uniqueTeacherIdentifiers([teacherSourceId, teacherDocumentId]);
          const teacherFallbackId = teacherSourceId || teacherDocumentId || '';
          const matchedTeacher = await this.findTeacherByIdentifiers(teacherIdentifiers);
          const teacherIdCandidate = matchedTeacher?.id ?? teacherFallbackId;
          const teacherName = pickValue(row, TEACHER_NAME_KEYS) || 'Docente no identificado';
          const teacherEmail = pickValue(row, TEACHER_EMAIL_KEYS) || null;
          const campus = pickValue(row, CAMPUS_KEYS) || null;
          const importedProgramCode = inferProgramCode(row);
          const importedProgramName = pickValue(row, PROGRAM_NAME_KEYS) || null;
          const resolvedProgram = resolveProgramValue({
            teacherId: matchedTeacher?.id ?? (teacherIdCandidate || null),
            teacherSourceId: teacherSourceId || null,
            teacherDocumentId: teacherDocumentId || null,
            teacherName,
            teacherCostCenter: matchedTeacher?.costCenter ?? null,
            courseProgramCode: importedProgramCode,
            courseProgramName: importedProgramName,
          });
          const subjectName = pickValue(row, SUBJECT_KEYS) || null;
          const moment = normalizeMoment(pickValue(row, MOMENT_KEYS) || '1');
          const bannerStartDate = pickValue(row, START_DATE_KEYS) || existing?.bannerStartDate || null;
          const bannerEndDate = pickValue(row, END_DATE_KEYS) || existing?.bannerEndDate || null;
          const templateDeclared = normalizeTemplate(pickValue(row, TEMPLATE_KEYS) || 'UNKNOWN');
          const d4FlagLegacy = toBoolean(pickValue(row, D4_KEYS)) || templateDeclared === 'D4';

          if (teacherIdCandidate) {
            if (matchedTeacher) {
              await this.prisma.teacher.update({
                where: { id: matchedTeacher.id },
                data: {
                  fullName: teacherName || matchedTeacher.fullName,
                  email: teacherEmail || undefined,
                  campus: campus || undefined,
                  sourceId:
                    teacherSourceId && teacherSourceId !== matchedTeacher.sourceId
                      ? teacherSourceId
                      : undefined,
                  documentId:
                    teacherDocumentId && teacherDocumentId !== matchedTeacher.documentId
                      ? teacherDocumentId
                      : undefined,
                },
              });
            } else {
              const existingTeacher = await this.prisma.teacher.findUnique({
                where: { id: teacherIdCandidate },
              });

              await this.prisma.teacher.upsert({
                where: { id: teacherIdCandidate },
                create: {
                  id: teacherIdCandidate,
                  sourceId: teacherSourceId || null,
                  documentId: teacherDocumentId || null,
                  fullName: teacherName,
                  email: teacherEmail ?? existingTeacher?.email ?? null,
                  campus: campus ?? existingTeacher?.campus ?? null,
                  region: existingTeacher?.region ?? null,
                  costCenter: existingTeacher?.costCenter ?? null,
                  coordination: existingTeacher?.coordination ?? null,
                },
                update: {
                  fullName: teacherName || existingTeacher?.fullName,
                  email: teacherEmail || undefined,
                  campus: campus || undefined,
                  sourceId: teacherSourceId || undefined,
                  documentId: teacherDocumentId || undefined,
                },
              });
            }
          }
          const teacherPreserved =
            !!existing && preserveTeacherAssignment && !teacherIdCandidate && !!existing.teacherId;
          const teacherIdToPersist = teacherPreserved
            ? existing.teacherId
            : (teacherIdCandidate || null);
          if (teacherPreserved) preservedTeacherAssignments += 1;

          const edificio = (pickValue(row, EDIFICIO_KEYS) || '').toString().trim().toUpperCase() || null;
          const horaInicio = pickValue(row, HORA_INICIO_KEYS) || null;
          const horaFin = pickValue(row, HORA_FIN_KEYS) || null;
          const diaL = (pickValue(row, DIA_L_KEYS) || '').toString().trim();
          const diaM = (pickValue(row, DIA_M_KEYS) || '').toString().trim();
          const diaI = (pickValue(row, DIA_I_KEYS) || '').toString().trim();
          const diaJ = (pickValue(row, DIA_J_KEYS) || '').toString().trim();
          const diaV = (pickValue(row, DIA_V_KEYS) || '').toString().trim();
          const diaS = (pickValue(row, DIA_S_KEYS) || '').toString().trim();
          const diaD = (pickValue(row, DIA_D_KEYS) || '').toString().trim();
          const dias = [
            diaL ? 'L' : '_',
            diaM ? 'M' : '_',
            diaI ? 'I' : '_',
            diaJ ? 'J' : '_',
            diaV ? 'V' : '_',
            diaS ? 'S' : '_',
            diaD ? 'D' : '_',
          ].join('');
          const hasAnyDay = dias.replace(/_/g, '').length > 0;
          const isVirtu = edificio?.startsWith('VIRTU') || false;
          const modalityType: 'PRESENCIAL' | 'VIRTUAL' | 'VIRTUAL_100' = isVirtu
            ? hasAnyDay ? 'VIRTUAL' : 'VIRTUAL_100'
            : 'PRESENCIAL';

          const courseData = {
            nrc,
            periodId: period.id,
            teacherId: teacherIdToPersist,
            campusCode: campus,
            programCode: resolvedProgram.programCode,
            programName: resolvedProgram.programName,
            subjectName,
            moment,
            bannerStartDate,
            bannerEndDate,
            salon: pickValue(row, SALON_KEYS) || null,
            salon1: pickValue(row, SALON1_KEYS) || null,
            edificio,
            horaInicio: horaInicio ? String(horaInicio) : null,
            horaFin: horaFin ? String(horaFin) : null,
            dias: hasAnyDay || isVirtu ? dias : null,
            modalityType,
            templateDeclared,
            d4FlagLegacy,
            rawJson: this.buildCourseRawJson({
              existingRawJson: existing?.rawJson,
              fileName: file.originalname,
              rowNumber: idx + 2,
              row,
              importId,
              importedAt: importStartedAtIso,
              preserveTeacherAssignment,
              createOnly,
              teacherPreserved,
            }),
          };

          const course = existing
            ? await this.prisma.course.update({ where: { id: existing.id }, data: courseData })
            : await this.prisma.course.create({ data: courseData });

          if (existing) {
            updatedCourses += 1;
          } else {
            createdCourses += 1;
          }

          changes.push({
            action: existing ? 'UPDATED' : 'CREATED',
            periodCode: period.code,
            nrc,
            sourceFile: file.originalname,
            rowNumber: idx + 2,
            courseId: course.id,
            teacherIdBefore: existing?.teacherId ?? null,
            teacherIdAfter: teacherIdToPersist,
            teacherPreserved,
            subjectNameBefore: existing?.subjectName ?? null,
            subjectNameAfter: subjectName,
            momentBefore: existing?.moment ?? null,
            momentAfter: moment,
          });

          await this.prisma.moodleCheck.upsert({
            where: { courseId: course.id },
            create: { courseId: course.id, status: 'PENDIENTE' },
            update: {},
          });
        } catch (error) {
          failedRows += 1;
          const message = error instanceof Error ? error.message : 'Error desconocido';
          const failure = `${file.originalname} fila ${idx + 2}: ${message}`;
          this.logger.error(failure);
          if (errors.length < 50) errors.push(failure);
        }
      }
    }

    let historyPath: string | null = null;
    let historyRelativePath: string | null = null;

    try {
      const history = await this.writeRpacaImportHistory({
        importId,
        files,
        startedAt: importStartedAtIso,
        finishedAt: new Date().toISOString(),
        options: {
          preserveTeacherAssignment,
          createOnly,
          periodCode: body.periodCode,
          periodLabel: body.periodLabel,
          modality: body.modality,
          semester: body.semester,
          executionPolicy: body.executionPolicy,
        },
        summary: {
          totalRows,
          createdCourses,
          updatedCourses,
          skippedRows,
          failedRows,
          skippedExistingCourses,
          preservedTeacherAssignments,
          periodsTouched: [...periodsTouched],
          errors,
        },
        changes,
      });
      historyPath = history.historyPath;
      historyRelativePath = history.historyRelativePath;
    } catch (error) {
      const message = `No fue posible guardar historial RPACA: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(message);
      if (errors.length < 50) errors.push(message);
    }

    return {
      ok: true,
      files: files.length,
      totalRows,
      createdCourses,
      updatedCourses,
      skippedRows,
      failedRows,
      completedWithErrors: failedRows > 0,
      skippedExistingCourses,
      preservedTeacherAssignments,
      periodsTouched: [...periodsTouched],
      historyPath,
      historyRelativePath,
      errors,
    };
  }

  async importTeachersWorkbook(file: Express.Multer.File, payload: unknown) {
    const body = parseWithSchema(ImportTeachersBodySchema, payload, 'teachers workbook body');
    const workbook = read(file.buffer, { type: 'buffer', cellDates: false });

    const targetSheets = body.sheetName
      ? workbook.SheetNames.filter(
          (sheet: string) => sheet.toLowerCase() === body.sheetName!.toLowerCase(),
        )
      : workbook.SheetNames;

    let createdTeachers = 0;
    let updatedTeachers = 0;
    let skippedRows = 0;
    const processedTeacherSheets: string[] = [];

    let createdCoordinators = 0;
    let updatedCoordinators = 0;
    let skippedCoordinatorRows = 0;
    const processedCoordinatorSheets: string[] = [];

    if (body.includeCoordinators) {
      for (const sheetName of targetSheets) {
        if (!sheetName.toLowerCase().includes('coordin')) continue;

        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) continue;

        const rowsRaw = utils.sheet_to_json<Record<string, unknown>>(worksheet, {
          defval: '',
          raw: false,
        });
        if (!rowsRaw.length) continue;

        processedCoordinatorSheets.push(sheetName);

        for (const rowRaw of rowsRaw) {
          const row = normalizeRowKeys(rowRaw);
          const programId = normalizeProgramValue(pickValue(row, COORDINATOR_PROGRAM_KEYS));
          const email = pickValue(row, COORDINATOR_EMAIL_KEYS).toLowerCase();
          const fullName = pickValue(row, COORDINATOR_NAME_KEYS) || 'Coordinador de programa';

          if (!programId || !email) {
            skippedCoordinatorRows += 1;
            continue;
          }

          const programKey = normalizeProgramKey(programId);
          if (!programKey) {
            skippedCoordinatorRows += 1;
            continue;
          }

          const existing = await this.prisma.coordinator.findUnique({
            where: {
              programKey_email: {
                programKey,
                email,
              },
            },
            select: { id: true },
          });

          await this.prisma.coordinator.upsert({
            where: {
              programKey_email: {
                programKey,
                email,
              },
            },
            create: {
              programId,
              programKey,
              fullName,
              email,
              sourceSheet: sheetName,
            },
            update: {
              programId,
              fullName,
              sourceSheet: sheetName,
            },
          });

          if (existing) {
            updatedCoordinators += 1;
          } else {
            createdCoordinators += 1;
          }
        }
      }
    }

    for (const sheetName of targetSheets) {
      if (sheetName.toLowerCase().includes('coordin')) continue;

      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;

      const rowsRaw = utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: '',
        raw: false,
      });

      if (!rowsRaw.length) continue;

      const firstNormalized = normalizeRowKeys(rowsRaw[0]);
      if (!hasTeacherLikeColumns(firstNormalized)) continue;
      processedTeacherSheets.push(sheetName);

      for (const rowRaw of rowsRaw) {
        const row = normalizeRowKeys(rowRaw);
        const sourceId = normalizeTeacherId(pickValue(row, ['id', 'id_docente', 'docente_id']));
        const documentId = normalizeTeacherId(
          pickValue(row, ['cedula', 'identificacion', 'cedula_docente', 'identificacion_docente']),
        );
        const identifiers = uniqueTeacherIdentifiers([sourceId, documentId]);
        const existing = await this.findTeacherByIdentifiers(identifiers);
        const teacherId = existing?.id ?? sourceId ?? documentId;

        if (!teacherId) {
          skippedRows += 1;
          continue;
        }

        const fullName = pickValue(row, TEACHER_NAME_KEYS) || 'Docente no identificado';
        const email = pickValue(row, TEACHER_EMAIL_KEYS) || null;
        const campus = pickValue(row, CAMPUS_KEYS) || null;
        const region = pickValue(row, ['zona', 'region']) || null;
        const costCenter = resolveTeacherProgramOverride({
          teacherId,
          teacherSourceId: sourceId || existing?.sourceId || null,
          teacherDocumentId: documentId || existing?.documentId || null,
          teacherName: fullName,
          teacherCostCenter: pickValue(row, ['centrocosto']) || existing?.costCenter || null,
        });
        const coordination = resolveTeacherProgramOverride({
          teacherId,
          teacherSourceId: sourceId || existing?.sourceId || null,
          teacherDocumentId: documentId || existing?.documentId || null,
          teacherName: fullName,
          teacherCostCenter:
            pickValue(row, COORDINATION_KEYS) || pickValue(row, ['centrocosto']) || existing?.coordination || existing?.costCenter || null,
        });

        await this.prisma.teacher.upsert({
          where: { id: teacherId },
          create: {
            id: teacherId,
            sourceId: sourceId || null,
            documentId: documentId || null,
            fullName,
            email,
            campus,
            region,
            costCenter,
            coordination,
            extraJson: {
              sourceFile: file.originalname,
              sourceSheet: sheetName,
              sourceWorkbookId: sourceId || null,
              sourceWorkbookDocumentId: documentId || null,
            },
          },
          update: {
            fullName,
            sourceId: sourceId || undefined,
            documentId: documentId || undefined,
            email: email || undefined,
            campus: campus || undefined,
            region: region || undefined,
            costCenter: costCenter || undefined,
            coordination: coordination || undefined,
            extraJson: {
              sourceFile: file.originalname,
              sourceSheet: sheetName,
              sourceWorkbookId: sourceId || null,
              sourceWorkbookDocumentId: documentId || null,
            },
          },
        });

        await this.syncTeacherProgramToCourses(teacherId, costCenter);

        if (existing) {
          updatedTeachers += 1;
        } else {
          createdTeachers += 1;
        }
      }
    }

    return {
      ok: true,
      source: file.originalname,
      sheetsProcessed: processedTeacherSheets,
      coordinatorSheetsProcessed: processedCoordinatorSheets,
      createdTeachers,
      updatedTeachers,
      skippedRows,
      createdCoordinators,
      updatedCoordinators,
      skippedCoordinatorRows,
    };
  }

  async importMoodleLogsFromFolder(rawBody: unknown) {
    const body = rawBody && typeof rawBody === 'object' ? rawBody as Record<string, unknown> : {};
    const defaultPeriodCode = typeof body['periodCode'] === 'string' ? body['periodCode'].trim() : '';
    const folderPath = path.resolve(resolveProjectRoot(), 'storage/imports/moodle-logs');

    let files: string[] = [];
    try {
      const entries = await fs.readdir(folderPath);
      files = entries.filter((e) => e.toLowerCase().endsWith('.csv') && e.toLowerCase().startsWith('logs_'));
    } catch {
      return { ok: false, error: `Carpeta no encontrada: ${folderPath}`, processed: 0, skipped: 0, details: [] };
    }

    if (!files.length) {
      return { ok: true, message: 'No hay archivos logs_*.csv en la carpeta.', processed: 0, skipped: 0, details: [] };
    }

    const REQUIRED_DAYS_PER_WEEK = 3;
    const details: Array<{ file: string; nrc: string; status: string; teacherDays?: number; complianceRate?: number; ingresosScore?: number }> = [];
    let processed = 0;
    let skipped = 0;

    for (const file of files) {
      // Extraer NRC del nombre: logs_15-79471_*.csv o logs_79471_*.csv
      const nrcMatch = file.match(/logs_(?:(?:\d{2}-)?(\d+))_/);
      const nrcRaw = nrcMatch?.[1] ?? null;
      if (!nrcRaw) { skipped++; details.push({ file, nrc: '', status: 'NRC_NO_DETECTADO_EN_NOMBRE' }); continue; }

      // Buscar el curso en BD
      const course = await this.prisma.course.findFirst({
        where: {
          nrc: { endsWith: nrcRaw },
          ...(defaultPeriodCode ? { period: { code: defaultPeriodCode } } : {}),
        },
        include: {
          teacher: { select: { fullName: true } },
          period: { select: { code: true, executionPolicy: true } },
          evaluations: { where: { phase: 'EJECUCION' }, select: { id: true, checklist: true, score: true, observations: true } },
        },
        orderBy: { period: { code: 'desc' } },
      });

      if (!course) { skipped++; details.push({ file, nrc: nrcRaw, status: 'CURSO_NO_ENCONTRADO' }); continue; }
      if (!course.teacher?.fullName) { skipped++; details.push({ file, nrc: nrcRaw, status: 'SIN_DOCENTE' }); continue; }

      // Parsear CSV Moodle (log de actividad)
      const content = await fs.readFile(path.join(folderPath, file));
      const rows: Record<string, string>[] = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true });

      // Identificar al docente: normalizar nombre del DB y buscar coincidencia en el log
      // Normalizar: quitar tildes y convertir a mayúsculas para comparación robusta
      const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

      const teacherDbName = normalize(course.teacher.fullName);
      // DB format: "GLORIA, ROJAS DURAN I." → extraer tokens significativos
      const dbTokens = teacherDbName.replace(/[.,]/g, ' ').split(/\s+/).filter((t) => t.length > 2);

      const userCounts = new Map<string, number>();
      for (const row of rows) {
        const u = (row['Nombre completo del usuario'] ?? row['Full name of user'] ?? '').trim();
        if (u && u !== '-') userCounts.set(u, (userCounts.get(u) ?? 0) + 1);
      }

      // Buscar usuario del log que más tokens del DB tenga en su nombre
      let teacherLogName = '';
      let bestMatch = 0;
      for (const [userName] of userCounts) {
        const upper = normalize(userName);
        const matches = dbTokens.filter((t) => upper.includes(t)).length;
        if (matches > bestMatch) { bestMatch = matches; teacherLogName = userName; }
      }

      if (!teacherLogName || bestMatch < 2) {
        skipped++;
        details.push({ file, nrc: course.nrc, status: `DOCENTE_NO_IDENTIFICADO (DB: ${teacherDbName})` });
        continue;
      }

      // Contar días únicos de acceso del docente
      const teacherDays = new Set<string>();
      const allLogDates = new Set<string>();
      for (const row of rows) {
        const hora = (row['Hora'] ?? row['Time'] ?? '').trim();
        const day = hora.split(',')[0]?.trim();
        if (day) allLogDates.add(day);
        const userName = (row['Nombre completo del usuario'] ?? '').trim();
        if (userName === teacherLogName && day) teacherDays.add(day);
      }

      // Calcular semanas del curso: usar fechas Banner si existen, sino rango del log
      const parseLogDate = (d: string) => {
        // Formato "28/03/26" → día/mes/año (2 dígitos)
        const parts = d.split('/');
        if (parts.length !== 3) return null;
        const [dd, mm, yy] = parts;
        return new Date(`20${yy}-${mm}-${dd}`);
      };
      const parseBannerDate = (d: string) => {
        const [dd, mm, yyyy] = d.split('/');
        return new Date(`${yyyy}-${mm}-${dd}`);
      };

      let totalWeeks: number;
      let dateSource: string;
      if (course.bannerStartDate && course.bannerEndDate) {
        const start = parseBannerDate(course.bannerStartDate);
        const end = parseBannerDate(course.bannerEndDate);
        const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
        totalWeeks = Math.max(1, Math.ceil(totalDays / 7));
        dateSource = 'banner';
      } else {
        // Sin fechas Banner: usar rango de fechas presentes en el log
        const logDates = [...allLogDates].map((d) => parseLogDate(d)).filter(Boolean) as Date[];
        if (logDates.length < 2) {
          skipped++;
          details.push({ file, nrc: course.nrc, status: 'SIN_FECHAS_BANNER_Y_LOG_INSUFICIENTE' });
          continue;
        }
        const minDate = new Date(Math.min(...logDates.map((d) => d.getTime())));
        const maxDate = new Date(Math.max(...logDates.map((d) => d.getTime())));
        const totalDays = Math.max(1, Math.round((maxDate.getTime() - minDate.getTime()) / 86400000));
        totalWeeks = Math.max(1, Math.ceil(totalDays / 7));
        dateSource = 'log';
      }

      const requiredDays = totalWeeks * REQUIRED_DAYS_PER_WEEK;
      const complianceRate = Math.min(100, Math.round((teacherDays.size / requiredDays) * 100 * 100) / 100);
      const ingresosValue = complianceRate; // valor numérico 0-100

      // Actualizar o crear evaluación EJECUCION con ingresos
      const existingEval = course.evaluations[0];
      const existingChecklist = (existingEval?.checklist && typeof existingEval.checklist === 'object') ? existingEval.checklist as Record<string, unknown> : {};
      const newChecklist = { ...existingChecklist, ingresos: ingresosValue };

      if (existingEval) {
        await this.prisma.evaluation.update({
          where: { id: existingEval.id },
          data: { checklist: newChecklist },
        });
      } else {
        await this.prisma.evaluation.create({
          data: {
            courseId: course.id,
            phase: 'EJECUCION',
            checklist: newChecklist,
            score: 0,
          },
        });
      }

      processed++;
      details.push({
        file,
        nrc: course.nrc,
        status: 'OK',
        teacherDays: teacherDays.size,
        complianceRate,
        ingresosScore: Math.round((Math.min(100, complianceRate) / 100) * 10 * 100) / 100,
      });
    }

    return { ok: true, processed, skipped, filesFound: files.length, details };
  }

  async importBannerDatesFromFolder(rawBody: unknown) {
    const body = rawBody && typeof rawBody === 'object' ? rawBody as Record<string, unknown> : {};
    const defaultPeriodCode = typeof body['periodCode'] === 'string' ? body['periodCode'].trim() : '';
    const folderPath = path.resolve(resolveProjectRoot(), 'storage/imports/banner-dates');

    let files: string[] = [];
    try {
      const entries = await fs.readdir(folderPath);
      files = entries.filter((e) => e.toLowerCase().endsWith('.csv'));
    } catch {
      return { ok: false, error: `Carpeta no encontrada: ${folderPath}`, updated: 0, skipped: 0, periodCodes: [] };
    }

    if (!files.length) {
      return { ok: true, message: 'No hay archivos CSV en la carpeta.', updated: 0, skipped: 0, periodCodes: [] };
    }

    let updated = 0;
    let skipped = 0;
    const periodCodesSet = new Set<string>();
    const details: Array<{ nrc: string; period: string; status: string }> = [];

    for (const file of files) {
      if (file.startsWith('README')) continue;
      const content = await fs.readFile(path.join(folderPath, file));
      const rows: Record<string, string>[] = parse(content, { columns: true, skip_empty_lines: true, trim: true });

      for (const row of rows) {
        const nrcRaw = (row['nrc'] ?? row['NRC'] ?? '').trim().replace(/^\d{2}-/, '');
        const periodCode = (row['period'] ?? row['periodo'] ?? row['period_code'] ?? defaultPeriodCode).trim();
        const startDate = (row['start_date'] ?? row['fecha_inicio'] ?? row['fecha_inicial'] ?? '').trim();
        const endDate = (row['end_date'] ?? row['fecha_fin'] ?? row['fecha_final'] ?? '').trim();

        if (!nrcRaw || !periodCode) { skipped++; continue; }

        const period = await this.prisma.period.findFirst({ where: { code: periodCode } });
        if (!period) { skipped++; details.push({ nrc: nrcRaw, period: periodCode, status: 'PERIODO_NO_ENCONTRADO' }); continue; }

        const result = await this.prisma.course.updateMany({
          where: { nrc: { endsWith: nrcRaw }, periodId: period.id },
          data: {
            ...(startDate ? { bannerStartDate: startDate } : {}),
            ...(endDate ? { bannerEndDate: endDate } : {}),
          },
        });

        if (result.count > 0) {
          updated += result.count;
          periodCodesSet.add(periodCode);
          details.push({ nrc: nrcRaw, period: periodCode, status: 'ACTUALIZADO' });
        } else {
          skipped++;
          details.push({ nrc: nrcRaw, period: periodCode, status: 'NRC_NO_ENCONTRADO' });
        }
      }
    }

    return { ok: true, updated, skipped, periodCodes: [...periodCodesSet], filesProcessed: files.length, details };
  }
}
