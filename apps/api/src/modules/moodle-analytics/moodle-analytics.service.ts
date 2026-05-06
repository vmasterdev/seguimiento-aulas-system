import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { parse as parseCsv } from 'csv-parse/sync';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { resolveProgramValue } from '../common/program.util';
import { resolveProjectRoot } from '../moodle-url-resolver-adapter/adapter.logic';
import { buildCourseScheduleInfo, scoreEjecucion } from '@seguimiento/shared';

const ImportSchema = z.object({
  summaryPath: z.string().trim().optional(),
});

const BannerEnrollmentImportSchema = z.object({
  inputPath: z.string().trim().min(1),
  sourceLabel: z.string().trim().optional(),
  defaultPeriodCode: z.string().trim().optional(),
  defaultNrc: z.string().trim().optional(),
});

const FiltersSchema = z.object({
  periodCodes: z.string().trim().optional(),
  programCodes: z.string().trim().optional(),
  campusCodes: z.string().trim().optional(),
  teacherIds: z.string().trim().optional(),
  nrcs: z.string().trim().optional(),
  moments: z.string().trim().optional(),
});

const AttendanceDateReportSchema = FiltersSchema.extend({
  sessionDay: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const AttendanceStudentReportSchema = FiltersSchema.extend({
  sessionDays: z.string().trim().min(1),
});

type AnalyticsFilters = {
  periodCodes: string[];
  programCodes: string[];
  campusCodes: string[];
  teacherIds: string[];
  nrcs: string[];
  moments: string[];
};

type AttendanceSessionSummary = {
  label: string;
  day: string | null;
  presentCount: number;
  absentCount: number;
  justifiedCount: number;
  unknownCount: number;
  trackedCount: number;
  attendanceRate: number | null;
};

type AttendanceSummaryJson = {
  statusCounts: Record<string, number>;
  sessions: AttendanceSessionSummary[];
  trackedEntries: number;
  presentCount: number;
  absentCount: number;
  justifiedCount: number;
  unknownCount: number;
  attendanceRate: number | null;
  inattendanceRate: number | null;
};

type ActivitySummaryJson = {
  dailyCounts: Record<string, number>;
  componentCounts: Record<string, number>;
  eventNameCounts: Record<string, number>;
  actorCategoryCounts: Record<string, number>;
  topActors: Array<{ name: string; count: number }>;
};

type ParticipantSummaryJson = {
  roleCounts: Record<string, number>;
  actorCategoryCounts: Record<string, number>;
  totalParticipants: number;
  classifiedParticipants: number;
};

type BannerEnrollmentSummaryJson = {
  sourceLabel: string | null;
  rowCount: number;
};

type AlertTypeKey =
  | 'ACTIVITY_OUTSIDE_ROSTER'
  | 'ACTIVITY_UNCLASSIFIED'
  | 'PARTICIPANT_UNUSUAL_ROLE'
  | 'STUDENT_NO_ACTIVITY'
  | 'STUDENT_NO_ATTENDANCE';

type CourseMeta = {
  id: string;
  nrc: string;
  subjectName: string | null;
  campusCode: string | null;
  programCode: string | null;
  programName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  periodCode: string;
  periodLabel: string;
  semester: number | null;
};

const MONTHS: Record<string, string> = {
  ene: '01',
  enero: '01',
  feb: '02',
  febrero: '02',
  mar: '03',
  marzo: '03',
  abr: '04',
  abril: '04',
  may: '05',
  mayo: '05',
  jun: '06',
  junio: '06',
  jul: '07',
  julio: '07',
  ago: '08',
  agosto: '08',
  sep: '09',
  sept: '09',
  septiembre: '09',
  oct: '10',
  octubre: '10',
  nov: '11',
  noviembre: '11',
  dic: '12',
  diciembre: '12',
};

const REPORT_TZ = '-05:00';

@Injectable()
export class MoodleAnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private parseCsvList(value: string | undefined) {
    return [...new Set(String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean))];
  }

  private root() {
    return resolveProjectRoot();
  }

  private resolveInputPath(root: string, value: string) {
    return path.isAbsolute(value) ? value : path.resolve(root, value);
  }

  private normalizeHeaderKey(value: string | null | undefined) {
    return this.normalizeNameKey(value).toLowerCase();
  }

  private normalizeNameKey(value: string | null | undefined) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private parseNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = String(value ?? '').trim();
    if (!text) return null;
    const normalized = text.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private percentage(value: number, total: number) {
    if (!total) return null;
    return Number(((value / total) * 100).toFixed(1));
  }

  private parseDateList(value: string | undefined) {
    return this.parseCsvList(value).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
  }

  private attendanceStatusLabel(statusCode: string | null | undefined) {
    switch (statusCode) {
      case 'A':
        return 'Presente';
      case 'N':
        return 'Ausente';
      case 'J':
        return 'Justificado';
      case 'P':
        return 'Pendiente';
      case '?':
        return 'No tomada';
      default:
        return 'Sin estado';
    }
  }

  private normalizedKeys(values: Array<string | null | undefined>) {
    const output = new Set<string>();
    for (const value of values) {
      const key = this.normalizeNameKey(value);
      if (key && key !== '-') output.add(key);
    }
    return [...output];
  }

  private alertTypeLabel(type: AlertTypeKey) {
    switch (type) {
      case 'ACTIVITY_OUTSIDE_ROSTER':
        return 'Actores en logs fuera del listado';
      case 'ACTIVITY_UNCLASSIFIED':
        return 'Actores no clasificados en logs';
      case 'PARTICIPANT_UNUSUAL_ROLE':
        return 'Participantes con rol no academico';
      case 'STUDENT_NO_ACTIVITY':
        return 'Estudiantes sin actividad';
      case 'STUDENT_NO_ATTENDANCE':
        return 'Estudiantes sin asistencia';
      default:
        return type;
    }
  }

  private alertUserRank(type: AlertTypeKey) {
    switch (type) {
      case 'ACTIVITY_OUTSIDE_ROSTER':
        return 50;
      case 'ACTIVITY_UNCLASSIFIED':
        return 40;
      case 'PARTICIPANT_UNUSUAL_ROLE':
        return 30;
      case 'STUDENT_NO_ACTIVITY':
        return 20;
      case 'STUDENT_NO_ATTENDANCE':
        return 10;
      default:
        return 0;
    }
  }

  private alertRiskLevel(score: number) {
    if (score >= 18) return 'ALTO';
    if (score >= 8) return 'MEDIO';
    if (score > 0) return 'BAJO';
    return 'SIN_ALERTAS';
  }

  private safeDate(day: string, time = '00:00:00') {
    const candidate = new Date(`${day}T${time}${REPORT_TZ}`);
    return Number.isNaN(candidate.getTime()) ? null : candidate;
  }

  private parseAttendanceSessionLabel(label: string) {
    const raw = String(label ?? '').trim();
    if (!raw) return { day: null as string | null, at: null as Date | null };
    const match = raw.match(/(\d{1,2})\s+([a-zA-Záéíóúñ]+)\s+(\d{4})(?:\s+(\d{1,2})\.(\d{2})(AM|PM))?/i);
    if (!match) return { day: null as string | null, at: null as Date | null };
    const [, dd, monthLabel, yyyy, hh, mm, meridiem] = match;
    const month = MONTHS[this.normalizeNameKey(monthLabel).toLowerCase()] ?? MONTHS[monthLabel.toLowerCase()];
    if (!month) return { day: null as string | null, at: null as Date | null };
    const day = `${yyyy}-${month}-${dd.padStart(2, '0')}`;
    if (!hh || !mm || !meridiem) {
      return { day, at: this.safeDate(day) };
    }
    let hour = Number(hh);
    if (meridiem.toUpperCase() === 'PM' && hour < 12) hour += 12;
    if (meridiem.toUpperCase() === 'AM' && hour === 12) hour = 0;
    const at = this.safeDate(day, `${String(hour).padStart(2, '0')}:${mm}:00`);
    return { day, at };
  }

  private parseActivityTimestamp(value: string) {
    const raw = String(value ?? '').trim();
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}),\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return { day: null as string | null, at: null as Date | null };
    const [, dd, mm, yy, hh, mi, ss] = match;
    const year = Number(yy) + 2000;
    const day = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    return {
      day,
      at: this.safeDate(day, `${hh}:${mi}:${ss}`),
    };
  }

  private parseAttendanceCell(rawValue: unknown) {
    const raw = String(rawValue ?? '').trim();
    if (!raw) {
      return {
        rawValue: null,
        statusCode: null as string | null,
        present: null as boolean | null,
        justified: null as boolean | null,
        pointsEarned: null as number | null,
        pointsPossible: null as number | null,
      };
    }
    const statusCode = raw.startsWith('?') ? '?' : raw.charAt(0).toUpperCase();
    const pointsMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
    const pointsEarned = pointsMatch ? this.parseNumber(pointsMatch[1]) : null;
    const pointsPossible = pointsMatch ? this.parseNumber(pointsMatch[2]) : null;
    return {
      rawValue: raw,
      statusCode,
      present: statusCode === 'A',
      justified: statusCode === 'J',
      pointsEarned,
      pointsPossible,
    };
  }

  private asStringMap(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private findHeaderValue(row: Record<string, unknown>, patterns: string[]) {
    const entries = Object.entries(row);
    for (const [key, value] of entries) {
      const normalized = this.normalizeHeaderKey(key);
      if (patterns.some((pattern) => normalized.includes(pattern))) {
        const text = String(value ?? '').trim();
        if (text) return text;
      }
    }
    return '';
  }

  private topEntries(input: Record<string, number>, limit = 8) {
    return Object.entries(input)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([key, value]) => ({ key, value }));
  }

  private asNumberRecord(value: unknown) {
    const raw = this.asStringMap(value);
    const output: Record<string, number> = {};
    for (const [key, item] of Object.entries(raw)) {
      const parsed = this.parseNumber(item);
      if (parsed != null) output[key] = parsed;
    }
    return output;
  }

  private chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private resolveLatestSummaryPath(kind: 'attendance' | 'activity' | 'participants', requestedPath?: string) {
    const root = this.root();
    if (requestedPath?.trim()) {
      const absolute = this.resolveInputPath(root, requestedPath.trim());
      if (!fs.existsSync(absolute)) {
        throw new BadRequestException(`No existe el summary indicado: ${absolute}`);
      }
      return absolute;
    }

    const baseDir = path.join(root, 'storage', 'outputs', 'validation', 'sidecar-extract-batches');
    if (!fs.existsSync(baseDir)) {
      throw new BadRequestException('No existen lotes de exportacion sidecar en storage/outputs/validation/sidecar-extract-batches.');
    }

    const candidates = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(`_${kind}`))
      .map((entry) => path.join(baseDir, entry.name, `${kind}_exports`, 'summary.json'))
      .filter((candidate) => fs.existsSync(candidate))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

    if (!candidates[0]) {
      throw new BadRequestException(`No se encontro un summary de ${kind} para importar.`);
    }
    return candidates[0];
  }

  private selectLatestPerCourse<T extends { courseId: string; importGroupKey: string | null; id: string }>(reports: T[]) {
    const selected = new Map<string, string>();
    for (const report of reports) {
      if (!selected.has(report.courseId)) {
        selected.set(report.courseId, report.importGroupKey ?? report.id);
      }
    }
    return reports.filter((report) => (report.importGroupKey ?? report.id) === selected.get(report.courseId));
  }

  private resolveCourseWhere(filters: AnalyticsFilters) {
    const nrcOr = filters.nrcs.length
      ? filters.nrcs.map((token) => ({
          nrc: { endsWith: token, mode: 'insensitive' as const },
        }))
      : undefined;

    return {
      period: filters.periodCodes.length ? { code: { in: filters.periodCodes } } : undefined,
      programCode: filters.programCodes.length ? { in: filters.programCodes } : undefined,
      campusCode: filters.campusCodes.length ? { in: filters.campusCodes } : undefined,
      teacherId: filters.teacherIds.length ? { in: filters.teacherIds } : undefined,
      moment: filters.moments.length ? { in: filters.moments } : undefined,
      OR: nrcOr,
    };
  }

  private async resolveCourseId(courseId: string | undefined, nrc: string, periodCode: string) {
    if (courseId?.trim()) return courseId.trim();
    const course = await this.prisma.course.findFirst({
      where: {
        nrc,
        period: { code: periodCode },
      },
      select: { id: true },
    });
    return course?.id ?? null;
  }

  private courseMeta(course: {
    id: string;
    nrc: string;
    subjectName: string | null;
    campusCode: string | null;
    programCode: string | null;
    programName: string | null;
    teacherId: string | null;
    teacher: { fullName: string; costCenter: string | null } | null;
    period: { code: string; label: string; semester: number };
  }): CourseMeta {
    const resolvedProgram = resolveProgramValue({
      teacherCostCenter: course.teacher?.costCenter ?? null,
      teacherLinked: !!course.teacherId,
      courseProgramCode: course.programCode,
      courseProgramName: course.programName,
    });

    return {
      id: course.id,
      nrc: course.nrc,
      subjectName: course.subjectName,
      campusCode: course.campusCode,
      programCode: resolvedProgram.programCode,
      programName: resolvedProgram.programName,
      teacherId: course.teacherId,
      teacherName: course.teacher?.fullName ?? null,
      periodCode: course.period.code,
      periodLabel: course.period.label,
      semester: course.period.semester ?? null,
    };
  }

  private parseAttendanceWorkbook(filePath: string) {
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      raw: false,
      defval: null,
    });
    const courseLabel = String(rows[0]?.[1] ?? '').trim() || null;
    const groupLabel = String(rows[1]?.[1] ?? '').trim() || null;
    const header = rows[3] ?? [];

    const tailHeaders = new Set(['A', 'N', 'J', 'P', 'SESIONES TOMADAS', 'PUNTUACION', 'PORCENTAJE']);
    let trailerStart = header.length;
    for (let index = 5; index < header.length; index += 1) {
      const token = this.normalizeNameKey(String(header[index] ?? ''));
      if (tailHeaders.has(token)) {
        trailerStart = index;
        break;
      }
    }

    const sessionHeaders = header.slice(5, trailerStart).map((value) => String(value ?? '').trim());
    const sessions = sessionHeaders
      .map((label, index) => {
        const { day, at } = this.parseAttendanceSessionLabel(label);
        return {
          id: randomUUID(),
          sessionLabel: label,
          sessionDay: day,
          sessionAt: at,
          columnIndex: index,
        };
      })
      .filter((item) => item.sessionLabel);

    type AttendanceEntryDraft = {
      sessionId: string;
      rawValue: string | null;
      statusCode: string | null;
      present: boolean | null;
      justified: boolean | null;
      pointsEarned: number | null;
      pointsPossible: number | null;
    };

    const records: Array<{
      id: string;
      lastName: string | null;
      firstName: string | null;
      fullName: string;
      moodleUserId: string | null;
      institutionalId: string | null;
      email: string | null;
      sessionsTaken: number | null;
      scoreLabel: string | null;
      percentage: number | null;
      entries: AttendanceEntryDraft[];
    }> = [];

    const statusCounts: Record<string, number> = {};
    const sessionStats = new Map<string, AttendanceSessionSummary>();
    for (const session of sessions) {
      sessionStats.set(session.id, {
        label: session.sessionLabel,
        day: session.sessionDay,
        presentCount: 0,
        absentCount: 0,
        justifiedCount: 0,
        unknownCount: 0,
        trackedCount: 0,
        attendanceRate: null,
      });
    }

    for (const row of rows.slice(4)) {
      const firstName = String(row?.[1] ?? '').trim();
      const lastName = String(row?.[0] ?? '').trim();
      if (!firstName && !lastName) continue;
      const fullName = `${firstName} ${lastName}`.trim();
      const record = {
        id: randomUUID(),
        lastName: lastName || null,
        firstName: firstName || null,
        fullName,
        moodleUserId: row?.[2] != null ? String(row[2]).trim() || null : null,
        institutionalId: row?.[3] != null ? String(row[3]).trim() || null : null,
        email: row?.[4] != null ? String(row[4]).trim() || null : null,
        sessionsTaken: this.parseNumber(row?.[trailerStart + 3]) ?? null,
        scoreLabel: row?.[trailerStart + 4] != null ? String(row[trailerStart + 4]).trim() || null : null,
        percentage: this.parseNumber(row?.[trailerStart + 5]),
        entries: [] as Array<ReturnType<typeof this.parseAttendanceCell> & { sessionId: string }>,
      };

      sessions.forEach((session, index) => {
        const parsed = this.parseAttendanceCell(row?.[5 + index]);
        record.entries.push({ sessionId: session.id, ...parsed });
        const code = parsed.statusCode ?? 'VACIO';
        statusCounts[code] = (statusCounts[code] ?? 0) + 1;

        const stats = sessionStats.get(session.id);
        if (!stats) return;
        if (parsed.statusCode === 'A') stats.presentCount += 1;
        else if (parsed.statusCode === 'N') stats.absentCount += 1;
        else if (parsed.statusCode === 'J') stats.justifiedCount += 1;
        else stats.unknownCount += 1;
        if (parsed.statusCode && parsed.statusCode !== '?') stats.trackedCount += 1;
      });

      records.push(record);
    }

    const sessionSummaries = sessions.map((session) => {
      const stats = sessionStats.get(session.id)!;
      stats.attendanceRate = this.percentage(stats.presentCount, stats.trackedCount);
      return stats;
    });

    const presentCount = sessionSummaries.reduce((sum, item) => sum + item.presentCount, 0);
    const absentCount = sessionSummaries.reduce((sum, item) => sum + item.absentCount, 0);
    const justifiedCount = sessionSummaries.reduce((sum, item) => sum + item.justifiedCount, 0);
    const unknownCount = sessionSummaries.reduce((sum, item) => sum + item.unknownCount, 0);
    const trackedEntries = presentCount + absentCount + justifiedCount;
    const summaryJson: AttendanceSummaryJson = {
      statusCounts,
      sessions: sessionSummaries,
      trackedEntries,
      presentCount,
      absentCount,
      justifiedCount,
      unknownCount,
      attendanceRate: this.percentage(presentCount, trackedEntries),
      inattendanceRate: this.percentage(absentCount, trackedEntries),
    };

    return {
      courseLabel,
      groupLabel,
      sessions,
      records,
      summaryJson,
      coverageStart: sessionSummaries.map((item) => item.day).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
      coverageEnd:
        sessionSummaries
          .map((item) => item.day)
          .filter((value): value is string => Boolean(value))
          .sort()
          .slice(-1)[0] ?? null,
    };
  }

  private async latestAttendanceStudentKeysByCourse(courseIds: string[]) {
    const ids = [...new Set(courseIds.filter(Boolean))];
    if (!ids.length) return new Map<string, Set<string>>();

    const reports = await this.prisma.moodleAttendanceReport.findMany({
      where: { courseId: { in: ids } },
      orderBy: [{ courseId: 'asc' }, { importedAt: 'desc' }],
      include: {
        records: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    });

    const latest = this.selectLatestPerCourse(reports);
    const output = new Map<string, Set<string>>();
    for (const report of latest) {
      const keys = new Set<string>();
      for (const record of report.records) {
        if (record.fullName) keys.add(this.normalizeNameKey(record.fullName));
        if (record.email) keys.add(this.normalizeNameKey(record.email));
      }
      output.set(report.courseId, keys);
    }
    return output;
  }

  private actorCategoryRank(category: string | null | undefined) {
    switch (category) {
      case 'DOCENTE':
        return 50;
      case 'ADMIN':
        return 40;
      case 'AUDITOR':
        return 30;
      case 'ESTUDIANTE':
        return 20;
      case 'NO_CLASIFICADO':
        return 10;
      case 'SIN_USUARIO':
      default:
        return 0;
    }
  }

  private preferActorCategory(current: string | null | undefined, next: string | null | undefined) {
    if (!next) return current ?? 'NO_CLASIFICADO';
    if (!current) return next;
    return this.actorCategoryRank(next) >= this.actorCategoryRank(current) ? next : current;
  }

  private classifyParticipantActorCategory(
    fullName: string,
    email: string | null,
    roles: string[],
    teacherName: string | null,
  ) {
    const nameKey = this.normalizeNameKey(fullName);
    const emailKey = this.normalizeNameKey(email);
    const teacherKey = this.normalizeNameKey(teacherName);
    if (teacherKey && (nameKey === teacherKey || emailKey === teacherKey)) {
      return 'DOCENTE';
    }

    const normalizedRoles = roles.map((role) => this.normalizeNameKey(role)).filter(Boolean);
    const hasRole = (tokens: string[]) =>
      normalizedRoles.some((role) => tokens.some((token) => role.includes(token)));

    if (hasRole(['DOCENTE', 'PROFESOR', 'TEACHER', 'EDITINGTEACHER', 'NONEDITINGTEACHER', 'TUTOR'])) {
      return 'DOCENTE';
    }
    if (hasRole(['ADMIN', 'ADMINISTRADOR', 'MANAGER', 'COORDINADOR', 'COURSE CREATOR', 'CREATOR', 'SOPORTE'])) {
      return 'ADMIN';
    }
    if (hasRole(['AUDITOR', 'OBSERVADOR', 'VIEWER'])) {
      return 'AUDITOR';
    }
    if (hasRole(['ESTUDIANTE', 'STUDENT', 'ALUMNO', 'LEARNER', 'PARTICIPANTE'])) {
      return 'ESTUDIANTE';
    }
    return 'NO_CLASIFICADO';
  }

  private parseParticipantsReport(filePath: string, teacherName: string | null) {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      pageTitle?: string | null;
      title?: string | null;
      participants?: Array<Record<string, unknown>>;
      roleCounts?: Record<string, number>;
    };

    const actorCategoryCounts: Record<string, number> = {};
    const participants = Array.isArray(payload.participants) ? payload.participants : [];
    const rows = participants.map((participant) => {
      const raw = this.asStringMap(participant);
      const fullName = String(raw.fullName ?? '').trim() || 'SIN_NOMBRE';
      const email = String(raw.email ?? '').trim() || null;
      const roles = Array.isArray(raw.roles)
        ? raw.roles.map((item) => String(item ?? '').trim()).filter(Boolean)
        : [];
      const actorCategory = this.classifyParticipantActorCategory(fullName, email, roles, teacherName);
      actorCategoryCounts[actorCategory] = (actorCategoryCounts[actorCategory] ?? 0) + 1;

      return {
        id: randomUUID(),
        fullName,
        email,
        moodleUserId: String(raw.moodleUserId ?? '').trim() || null,
        institutionalId: String(raw.institutionalId ?? '').trim() || null,
        rolesLabel: String(raw.rolesLabel ?? '').trim() || null,
        rolesJson: roles as Prisma.InputJsonValue,
        groupsLabel: String(raw.groupsLabel ?? '').trim() || null,
        lastAccessLabel: String(raw.lastAccessLabel ?? '').trim() || null,
        statusLabel: String(raw.statusLabel ?? '').trim() || null,
        actorCategory,
        rawJson: raw as Prisma.InputJsonValue,
      };
    });

    const summaryJson: ParticipantSummaryJson = {
      roleCounts: this.asNumberRecord(payload.roleCounts),
      actorCategoryCounts,
      totalParticipants: rows.length,
      classifiedParticipants: rows.filter((row) => row.actorCategory !== 'NO_CLASIFICADO').length,
    };

    return {
      courseLabel: String(payload.pageTitle ?? payload.title ?? '').trim() || null,
      participants: rows,
      roleCounts: this.asNumberRecord(payload.roleCounts),
      summaryJson,
    };
  }

  private readTabularRows(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.readFile(filePath, { cellDates: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) return [];
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
        raw: false,
        defval: null,
      });
    }
    if (ext === '.json') {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(payload) ? (payload as Array<Record<string, unknown>>) : [];
    }
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return parseCsv(text, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
    }) as Array<Record<string, unknown>>;
  }

  private parseBannerEnrollmentFile(
    filePath: string,
    defaults: { periodCode?: string; nrc?: string; sourceLabel?: string },
  ) {
    const rows = this.readTabularRows(filePath);
    const grouped = new Map<
      string,
      {
        nrc: string;
        periodCode: string;
        sourceLabel: string | null;
        students: Array<{
          fullName: string;
          firstName: string | null;
          lastName: string | null;
          institutionalId: string | null;
          email: string | null;
          statusLabel: string | null;
          rawJson: Prisma.InputJsonValue;
        }>;
      }
    >();

    for (const row of rows) {
      const raw = this.asStringMap(row);
      const nrc =
        this.findHeaderValue(raw, ['nrc', 'crn', 'curso nrc']) ||
        String(defaults.nrc ?? '').trim();
      const periodCode =
        this.findHeaderValue(raw, ['periodo', 'term', 'period code', 'codigo periodo']) ||
        String(defaults.periodCode ?? '').trim();
      if (!nrc || !periodCode) continue;

      const fullName =
        this.findHeaderValue(raw, ['nombre completo', 'student name', 'full name', 'estudiante']) ||
        '';
      const firstName = this.findHeaderValue(raw, ['nombres', 'nombre', 'first name']) || null;
      const lastName = this.findHeaderValue(raw, ['apellidos', 'apellido', 'last name']) || null;
      const email = this.findHeaderValue(raw, ['correo', 'email', 'mail']) || null;
      const institutionalId =
        this.findHeaderValue(raw, ['id estudiante', 'id institucional', 'codigo', 'student id', 'banner id', 'documento']) ||
        null;
      const statusLabel = this.findHeaderValue(raw, ['estado', 'status']) || null;
      const normalizedFullName =
        fullName ||
        [firstName ?? '', lastName ?? '']
          .join(' ')
          .trim();
      if (!normalizedFullName) continue;

      const key = `${periodCode}::${nrc}`;
      const bucket =
        grouped.get(key) ??
        {
          nrc,
          periodCode,
          sourceLabel: defaults.sourceLabel?.trim() || null,
          students: [],
        };
      bucket.students.push({
        fullName: normalizedFullName,
        firstName,
        lastName,
        institutionalId,
        email,
        statusLabel,
        rawJson: raw as Prisma.InputJsonValue,
      });
      grouped.set(key, bucket);
    }

    return [...grouped.values()].map((item) => ({
      ...item,
      summaryJson: {
        sourceLabel: item.sourceLabel,
        rowCount: item.students.length,
      } satisfies BannerEnrollmentSummaryJson,
    }));
  }

  private async latestParticipantActorCategoriesByCourse(courseIds: string[]) {
    const ids = [...new Set(courseIds.filter(Boolean))];
    if (!ids.length) return new Map<string, Map<string, string>>();

    const reports = await this.prisma.moodleParticipantReport.findMany({
      where: { courseId: { in: ids } },
      orderBy: [{ courseId: 'asc' }, { importedAt: 'desc' }],
      include: {
        participants: {
          select: {
            fullName: true,
            email: true,
            actorCategory: true,
          },
        },
      },
    });

    const latest = this.selectLatestPerCourse(reports);
    const output = new Map<string, Map<string, string>>();
    for (const report of latest) {
      const categories = new Map<string, string>();
      for (const participant of report.participants) {
        const actorCategory = participant.actorCategory ?? 'NO_CLASIFICADO';
        const keys = [this.normalizeNameKey(participant.fullName), this.normalizeNameKey(participant.email)].filter(Boolean);
        for (const key of keys) {
          categories.set(key, this.preferActorCategory(categories.get(key), actorCategory));
        }
      }
      output.set(report.courseId, categories);
    }
    return output;
  }

  private classifyActorCategory(
    actorName: string,
    teacherName: string | null,
    attendanceStudentKeys: Set<string>,
    participantActorCategories?: Map<string, string>,
  ) {
    const key = this.normalizeNameKey(actorName);
    if (!key || key === '-') return 'SIN_USUARIO';
    if (teacherName && key === this.normalizeNameKey(teacherName)) return 'DOCENTE';
    const participantCategory = participantActorCategories?.get(key);
    if (participantCategory) return participantCategory;
    if (attendanceStudentKeys.has(key)) return 'ESTUDIANTE';
    if (key.includes('ADMINISTRADOR')) return 'ADMIN';
    return 'NO_CLASIFICADO';
  }

  private parseActivityCsv(
    filePath: string,
    teacherName: string | null,
    attendanceStudentKeys: Set<string>,
    participantActorCategories?: Map<string, string>,
  ) {
    const text = fs.readFileSync(filePath, 'utf8');
    const rows = parseCsv(text, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
    }) as Array<Record<string, string>>;

    const dailyCounts: Record<string, number> = {};
    const componentCounts: Record<string, number> = {};
    const eventNameCounts: Record<string, number> = {};
    const actorCategoryCounts: Record<string, number> = {};
    const actorCounts: Record<string, number> = {};
    const userKeys = new Set<string>();

    const events = rows.map((row) => {
      const eventAtRaw = String(row['Hora'] ?? '').trim();
      const actorName = String(row['Nombre completo del usuario'] ?? '').trim() || '-';
      const component = String(row['Componente'] ?? '').trim() || 'SIN_COMPONENTE';
      const eventName = String(row['Nombre evento'] ?? '').trim() || 'SIN_EVENTO';
      const { day, at } = this.parseActivityTimestamp(eventAtRaw);
      const actorKey = this.normalizeNameKey(actorName) || null;
      const actorCategory = this.classifyActorCategory(
        actorName,
        teacherName,
        attendanceStudentKeys,
        participantActorCategories,
      );

      if (day) dailyCounts[day] = (dailyCounts[day] ?? 0) + 1;
      componentCounts[component] = (componentCounts[component] ?? 0) + 1;
      eventNameCounts[eventName] = (eventNameCounts[eventName] ?? 0) + 1;
      actorCategoryCounts[actorCategory] = (actorCategoryCounts[actorCategory] ?? 0) + 1;
      actorCounts[actorName] = (actorCounts[actorName] ?? 0) + 1;
      if (actorKey && actorKey !== '-') userKeys.add(actorKey);

      return {
        id: randomUUID(),
        eventAt: at,
        eventDay: day,
        actorName,
        actorKey,
        actorCategory,
        affectedUser: String(row['Usuario afectado'] ?? '').trim() || null,
        eventContext: String(row['Contexto del evento'] ?? '').trim() || null,
        component,
        eventName,
        description: String(row['Descripción'] ?? '').trim() || null,
        origin: String(row['Origen'] ?? '').trim() || null,
        ipAddress: String(row['Dirección IP'] ?? '').trim() || null,
      };
    });

    const days = Object.keys(dailyCounts).sort();
    const summaryJson: ActivitySummaryJson = {
      dailyCounts,
      componentCounts,
      eventNameCounts,
      actorCategoryCounts,
      topActors: Object.entries(actorCounts)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 12)
        .map(([name, count]) => ({ name, count })),
    };

    return {
      events,
      summaryJson,
      coverageStart: days[0] ?? null,
      coverageEnd: days.slice(-1)[0] ?? null,
      uniqueUsers: userKeys.size,
    };
  }

  private async latestAttendanceSnapshots(filters: AnalyticsFilters) {
    const reports = await this.prisma.moodleAttendanceReport.findMany({
      where: { course: this.resolveCourseWhere(filters) },
      include: {
        course: {
          include: {
            period: true,
            teacher: { select: { fullName: true, costCenter: true } },
          },
        },
      },
      orderBy: [{ courseId: 'asc' }, { importedAt: 'desc' }],
    });
    return this.selectLatestPerCourse(reports);
  }

  private async latestActivitySnapshots(filters: AnalyticsFilters) {
    const reports = await this.prisma.moodleActivityReport.findMany({
      where: { course: this.resolveCourseWhere(filters) },
      include: {
        course: {
          include: {
            period: true,
            teacher: { select: { fullName: true, costCenter: true } },
          },
        },
      },
      orderBy: [{ courseId: 'asc' }, { importedAt: 'desc' }],
    });
    return this.selectLatestPerCourse(reports);
  }

  private async latestParticipantSnapshots(filters: AnalyticsFilters) {
    const reports = await this.prisma.moodleParticipantReport.findMany({
      where: { course: this.resolveCourseWhere(filters) },
      include: {
        course: {
          include: {
            period: true,
            teacher: { select: { fullName: true, costCenter: true } },
          },
        },
      },
      orderBy: [{ courseId: 'asc' }, { importedAt: 'desc' }],
    });
    return this.selectLatestPerCourse(reports);
  }

  private async latestBannerEnrollmentSnapshots(filters: AnalyticsFilters) {
    const reports = await this.prisma.bannerEnrollmentReport.findMany({
      where: { course: this.resolveCourseWhere(filters) },
      include: {
        course: {
          include: {
            period: true,
            teacher: { select: { fullName: true, costCenter: true } },
          },
        },
      },
      orderBy: [{ courseId: 'asc' }, { importedAt: 'desc' }],
    });
    return this.selectLatestPerCourse(reports);
  }

  async importAttendance(rawBody: unknown) {
    const body = parseWithSchema(ImportSchema, rawBody, 'attendance import');
    const root = this.root();
    const summaryPath = this.resolveLatestSummaryPath('attendance', body.summaryPath);
    const summaryPayload = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as {
      items?: Array<{
        courseId?: string | null;
        nrc: string;
        periodCode: string;
        downloads?: Array<{ relativePath: string; label?: string }>;
      }>;
    };
    const summaryRelative = path.relative(root, summaryPath).replace(/\\/g, '/');
    const importGroupKey = path.basename(path.dirname(path.dirname(summaryPath)));

    let importedReports = 0;
    let importedEntries = 0;
    const skipped: string[] = [];

    for (const item of summaryPayload.items ?? []) {
      const courseId = await this.resolveCourseId(item.courseId ?? undefined, item.nrc, item.periodCode);
      if (!courseId) {
        skipped.push(`${item.nrc}:${item.periodCode}`);
        continue;
      }

      for (const download of item.downloads ?? []) {
        const filePath = this.resolveInputPath(root, download.relativePath);
        if (!fs.existsSync(filePath)) continue;
        const parsed = this.parseAttendanceWorkbook(filePath);
        const sourceRelativePath = path.relative(root, filePath).replace(/\\/g, '/');
        const reportId = randomUUID();
        const sessionRows = parsed.sessions.map((session) => ({
          id: session.id,
          reportId,
          sessionLabel: session.sessionLabel,
          sessionDay: session.sessionDay,
          sessionAt: session.sessionAt,
          columnIndex: session.columnIndex,
        }));
        const recordRows = parsed.records.map((record) => ({
          id: record.id,
          reportId,
          fullName: record.fullName,
          firstName: record.firstName,
          lastName: record.lastName,
          moodleUserId: record.moodleUserId,
          institutionalId: record.institutionalId,
          email: record.email,
          sessionsTaken: record.sessionsTaken,
          scoreLabel: record.scoreLabel,
          percentage: record.percentage,
        }));
        const entryRows = parsed.records.flatMap((record) =>
          record.entries.map((entry) => ({
            id: randomUUID(),
            reportId,
            sessionId: entry.sessionId,
            recordId: record.id,
            rawValue: entry.rawValue,
            statusCode: entry.statusCode,
            present: entry.present,
            justified: entry.justified,
            pointsEarned: entry.pointsEarned,
            pointsPossible: entry.pointsPossible,
          })),
        );

        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.moodleAttendanceReport.findUnique({
            where: { sourceRelativePath },
            select: { id: true },
          });
          if (existing) {
            await tx.moodleAttendanceReport.delete({ where: { id: existing.id } });
          }
          await tx.moodleAttendanceReport.create({
            data: {
              id: reportId,
              courseId,
              sourceRelativePath,
              importGroupKey,
              label: download.label ?? null,
              courseLabel: parsed.courseLabel,
              groupLabel: parsed.groupLabel,
              totalStudents: recordRows.length,
              totalSessions: sessionRows.length,
              coverageStart: parsed.coverageStart,
              coverageEnd: parsed.coverageEnd,
              summaryJson: parsed.summaryJson,
            },
          });
          if (sessionRows.length) await tx.moodleAttendanceSession.createMany({ data: sessionRows });
          if (recordRows.length) await tx.moodleAttendanceRecord.createMany({ data: recordRows });
          for (const chunk of this.chunk(entryRows, 1000)) {
            if (chunk.length) await tx.moodleAttendanceEntry.createMany({ data: chunk });
          }
        }, { timeout: 60_000, maxWait: 10_000 });

        importedReports += 1;
        importedEntries += entryRows.length;
      }
    }

    return {
      ok: true,
      kind: 'attendance',
      summaryPath: summaryRelative,
      importGroupKey,
      importedReports,
      importedEntries,
      skippedCourses: skipped,
    };
  }

  async importActivity(rawBody: unknown) {
    const body = parseWithSchema(ImportSchema, rawBody, 'activity import');
    const root = this.root();
    const summaryPath = this.resolveLatestSummaryPath('activity', body.summaryPath);
    const summaryPayload = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as {
      items?: Array<{
        courseId?: string | null;
        nrc: string;
        periodCode: string;
        downloads?: Array<{ relativePath: string }>;
      }>;
    };
    const summaryRelative = path.relative(root, summaryPath).replace(/\\/g, '/');
    const importGroupKey = path.basename(path.dirname(path.dirname(summaryPath)));

    let importedReports = 0;
    let importedEvents = 0;
    const skipped: string[] = [];
    const resolvedItems: Array<{
      courseId: string;
      nrc: string;
      periodCode: string;
      downloads: Array<{ relativePath: string }>;
    }> = [];

    for (const item of summaryPayload.items ?? []) {
      const courseId = await this.resolveCourseId(item.courseId ?? undefined, item.nrc, item.periodCode);
      if (!courseId) {
        skipped.push(`${item.nrc}:${item.periodCode}`);
        continue;
      }
      resolvedItems.push({
        courseId,
        nrc: item.nrc,
        periodCode: item.periodCode,
        downloads: item.downloads ?? [],
      });
    }

    const courseIds = [...new Set(resolvedItems.map((item) => item.courseId))];
    const [courses, attendanceKeysByCourse, participantCategoriesByCourse] = await Promise.all([
      this.prisma.course.findMany({
        where: { id: { in: courseIds } },
        include: {
          teacher: { select: { fullName: true } },
        },
      }),
      this.latestAttendanceStudentKeysByCourse(courseIds),
      this.latestParticipantActorCategoriesByCourse(courseIds),
    ]);
    const courseMap = new Map(courses.map((course) => [course.id, course]));

    for (const item of resolvedItems) {
      const course = courseMap.get(item.courseId);
      if (!course) {
        skipped.push(`${item.nrc}:${item.periodCode}`);
        continue;
      }
      const studentKeys = attendanceKeysByCourse.get(item.courseId) ?? new Set<string>();
      const participantCategories = participantCategoriesByCourse.get(item.courseId) ?? new Map<string, string>();

      for (const download of item.downloads) {
        const filePath = this.resolveInputPath(root, download.relativePath);
        if (!fs.existsSync(filePath)) continue;
        const parsed = this.parseActivityCsv(
          filePath,
          course.teacher?.fullName ?? null,
          studentKeys,
          participantCategories,
        );
        const sourceRelativePath = path.relative(root, filePath).replace(/\\/g, '/');
        const reportId = randomUUID();
        const eventRows = parsed.events.map((event) => ({
          id: event.id,
          reportId,
          eventAt: event.eventAt,
          eventDay: event.eventDay,
          actorName: event.actorName,
          actorKey: event.actorKey,
          actorCategory: event.actorCategory,
          affectedUser: event.affectedUser,
          eventContext: event.eventContext,
          component: event.component,
          eventName: event.eventName,
          description: event.description,
          origin: event.origin,
          ipAddress: event.ipAddress,
        }));

        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.moodleActivityReport.findUnique({
            where: { sourceRelativePath },
            select: { id: true },
          });
          if (existing) {
            await tx.moodleActivityReport.delete({ where: { id: existing.id } });
          }
          await tx.moodleActivityReport.create({
            data: {
              id: reportId,
              courseId: item.courseId,
              sourceRelativePath,
              importGroupKey,
              totalEvents: eventRows.length,
              uniqueUsers: parsed.uniqueUsers,
              coverageStart: parsed.coverageStart,
              coverageEnd: parsed.coverageEnd,
              summaryJson: parsed.summaryJson,
            },
          });
          for (const chunk of this.chunk(eventRows, 1000)) {
            if (chunk.length) await tx.moodleActivityEvent.createMany({ data: chunk });
          }
        }, { timeout: 180_000, maxWait: 10_000 });

        importedReports += 1;
        importedEvents += eventRows.length;
      }
    }

    return {
      ok: true,
      kind: 'activity',
      summaryPath: summaryRelative,
      importGroupKey,
      importedReports,
      importedEvents,
      skippedCourses: skipped,
    };
  }

  async importParticipants(rawBody: unknown) {
    const body = parseWithSchema(ImportSchema, rawBody, 'participants import');
    const root = this.root();
    const summaryPath = this.resolveLatestSummaryPath('participants', body.summaryPath);
    const summaryPayload = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as {
      items?: Array<{
        courseId?: string | null;
        nrc: string;
        periodCode: string;
        downloads?: Array<{ relativePath: string }>;
      }>;
    };
    const summaryRelative = path.relative(root, summaryPath).replace(/\\/g, '/');
    const importGroupKey = path.basename(path.dirname(path.dirname(summaryPath)));

    let importedReports = 0;
    let importedParticipants = 0;
    const skipped: string[] = [];
    const resolvedItems: Array<{
      courseId: string;
      nrc: string;
      periodCode: string;
      downloads: Array<{ relativePath: string }>;
    }> = [];

    for (const item of summaryPayload.items ?? []) {
      const courseId = await this.resolveCourseId(item.courseId ?? undefined, item.nrc, item.periodCode);
      if (!courseId) {
        skipped.push(`${item.nrc}:${item.periodCode}`);
        continue;
      }
      resolvedItems.push({
        courseId,
        nrc: item.nrc,
        periodCode: item.periodCode,
        downloads: item.downloads ?? [],
      });
    }

    const courses = await this.prisma.course.findMany({
      where: { id: { in: [...new Set(resolvedItems.map((item) => item.courseId))] } },
      include: {
        teacher: { select: { fullName: true } },
      },
    });
    const courseMap = new Map(courses.map((course) => [course.id, course]));

    for (const item of resolvedItems) {
      const course = courseMap.get(item.courseId);
      if (!course) {
        skipped.push(`${item.nrc}:${item.periodCode}`);
        continue;
      }

      for (const download of item.downloads) {
        const filePath = this.resolveInputPath(root, download.relativePath);
        if (!fs.existsSync(filePath)) continue;
        const parsed = this.parseParticipantsReport(filePath, course.teacher?.fullName ?? null);
        const sourceRelativePath = path.relative(root, filePath).replace(/\\/g, '/');
        const reportId = randomUUID();
        const participantRows = parsed.participants.map((participant) => ({
          id: participant.id,
          reportId,
          fullName: participant.fullName,
          email: participant.email,
          moodleUserId: participant.moodleUserId,
          institutionalId: participant.institutionalId,
          rolesLabel: participant.rolesLabel,
          rolesJson: participant.rolesJson,
          groupsLabel: participant.groupsLabel,
          lastAccessLabel: participant.lastAccessLabel,
          statusLabel: participant.statusLabel,
          actorCategory: participant.actorCategory,
          rawJson: participant.rawJson,
        }));

        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.moodleParticipantReport.findUnique({
            where: { sourceRelativePath },
            select: { id: true },
          });
          if (existing) {
            await tx.moodleParticipantReport.delete({ where: { id: existing.id } });
          }
          await tx.moodleParticipantReport.create({
            data: {
              id: reportId,
              courseId: item.courseId,
              sourceRelativePath,
              importGroupKey,
              courseLabel: parsed.courseLabel,
              totalParticipants: participantRows.length,
              roleCounts: parsed.roleCounts,
              summaryJson: parsed.summaryJson,
            },
          });
          for (const chunk of this.chunk(participantRows, 500)) {
            if (chunk.length) {
              await tx.moodleParticipantRecord.createMany({ data: chunk });
            }
          }
        }, { timeout: 60_000, maxWait: 10_000 });

        importedReports += 1;
        importedParticipants += participantRows.length;
      }
    }

    return {
      ok: true,
      kind: 'participants',
      summaryPath: summaryRelative,
      importGroupKey,
      importedReports,
      importedParticipants,
      skippedCourses: skipped,
    };
  }

  async importBannerEnrollment(rawBody: unknown) {
    const body = parseWithSchema(BannerEnrollmentImportSchema, rawBody, 'banner enrollment import');
    const root = this.root();
    const inputPath = this.resolveInputPath(root, body.inputPath);
    if (!fs.existsSync(inputPath)) {
      throw new BadRequestException(`No existe el archivo de matricula Banner: ${inputPath}`);
    }

    const sourceRelativePath = path.relative(root, inputPath).replace(/\\/g, '/');
    const importGroupKey = `banner-enrollment-${new Date().toISOString()}`;
    const groups = this.parseBannerEnrollmentFile(inputPath, {
      nrc: body.defaultNrc,
      periodCode: body.defaultPeriodCode,
      sourceLabel: body.sourceLabel,
    });

    let importedReports = 0;
    let importedStudents = 0;
    const skipped: string[] = [];

    for (const group of groups) {
      const courseId = await this.resolveCourseId(undefined, group.nrc, group.periodCode);
      if (!courseId) {
        skipped.push(`${group.nrc}:${group.periodCode}`);
        continue;
      }

      const reportId = randomUUID();
      const reportSourcePath = `${sourceRelativePath}#${group.periodCode}:${group.nrc}`;
      const studentRows = group.students.map((student) => ({
        id: randomUUID(),
        reportId,
        fullName: student.fullName,
        firstName: student.firstName,
        lastName: student.lastName,
        institutionalId: student.institutionalId,
        email: student.email,
        statusLabel: student.statusLabel,
        rawJson: student.rawJson,
      }));

      await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.bannerEnrollmentReport.findUnique({
            where: { sourceRelativePath: reportSourcePath },
            select: { id: true },
          });
          if (existing) {
            await tx.bannerEnrollmentReport.delete({ where: { id: existing.id } });
          }
          await tx.bannerEnrollmentReport.create({
            data: {
              id: reportId,
              courseId,
              sourceRelativePath: reportSourcePath,
              importGroupKey,
              sourceLabel: group.sourceLabel,
              totalStudents: studentRows.length,
              summaryJson: group.summaryJson,
            },
          });
          for (const chunk of this.chunk(studentRows, 500)) {
            if (chunk.length) {
              await tx.bannerEnrollmentRecord.createMany({ data: chunk });
            }
          }
        },
        { timeout: 60_000, maxWait: 10_000 },
      );

      importedReports += 1;
      importedStudents += studentRows.length;
    }

    return {
      ok: true,
      kind: 'banner-enrollment',
      inputPath: sourceRelativePath,
      importGroupKey,
      importedReports,
      importedStudents,
      skippedCourses: skipped,
    };
  }

  async options(rawQuery: unknown) {
    const query = parseWithSchema(FiltersSchema, rawQuery, 'moodle analytics options');
    const filters: AnalyticsFilters = {
      periodCodes: this.parseCsvList(query.periodCodes),
      programCodes: this.parseCsvList(query.programCodes),
      campusCodes: this.parseCsvList(query.campusCodes),
      teacherIds: this.parseCsvList(query.teacherIds),
      nrcs: this.parseCsvList(query.nrcs),
      moments: this.parseCsvList(query.moments),
    };

    const [attendanceReports, activityReports, participantReports, bannerEnrollmentReports] = await Promise.all([
      this.latestAttendanceSnapshots(filters),
      this.latestActivitySnapshots(filters),
      this.latestParticipantSnapshots(filters),
      this.latestBannerEnrollmentSnapshots(filters),
    ]);

    const byCourse = new Map<string, CourseMeta>();
    for (const report of [...attendanceReports, ...activityReports, ...participantReports, ...bannerEnrollmentReports]) {
      byCourse.set(report.courseId, this.courseMeta(report.course));
    }

    const periods = new Map<string, { code: string; label: string; semester: number | null; count: number }>();
    const programs = new Map<string, { code: string; label: string; count: number }>();
    const campuses = new Map<string, { code: string; count: number }>();
    const teachers = new Map<string, { id: string; fullName: string; count: number }>();

    for (const course of byCourse.values()) {
      const period = periods.get(course.periodCode) ?? {
        code: course.periodCode,
        label: course.periodLabel,
        semester: course.semester,
        count: 0,
      };
      period.count += 1;
      periods.set(course.periodCode, period);

      if (course.programCode) {
        const program = programs.get(course.programCode) ?? {
          code: course.programCode,
          label: course.programName ?? course.programCode,
          count: 0,
        };
        program.count += 1;
        programs.set(course.programCode, program);
      }

      if (course.campusCode) {
        const campus = campuses.get(course.campusCode) ?? {
          code: course.campusCode,
          count: 0,
        };
        campus.count += 1;
        campuses.set(course.campusCode, campus);
      }

      if (course.teacherId && course.teacherName) {
        const teacher = teachers.get(course.teacherId) ?? {
          id: course.teacherId,
          fullName: course.teacherName,
          count: 0,
        };
        teacher.count += 1;
        teachers.set(course.teacherId, teacher);
      }
    }

    const attendanceReportIds = attendanceReports.map((report) => report.id);
    const sessionDays = attendanceReportIds.length
      ? await this.prisma.moodleAttendanceSession.findMany({
          where: {
            reportId: { in: attendanceReportIds },
            sessionDay: { not: null },
          },
          select: { sessionDay: true },
          distinct: ['sessionDay'],
          orderBy: { sessionDay: 'desc' },
        })
      : [];

    return {
      ok: true,
      filters,
      totals: {
        attendanceCourses: new Set(attendanceReports.map((item) => item.courseId)).size,
        activityCourses: new Set(activityReports.map((item) => item.courseId)).size,
        participantCourses: new Set(participantReports.map((item) => item.courseId)).size,
        bannerEnrollmentCourses: new Set(bannerEnrollmentReports.map((item) => item.courseId)).size,
      },
      periods: [...periods.values()].sort((left, right) => right.code.localeCompare(left.code)),
      programs: [...programs.values()].sort((left, right) => left.label.localeCompare(right.label)),
      campuses: [...campuses.values()].sort((left, right) => left.code.localeCompare(right.code)),
      teachers: [...teachers.values()].sort((left, right) => left.fullName.localeCompare(right.fullName)),
      sessionDays: sessionDays
        .map((item) => item.sessionDay)
        .filter((value): value is string => Boolean(value)),
    };
  }

  async overview(rawQuery: unknown) {
    const query = parseWithSchema(FiltersSchema, rawQuery, 'moodle analytics overview');
    const filters: AnalyticsFilters = {
      periodCodes: this.parseCsvList(query.periodCodes),
      programCodes: this.parseCsvList(query.programCodes),
      campusCodes: this.parseCsvList(query.campusCodes),
      teacherIds: this.parseCsvList(query.teacherIds),
      nrcs: this.parseCsvList(query.nrcs),
      moments: this.parseCsvList(query.moments),
    };

    const [attendanceReports, activityReports, participantReports, bannerEnrollmentReports] = await Promise.all([
      this.latestAttendanceSnapshots(filters),
      this.latestActivitySnapshots(filters),
      this.latestParticipantSnapshots(filters),
      this.latestBannerEnrollmentSnapshots(filters),
    ]);

    const attendanceCourseBuckets = new Map<
      string,
      {
        meta: CourseMeta;
        students: number;
        sessions: number;
        present: number;
        absent: number;
        justified: number;
        unknown: number;
        tracked: number;
      }
    >();

    for (const report of attendanceReports) {
      const meta = this.courseMeta(report.course);
      const bucket =
        attendanceCourseBuckets.get(report.courseId) ??
        {
          meta,
          students: 0,
          sessions: 0,
          present: 0,
          absent: 0,
          justified: 0,
          unknown: 0,
          tracked: 0,
        };
      const summary = this.asStringMap(report.summaryJson) as unknown as AttendanceSummaryJson;
      bucket.students = Math.max(bucket.students, report.totalStudents);
      bucket.sessions += report.totalSessions;
      bucket.present += summary.presentCount ?? 0;
      bucket.absent += summary.absentCount ?? 0;
      bucket.justified += summary.justifiedCount ?? 0;
      bucket.unknown += summary.unknownCount ?? 0;
      bucket.tracked += summary.trackedEntries ?? 0;
      attendanceCourseBuckets.set(report.courseId, bucket);
    }

    const attendanceOverall = {
      courseCount: attendanceCourseBuckets.size,
      studentCount: [...attendanceCourseBuckets.values()].reduce((sum, item) => sum + item.students, 0),
      sessionCount: [...attendanceCourseBuckets.values()].reduce((sum, item) => sum + item.sessions, 0),
      presentCount: [...attendanceCourseBuckets.values()].reduce((sum, item) => sum + item.present, 0),
      absentCount: [...attendanceCourseBuckets.values()].reduce((sum, item) => sum + item.absent, 0),
      justifiedCount: [...attendanceCourseBuckets.values()].reduce((sum, item) => sum + item.justified, 0),
      unknownCount: [...attendanceCourseBuckets.values()].reduce((sum, item) => sum + item.unknown, 0),
      trackedEntries: [...attendanceCourseBuckets.values()].reduce((sum, item) => sum + item.tracked, 0),
    };

    const attendanceByProgram = new Map<string, typeof attendanceOverall & { label: string }>();
    const attendanceByCampus = new Map<string, typeof attendanceOverall & { label: string }>();
    const attendanceByDay = new Map<
      string,
      { day: string; present: number; absent: number; justified: number; unknown: number; tracked: number }
    >();

    for (const report of attendanceReports) {
      const meta = this.courseMeta(report.course);
      const summary = this.asStringMap(report.summaryJson) as unknown as AttendanceSummaryJson;
      const sessions = Array.isArray(summary.sessions) ? summary.sessions : [];
      for (const session of sessions) {
        if (!session.day) continue;
        const bucket =
          attendanceByDay.get(session.day) ?? {
            day: session.day,
            present: 0,
            absent: 0,
            justified: 0,
            unknown: 0,
            tracked: 0,
          };
        bucket.present += session.presentCount ?? 0;
        bucket.absent += session.absentCount ?? 0;
        bucket.justified += session.justifiedCount ?? 0;
        bucket.unknown += session.unknownCount ?? 0;
        bucket.tracked += session.trackedCount ?? 0;
        attendanceByDay.set(session.day, bucket);
      }

      const programKey = meta.programCode ?? 'SIN_PROGRAMA';
      const programBucket =
        attendanceByProgram.get(programKey) ??
        {
          ...attendanceOverall,
          courseCount: 0,
          studentCount: 0,
          sessionCount: 0,
          presentCount: 0,
          absentCount: 0,
          justifiedCount: 0,
          unknownCount: 0,
          trackedEntries: 0,
          label: meta.programName ?? meta.programCode ?? 'Sin programa',
        };
      programBucket.courseCount += 1;
      programBucket.studentCount += report.totalStudents;
      programBucket.sessionCount += report.totalSessions;
      programBucket.presentCount += summary.presentCount ?? 0;
      programBucket.absentCount += summary.absentCount ?? 0;
      programBucket.justifiedCount += summary.justifiedCount ?? 0;
      programBucket.unknownCount += summary.unknownCount ?? 0;
      programBucket.trackedEntries += summary.trackedEntries ?? 0;
      attendanceByProgram.set(programKey, programBucket);

      const campusKey = meta.campusCode ?? 'SIN_SEDE';
      const campusBucket =
        attendanceByCampus.get(campusKey) ??
        {
          ...attendanceOverall,
          courseCount: 0,
          studentCount: 0,
          sessionCount: 0,
          presentCount: 0,
          absentCount: 0,
          justifiedCount: 0,
          unknownCount: 0,
          trackedEntries: 0,
          label: meta.campusCode ?? 'Sin sede',
        };
      campusBucket.courseCount += 1;
      campusBucket.studentCount += report.totalStudents;
      campusBucket.sessionCount += report.totalSessions;
      campusBucket.presentCount += summary.presentCount ?? 0;
      campusBucket.absentCount += summary.absentCount ?? 0;
      campusBucket.justifiedCount += summary.justifiedCount ?? 0;
      campusBucket.unknownCount += summary.unknownCount ?? 0;
      campusBucket.trackedEntries += summary.trackedEntries ?? 0;
      attendanceByCampus.set(campusKey, campusBucket);
    }

    const activityByDay: Record<string, number> = {};
    const activityByComponent: Record<string, number> = {};
    const activityByEventName: Record<string, number> = {};
    const activityByCategory: Record<string, number> = {};
    const activityByCourse = new Map<string, { meta: CourseMeta; events: number; users: number }>();

    let activityEvents = 0;
    let activityReportsCount = 0;
    let activityUsers = 0;
    for (const report of activityReports) {
      const meta = this.courseMeta(report.course);
      const summary = this.asStringMap(report.summaryJson) as unknown as ActivitySummaryJson;
      activityReportsCount += 1;
      activityEvents += report.totalEvents;
      activityUsers += report.uniqueUsers;

      const bucket = activityByCourse.get(report.courseId) ?? { meta, events: 0, users: 0 };
      bucket.events += report.totalEvents;
      bucket.users = Math.max(bucket.users, report.uniqueUsers);
      activityByCourse.set(report.courseId, bucket);

      for (const [day, count] of Object.entries(summary.dailyCounts ?? {})) {
        activityByDay[day] = (activityByDay[day] ?? 0) + count;
      }
      for (const [component, count] of Object.entries(summary.componentCounts ?? {})) {
        activityByComponent[component] = (activityByComponent[component] ?? 0) + count;
      }
      for (const [eventName, count] of Object.entries(summary.eventNameCounts ?? {})) {
        activityByEventName[eventName] = (activityByEventName[eventName] ?? 0) + count;
      }
      for (const [category, count] of Object.entries(summary.actorCategoryCounts ?? {})) {
        activityByCategory[category] = (activityByCategory[category] ?? 0) + count;
      }
    }

    const participantRoleCounts: Record<string, number> = {};
    const participantCategoryCounts: Record<string, number> = {};
    let participantReportsCount = 0;
    let participantTotal = 0;

    for (const report of participantReports) {
      participantReportsCount += 1;
      participantTotal += report.totalParticipants;
      const summary = this.asStringMap(report.summaryJson) as unknown as ParticipantSummaryJson;
      for (const [role, count] of Object.entries(this.asNumberRecord(report.roleCounts))) {
        participantRoleCounts[role] = (participantRoleCounts[role] ?? 0) + count;
      }
      for (const [category, count] of Object.entries(summary.actorCategoryCounts ?? {})) {
        participantCategoryCounts[category] = (participantCategoryCounts[category] ?? 0) + count;
      }
    }

    let bannerEnrollmentReportsCount = 0;
    let bannerEnrollmentTotal = 0;
    for (const report of bannerEnrollmentReports) {
      bannerEnrollmentReportsCount += 1;
      bannerEnrollmentTotal += report.totalStudents;
    }

    const courseMetaById = new Map<string, CourseMeta>();
    for (const report of attendanceReports) courseMetaById.set(report.courseId, this.courseMeta(report.course));
    for (const report of activityReports) courseMetaById.set(report.courseId, this.courseMeta(report.course));
    for (const report of participantReports) courseMetaById.set(report.courseId, this.courseMeta(report.course));
    for (const report of bannerEnrollmentReports) courseMetaById.set(report.courseId, this.courseMeta(report.course));

    const activityReportToCourse = new Map(activityReports.map((report) => [report.id, report.courseId]));
    const participantReportToCourse = new Map(participantReports.map((report) => [report.id, report.courseId]));
    const bannerEnrollmentReportToCourse = new Map(bannerEnrollmentReports.map((report) => [report.id, report.courseId]));
    const attendanceCourseIds = new Set(attendanceReports.map((report) => report.courseId));
    const activityCourseIds = new Set(activityReports.map((report) => report.courseId));

    const [activityActorGroups, participantRecords, bannerEnrollmentRecords, attendanceKeysByCourse] = await Promise.all([
      activityReports.length
        ? this.prisma.moodleActivityEvent.groupBy({
            by: ['reportId', 'actorKey', 'actorName', 'actorCategory'],
            where: {
              reportId: { in: activityReports.map((report) => report.id) },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      participantReports.length
        ? this.prisma.moodleParticipantRecord.findMany({
            where: {
              reportId: { in: participantReports.map((report) => report.id) },
            },
            select: {
              reportId: true,
              fullName: true,
              email: true,
              institutionalId: true,
              rolesLabel: true,
              actorCategory: true,
            },
          })
        : Promise.resolve([]),
      bannerEnrollmentReports.length
        ? this.prisma.bannerEnrollmentRecord.findMany({
            where: {
              reportId: { in: bannerEnrollmentReports.map((report) => report.id) },
            },
            select: {
              reportId: true,
              fullName: true,
              email: true,
              institutionalId: true,
              statusLabel: true,
            },
          })
        : Promise.resolve([]),
      this.latestAttendanceStudentKeysByCourse([...attendanceCourseIds]),
    ]);

    type ParticipantAlertUser = {
      fullName: string;
      email: string | null;
      institutionalId: string | null;
      rolesLabel: string | null;
      actorCategory: string;
      keys: string[];
    };

    type BannerEnrollmentAlertUser = {
      fullName: string;
      email: string | null;
      institutionalId: string | null;
      statusLabel: string | null;
      actorCategory: 'ESTUDIANTE';
      keys: string[];
    };

    const bannerEnrollmentStateByCourse = new Map<
      string,
      {
        allKeys: Set<string>;
        students: BannerEnrollmentAlertUser[];
      }
    >();

    const getBannerEnrollmentState = (courseId: string) => {
      const existing = bannerEnrollmentStateByCourse.get(courseId);
      if (existing) return existing;
      const created = {
        allKeys: new Set<string>(),
        students: [] as BannerEnrollmentAlertUser[],
      };
      bannerEnrollmentStateByCourse.set(courseId, created);
      return created;
    };

    for (const student of bannerEnrollmentRecords) {
      const courseId = bannerEnrollmentReportToCourse.get(student.reportId);
      if (!courseId) continue;
      const state = getBannerEnrollmentState(courseId);
      const keys = this.normalizedKeys([student.fullName, student.email, student.institutionalId]);
      keys.forEach((key) => state.allKeys.add(key));
      state.students.push({
        fullName: student.fullName,
        email: student.email,
        institutionalId: student.institutionalId,
        statusLabel: student.statusLabel,
        actorCategory: 'ESTUDIANTE',
        keys,
      });
    }

    const participantStateByCourse = new Map<
      string,
      {
        allKeys: Set<string>;
        students: ParticipantAlertUser[];
        unusual: ParticipantAlertUser[];
      }
    >();

    const getParticipantState = (courseId: string) => {
      const existing = participantStateByCourse.get(courseId);
      if (existing) return existing;
      const created = {
        allKeys: new Set<string>(),
        students: [] as ParticipantAlertUser[],
        unusual: [] as ParticipantAlertUser[],
      };
      participantStateByCourse.set(courseId, created);
      return created;
    };

    for (const participant of participantRecords) {
      const courseId = participantReportToCourse.get(participant.reportId);
      if (!courseId) continue;
      const state = getParticipantState(courseId);
      const actorCategory = participant.actorCategory ?? 'NO_CLASIFICADO';
      const keys = this.normalizedKeys([participant.fullName, participant.email]);
      keys.forEach((key) => state.allKeys.add(key));

      const user: ParticipantAlertUser = {
        fullName: participant.fullName,
        email: participant.email,
        institutionalId: participant.institutionalId,
        rolesLabel: participant.rolesLabel,
        actorCategory,
        keys,
      };

      if (actorCategory === 'ESTUDIANTE') {
        state.students.push(user);
      }
      if (actorCategory === 'ADMIN' || actorCategory === 'AUDITOR' || actorCategory === 'NO_CLASIFICADO') {
        state.unusual.push(user);
      }
    }

    type ActivityActorAlert = {
      actorName: string;
      actorKey: string;
      actorCategory: string;
      eventCount: number;
    };

    const activityKeysByCourse = new Map<string, Set<string>>();
    const outsideRosterByCourse = new Map<string, Map<string, ActivityActorAlert>>();
    const unclassifiedByCourse = new Map<string, Map<string, ActivityActorAlert>>();

    const getKeySet = (courseId: string) => {
      const existing = activityKeysByCourse.get(courseId);
      if (existing) return existing;
      const created = new Set<string>();
      activityKeysByCourse.set(courseId, created);
      return created;
    };

    const getActorAlertMap = (
      target: Map<string, Map<string, ActivityActorAlert>>,
      courseId: string,
    ) => {
      const existing = target.get(courseId);
      if (existing) return existing;
      const created = new Map<string, ActivityActorAlert>();
      target.set(courseId, created);
      return created;
    };

    for (const actor of activityActorGroups) {
      const courseId = activityReportToCourse.get(actor.reportId);
      if (!courseId) continue;
      const actorKey = actor.actorKey ?? this.normalizeNameKey(actor.actorName);
      if (!actorKey || actorKey === '-') continue;
      getKeySet(courseId).add(actorKey);

      const rosterKeys =
        bannerEnrollmentStateByCourse.get(courseId)?.allKeys ??
        participantStateByCourse.get(courseId)?.allKeys ??
        new Set<string>();
      const eventCount = actor._count._all;
      const actorCategory = actor.actorCategory ?? 'NO_CLASIFICADO';

      if (actorCategory === 'NO_CLASIFICADO') {
        const bucket = getActorAlertMap(unclassifiedByCourse, courseId);
        const current = bucket.get(actorKey);
        bucket.set(actorKey, {
          actorName: actor.actorName,
          actorKey,
          actorCategory,
          eventCount: (current?.eventCount ?? 0) + eventCount,
        });
      }

      if (actorCategory !== 'ADMIN' && actorCategory !== 'SIN_USUARIO' && !rosterKeys.has(actorKey)) {
        const bucket = getActorAlertMap(outsideRosterByCourse, courseId);
        const current = bucket.get(actorKey);
        bucket.set(actorKey, {
          actorName: actor.actorName,
          actorKey,
          actorCategory,
          eventCount: (current?.eventCount ?? 0) + eventCount,
        });
      }
    }

    const alertTypeCounts = new Map<AlertTypeKey, { key: AlertTypeKey; label: string; count: number; courseIds: Set<string> }>();
    const registerAlertCount = (type: AlertTypeKey, courseId: string, amount: number) => {
      if (amount <= 0) return;
      const current =
        alertTypeCounts.get(type) ??
        { key: type, label: this.alertTypeLabel(type), count: 0, courseIds: new Set<string>() };
      current.count += amount;
      current.courseIds.add(courseId);
      alertTypeCounts.set(type, current);
    };

    const courseAlertBuckets = new Map<
      string,
      {
        meta: CourseMeta;
        rosterSource: 'BANNER' | 'MOODLE_PARTICIPANTS' | 'SIN_ROSTER';
        outsideRosterActors: number;
        unclassifiedActors: number;
        unusualRoleParticipants: number;
        studentsWithoutActivity: number;
        studentsWithoutAttendance: number;
        totalAlerts: number;
        riskScore: number;
        riskLevel: string;
      }
    >();

    const specialUsers: Array<{
      kind: AlertTypeKey;
      kindLabel: string;
      nrc: string;
      subjectName: string | null;
      programName: string | null;
      campusCode: string | null;
      teacherName: string | null;
      fullName: string;
      email: string | null;
      institutionalId: string | null;
      actorCategory: string | null;
      rolesLabel: string | null;
      count: number;
      detail: string;
    }> = [];

    for (const [courseId, meta] of courseMetaById.entries()) {
      const bannerEnrollmentState = bannerEnrollmentStateByCourse.get(courseId);
      const participantState = participantStateByCourse.get(courseId) ?? {
        allKeys: new Set<string>(),
        students: [] as ParticipantAlertUser[],
        unusual: [] as ParticipantAlertUser[],
      };
      const rosterSource = bannerEnrollmentState
        ? 'BANNER'
        : participantState.students.length || participantState.allKeys.size
          ? 'MOODLE_PARTICIPANTS'
          : 'SIN_ROSTER';
      const rosterStudents =
        rosterSource === 'BANNER'
          ? bannerEnrollmentState?.students ?? []
          : participantState.students;
      const outsideRosterActors = [...(outsideRosterByCourse.get(courseId)?.values() ?? [])];
      const unclassifiedActors = [...(unclassifiedByCourse.get(courseId)?.values() ?? [])];
      const activityKeys = activityKeysByCourse.get(courseId) ?? new Set<string>();
      const attendanceKeys = attendanceKeysByCourse.get(courseId) ?? new Set<string>();
      const studentsWithoutActivity =
        activityCourseIds.has(courseId)
          ? rosterStudents.filter((user) => !user.keys.some((key) => activityKeys.has(key)))
          : [];
      const studentsWithoutAttendance =
        attendanceCourseIds.has(courseId)
          ? rosterStudents.filter((user) => !user.keys.some((key) => attendanceKeys.has(key)))
          : [];

      const outsideRosterCount = outsideRosterActors.length;
      const unclassifiedCount = unclassifiedActors.length;
      const unusualParticipantsCount = participantState.unusual.length;
      const studentsWithoutActivityCount = studentsWithoutActivity.length;
      const studentsWithoutAttendanceCount = studentsWithoutAttendance.length;
      const riskScore =
        outsideRosterCount * 4 +
        unclassifiedCount * 3 +
        unusualParticipantsCount * 2 +
        studentsWithoutActivityCount +
        studentsWithoutAttendanceCount;
      const totalAlerts =
        outsideRosterCount +
        unclassifiedCount +
        unusualParticipantsCount +
        studentsWithoutActivityCount +
        studentsWithoutAttendanceCount;

      courseAlertBuckets.set(courseId, {
        meta,
        rosterSource,
        outsideRosterActors: outsideRosterCount,
        unclassifiedActors: unclassifiedCount,
        unusualRoleParticipants: unusualParticipantsCount,
        studentsWithoutActivity: studentsWithoutActivityCount,
        studentsWithoutAttendance: studentsWithoutAttendanceCount,
        totalAlerts,
        riskScore,
        riskLevel: this.alertRiskLevel(riskScore),
      });

      registerAlertCount('ACTIVITY_OUTSIDE_ROSTER', courseId, outsideRosterCount);
      registerAlertCount('ACTIVITY_UNCLASSIFIED', courseId, unclassifiedCount);
      registerAlertCount('PARTICIPANT_UNUSUAL_ROLE', courseId, unusualParticipantsCount);
      registerAlertCount('STUDENT_NO_ACTIVITY', courseId, studentsWithoutActivityCount);
      registerAlertCount('STUDENT_NO_ATTENDANCE', courseId, studentsWithoutAttendanceCount);

      for (const actor of outsideRosterActors) {
        specialUsers.push({
          kind: 'ACTIVITY_OUTSIDE_ROSTER',
          kindLabel: this.alertTypeLabel('ACTIVITY_OUTSIDE_ROSTER'),
          nrc: meta.nrc,
          subjectName: meta.subjectName,
          programName: meta.programName,
          campusCode: meta.campusCode,
          teacherName: meta.teacherName,
          fullName: actor.actorName,
          email: null,
          institutionalId: null,
          actorCategory: actor.actorCategory,
          rolesLabel: null,
          count: actor.eventCount,
          detail:
            rosterSource === 'BANNER'
              ? `${actor.eventCount} eventos sin cruce contra la matricula oficial Banner.`
              : `${actor.eventCount} eventos sin cruce contra participantes Moodle.`,
        });
      }

      for (const actor of unclassifiedActors) {
        specialUsers.push({
          kind: 'ACTIVITY_UNCLASSIFIED',
          kindLabel: this.alertTypeLabel('ACTIVITY_UNCLASSIFIED'),
          nrc: meta.nrc,
          subjectName: meta.subjectName,
          programName: meta.programName,
          campusCode: meta.campusCode,
          teacherName: meta.teacherName,
          fullName: actor.actorName,
          email: null,
          institutionalId: null,
          actorCategory: actor.actorCategory,
          rolesLabel: null,
          count: actor.eventCount,
          detail: `${actor.eventCount} eventos quedaron con actorCategory NO_CLASIFICADO.`,
        });
      }

      for (const participant of participantState.unusual) {
        specialUsers.push({
          kind: 'PARTICIPANT_UNUSUAL_ROLE',
          kindLabel: this.alertTypeLabel('PARTICIPANT_UNUSUAL_ROLE'),
          nrc: meta.nrc,
          subjectName: meta.subjectName,
          programName: meta.programName,
          campusCode: meta.campusCode,
          teacherName: meta.teacherName,
          fullName: participant.fullName,
          email: participant.email,
          institutionalId: participant.institutionalId,
          actorCategory: participant.actorCategory,
          rolesLabel: participant.rolesLabel,
          count: 1,
          detail: participant.rolesLabel
            ? `Rol visible: ${participant.rolesLabel}.`
            : `Actor clasificado como ${participant.actorCategory}.`,
        });
      }

      for (const participant of studentsWithoutActivity) {
        specialUsers.push({
          kind: 'STUDENT_NO_ACTIVITY',
          kindLabel: this.alertTypeLabel('STUDENT_NO_ACTIVITY'),
          nrc: meta.nrc,
          subjectName: meta.subjectName,
          programName: meta.programName,
          campusCode: meta.campusCode,
          teacherName: meta.teacherName,
          fullName: participant.fullName,
          email: participant.email,
          institutionalId: participant.institutionalId,
          actorCategory: participant.actorCategory,
          rolesLabel: 'rolesLabel' in participant ? participant.rolesLabel : participant.statusLabel,
          count: 0,
          detail:
            rosterSource === 'BANNER'
              ? 'Matriculado oficialmente en Banner, pero no aparece en los logs importados.'
              : 'Matriculado en participantes Moodle, pero no aparece en los logs importados.',
        });
      }

      for (const participant of studentsWithoutAttendance) {
        specialUsers.push({
          kind: 'STUDENT_NO_ATTENDANCE',
          kindLabel: this.alertTypeLabel('STUDENT_NO_ATTENDANCE'),
          nrc: meta.nrc,
          subjectName: meta.subjectName,
          programName: meta.programName,
          campusCode: meta.campusCode,
          teacherName: meta.teacherName,
          fullName: participant.fullName,
          email: participant.email,
          institutionalId: participant.institutionalId,
          actorCategory: participant.actorCategory,
          rolesLabel: 'rolesLabel' in participant ? participant.rolesLabel : participant.statusLabel,
          count: 0,
          detail:
            rosterSource === 'BANNER'
              ? 'Matriculado oficialmente en Banner, pero no aparece en el export de asistencia.'
              : 'Matriculado en participantes Moodle, pero no aparece en el export de asistencia.',
        });
      }
    }

    const alertsByProgram = new Map<string, { key: string; label: string; count: number; courseIds: Set<string> }>();
    const alertsByCampus = new Map<string, { key: string; label: string; count: number; courseIds: Set<string> }>();

    for (const [courseId, item] of courseAlertBuckets.entries()) {
      if (item.totalAlerts <= 0) continue;

      const programKey = item.meta.programCode ?? 'SIN_PROGRAMA';
      const programBucket =
        alertsByProgram.get(programKey) ??
        {
          key: programKey,
          label: item.meta.programName ?? item.meta.programCode ?? 'Sin programa',
          count: 0,
          courseIds: new Set<string>(),
        };
      programBucket.count += item.totalAlerts;
      programBucket.courseIds.add(courseId);
      alertsByProgram.set(programKey, programBucket);

      const campusKey = item.meta.campusCode ?? 'SIN_SEDE';
      const campusBucket =
        alertsByCampus.get(campusKey) ??
        {
          key: campusKey,
          label: item.meta.campusCode ?? 'Sin sede',
          count: 0,
          courseIds: new Set<string>(),
        };
      campusBucket.count += item.totalAlerts;
      campusBucket.courseIds.add(courseId);
      alertsByCampus.set(campusKey, campusBucket);
    }

    return {
      ok: true,
      filters,
      attendance: {
        ...attendanceOverall,
        attendanceRate: this.percentage(attendanceOverall.presentCount, attendanceOverall.trackedEntries),
        inattendanceRate: this.percentage(attendanceOverall.absentCount, attendanceOverall.trackedEntries),
        byDay: [...attendanceByDay.values()]
          .sort((left, right) => left.day.localeCompare(right.day))
          .map((item) => ({
            ...item,
            attendanceRate: this.percentage(item.present, item.tracked),
            inattendanceRate: this.percentage(item.absent, item.tracked),
          })),
        byProgram: [...attendanceByProgram.values()]
          .map((item) => ({
            key: item.label,
            label: item.label,
            courseCount: item.courseCount,
            studentCount: item.studentCount,
            attendanceRate: this.percentage(item.presentCount, item.trackedEntries),
            inattendanceRate: this.percentage(item.absentCount, item.trackedEntries),
            presentCount: item.presentCount,
            absentCount: item.absentCount,
          }))
          .sort((left, right) => (right.inattendanceRate ?? 0) - (left.inattendanceRate ?? 0))
          .slice(0, 12),
        byCampus: [...attendanceByCampus.values()]
          .map((item) => ({
            key: item.label,
            label: item.label,
            courseCount: item.courseCount,
            studentCount: item.studentCount,
            attendanceRate: this.percentage(item.presentCount, item.trackedEntries),
            inattendanceRate: this.percentage(item.absentCount, item.trackedEntries),
            presentCount: item.presentCount,
            absentCount: item.absentCount,
          }))
          .sort((left, right) => (right.inattendanceRate ?? 0) - (left.inattendanceRate ?? 0))
          .slice(0, 12),
        worstCourses: [...attendanceCourseBuckets.values()]
          .map((item) => ({
            nrc: item.meta.nrc,
            subjectName: item.meta.subjectName,
            programName: item.meta.programName,
            campusCode: item.meta.campusCode,
            teacherName: item.meta.teacherName,
            studentCount: item.students,
            trackedEntries: item.tracked,
            attendanceRate: this.percentage(item.present, item.tracked),
            inattendanceRate: this.percentage(item.absent, item.tracked),
            absentCount: item.absent,
            presentCount: item.present,
          }))
          .filter((item) => item.trackedEntries > 0)
          .sort((left, right) => (right.inattendanceRate ?? 0) - (left.inattendanceRate ?? 0))
          .slice(0, 12),
      },
      activity: {
        courseCount: new Set(activityReports.map((item) => item.courseId)).size,
        reportCount: activityReportsCount,
        totalEvents: activityEvents,
        summedUniqueUsers: activityUsers,
        byDay: Object.entries(activityByDay)
          .sort((left, right) => left[0].localeCompare(right[0]))
          .map(([day, count]) => ({ day, count })),
        byComponent: this.topEntries(activityByComponent, 12),
        byEventName: this.topEntries(activityByEventName, 12),
        byActorCategory: this.topEntries(activityByCategory, 8),
        topCourses: [...activityByCourse.values()]
          .map((item) => ({
            nrc: item.meta.nrc,
            subjectName: item.meta.subjectName,
            programName: item.meta.programName,
            campusCode: item.meta.campusCode,
            teacherName: item.meta.teacherName,
            events: item.events,
            users: item.users,
          }))
          .sort((left, right) => right.events - left.events)
          .slice(0, 12),
      },
      participants: {
        courseCount: new Set(participantReports.map((item) => item.courseId)).size,
        reportCount: participantReportsCount,
        totalParticipants: participantTotal,
        byActorCategory: this.topEntries(participantCategoryCounts, 8),
        byRole: this.topEntries(participantRoleCounts, 12),
      },
      enrollment: {
        courseCount: new Set(bannerEnrollmentReports.map((item) => item.courseId)).size,
        reportCount: bannerEnrollmentReportsCount,
        totalStudents: bannerEnrollmentTotal,
      },
      alerts: {
        totals: {
          courseCount: [...courseAlertBuckets.values()].filter((item) => item.totalAlerts > 0).length,
          userCount: specialUsers.length,
          bannerRosterCourses: [...courseAlertBuckets.values()].filter((item) => item.rosterSource === 'BANNER').length,
          activityActorsOutsideRoster: [...courseAlertBuckets.values()].reduce((sum, item) => sum + item.outsideRosterActors, 0),
          activityUnclassified: [...courseAlertBuckets.values()].reduce((sum, item) => sum + item.unclassifiedActors, 0),
          participantUnusualRoles: [...courseAlertBuckets.values()].reduce((sum, item) => sum + item.unusualRoleParticipants, 0),
          studentsWithoutActivity: [...courseAlertBuckets.values()].reduce((sum, item) => sum + item.studentsWithoutActivity, 0),
          studentsWithoutAttendance: [...courseAlertBuckets.values()].reduce((sum, item) => sum + item.studentsWithoutAttendance, 0),
        },
        byType: [...alertTypeCounts.values()]
          .map((item) => ({
            key: item.key,
            label: item.label,
            count: item.count,
            courseCount: item.courseIds.size,
          }))
          .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
        byProgram: [...alertsByProgram.values()]
          .map((item) => ({
            key: item.key,
            label: item.label,
            count: item.count,
            courseCount: item.courseIds.size,
          }))
          .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
          .slice(0, 12),
        byCampus: [...alertsByCampus.values()]
          .map((item) => ({
            key: item.key,
            label: item.label,
            count: item.count,
            courseCount: item.courseIds.size,
          }))
          .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
          .slice(0, 12),
        courses: [...courseAlertBuckets.values()]
          .filter((item) => item.totalAlerts > 0)
          .map((item) => ({
            nrc: item.meta.nrc,
            subjectName: item.meta.subjectName,
            programName: item.meta.programName,
            campusCode: item.meta.campusCode,
            teacherName: item.meta.teacherName,
            rosterSource: item.rosterSource,
            outsideRosterActors: item.outsideRosterActors,
            unclassifiedActors: item.unclassifiedActors,
            unusualRoleParticipants: item.unusualRoleParticipants,
            studentsWithoutActivity: item.studentsWithoutActivity,
            studentsWithoutAttendance: item.studentsWithoutAttendance,
            totalAlerts: item.totalAlerts,
            riskScore: item.riskScore,
            riskLevel: item.riskLevel,
          }))
          .sort((left, right) => right.riskScore - left.riskScore || right.totalAlerts - left.totalAlerts || left.nrc.localeCompare(right.nrc))
          .slice(0, 60),
        users: specialUsers
          .sort(
            (left, right) =>
              this.alertUserRank(right.kind) - this.alertUserRank(left.kind) ||
              right.count - left.count ||
              left.nrc.localeCompare(right.nrc) ||
              left.fullName.localeCompare(right.fullName),
          )
          .slice(0, 120),
      },
    };
  }

  async attendanceDateReport(rawQuery: unknown) {
    const query = parseWithSchema(AttendanceDateReportSchema, rawQuery, 'attendance date report');
    const filters: AnalyticsFilters = {
      periodCodes: this.parseCsvList(query.periodCodes),
      programCodes: this.parseCsvList(query.programCodes),
      campusCodes: this.parseCsvList(query.campusCodes),
      teacherIds: this.parseCsvList(query.teacherIds),
      nrcs: this.parseCsvList(query.nrcs),
      moments: this.parseCsvList(query.moments),
    };

    const reports = await this.latestAttendanceSnapshots(filters);
    const reportMap = new Map(reports.map((report) => [report.id, report]));
    const sessions = await this.prisma.moodleAttendanceSession.findMany({
      where: {
        reportId: { in: reports.map((report) => report.id) },
        sessionDay: query.sessionDay,
      },
      orderBy: [{ reportId: 'asc' }, { columnIndex: 'asc' }],
    });

    if (!sessions.length) {
      return {
        ok: true,
        filters: { ...filters, sessionDay: query.sessionDay },
        summary: {
          courseCount: 0,
          participantCount: 0,
          presentCount: 0,
          absentCount: 0,
          justifiedCount: 0,
          unknownCount: 0,
          attendanceRate: null,
          inattendanceRate: null,
        },
        courses: [],
      };
    }

    const entries = await this.prisma.moodleAttendanceEntry.findMany({
      where: {
        sessionId: { in: sessions.map((session) => session.id) },
      },
      include: {
        record: true,
      },
    });

    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const byCourse = new Map<
      string,
      {
        meta: CourseMeta;
        participantCount: number;
        presentCount: number;
        absentCount: number;
        justifiedCount: number;
        unknownCount: number;
        sessionLabels: string[];
        presentStudents: Array<{ fullName: string; email: string | null; institutionalId: string | null }>;
      }
    >();

    for (const entry of entries) {
      const session = sessionsById.get(entry.sessionId);
      if (!session) continue;
      const report = reportMap.get(session.reportId);
      if (!report) continue;
      const meta = this.courseMeta(report.course);
      const bucket =
        byCourse.get(report.courseId) ??
        {
          meta,
          participantCount: report.totalStudents,
          presentCount: 0,
          absentCount: 0,
          justifiedCount: 0,
          unknownCount: 0,
          sessionLabels: [],
          presentStudents: [],
        };
      if (!bucket.sessionLabels.includes(session.sessionLabel)) {
        bucket.sessionLabels.push(session.sessionLabel);
      }
      if (entry.statusCode === 'A') {
        bucket.presentCount += 1;
        bucket.presentStudents.push({
          fullName: entry.record.fullName,
          email: entry.record.email,
          institutionalId: entry.record.institutionalId,
        });
      } else if (entry.statusCode === 'N') {
        bucket.absentCount += 1;
      } else if (entry.statusCode === 'J') {
        bucket.justifiedCount += 1;
      } else {
        bucket.unknownCount += 1;
      }
      byCourse.set(report.courseId, bucket);
    }

    const courses = [...byCourse.values()]
      .map((item) => {
        const tracked = item.presentCount + item.absentCount + item.justifiedCount;
        return {
          nrc: item.meta.nrc,
          subjectName: item.meta.subjectName,
          programName: item.meta.programName,
          campusCode: item.meta.campusCode,
          teacherName: item.meta.teacherName,
          periodCode: item.meta.periodCode,
          participantCount: item.participantCount,
          presentCount: item.presentCount,
          absentCount: item.absentCount,
          justifiedCount: item.justifiedCount,
          unknownCount: item.unknownCount,
          attendanceRate: this.percentage(item.presentCount, tracked),
          inattendanceRate: this.percentage(item.absentCount, tracked),
          sessionLabels: item.sessionLabels.sort(),
          presentStudents: item.presentStudents.sort((left, right) => left.fullName.localeCompare(right.fullName)),
        };
      })
      .sort((left, right) => left.nrc.localeCompare(right.nrc));

    const participantCount = courses.reduce((sum, item) => sum + item.participantCount, 0);
    const presentCount = courses.reduce((sum, item) => sum + item.presentCount, 0);
    const absentCount = courses.reduce((sum, item) => sum + item.absentCount, 0);
    const justifiedCount = courses.reduce((sum, item) => sum + item.justifiedCount, 0);
    const unknownCount = courses.reduce((sum, item) => sum + item.unknownCount, 0);
    const tracked = presentCount + absentCount + justifiedCount;

    return {
      ok: true,
      filters: { ...filters, sessionDay: query.sessionDay },
      summary: {
        courseCount: courses.length,
        participantCount,
        presentCount,
        absentCount,
        justifiedCount,
        unknownCount,
        attendanceRate: this.percentage(presentCount, tracked),
        inattendanceRate: this.percentage(absentCount, tracked),
      },
      courses,
    };
  }

  async attendanceStudentReport(rawQuery: unknown) {
    const query = parseWithSchema(AttendanceStudentReportSchema, rawQuery, 'attendance student report');
    const filters: AnalyticsFilters = {
      periodCodes: this.parseCsvList(query.periodCodes),
      programCodes: this.parseCsvList(query.programCodes),
      campusCodes: this.parseCsvList(query.campusCodes),
      teacherIds: this.parseCsvList(query.teacherIds),
      nrcs: this.parseCsvList(query.nrcs),
      moments: this.parseCsvList(query.moments),
    };
    const sessionDays = this.parseDateList(query.sessionDays);
    if (!sessionDays.length) {
      throw new BadRequestException('Debes seleccionar al menos una fecha de asistencia valida.');
    }

    const reports = await this.latestAttendanceSnapshots(filters);
    const reportMap = new Map(reports.map((report) => [report.id, report]));
    const sessions = reports.length
      ? await this.prisma.moodleAttendanceSession.findMany({
          where: {
            reportId: { in: reports.map((report) => report.id) },
            sessionDay: { in: sessionDays },
          },
          orderBy: [{ sessionDay: 'asc' }, { reportId: 'asc' }, { columnIndex: 'asc' }],
        })
      : [];

    const entries = sessions.length
      ? await this.prisma.moodleAttendanceEntry.findMany({
          where: {
            sessionId: { in: sessions.map((session) => session.id) },
          },
          include: {
            record: true,
          },
        })
      : [];

    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const rows = entries
      .map((entry) => {
        const session = sessionsById.get(entry.sessionId);
        if (!session) return null;
        const report = reportMap.get(session.reportId);
        if (!report) return null;
        const meta = this.courseMeta(report.course);
        return {
          sessionDay: session.sessionDay ?? '',
          sessionLabel: session.sessionLabel,
          periodCode: meta.periodCode,
          nrc: meta.nrc,
          subjectName: meta.subjectName,
          programName: meta.programName,
          campusCode: meta.campusCode,
          teacherName: meta.teacherName,
          studentName: entry.record.fullName,
          studentEmail: entry.record.email,
          studentId: entry.record.institutionalId,
          statusCode: entry.statusCode,
          statusLabel: this.attendanceStatusLabel(entry.statusCode),
          rawValue: entry.rawValue,
          present: entry.statusCode === 'A',
          justified: entry.statusCode === 'J',
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .sort(
        (left, right) =>
          left.sessionDay.localeCompare(right.sessionDay) ||
          left.periodCode.localeCompare(right.periodCode) ||
          left.nrc.localeCompare(right.nrc) ||
          left.studentName.localeCompare(right.studentName) ||
          left.sessionLabel.localeCompare(right.sessionLabel),
      );

    const presentCount = rows.filter((row) => row.statusCode === 'A').length;
    const absentCount = rows.filter((row) => row.statusCode === 'N').length;
    const justifiedCount = rows.filter((row) => row.statusCode === 'J').length;
    const unknownCount = rows.length - presentCount - absentCount - justifiedCount;
    const tracked = presentCount + absentCount + justifiedCount;

    return {
      ok: true,
      filters: { ...filters, sessionDays },
      summary: {
        selectedDayCount: sessionDays.length,
        matchedSessionCount: sessions.length,
        courseCount: new Set(rows.map((row) => `${row.periodCode}::${row.nrc}`)).size,
        studentCount: new Set(rows.map((row) => `${row.periodCode}::${row.nrc}::${this.normalizeNameKey(row.studentEmail || row.studentId || row.studentName)}`)).size,
        rowCount: rows.length,
        presentCount,
        absentCount,
        justifiedCount,
        unknownCount,
        attendanceRate: this.percentage(presentCount, tracked),
        inattendanceRate: this.percentage(absentCount, tracked),
      },
      rows,
    };
  }

  async teacherAccessReport(rawQuery: unknown) {
    const query = parseWithSchema(FiltersSchema, rawQuery, 'teacher access report');
    const filters: AnalyticsFilters = {
      periodCodes: this.parseCsvList(query.periodCodes),
      programCodes: this.parseCsvList(query.programCodes),
      campusCodes: this.parseCsvList(query.campusCodes),
      teacherIds: this.parseCsvList(query.teacherIds),
      nrcs: this.parseCsvList(query.nrcs),
      moments: this.parseCsvList(query.moments),
    };

    // Traer snapshots de actividad con fechas del curso
    const activityReports = await this.prisma.moodleActivityReport.findMany({
      where: { course: this.resolveCourseWhere(filters) },
      include: {
        course: {
          include: {
            period: true,
            teacher: { select: { fullName: true, costCenter: true } },
          },
        },
      },
      orderBy: [{ courseId: 'asc' }, { importedAt: 'desc' }],
    });
    const snapshots = this.selectLatestPerCourse(activityReports);

    if (!snapshots.length) {
      return {
        ok: true,
        filters,
        summary: {
          courseCount: 0,
          compliantCourses: 0,
          partialCourses: 0,
          nonCompliantCourses: 0,
          noDataCourses: 0,
          complianceRate: null as number | null,
        },
        courses: [] as unknown[],
      };
    }

    // Traer días únicos de ingreso del docente por reporte
    const reportIds = snapshots.map((r) => r.id);
    const teacherDayGroups = await this.prisma.moodleActivityEvent.groupBy({
      by: ['reportId', 'eventDay'],
      where: {
        reportId: { in: reportIds },
        actorCategory: 'DOCENTE',
        eventDay: { not: null },
      },
      _count: { _all: true },
    });

    // Indexar días por reportId
    const daysByReport = new Map<string, Set<string>>();
    for (const group of teacherDayGroups) {
      if (!group.eventDay) continue;
      const set = daysByReport.get(group.reportId) ?? new Set<string>();
      set.add(group.eventDay);
      daysByReport.set(group.reportId, set);
    }

    const REQUIRED_DAYS_PER_WEEK = 3;

    const courses = snapshots.map((report) => {
      const course = report.course;
      const meta = this.courseMeta(course);
      const schedule = buildCourseScheduleInfo({
        startDate: course.bannerStartDate,
        endDate: course.bannerEndDate,
      });

      const teacherDays = [...(daysByReport.get(report.id) ?? new Set<string>())].sort();
      const totalTeacherDays = teacherDays.length;

      // Sin fechas de Banner → no se puede calcular semanas
      if (!schedule.startIsoDate || !schedule.endIsoDate || schedule.totalWeeks === null) {
        return {
          nrc: meta.nrc,
          subjectName: meta.subjectName,
          programName: meta.programName,
          campusCode: meta.campusCode,
          teacherName: meta.teacherName,
          periodCode: meta.periodCode,
          calendarState: schedule.calendarState,
          isShortCourse: schedule.isShortCourse,
          totalCourseWeeks: null as number | null,
          requiredLoginDays: null as number | null,
          totalTeacherDays,
          weeksDetail: [] as Array<{ week: string; days: string[]; dayCount: number; compliant: boolean }>,
          compliantWeeks: null as number | null,
          complianceRate: null as number | null,
          status: 'SIN_FECHAS' as string,
        };
      }

      const totalCourseWeeks = schedule.totalWeeks;

      // Cap de semanas evaluadas según momento del curso:
      // MD1 / MD2 → máximo 7 semanas | 1 (RyC, 16 sem) → máximo 15 | resto → sin cap
      const moment = (course as { moment?: string | null }).moment ?? null;
      const maxEvalWeeks =
        moment === 'MD1' || moment === 'MD2' ? 7
        : moment === '1' ? 15
        : totalCourseWeeks;
      const evalWeeks = Math.min(totalCourseWeeks, maxEvalWeeks ?? totalCourseWeeks);

      const requiredLoginDays = schedule.isShortCourse
        ? (schedule.requiredLoginCount ?? evalWeeks * REQUIRED_DAYS_PER_WEEK)
        : evalWeeks * REQUIRED_DAYS_PER_WEEK;

      // Calcular semanas ISO dentro de la ventana del curso
      const startMs = new Date(schedule.startIsoDate).getTime();
      const endMs = new Date(schedule.endIsoDate).getTime();
      const DAY_MS = 24 * 60 * 60 * 1000;

      // Construir semanas: agrupar los días del docente por semana ISO (lunes como inicio)
      const dayToIsoWeek = (dateStr: string): string => {
        const d = new Date(dateStr + 'T00:00:00Z');
        const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon...6=Sat
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(d.getTime() + diffToMonday * DAY_MS);
        return monday.toISOString().slice(0, 10);
      };

      // Generar las semanas evaluadas del curso (hasta evalWeeks)
      const courseWeeks = new Set<string>();
      for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
        courseWeeks.add(dayToIsoWeek(new Date(ms).toISOString().slice(0, 10)));
        if (courseWeeks.size >= evalWeeks) break;
      }

      // Agrupar días del docente por semana
      const weekMap = new Map<string, string[]>();
      for (const day of teacherDays) {
        const dayMs = new Date(day + 'T00:00:00Z').getTime();
        if (dayMs < startMs || dayMs > endMs) continue; // fuera del rango del NRC
        const week = dayToIsoWeek(day);
        if (!courseWeeks.has(week)) continue; // fuera de las semanas evaluadas
        const arr = weekMap.get(week) ?? [];
        arr.push(day);
        weekMap.set(week, arr);
      }

      const weeksDetail = [...courseWeeks]
        .sort()
        .map((week) => {
          const days = weekMap.get(week) ?? [];
          const effectiveDays = Math.min(days.length, REQUIRED_DAYS_PER_WEEK);
          const compliant = days.length >= REQUIRED_DAYS_PER_WEEK;
          return { week, days, dayCount: days.length, effectiveDays, compliant };
        });

      let compliantWeeks: number | null;
      let complianceRate: number | null;
      let status: string;

      if (schedule.isShortCourse) {
        // Cursos cortos: total de días vs mínimo requerido
        const meets = totalTeacherDays >= requiredLoginDays;
        compliantWeeks = null;
        complianceRate = requiredLoginDays > 0
          ? Number(Math.min(100, (totalTeacherDays / requiredLoginDays) * 100).toFixed(1))
          : null;
        status = meets ? 'CUMPLE' : totalTeacherDays === 0 ? 'SIN_INGRESOS' : 'INCUMPLE';
      } else {
        // Cursos regulares: sumar días efectivos (máx 3 por semana) vs requeridos
        compliantWeeks = weeksDetail.filter((w) => w.compliant).length;
        const totalEffectiveDays = weeksDetail.reduce((s, w) => s + w.effectiveDays, 0);
        complianceRate = requiredLoginDays > 0
          ? Number(Math.min(100, (totalEffectiveDays / requiredLoginDays) * 100).toFixed(1))
          : null;
        const rate = complianceRate ?? 0;
        const anyDays = weeksDetail.some((w) => w.dayCount > 0);
        status = !anyDays
          ? 'SIN_INGRESOS'
          : rate >= 100
          ? 'CUMPLE'
          : rate >= 50
          ? 'PARCIAL'
          : 'INCUMPLE';
      }

      return {
        nrc: meta.nrc,
        subjectName: meta.subjectName,
        programName: meta.programName,
        campusCode: meta.campusCode,
        teacherName: meta.teacherName,
        periodCode: meta.periodCode,
        calendarState: schedule.calendarState,
        isShortCourse: schedule.isShortCourse,
        totalCourseWeeks: evalWeeks,
        requiredLoginDays,
        totalTeacherDays,
        weeksDetail,
        compliantWeeks,
        complianceRate,
        status,
      };
    });

    const withData = courses.filter((c) => c.status !== 'SIN_FECHAS');
    const compliantCourses = withData.filter((c) => c.status === 'CUMPLE').length;
    const partialCourses = withData.filter((c) => c.status === 'PARCIAL').length;
    const nonCompliantCourses = withData.filter((c) => c.status === 'INCUMPLE').length;
    const noDataCourses = withData.filter((c) => c.status === 'SIN_INGRESOS').length;
    const noDatesCourses = courses.filter((c) => c.status === 'SIN_FECHAS').length;

    const ratedCourses = withData.filter((c) => c.complianceRate !== null);
    const avgCompliance = ratedCourses.length
      ? Number((ratedCourses.reduce((sum, c) => sum + (c.complianceRate ?? 0), 0) / ratedCourses.length).toFixed(1))
      : null;

    return {
      ok: true,
      filters,
      summary: {
        courseCount: courses.length,
        compliantCourses,
        partialCourses,
        nonCompliantCourses,
        noDataCourses,
        noDatesCourses,
        complianceRate: avgCompliance,
      },
      courses: courses.sort((a, b) => {
        const order: Record<string, number> = { SIN_INGRESOS: 0, INCUMPLE: 1, PARCIAL: 2, SIN_FECHAS: 3, CUMPLE: 4 };
        return (order[a.status] ?? 5) - (order[b.status] ?? 5);
      }),
    };
  }

  async applyTeacherAccessToChecklists(rawQuery: Record<string, unknown>) {
    type TeacherCourse = { nrc: string; periodCode: string; status: string; complianceRate: number | null };
    const report = await this.teacherAccessReport(rawQuery) as { ok: boolean; courses: TeacherCourse[] };

    // Solo procesar cursos con datos de ingresos (excluir SIN_FECHAS)
    const actionable = report.courses.filter((c) => c.status !== 'SIN_FECHAS');

    let updated = 0;
    let skipped = 0;
    const details: Array<{ nrc: string; periodCode: string; status: string; ingresosScore: number; newEjecucionScore: number | null }> = [];

    for (const course of actionable) {
      // Valor numerico: complianceRate (0-100) si hay datos, 0 si sin ingresos
      const ingresosValue = course.status === 'SIN_INGRESOS' ? 0 : (course.complianceRate ?? 0);

      // Buscar el curso en BD por NRC + periodo
      const dbCourse = await this.prisma.course.findFirst({
        where: {
          nrc: course.nrc,
          period: { code: course.periodCode },
        },
        select: {
          id: true,
          nrc: true,
          bannerStartDate: true,
          bannerEndDate: true,
          period: { select: { executionPolicy: true } },
          evaluations: {
            where: { phase: 'EJECUCION' },
            select: { id: true, checklist: true, score: true, observations: true },
          },
        },
      });

      if (!dbCourse) {
        skipped++;
        continue;
      }

      const existingEval = dbCourse.evaluations[0];
      const existingChecklist =
        existingEval?.checklist && typeof existingEval.checklist === 'object' && !Array.isArray(existingEval.checklist)
          ? (existingEval.checklist as Record<string, unknown>)
          : {};

      // Merge: actualiza solo el campo ingresos, conserva el resto del checklist
      const updatedChecklist: Record<string, unknown> = { ...existingChecklist, ingresos: ingresosValue };

      const executionPolicy = (dbCourse.period?.executionPolicy ?? 'APPLIES') as 'APPLIES' | 'AUTO_PASS';
      const courseModalityForScore = (dbCourse as { modalityType?: string | null }).modalityType as
        | 'PRESENCIAL'
        | 'VIRTUAL'
        | 'VIRTUAL_100'
        | null
        | undefined;
      const { score: newScore, notes } = scoreEjecucion(updatedChecklist as Record<string, string | number | boolean | null | undefined>, {
        executionPolicy,
        bannerStartDate: dbCourse.bannerStartDate ?? null,
        bannerEndDate: dbCourse.bannerEndDate ?? null,
        modality: courseModalityForScore,
      });

      const missingItems: string[] = [];
      if (!updatedChecklist['acuerdo']) missingItems.push('Acuerdo pedagogico');
      if (!updatedChecklist['grabaciones']) missingItems.push('Grabaciones');
      if (ingresosValue < 100) missingItems.push(`Ingresos docente (${ingresosValue.toFixed(1)}%)`);
      if (!updatedChecklist['calificacion']) missingItems.push('Calificaciones');
      if (!updatedChecklist['asistencia']) missingItems.push('Asistencia');
      const observations = missingItems.length
        ? `Pendiente: ${missingItems.join(', ')}`
        : notes[0] ?? 'Cumple ejecucion.';

      await this.prisma.evaluation.upsert({
        where: { courseId_phase: { courseId: dbCourse.id, phase: 'EJECUCION' } },
        create: {
          courseId: dbCourse.id,
          phase: 'EJECUCION',
          checklist: updatedChecklist as Prisma.InputJsonValue,
          score: newScore,
          observations,
        },
        update: {
          checklist: updatedChecklist as Prisma.InputJsonValue,
          score: newScore,
          observations,
        },
      });

      details.push({
        nrc: course.nrc,
        periodCode: course.periodCode,
        status: course.status,
        ingresosScore: Number(((ingresosValue / 100) * 10).toFixed(2)),
        newEjecucionScore: newScore,
      });
      updated++;
    }

    return {
      ok: true,
      summary: {
        total: actionable.length,
        updated,
        skipped,
      },
      details,
    };
  }
}
