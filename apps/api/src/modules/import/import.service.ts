import { Inject, Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { read, utils } from 'xlsx';
import { z } from 'zod';
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
import { resolveProgramValue } from '../common/program.util';

const ImportBodySchema = z.object({
  periodCode: z.string().trim().optional(),
  periodLabel: z.string().trim().optional(),
  modality: z.string().trim().optional(),
  semester: z.coerce.number().int().min(1).max(2).optional(),
  executionPolicy: z.enum(['APPLIES', 'AUTO_PASS']).optional(),
});

const ImportTeachersBodySchema = z.object({
  sheetName: z.string().trim().optional(),
  includeCoordinators: z.coerce.boolean().optional().default(true),
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
const SALON_KEYS = ['salon'];
const SALON1_KEYS = ['salon1'];
const TEMPLATE_KEYS = ['tipo_aula', 'plantilla', 'template'];
const D4_KEYS = ['d4', 'd4_flag', 'distancia_4_0'];
const COORDINATOR_PROGRAM_KEYS = ['id', 'programa', 'centrocosto', 'responsable'];
const COORDINATOR_EMAIL_KEYS = ['email', 'correo'];
const COORDINATOR_NAME_KEYS = ['nombre', 'coordinador', 'responsable'];
const COORDINATION_KEYS = ['responsable', 'centrocosto', 'programa'];

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
  for (const candidate of candidates) {
    const fuzzyKey = keys.find((key) => key.includes(candidate));
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
    const resolved = resolveProgramValue({ teacherCostCenter: program });
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

    let totalRows = 0;
    let createdCourses = 0;
    let updatedCourses = 0;
    let skippedRows = 0;
    const periodsTouched = new Set<string>();
    const errors: string[] = [];

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
            teacherCostCenter: matchedTeacher?.costCenter ?? null,
            courseProgramCode: importedProgramCode,
            courseProgramName: importedProgramName,
          });
          const subjectName = pickValue(row, SUBJECT_KEYS) || null;
          const moment = normalizeMoment(pickValue(row, MOMENT_KEYS) || '1');
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

          const uniqueCourseWhere = { nrc_periodId: { nrc, periodId: period.id } };
          const existing = await this.prisma.course.findUnique({
            where: uniqueCourseWhere,
            select: { id: true },
          });

          const courseData = {
            nrc,
            periodId: period.id,
            teacherId: teacherIdCandidate || null,
            campusCode: campus,
            programCode: resolvedProgram.programCode,
            programName: resolvedProgram.programName,
            subjectName,
            moment,
            salon: pickValue(row, SALON_KEYS) || null,
            salon1: pickValue(row, SALON1_KEYS) || null,
            templateDeclared,
            d4FlagLegacy,
            rawJson: {
              sourceFile: file.originalname,
              rowNumber: idx + 2,
              row,
            },
          };

          const course = existing
            ? await this.prisma.course.update({ where: { id: existing.id }, data: courseData })
            : await this.prisma.course.create({ data: courseData });

          if (existing) {
            updatedCourses += 1;
          } else {
            createdCourses += 1;
          }

          await this.prisma.moodleCheck.upsert({
            where: { courseId: course.id },
            create: { courseId: course.id, status: 'PENDIENTE' },
            update: {},
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Error desconocido';
          const failure = `${file.originalname} fila ${idx + 2}: ${message}`;
          this.logger.error(failure);
          if (errors.length < 50) errors.push(failure);
        }
      }
    }

    return {
      ok: true,
      files: files.length,
      totalRows,
      createdCourses,
      updatedCourses,
      skippedRows,
      periodsTouched: [...periodsTouched],
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
          const programId = pickValue(row, COORDINATOR_PROGRAM_KEYS);
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
        const costCenter = pickValue(row, ['centrocosto']) || null;
        const coordination = pickValue(row, COORDINATION_KEYS) || null;

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
}
