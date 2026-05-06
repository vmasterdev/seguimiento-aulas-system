import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';

const DAY_LABELS = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];
const DAY_KEYS = ['L', 'M', 'I', 'J', 'V', 'S', 'D'];

function parseHHMM(value: string | null | undefined): { mins: number; label: string } | null {
  if (!value) return null;
  const v = value.trim().padStart(4, '0');
  if (!/^\d{4}$/.test(v)) {
    if (/^\d{1,2}:\d{2}$/.test(value.trim())) {
      const [h, m] = value.trim().split(':').map((n) => parseInt(n, 10));
      const mins = h * 60 + m;
      return { mins, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
    }
    return null;
  }
  const h = parseInt(v.slice(0, 2), 10);
  const m = parseInt(v.slice(2, 4), 10);
  return { mins: h * 60 + m, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

function parseDayMask(value: string | null | undefined): boolean[] {
  // formato '_______' (7 chars) con letras LMIJVSD en posiciones donde aplica
  const arr = [false, false, false, false, false, false, false];
  if (!value) return arr;
  for (let i = 0; i < Math.min(value.length, 7); i++) {
    const ch = value[i];
    if (ch && ch !== '_' && ch !== ' ') arr[i] = true;
  }
  return arr;
}

function dayKeyForDate(date: Date): number {
  // JS getDay: 0=Dom, 1=Lun, ..., 6=Sab. Nuestro index: 0=Lun, ..., 6=Dom
  const js = date.getUTCDay();
  return js === 0 ? 6 : js - 1;
}

function fmtDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildSubjectKey(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ScheduleQuerySchema = z.object({
  periodCode: z.string().trim().optional(),
  moment: z.string().trim().optional(),
  teacherId: z.string().trim().optional(),
  teacherEmail: z.string().trim().optional(),
  programCode: z.string().trim().optional(),
  campus: z.string().trim().optional(),
  nrc: z.string().trim().optional(),
});

const ClassroomsQuerySchema = z.object({
  template: z.string().trim().optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

const UpsertClassroomSchema = z.object({
  id: z.string().trim().optional(),
  template: z.string().trim().min(1),
  subjectName: z.string().trim().min(1).max(300),
  alphanumericCode: z.string().trim().max(200).optional(),
  backupUrl: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const SettingsUpdateSchema = z.object({
  recargoStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  recargoEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const RecargoQuerySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  teacherId: z.string().trim().optional(),
  programCode: z.string().trim().optional(),
  campus: z.string().trim().optional(),
  recargoStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  recargoEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  format: z.string().trim().optional(),
});

const EmailRequestSchema = z.object({
  periodCode: z.string().trim().min(1),
  moment: z.string().trim().optional(),
  teacherId: z.string().trim().optional(),
  testEmail: z.string().trim().email().optional(),
  audience: z.enum(['SEMESTRE', 'PRE_MOMENTO']).default('SEMESTRE'),
});

@Injectable()
export class ScheduleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ── Schedule ──
  async getSchedule(rawQuery: unknown) {
    const q = parseWithSchema(ScheduleQuerySchema, rawQuery, 'schedule query');

    const where: any = {};
    if (q.periodCode) where.period = { code: q.periodCode };
    if (q.moment) where.moment = q.moment;
    if (q.teacherId) where.teacherId = q.teacherId;
    if (q.programCode) where.programCode = q.programCode;
    if (q.campus) where.campusCode = q.campus;
    if (q.nrc) where.nrc = q.nrc;

    const courses = await this.prisma.course.findMany({
      where,
      include: { teacher: true, period: true, moodleCheck: true },
      orderBy: [{ teacherId: 'asc' }, { dias: 'asc' }, { horaInicio: 'asc' }],
      take: 5000,
    });

    if (q.teacherEmail && !q.teacherId) {
      const email = q.teacherEmail.trim().toLowerCase();
      return {
        ok: true,
        items: courses
          .filter((c) => (c.teacher?.email?.toLowerCase() === email) || (c.teacher?.email2?.toLowerCase() === email))
          .map((c) => this.shapeCourse(c)),
      };
    }

    return {
      ok: true,
      items: courses.map((c) => this.shapeCourse(c)),
    };
  }

  private shapeCourse(c: any) {
    const start = parseHHMM(c.horaInicio);
    const end = parseHHMM(c.horaFin);
    const days = parseDayMask(c.dias);
    return {
      id: c.id,
      nrc: c.nrc,
      periodCode: c.period?.code ?? null,
      moment: c.moment,
      programCode: c.programCode,
      programName: c.programName,
      subjectName: c.subjectName,
      teacherId: c.teacherId,
      teacherName: c.teacher?.fullName ?? null,
      teacherEmail: c.teacher?.email ?? null,
      teacherEmail2: c.teacher?.email2 ?? null,
      campus: c.campusCode ?? c.teacher?.campus ?? null,
      edificio: c.edificio,
      salon: c.salon,
      horaInicio: start?.label ?? c.horaInicio,
      horaFin: end?.label ?? c.horaFin,
      dias: days,
      diasLabels: DAY_LABELS.filter((_, i) => days[i]),
      moodleUrl: c.moodleCheck?.moodleCourseUrl ?? null,
      modalityType: c.modalityType ?? null,
      detectedTemplate: c.moodleCheck?.detectedTemplate ?? null,
    };
  }

  // ── Standard classrooms ──
  async listClassrooms(rawQuery: unknown) {
    const q = parseWithSchema(ClassroomsQuerySchema, rawQuery, 'classrooms query');
    const where: any = {};
    if (q.template) where.template = q.template.toUpperCase();
    if (q.q) {
      where.OR = [
        { subjectName: { contains: q.q, mode: 'insensitive' } },
        { alphanumericCode: { contains: q.q, mode: 'insensitive' } },
        { notes: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    const items = await this.prisma.standardClassroom.findMany({
      where,
      orderBy: [{ template: 'asc' }, { subjectName: 'asc' }],
      take: q.limit,
    });
    return { ok: true, items };
  }

  async upsertClassroom(payload: unknown) {
    const body = parseWithSchema(UpsertClassroomSchema, payload, 'upsert classroom');
    const template = body.template.trim().toUpperCase();
    const subjectKey = buildSubjectKey(body.subjectName);
    if (!subjectKey) throw new BadRequestException('subjectName invalido.');

    const existing = body.id
      ? await this.prisma.standardClassroom.findUnique({ where: { id: body.id } })
      : await this.prisma.standardClassroom.findUnique({
          where: { template_subjectKey: { template, subjectKey } },
        });

    const data = {
      template,
      subjectName: body.subjectName,
      subjectKey,
      alphanumericCode: body.alphanumericCode || null,
      backupUrl: body.backupUrl || null,
      notes: body.notes || null,
    };

    const item = existing
      ? await this.prisma.standardClassroom.update({ where: { id: existing.id }, data })
      : await this.prisma.standardClassroom.create({ data });

    return { ok: true, item };
  }

  async deleteClassroom(id: string) {
    const existing = await this.prisma.standardClassroom.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Aula no encontrada');
    await this.prisma.standardClassroom.delete({ where: { id } });
    return { ok: true };
  }

  async findClassroomFor(template: string, subjectName: string | null | undefined) {
    if (!template || !subjectName) return null;
    const subjectKey = buildSubjectKey(subjectName);
    if (!subjectKey) return null;
    return this.prisma.standardClassroom.findUnique({
      where: { template_subjectKey: { template: template.toUpperCase(), subjectKey } },
    });
  }

  // ── System settings ──
  async getSettings() {
    const items = await this.prisma.systemSetting.findMany();
    const map: Record<string, string> = {};
    for (const it of items) map[it.key] = it.value;
    return {
      ok: true,
      recargoStart: map.recargo_nocturno_inicio ?? '21:00',
      recargoEnd: map.recargo_nocturno_fin ?? '06:00',
    };
  }

  async updateSettings(payload: unknown) {
    const body = parseWithSchema(SettingsUpdateSchema, payload, 'settings update');
    if (body.recargoStart) {
      await this.prisma.systemSetting.upsert({
        where: { key: 'recargo_nocturno_inicio' },
        create: { key: 'recargo_nocturno_inicio', value: body.recargoStart },
        update: { value: body.recargoStart },
      });
    }
    if (body.recargoEnd) {
      await this.prisma.systemSetting.upsert({
        where: { key: 'recargo_nocturno_fin' },
        create: { key: 'recargo_nocturno_fin', value: body.recargoEnd },
        update: { value: body.recargoEnd },
      });
    }
    return this.getSettings();
  }

  // ── Recargo nocturno ──
  async computeRecargo(rawQuery: unknown) {
    const q = parseWithSchema(RecargoQuerySchema, rawQuery, 'recargo query');
    const settings = await this.getSettings();
    const recargoStart = parseHHMM(q.recargoStart ?? settings.recargoStart)!.mins;
    const recargoEnd = parseHHMM(q.recargoEnd ?? settings.recargoEnd)!.mins;
    const isOvernight = recargoEnd <= recargoStart;

    const where: any = {};
    if (q.teacherId) where.teacherId = q.teacherId;
    if (q.programCode) where.programCode = q.programCode;
    if (q.campus) where.campusCode = q.campus;

    const courses = await this.prisma.course.findMany({
      where: {
        ...where,
        horaInicio: { not: null },
        horaFin: { not: null },
        dias: { not: null },
      },
      include: { teacher: true, period: true },
    });

    const dateFrom = new Date(q.dateFrom + 'T00:00:00Z');
    const dateTo = new Date(q.dateTo + 'T00:00:00Z');
    if (dateTo < dateFrom) throw new BadRequestException('dateTo < dateFrom');

    const rows: Array<Record<string, string | number>> = [];

    for (const c of courses) {
      const start = parseHHMM(c.horaInicio);
      const end = parseHHMM(c.horaFin);
      if (!start || !end) continue;
      const days = parseDayMask(c.dias);
      if (!days.some(Boolean)) continue;

      // Para cada fecha en rango
      const cur = new Date(dateFrom);
      while (cur <= dateTo) {
        const dayIdx = dayKeyForDate(cur);
        if (days[dayIdx]) {
          const overlap = this.computeOverlap(start.mins, end.mins, recargoStart, recargoEnd, isOvernight);
          if (overlap.minutes > 0) {
            rows.push({
              docente: c.teacher?.fullName ?? '',
              docenteEmail: c.teacher?.email ?? '',
              docenteId: c.teacher?.id ?? '',
              centro: c.campusCode ?? c.teacher?.campus ?? '',
              programa: c.programCode ?? '',
              programaNombre: c.programName ?? '',
              nrc: c.nrc,
              periodo: c.period?.code ?? '',
              fecha: fmtDateISO(cur),
              dia: DAY_LABELS[dayIdx],
              claseInicio: start.label,
              claseFin: end.label,
              recargoInicio: minsToLabel(overlap.start),
              recargoFin: minsToLabel(overlap.end),
              minutosRecargo: overlap.minutes,
              horasRecargo: Number((overlap.minutes / 60).toFixed(2)),
              edificio: c.edificio ?? '',
              salon: c.salon ?? '',
            });
          }
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    rows.sort((a, b) => {
      if (a.docente !== b.docente) return String(a.docente).localeCompare(String(b.docente));
      if (a.fecha !== b.fecha) return String(a.fecha).localeCompare(String(b.fecha));
      return String(a.claseInicio).localeCompare(String(b.claseInicio));
    });

    // Totales
    const totalMinutos = rows.reduce((s, r) => s + (r.minutosRecargo as number), 0);
    const byTeacher = new Map<string, { docente: string; docenteId: string; centro: string; programa: string; minutos: number; horas: number }>();
    for (const r of rows) {
      const key = String(r.docenteId || r.docente);
      const cur = byTeacher.get(key) ?? { docente: String(r.docente), docenteId: String(r.docenteId), centro: String(r.centro), programa: String(r.programa), minutos: 0, horas: 0 };
      cur.minutos += r.minutosRecargo as number;
      cur.horas = Number((cur.minutos / 60).toFixed(2));
      byTeacher.set(key, cur);
    }

    const csv = this.toCsv(rows);

    return {
      json: {
        ok: true,
        recargoStart: q.recargoStart ?? settings.recargoStart,
        recargoEnd: q.recargoEnd ?? settings.recargoEnd,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        totalRows: rows.length,
        totalMinutos,
        totalHoras: Number((totalMinutos / 60).toFixed(2)),
        byTeacher: [...byTeacher.values()].sort((a, b) => b.minutos - a.minutos),
        rows,
      },
      csv,
    };
  }

  private computeOverlap(claseStart: number, claseFin: number, recStart: number, recEnd: number, overnight: boolean) {
    // Calcular intersección entre [claseStart, claseFin] y franja recargo
    // Si overnight: franja es [recStart, 24:00] U [0, recEnd]
    let totalMins = 0;
    let firstStart = -1;
    let lastEnd = -1;

    const intersect = (a1: number, a2: number, b1: number, b2: number): [number, number] | null => {
      const s = Math.max(a1, b1);
      const e = Math.min(a2, b2);
      return e > s ? [s, e] : null;
    };

    if (overnight) {
      const seg1 = intersect(claseStart, claseFin, recStart, 24 * 60);
      const seg2 = intersect(claseStart, claseFin, 0, recEnd);
      for (const seg of [seg1, seg2]) {
        if (!seg) continue;
        totalMins += seg[1] - seg[0];
        if (firstStart < 0 || seg[0] < firstStart) firstStart = seg[0];
        if (seg[1] > lastEnd) lastEnd = seg[1];
      }
    } else {
      const seg = intersect(claseStart, claseFin, recStart, recEnd);
      if (seg) {
        totalMins = seg[1] - seg[0];
        firstStart = seg[0];
        lastEnd = seg[1];
      }
    }

    return { minutes: totalMins, start: firstStart, end: lastEnd };
  }

  private toCsv(rows: Array<Record<string, string | number>>): string {
    if (!rows.length) return 'docente,nrc,fecha,dia,claseInicio,claseFin,recargoInicio,recargoFin,minutosRecargo,horasRecargo\n';
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(','));
    return '﻿' + lines.join('\n');
  }

  // ── Metricas uso ──
  async metricsUsage(rawQuery: unknown) {
    const q = parseWithSchema(z.object({
      periodCode: z.string().trim().optional(),
      moment: z.string().trim().optional(),
      campus: z.string().trim().optional(),
    }), rawQuery, 'metrics query');

    const where: any = {
      horaInicio: { not: null },
      horaFin: { not: null },
      dias: { not: null },
    };
    if (q.periodCode) where.period = { code: q.periodCode };
    if (q.moment) where.moment = q.moment;
    if (q.campus) where.campusCode = q.campus;

    const courses = await this.prisma.course.findMany({
      where,
      include: { teacher: true, period: true, moodleCheck: true },
    });

    type Slot = { courseId: string; nrc: string; subject: string; teacher: string; campus: string; edificio: string; salon: string; modality: string; dayIdx: number; startMin: number; endMin: number };
    const slots: Slot[] = [];

    for (const c of courses) {
      const start = parseHHMM(c.horaInicio);
      const end = parseHHMM(c.horaFin);
      if (!start || !end || end.mins <= start.mins) continue;
      const days = parseDayMask(c.dias);
      const campus = c.campusCode ?? c.teacher?.campus ?? '—';
      for (let d = 0; d < 7; d++) {
        if (!days[d]) continue;
        slots.push({
          courseId: c.id,
          nrc: c.nrc,
          subject: c.subjectName ?? '',
          teacher: c.teacher?.fullName ?? '',
          campus,
          edificio: c.edificio ?? '',
          salon: c.salon ?? '',
          modality: (c.modalityType ?? '').toString(),
          dayIdx: d,
          startMin: start.mins,
          endMin: end.mins,
        });
      }
    }

    // Heatmap dia x hora (24 horas) — minutos ocupados por celda
    const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const s of slots) {
      let minute = s.startMin;
      while (minute < s.endMin) {
        const h = Math.floor(minute / 60);
        if (h < 24) heatmap[s.dayIdx][h] += 1;
        minute += 60 - (minute % 60);
        if (minute > s.endMin) minute = s.endMin;
      }
    }
    // Recalcular en minutos exactos
    const heatmapMins: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const s of slots) {
      for (let h = 0; h < 24; h++) {
        const slotStart = h * 60;
        const slotEnd = slotStart + 60;
        const overlap = Math.max(0, Math.min(s.endMin, slotEnd) - Math.max(s.startMin, slotStart));
        if (overlap > 0) heatmapMins[s.dayIdx][h] += overlap;
      }
    }

    // Por sede
    const byCenter = new Map<string, { campus: string; nrcSet: Set<string>; salones: Set<string>; minutes: number; teachers: Set<string>; modalityCount: Record<string, number> }>();
    for (const s of slots) {
      const cur = byCenter.get(s.campus) ?? { campus: s.campus, nrcSet: new Set<string>(), salones: new Set<string>(), minutes: 0, teachers: new Set<string>(), modalityCount: {} };
      cur.nrcSet.add(s.nrc);
      if (s.salon) cur.salones.add(`${s.edificio}|${s.salon}`);
      cur.minutes += s.endMin - s.startMin;
      if (s.teacher) cur.teachers.add(s.teacher);
      cur.modalityCount[s.modality || 'SIN'] = (cur.modalityCount[s.modality || 'SIN'] ?? 0) + 1;
      byCenter.set(s.campus, cur);
    }

    // Por salon (edificio + salon)
    const bySalon = new Map<string, { edificio: string; salon: string; campus: string; nrcSet: Set<string>; minutes: number; subjects: Set<string>; teachers: Set<string> }>();
    for (const s of slots) {
      if (!s.salon) continue;
      const key = `${s.campus}|${s.edificio}|${s.salon}`;
      const cur = bySalon.get(key) ?? { edificio: s.edificio, salon: s.salon, campus: s.campus, nrcSet: new Set<string>(), minutes: 0, subjects: new Set<string>(), teachers: new Set<string>() };
      cur.nrcSet.add(s.nrc);
      cur.minutes += s.endMin - s.startMin;
      if (s.subject) cur.subjects.add(s.subject);
      if (s.teacher) cur.teachers.add(s.teacher);
      bySalon.set(key, cur);
    }

    // Capacidad teorica salon: L-S 6am-10pm = 16h * 6 = 96h/sem = 5760min
    const TEORICO_MIN = 5760;

    return {
      ok: true,
      filters: q,
      heatmapMinutes: heatmapMins, // [day][hour] minutos/semana
      heatmapNrcCount: heatmap, // [day][hour] NRC simultaneos (max)
      totalSlots: slots.length,
      byCenter: [...byCenter.values()].map((c) => ({
        campus: c.campus,
        nrcCount: c.nrcSet.size,
        salonesCount: c.salones.size,
        teachersCount: c.teachers.size,
        horasSemana: Number((c.minutes / 60).toFixed(2)),
        modalityBreakdown: c.modalityCount,
      })).sort((a, b) => b.horasSemana - a.horasSemana),
      bySalon: [...bySalon.values()].map((s) => ({
        campus: s.campus,
        edificio: s.edificio,
        salon: s.salon,
        nrcCount: s.nrcSet.size,
        teachersCount: s.teachers.size,
        subjectsCount: s.subjects.size,
        horasSemana: Number((s.minutes / 60).toFixed(2)),
        ocupacionPct: Number(((s.minutes / TEORICO_MIN) * 100).toFixed(1)),
      })).sort((a, b) => b.horasSemana - a.horasSemana),
      teoricoMinSalon: TEORICO_MIN,
    };
  }

  // ── Teacher email ──
  async previewTeacherEmail(payload: unknown) {
    const body = parseWithSchema(EmailRequestSchema, payload, 'email preview');
    if (!body.teacherId) throw new BadRequestException('teacherId requerido para preview');

    const teacher = await this.prisma.teacher.findUnique({ where: { id: body.teacherId } });
    if (!teacher) throw new NotFoundException('Docente no encontrado');
    const emailOptions = { ...body, audience: body.audience ?? 'SEMESTRE' };

    const courses = await this.prisma.course.findMany({
      where: {
        teacherId: teacher.id,
        period: { code: body.periodCode },
        ...(body.moment ? { moment: body.moment } : {}),
      },
      include: { period: true, moodleCheck: true },
      orderBy: [{ moment: 'asc' }, { dias: 'asc' }, { horaInicio: 'asc' }],
    });

    const html = await this.buildTeacherEmailHtml(teacher, courses, emailOptions);
    return { ok: true, html, teacher: { id: teacher.id, fullName: teacher.fullName, email: teacher.email, email2: teacher.email2 } };
  }

  async sendTeacherEmail(payload: unknown) {
    const body = parseWithSchema(EmailRequestSchema, payload, 'email send');
    const emailOptions = { ...body, audience: body.audience ?? 'SEMESTRE' };

    const where: any = { period: { code: body.periodCode } };
    if (body.moment) where.moment = body.moment;
    if (body.teacherId) where.teacherId = body.teacherId;

    const courses = await this.prisma.course.findMany({
      where,
      include: { period: true, teacher: true, moodleCheck: true },
    });

    // Agrupar por docente
    const byTeacher = new Map<string, { teacher: any; courses: any[] }>();
    for (const c of courses) {
      if (!c.teacher) continue;
      const k = c.teacher.id;
      if (!byTeacher.has(k)) byTeacher.set(k, { teacher: c.teacher, courses: [] });
      byTeacher.get(k)!.courses.push(c);
    }

    const periodRecord = await this.prisma.period.findUnique({ where: { code: body.periodCode } });
    if (!periodRecord) throw new NotFoundException('Periodo no encontrado');

    let queued = 0;
    const results: Array<{ teacherId: string; emails: string[]; status: string }> = [];

    for (const { teacher, courses: tcourses } of byTeacher.values()) {
      const html = await this.buildTeacherEmailHtml(teacher, tcourses, emailOptions);
      const recipients = body.testEmail
        ? [body.testEmail]
        : [teacher.email, teacher.email2].filter(Boolean);
      if (!recipients.length) {
        results.push({ teacherId: teacher.id, emails: [], status: 'NO_EMAIL' });
        continue;
      }
      for (const recipient of recipients) {
        await this.prisma.outboxMessage.create({
          data: {
            audience: 'DOCENTE',
            teacherId: teacher.id,
            periodId: periodRecord.id,
            phase: 'INFO',
            moment: body.moment ?? '',
            subject: body.audience === 'PRE_MOMENTO'
              ? `[UNIMINUTO] Recordatorio momento ${body.moment ?? ''} — ${body.periodCode} — Tus NRC asignados`
              : `[UNIMINUTO] Inicio de semestre ${body.periodCode} — Tus NRC asignados`,
            recipientName: teacher.fullName,
            recipientEmail: recipient,
            htmlBody: html,
            status: 'QUEUED',
          },
        });
        queued += 1;
      }
      results.push({ teacherId: teacher.id, emails: recipients, status: 'QUEUED' });
    }

    return { ok: true, queued, totalTeachers: byTeacher.size, results };
  }

  private async buildTeacherEmailHtml(teacher: any, courses: any[], opts: { audience: string; moment?: string; periodCode: string }) {
    // Lookup aulas estandar para cada curso
    const rows: string[] = [];
    for (const c of courses) {
      const tpl = (c.moodleCheck?.detectedTemplate ?? '').toString().toUpperCase();
      const aula = await this.findClassroomFor(tpl, c.subjectName);
      const start = parseHHMM(c.horaInicio)?.label ?? c.horaInicio ?? '-';
      const end = parseHHMM(c.horaFin)?.label ?? c.horaFin ?? '-';
      const days = parseDayMask(c.dias);
      const daysLabel = DAY_LABELS.filter((_, i) => days[i]).join(', ') || '-';

      let aulaInfo = '';
      if (tpl === 'D4' || tpl === 'INNOVAME') {
        aulaInfo = aula?.alphanumericCode
          ? `<span style="color:#166534;font-weight:700;">${aula.alphanumericCode}</span>${aula.notes ? `<br><span style="font-size:11px;color:#6b7280;">${aula.notes}</span>` : ''}`
          : '<span style="color:#9ca3af;">— sin alfanumerico registrado —</span>';
      } else if (tpl === 'CRIBA') {
        aulaInfo = aula?.backupUrl
          ? `<a href="${aula.backupUrl}" style="color:#1e40af;">Copia de seguridad</a>`
          : '<span style="color:#9ca3af;">— sin URL backup —</span>';
      } else {
        aulaInfo = '—';
      }

      rows.push(`<tr>
        <td><strong>${c.nrc}</strong></td>
        <td>${c.subjectName ?? '-'}</td>
        <td>${c.programName ?? c.programCode ?? '-'}</td>
        <td>${c.moment ?? '-'}</td>
        <td>${tpl || '-'}</td>
        <td>${daysLabel}<br><span style="font-size:11px;color:#6b7280;">${start} — ${end}</span></td>
        <td>${c.edificio ?? ''} ${c.salon ?? ''}</td>
        <td>${c.moodleCheck?.moodleCourseUrl ? `<a href="${c.moodleCheck.moodleCourseUrl}">Abrir</a>` : '-'}</td>
        <td>${aulaInfo}</td>
      </tr>`);
    }

    const intro = opts.audience === 'PRE_MOMENTO'
      ? `Faltan aproximadamente <strong>una semana y media</strong> para el inicio del momento <strong>${opts.moment ?? ''}</strong>. A continuacion encontrara la informacion consolidada de sus NRC.`
      : `Le damos la bienvenida al periodo <strong>${opts.periodCode}</strong>. A continuacion encontrara la informacion consolidada de sus NRC asignados.`;

    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:16px;">
  <div style="max-width:920px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#1e40af;color:#fff;padding:18px 22px;">
      <div style="font-size:18px;font-weight:700;">UNIMINUTO — Direccion de Campus Virtual</div>
      <div style="font-size:13px;opacity:0.9;">Informacion de NRC asignados — Periodo ${opts.periodCode}${opts.moment ? ` · Momento ${opts.moment}` : ''}</div>
    </div>
    <div style="padding:20px 22px;color:#111827;">
      <p>Estimado(a) <strong>${teacher.fullName}</strong>,</p>
      <p>${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:12px;">
        <thead><tr style="background:#f3f4f6;">
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">NRC</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Asignatura</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Programa</th>
          <th style="padding:8px;border:1px solid #e5e7eb;">Momento</th>
          <th style="padding:8px;border:1px solid #e5e7eb;">Tipo</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Horario</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Salon</th>
          <th style="padding:8px;border:1px solid #e5e7eb;">Aula Moodle</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Aula tipo recomendada</th>
        </tr></thead>
        <tbody>${rows.join('') || '<tr><td colspan="9" style="text-align:center;padding:14px;color:#9ca3af;">Sin NRC registrados.</td></tr>'}</tbody>
      </table>

      <div style="background:#fef3c7;border-left:4px solid #d97706;padding:12px;margin-top:16px;font-size:13px;">
        <strong>Importante:</strong> Para aulas tipo <strong>D4 (Distancia 4.0)</strong> e <strong>INNOVAME</strong>, use el codigo alfanumerico indicado para acceder a la plantilla oficial. Para aulas <strong>CRIBA</strong>, descargue la copia de seguridad y restaure en su NRC. <em>Evite cargar copias de seguridad antiguas no autorizadas</em>; eso compromete los criterios de calidad del campus virtual.
      </div>

      <p style="margin-top:16px;font-size:12px;color:#6b7280;">Mensaje generado automaticamente por el sistema de seguimiento de aulas virtuales — UNIMINUTO.</p>
    </div>
  </div>
</body></html>`;
  }
}

function minsToLabel(m: number): string {
  if (m < 0) return '';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
