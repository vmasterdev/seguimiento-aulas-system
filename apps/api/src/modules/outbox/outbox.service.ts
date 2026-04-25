import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  normalizeProgramKey,
  normalizeTeacherId,
  OutboxExportSchema,
  OutboxGenerateSchema,
  OutboxSendSchema,
} from '@seguimiento/shared';
import type { Period } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { resolveProgramValue } from '../common/program.util';
import { isCourseExcludedFromReview } from '../common/review-eligibility.util';
import { SUPPORTED_MOMENTS, type SupportedMoment } from './outbox.constants';
import {
  buildSendFingerprint,
  createSmtpTransport,
  normalizeFingerprintToken,
  parsePositiveInt,
  resolveDeliveryMode,
} from './outbox.delivery';
import {
  buildWorkshopInvitationHtml,
  buildCoordinatorHtml,
  buildGlobalHtml,
  buildTeacherHtml,
  formatScoreForPhase,
  matchCoordinatorCourse,
  summarizeGlobalRows,
  toScoreBand,
  toScoreBandForPhase,
} from './outbox.report-builder';
import {
  OutboxPreviewByCourseSchema,
  OutboxQueueCierreSchema,
  OutboxResendByCourseSchema,
  OutboxResendUpdatedSchema,
  OutboxWorkshopInvitationPrepareSchema,
} from './outbox.schemas';
import type {
  CourseCoordinationRow,
  GeneratePayload,
  GlobalMomentSummaryRow,
  GlobalPeriodSummaryRow,
  GlobalSummaryRow,
  OutboxTrackingQuery,
  SendAuditLogDetail,
  SendCandidate,
  SendPayload,
} from './outbox.types';
import {
  formatMomentLabel,
  isSupportedMoment,
  normalizeMomentList,
  normalizePeriodCodeList,
  normalizeRecipientEmails,
  parseEnvBoolean,
  parseStoredRecipientEmails,
  sanitizeForFilename,
  toEml,
} from './outbox.utils';

function teacherRecipientEmail(teacher: { email?: string | null; email2?: string | null }): string | null {
  const emails = [teacher.email, teacher.email2].filter((e): e is string => Boolean(e?.trim()));
  return emails.length ? emails.join(';') : null;
}

@Injectable()
export class OutboxService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private resolveOutboxDir() {
    const raw = process.env.OUTBOX_DIR ?? '../../data/outbox';
    return path.resolve(process.cwd(), raw);
  }

  private normalizeGlobalSelectedPeriods(rawPeriodCodes: string[] | undefined, fallbackPeriodCode: string): string[] {
    const fallbackYearPrefix = String(fallbackPeriodCode ?? '')
      .replace(/[^\d]/g, '')
      .slice(0, 4);
    const yearPrefix = fallbackYearPrefix || String(new Date().getFullYear());
    const selected = normalizePeriodCodeList(fallbackPeriodCode, rawPeriodCodes)
      .filter((code) => code.startsWith(yearPrefix))
      .filter((code) => !/(80|85)$/.test(code));
    return selected.length ? selected : [fallbackPeriodCode];
  }

  private extractGlobalSelectedPeriods(message: {
    periodCode: string;
    programCode?: string | null;
    htmlBody?: string | null;
  }): string[] {
    const fromProgramCode = normalizePeriodCodeList(undefined, (message.programCode ?? '').split(/[|,;]+/));
    if (fromProgramCode.length) {
      return this.normalizeGlobalSelectedPeriods(fromProgramCode, message.periodCode);
    }

    const htmlBody = message.htmlBody ?? '';
    const matches = htmlBody.match(/\b20\d{4}\b/g) ?? [];
    const fromHtml = [...new Set(matches)];
    return this.normalizeGlobalSelectedPeriods(fromHtml, message.periodCode);
  }

  private encodeCoordinatorProgramMetadata(programId: string, periodCodes: string[]): string {
    return `${programId}||${periodCodes.join('|')}`;
  }

  private extractCoordinatorMetadata(message: {
    periodCode: string;
    programCode?: string | null;
  }): {
    programId: string | null;
    periodCodes: string[];
  } {
    const raw = message.programCode?.trim() ?? '';
    if (!raw) {
      return {
        programId: null,
        periodCodes: [message.periodCode],
      };
    }

    const [programIdRaw, periodsRaw] = raw.split('||');
    const programId = (programIdRaw || raw).trim() || null;
    const periodCodes = periodsRaw
      ? this.normalizeGlobalSelectedPeriods(periodsRaw.split(/[|,;]+/), message.periodCode)
      : [message.periodCode];
    return {
      programId,
      periodCodes,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private buildSendMomentFilterValues(selectedMoments: SupportedMoment[]): string[] {
    if (!selectedMoments.length) return [];
    if (selectedMoments.length === 1) return [selectedMoments[0]];

    const canonicalOrder = [...selectedMoments].sort(
      (left, right) => SUPPORTED_MOMENTS.indexOf(left) - SUPPORTED_MOMENTS.indexOf(right),
    );

    return [...new Set([
      ...selectedMoments,
      selectedMoments.join('+'),
      canonicalOrder.join('+'),
    ])];
  }

  private isTemporalChecklistCourse(rawJson: unknown): boolean {
    const root = this.asRecord(rawJson);
    const marker = this.asRecord(root.specialChecklistQueue);
    return marker.active === true;
  }

  private hasPhaseScore(
    evaluations: Array<{ phase?: string | null; score?: number | null }> | undefined,
    phase: 'ALISTAMIENTO' | 'EJECUCION',
  ): boolean {
    if (!Array.isArray(evaluations) || !evaluations.length) return false;
    const normalizedPhase = phase.toUpperCase();

    return evaluations.some((evaluation) => {
      const evaluationPhase = String(evaluation?.phase ?? '').trim().toUpperCase();
      if (evaluationPhase && evaluationPhase !== normalizedPhase) return false;
      return evaluation?.score != null;
    });
  }

  private shouldIncludeTeacherReportCourse(
    input: {
      rawJson: unknown;
      templateDeclared: string | null | undefined;
      moodleCheck:
        | {
            status?: string | null;
            detectedTemplate?: string | null;
            errorCode?: string | null;
            moodleCourseUrl?: string | null;
            moodleCourseId?: string | null;
          }
        | null
        | undefined;
      evaluations?: Array<{ phase?: string | null; score?: number | null }>;
      phase: 'ALISTAMIENTO' | 'EJECUCION';
    },
  ): boolean {
    const excluded = isCourseExcludedFromReview({
      rawJson: input.rawJson,
      template: input.moodleCheck?.detectedTemplate ?? input.templateDeclared ?? 'UNKNOWN',
      moodleCheck: input.moodleCheck ?? null,
    });
    if (!excluded) return true;

    // Permite incluir NRC en cola temporal cuando ya tienen calificacion guardada en la fase.
    return this.isTemporalChecklistCourse(input.rawJson) && this.hasPhaseScore(input.evaluations, input.phase);
  }

  private buildTeacherHtml(options: {
    teacherName: string;
    phase: string;
    moment: string;
    periodCode: string;
    rows: Array<{
      nrc: string;
      reviewedNrc: string;
      moodleCourseUrl?: string | null;
      moment: string;
      resultType: 'REVISADO' | 'REPLICADO';
      subject: string;
      program: string;
      template: string;
      score: number | null;
      observations: string;
    }>;
  }) {
    return buildTeacherHtml(options);
  }

  private buildCoordinatorHtml(options: {
    coordinatorName: string;
    programId: string;
    phase: string;
    moments: string[];
    periodCodes: string[];
    uniqueTeachers: number;
    rows: Array<{
      periodCode: string;
      teacherName: string;
      nrc: string;
      subject: string;
      moment: string;
      status: string;
      template: string;
      score: number | null;
    }>;
  }) {
    return buildCoordinatorHtml(options);
  }

  private matchCoordinatorCourse(
    coordinatorProgramKey: string,
    courseCoordinationKey: string,
  ): boolean {
    return matchCoordinatorCourse(coordinatorProgramKey, courseCoordinationKey);
  }

  private buildGlobalHtml(options: {
    phase: string;
    moments: string[];
    periodCodes: string[];
    totalCourses: number;
    averageScore: number | null;
    excellent: number;
    good: number;
    acceptable: number;
    unsatisfactory: number;
    rows: GlobalSummaryRow[];
    periodSummary: GlobalPeriodSummaryRow[];
    momentSummary: GlobalMomentSummaryRow[];
    recipientsCount: number;
  }) {
    return buildGlobalHtml(options);
  }

  private buildWorkshopInvitationHtml(options: {
    teacherName: string;
    phase: string;
    periodCode: string;
    sessionTitle: string;
    sessionDateLabel: string;
    sessionTimeLabel: string;
    meetingUrl: string;
    introNote?: string | null;
    rows: Array<{
      nrc: string;
      subject: string;
      moment: string;
      score: number | null;
      band: 'EXCELENTE' | 'BUENO' | 'ACEPTABLE' | 'INSATISFACTORIO';
    }>;
  }) {
    return buildWorkshopInvitationHtml(options);
  }

  private toScoreBand(score: number | null): 'EXCELENTE' | 'BUENO' | 'ACEPTABLE' | 'INSATISFACTORIO' {
    return toScoreBand(score);
  }

  private toScoreBandForPhase(
    score: number | null,
    phase: string,
  ): 'EXCELENTE' | 'BUENO' | 'ACEPTABLE' | 'INSATISFACTORIO' {
    return toScoreBandForPhase(score, phase);
  }

  private formatScoreForPhase(score: number | null, phase: string): string {
    return formatScoreForPhase(score, phase);
  }

  async prepareWorkshopInvitation(rawPayload: unknown) {
    const payload = parseWithSchema(
      OutboxWorkshopInvitationPrepareSchema,
      rawPayload,
      'outbox workshop invitation request',
    );

    const period = await this.prisma.period.findUnique({
      where: { code: payload.periodCode },
    });
    if (!period) {
      throw new NotFoundException(`No existe el periodo ${payload.periodCode}.`);
    }

    const selectedMoments = normalizeMomentList(undefined, payload.moments);
    const selectedBands = new Set(payload.scoreBands);
    const invitationMomentKey = `INVITACION_DIGITAL_${selectedMoments.join('_')}`;
    const subject = `[Campus Virtual] ${payload.sessionTitle} | ${payload.sessionDateLabel} | ${payload.sessionTimeLabel}`;

    const courses = await this.prisma.course.findMany({
      where: {
        periodId: period.id,
        teacherId: { not: null },
        moment: { in: selectedMoments },
        evaluations: {
          some: {
            phase: payload.phase,
          },
        },
      },
      include: {
        teacher: true,
        moodleCheck: true,
        evaluations: {
          where: {
            phase: payload.phase,
          },
        },
      },
      orderBy: [{ teacherId: 'asc' }, { moment: 'asc' }, { nrc: 'asc' }],
    });

    const grouped = new Map<
      string,
      {
        teacher: NonNullable<(typeof courses)[number]['teacher']>;
        rows: Array<{
          nrc: string;
          subject: string;
          moment: string;
          score: number | null;
          band: 'EXCELENTE' | 'BUENO' | 'ACEPTABLE' | 'INSATISFACTORIO';
        }>;
      }
    >();

    for (const course of courses) {
      if (!course.teacher) continue;
      if (
        isCourseExcludedFromReview({
          rawJson: course.rawJson,
          template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
          moodleCheck: course.moodleCheck,
        })
      ) {
        continue;
      }

      const phase = payload.phase ?? 'ALISTAMIENTO';
      const evaluation = course.evaluations[0] ?? null;
      const band = this.toScoreBandForPhase(evaluation?.score ?? null, phase);
      if (band !== 'ACEPTABLE' && band !== 'INSATISFACTORIO') continue;
      if (!selectedBands.has(band)) continue;

      const current = grouped.get(course.teacher.id) ?? {
        teacher: course.teacher,
        rows: [],
      };

      current.rows.push({
        nrc: course.nrc,
        subject: course.subjectName ?? 'Sin asignatura',
        moment: course.moment ?? 'SIN_MOMENTO',
        score: evaluation?.score ?? null,
        band,
      });

      grouped.set(course.teacher.id, current);
    }

    const createdMessageIds: string[] = [];
    const previewItems: Array<{
      id: string;
      teacherId: string;
      recipientName: string;
      recipientEmail: string;
      courseCount: number;
      moments: string[];
      scoreBands: string[];
    }> = [];
    const skippedTeachersWithoutEmail: string[] = [];

    for (const { teacher, rows } of grouped.values()) {
      if (!rows.length) continue;
      if (!teacher.email && !teacher.email2) {
        skippedTeachersWithoutEmail.push(teacher.fullName);
        continue;
      }

      const htmlBody = this.buildWorkshopInvitationHtml({
        teacherName: teacher.fullName,
        phase: payload.phase ?? 'ALISTAMIENTO',
        periodCode: period.code,
        sessionTitle: payload.sessionTitle,
        sessionDateLabel: payload.sessionDateLabel,
        sessionTimeLabel: payload.sessionTimeLabel,
        meetingUrl: payload.meetingUrl,
        introNote: payload.introNote,
        rows,
      });

      await this.prisma.outboxMessage.deleteMany({
        where: {
          audience: 'DOCENTE',
          teacherId: teacher.id,
          periodId: period.id,
          phase: payload.phase,
          moment: invitationMomentKey,
        },
      });

      const createdMessage = await this.prisma.outboxMessage.create({
        data: {
          audience: 'DOCENTE',
          teacherId: teacher.id,
          coordinatorId: null,
          programCode: teacher.costCenter ?? null,
          periodId: period.id,
          phase: payload.phase ?? 'ALISTAMIENTO',
          moment: invitationMomentKey,
          subject,
          recipientName: teacher.fullName,
          recipientEmail: teacherRecipientEmail(teacher),
          htmlBody,
          status: 'DRAFT',
        },
      });

      createdMessageIds.push(createdMessage.id);
      previewItems.push({
        id: createdMessage.id,
        teacherId: teacher.id,
        recipientName: teacher.fullName,
        recipientEmail: teacherRecipientEmail(teacher) ?? '',
        courseCount: rows.length,
        moments: [...new Set(rows.map((item) => item.moment))],
        scoreBands: [...new Set(rows.map((item) => item.band))],
      });
    }

    if (!createdMessageIds.length) {
      return {
        ok: true,
        created: 0,
        reason: grouped.size
          ? 'No fue posible crear borradores porque los docentes filtrados no tienen correo registrado.'
          : 'No hay docentes con resultado ACEPTABLE o INSATISFACTORIO para ese periodo y criterios.',
        previewItems: [],
        skippedTeachersWithoutEmail,
      };
    }

    return {
      ok: true,
      created: createdMessageIds.length,
      createdMessageIds,
      previewItems: previewItems.sort((left, right) => left.recipientName.localeCompare(right.recipientName, 'es')),
      skippedTeachersWithoutEmail,
      periodCode: period.code,
      phase: payload.phase,
      moments: selectedMoments,
      scoreBands: payload.scoreBands,
      sessionTitle: payload.sessionTitle,
      sessionDateLabel: payload.sessionDateLabel,
      sessionTimeLabel: payload.sessionTimeLabel,
      subject,
      invitationMomentKey,
    };
  }

  private async buildCoordinatorMessageContent(message: {
    coordinatorId: string | null;
    periodId: string;
    periodCode: string;
    phase: string;
    moment: string;
    programCode?: string | null;
  }): Promise<{
    subject: string;
    htmlBody: string;
    recipientName: string;
    recipientEmail: string | null;
    programCode: string | null;
  } | null> {
    if (!message.coordinatorId) return null;
    if (!message.phase || !['ALISTAMIENTO', 'EJECUCION'].includes(message.phase)) {
      return null;
    }

    const coordinator = await this.prisma.coordinator.findUnique({
      where: { id: message.coordinatorId },
    });
    if (!coordinator) return null;

    const selectedMoments = normalizeMomentList(undefined, message.moment.split('+') as SupportedMoment[]);
    const effectiveMoments = selectedMoments.length
      ? selectedMoments
      : ([message.moment || 'MD1'] as SupportedMoment[]);
    const coordinatorMeta = this.extractCoordinatorMetadata({
      periodCode: message.periodCode,
      programCode: message.programCode,
    });
    const selectedPeriodCodes = coordinatorMeta.periodCodes;
    const coursesByCoordination = await this.collectGlobalRows({
      periodCodes: selectedPeriodCodes,
      moments: effectiveMoments,
      phase: message.phase as GeneratePayload['phase'],
    });
    const matches = coursesByCoordination
      .filter((course) =>
        this.matchCoordinatorCourse(coordinator.programKey, course.coordinationKey),
      )
      .sort((left, right) => {
        const periodCompare = left.periodCode.localeCompare(right.periodCode);
        if (periodCompare !== 0) return periodCompare;
        const teacherCompare = left.teacherName.localeCompare(right.teacherName);
        if (teacherCompare !== 0) return teacherCompare;
        const momentCompare = left.moment.localeCompare(right.moment);
        if (momentCompare !== 0) return momentCompare;
        return left.nrc.localeCompare(right.nrc);
      });
    if (!matches.length) return null;

    const rows = matches.map((course) => ({
      periodCode: course.periodCode,
      teacherName: course.teacherName,
      nrc: course.nrc,
      subject: course.subject,
      moment: course.moment,
      status: course.status,
      template: course.template,
      score: course.score,
    }));
    const subject = `[Seguimiento Aulas] ${message.phase} ${effectiveMoments
      .map((moment) => formatMomentLabel(moment))
      .join(' + ')} - CONSOLIDADO ${selectedPeriodCodes[0].slice(0, 4)} - ${coordinator.programId}`;
    const htmlBody = this.buildCoordinatorHtml({
      coordinatorName: coordinator.fullName,
      programId: coordinator.programId,
      phase: message.phase,
      moments: effectiveMoments,
      periodCodes: selectedPeriodCodes,
      uniqueTeachers: new Set(rows.map((row) => row.teacherName)).size,
      rows,
    });

    return {
      subject,
      htmlBody,
      recipientName: coordinator.fullName,
      recipientEmail: coordinator.email,
      programCode: this.encodeCoordinatorProgramMetadata(coordinator.programId, selectedPeriodCodes),
    };
  }

  private async buildGlobalMessageContent(message: {
    periodId: string;
    periodCode: string;
    phase: string;
    moment: string;
    recipientName?: string | null;
    recipientEmail?: string | null;
    programCode?: string | null;
    htmlBody?: string | null;
  }): Promise<{
    subject: string;
    htmlBody: string;
    recipientName: string;
    recipientEmail: string | null;
    programCode: string | null;
  } | null> {
    if (!message.phase || !['ALISTAMIENTO', 'EJECUCION'].includes(message.phase)) {
      return null;
    }

    const selectedMoments = normalizeMomentList(undefined, message.moment.split('+') as SupportedMoment[]);
    const selectedPeriodCodes = this.extractGlobalSelectedPeriods({
      periodCode: message.periodCode,
      programCode: message.programCode,
      htmlBody: message.htmlBody,
    });
    const effectiveMoments = selectedMoments.length
      ? selectedMoments
      : ([message.moment || 'MD1'] as SupportedMoment[]);
    const rows = await this.collectGlobalRows({
      periodCodes: selectedPeriodCodes,
      moments: effectiveMoments,
      phase: message.phase as GeneratePayload['phase'],
    });
    if (!rows.length) return null;

    const summary = this.summarizeGlobalRows(
      rows,
      message.phase as GeneratePayload['phase'],
      selectedPeriodCodes,
      effectiveMoments,
    );
    const recipientEmail = message.recipientEmail?.trim() || null;
    const recipientName =
      message.recipientName?.trim() ||
      process.env.OUTBOX_GLOBAL_RECIPIENT_NAME?.trim() ||
      'Equipo de Coordinacion Academica';
    const recipientsCount = parseStoredRecipientEmails(recipientEmail).length || (recipientEmail ? 1 : 0);
    const subject = `[Seguimiento Aulas] GLOBAL ${message.phase} ${effectiveMoments
      .map((moment) => formatMomentLabel(moment))
      .join(' + ')} - CONSOLIDADO ${selectedPeriodCodes[0].slice(0, 4)}`;
    const htmlBody = this.buildGlobalHtml({
      phase: message.phase,
      moments: effectiveMoments,
      periodCodes: selectedPeriodCodes,
      totalCourses: summary.totalCourses,
      averageScore: summary.averageScore,
      excellent: summary.excellent,
      good: summary.good,
      acceptable: summary.acceptable,
      unsatisfactory: summary.unsatisfactory,
      rows: summary.rowsSummary,
      periodSummary: summary.periodSummary,
      momentSummary: summary.momentSummary,
      recipientsCount,
    });

    return {
      subject,
      htmlBody,
      recipientName,
      recipientEmail,
      programCode: selectedPeriodCodes.join('|'),
    };
  }

  private extractCourseTeacherIdentifiers(course: { teacherId: string | null; rawJson: unknown }): string[] {
    const values: Array<unknown> = [course.teacherId];

    if (course.rawJson && typeof course.rawJson === 'object') {
      const raw = course.rawJson as Record<string, unknown>;
      const row = raw.row;
      if (row && typeof row === 'object') {
        const normalizedRow = row as Record<string, unknown>;
        values.push(
          normalizedRow.id_docente,
          normalizedRow.docente_id,
          normalizedRow.identificacion,
          normalizedRow.cedula,
          normalizedRow.identificacion_docente,
          normalizedRow.cedula_docente,
        );
      }
    }

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

  private async buildCourseCoordinationRows(
    periodId: string,
    moment: GeneratePayload['moment'],
    phase: GeneratePayload['phase'],
  ): Promise<CourseCoordinationRow[]> {
    const courses = await this.prisma.course.findMany({
      where: {
        periodId,
        moment,
      },
      include: {
        period: true,
        teacher: true,
        moodleCheck: true,
        evaluations: true,
      },
      orderBy: [{ programName: 'asc' }, { teacher: { fullName: 'asc' } }, { nrc: 'asc' }],
    });

    if (!courses.length) return [];

    const teachers = await this.prisma.teacher.findMany({
      select: {
        id: true,
        sourceId: true,
        documentId: true,
        fullName: true,
        costCenter: true,
        coordination: true,
      },
    });
    const teacherByIdentifier = new Map<
      string,
      {
        id: string;
        fullName: string;
        costCenter: string | null;
        coordination: string | null;
      }
    >();
    for (const teacher of teachers) {
      const identifiers = [teacher.id, teacher.sourceId, teacher.documentId]
        .map((value) => normalizeTeacherId(value ?? ''))
        .filter(Boolean);
      for (const identifier of identifiers) {
        if (!teacherByIdentifier.has(identifier)) {
          teacherByIdentifier.set(identifier, {
            id: teacher.id,
            fullName: teacher.fullName,
            costCenter: teacher.costCenter,
            coordination: teacher.coordination,
          });
        }
      }
    }

    return courses
      .filter(
        (course) =>
          !isCourseExcludedFromReview({
            rawJson: course.rawJson,
            template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
            moodleCheck: course.moodleCheck,
          }),
      )
      .map((course) => {
        const identifiers = this.extractCourseTeacherIdentifiers({
          teacherId: course.teacherId,
          rawJson: course.rawJson,
        });
        const mappedTeacher = identifiers
          .map((identifier) => teacherByIdentifier.get(identifier) ?? null)
          .find((teacher): teacher is NonNullable<typeof teacher> => Boolean(teacher));
        const teacherName =
          mappedTeacher?.fullName ?? course.teacher?.fullName ?? 'Docente sin identificar';
        const coordinationName = mappedTeacher?.coordination ?? mappedTeacher?.costCenter ?? null;
        const coordinationLabel = coordinationName?.trim() || 'SIN_COORDINACION';
        const coordinationKey = normalizeProgramKey(coordinationLabel);

        const evaluation = course.evaluations.find((item) => item.phase === phase);
        return {
          periodCode: course.period.code,
          periodLabel: course.period.label ?? null,
          teacherName,
          nrc: course.nrc,
          subject: course.subjectName ?? '-',
          moment: course.moment ?? '-',
          status: course.moodleCheck?.status ?? 'SIN_CHECK',
          template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
          score: evaluation?.score ?? null,
          coordinationKey,
          coordinationName: coordinationLabel,
        };
      })
      .filter((row) => Boolean(row.coordinationKey));
  }

  private summarizeGlobalRows(
    rows: CourseCoordinationRow[],
    phase: GeneratePayload['phase'],
    selectedPeriodCodes: string[],
    selectedMoments: string[],
  ): {
    rowsSummary: GlobalSummaryRow[];
    periodSummary: GlobalPeriodSummaryRow[];
    momentSummary: GlobalMomentSummaryRow[];
    totalCourses: number;
    averageScore: number | null;
    excellent: number;
    good: number;
    acceptable: number;
    unsatisfactory: number;
  } {
    return summarizeGlobalRows(rows, phase, selectedPeriodCodes, selectedMoments);
  }

  private async collectGlobalRows(criteria: {
    periodCodes: string[];
    moments: SupportedMoment[];
    phase: GeneratePayload['phase'];
  }): Promise<CourseCoordinationRow[]> {
    const periods = await this.prisma.period.findMany({
      where: {
        code: {
          in: criteria.periodCodes,
        },
      },
      select: {
        id: true,
        code: true,
      },
      orderBy: {
        code: 'asc',
      },
    });
    if (!periods.length) return [];

    const rowsByCriteria = await Promise.all(
      periods.flatMap((period) =>
        criteria.moments.map((moment) =>
          this.buildCourseCoordinationRows(period.id, moment, criteria.phase),
        ),
      ),
    );

    return rowsByCriteria.flat();
  }

  private async generateTeacherOutbox(
    period: Period,
    payload: GeneratePayload,
  ) {
    const sampleGroups = await this.prisma.sampleGroup.findMany({
      where: {
        periodId: period.id,
        moment: payload.moment,
        teacherId: payload.teacherId,
      },
      include: {
        teacher: true,
        selectedCourse: {
          include: {
            teacher: true,
            moodleCheck: true,
            evaluations: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    if (!sampleGroups.length) {
      if (!payload.teacherId || !payload.moment) {
        return {
          ok: true,
          audience: 'DOCENTE',
          created: 0,
          reason: 'No hay grupos de muestreo para ese criterio.',
        };
      }

      const teacher = await this.prisma.teacher.findUnique({
        where: { id: payload.teacherId },
      });
      if (!teacher) {
        return {
          ok: true,
          audience: 'DOCENTE',
          created: 0,
          reason: `Docente ${payload.teacherId} no encontrado para regenerar correo sin muestreo.`,
        };
      }

      const courses = await this.prisma.course.findMany({
        where: {
          periodId: period.id,
          teacherId: teacher.id,
          moment: payload.moment,
        },
        include: {
          teacher: true,
          moodleCheck: true,
          evaluations: {
            where: {
              phase: payload.phase,
            },
          },
        },
        orderBy: [{ nrc: 'asc' }],
      });

      const filteredCourses = courses.filter((course) =>
        this.shouldIncludeTeacherReportCourse({
          rawJson: course.rawJson,
          templateDeclared: course.templateDeclared,
          moodleCheck: course.moodleCheck,
          evaluations: course.evaluations,
          phase: payload.phase,
        }),
      );
      if (!filteredCourses.length) {
        return {
          ok: true,
          audience: 'DOCENTE',
          created: 0,
          reason: `Docente ${teacher.fullName} sin cursos revisables en ${payload.moment}.`,
        };
      }

      const referenceIds = Array.from(
        new Set(
          filteredCourses
            .map((course) => course.evaluations[0]?.replicatedFromCourseId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const referencedCourses = referenceIds.length
        ? await this.prisma.course.findMany({
            where: { id: { in: referenceIds } },
            select: { id: true, nrc: true },
          })
        : [];
      const nrcByCourseId = new Map<string, string>();
      for (const course of filteredCourses) nrcByCourseId.set(course.id, course.nrc);
      for (const course of referencedCourses) nrcByCourseId.set(course.id, course.nrc);

      const rows = filteredCourses
        .map((course) => {
          const evaluation = course.evaluations[0];
          const replicatedFromCourseId = evaluation?.replicatedFromCourseId ?? null;
          const isReplicated = Boolean(replicatedFromCourseId);
          const resolvedProgram = resolveProgramValue({
            teacherCostCenter: course.teacher?.costCenter ?? teacher.costCenter ?? null,
            teacherLinked: !!course.teacherId,
            courseProgramCode: course.programCode,
            courseProgramName: course.programName,
          });

          return {
            nrc: course.nrc,
            reviewedNrc: replicatedFromCourseId
              ? (nrcByCourseId.get(replicatedFromCourseId) ?? course.nrc)
              : course.nrc,
            moodleCourseUrl: course.moodleCheck?.moodleCourseUrl ?? null,
            moment: course.moment ?? payload.moment ?? '1',
            resultType: isReplicated ? ('REPLICADO' as const) : ('REVISADO' as const),
            subject: course.subjectName ?? '-',
            program:
              resolvedProgram.programName ??
              resolvedProgram.programCode ??
              'SIN_PROGRAMA_VALIDADO',
            template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
            score: evaluation?.score ?? null,
            observations: evaluation?.observations?.trim() || 'Sin observaciones registradas.',
          };
        })
        .sort((left, right) => left.nrc.localeCompare(right.nrc));

      const subject = `[Seguimiento Aulas] ${payload.phase} ${payload.moment} - ${period.code}`;
      const htmlBody = this.buildTeacherHtml({
        teacherName: teacher.fullName,
        phase: payload.phase,
        moment: payload.moment,
        periodCode: period.code,
        rows,
      });

      await this.prisma.outboxMessage.deleteMany({
        where: {
          teacherId: teacher.id,
          periodId: period.id,
          phase: payload.phase,
          moment: payload.moment,
          audience: 'DOCENTE',
        },
      });

      const createdMessage = await this.prisma.outboxMessage.create({
        data: {
          audience: 'DOCENTE',
          teacherId: teacher.id,
          coordinatorId: null,
          programCode: teacher.costCenter ?? null,
          periodId: period.id,
          phase: payload.phase,
          moment: payload.moment,
          subject,
          recipientName: teacher.fullName,
          recipientEmail: teacherRecipientEmail(teacher),
          htmlBody,
          status: 'DRAFT',
        },
      });

      return {
        ok: true,
        audience: 'DOCENTE',
        created: 1,
        period: period.code,
        phase: payload.phase,
        moment: payload.moment,
        reason: 'Regenerado sin muestreo activo (fallback por cursos del docente).',
        createdMessages: [
          {
            id: createdMessage.id,
            teacherId: teacher.id,
            moment: payload.moment,
          },
        ],
      };
    }

    const buckets = new Map<string, typeof sampleGroups>();
    for (const group of sampleGroups) {
      const key = `${group.teacherId}|${group.moment}`;
      const current = buckets.get(key) ?? [];
      current.push(group);
      buckets.set(key, current);
    }

    let created = 0;
    const createdMessages: Array<{ id: string; teacherId: string; moment: string }> = [];
    for (const groups of buckets.values()) {
      const teacher = groups[0].teacher;
      const moment = groups[0].moment;
      const programCode = teacher.costCenter ?? groups[0].programCode;
      const selectedCourses = groups
        .map((group) => group.selectedCourse)
        .filter((course): course is NonNullable<typeof course> => Boolean(course));
      const selectedCourseIds = selectedCourses.map((course) => course.id);
      const selectedCourseIdSet = new Set(selectedCourseIds);
      const replicatedCourses = selectedCourseIds.length
        ? await this.prisma.course.findMany({
            where: {
              periodId: period.id,
              teacherId: teacher.id,
              moment,
              evaluations: {
                some: {
                  phase: payload.phase,
                  replicatedFromCourseId: {
                    in: selectedCourseIds,
                  },
                },
              },
            },
            include: {
              teacher: true,
              moodleCheck: true,
              evaluations: {
                where: {
                  phase: payload.phase,
                },
              },
            },
            orderBy: [{ nrc: 'asc' }],
          })
        : [];
      const groupByCourseId = new Map(
        groups
          .filter((group) => Boolean(group.selectedCourseId))
          .map((group) => [group.selectedCourseId as string, group]),
      );
      const coursesById = new Map<string, (typeof selectedCourses)[number]>();
      for (const course of selectedCourses) coursesById.set(course.id, course);
      for (const course of replicatedCourses) coursesById.set(course.id, course);
      const nrcByCourseId = new Map<string, string>();
      for (const course of coursesById.values()) nrcByCourseId.set(course.id, course.nrc);

      const rows = [...coursesById.values()]
        .filter((course) =>
          this.shouldIncludeTeacherReportCourse({
            rawJson: course.rawJson,
            templateDeclared: course.templateDeclared,
            moodleCheck: course.moodleCheck,
            evaluations: course.evaluations,
            phase: payload.phase,
          }),
        )
        .map((course) => {
          const evaluation = course.evaluations.find((item) => item.phase === payload.phase);
          const isSelectedCourse = selectedCourseIdSet.has(course.id);
          const parentSelectedCourseId =
            isSelectedCourse
              ? course.id
              : evaluation?.replicatedFromCourseId &&
                  selectedCourseIdSet.has(evaluation.replicatedFromCourseId)
                ? evaluation.replicatedFromCourseId
                : selectedCourseIds[0] ?? course.id;
          const parentGroup = groupByCourseId.get(parentSelectedCourseId);
          const isReplicated = !isSelectedCourse;
          const resolvedProgram = resolveProgramValue({
            teacherCostCenter: course.teacher?.costCenter ?? teacher.costCenter ?? null,
            teacherLinked: !!course.teacherId,
            courseProgramCode: course.programCode,
            courseProgramName: course.programName,
          });
          return {
            nrc: course.nrc,
            reviewedNrc: nrcByCourseId.get(parentSelectedCourseId) ?? course.nrc,
            moodleCourseUrl: course.moodleCheck?.moodleCourseUrl ?? null,
            moment: course.moment ?? moment,
            resultType: isReplicated ? ('REPLICADO' as const) : ('REVISADO' as const),
            subject: course.subjectName ?? '-',
            program:
              resolvedProgram.programName ??
              resolvedProgram.programCode ??
              (!course.teacherId ? (parentGroup?.programCode ?? groups[0].programCode) : 'SIN_PROGRAMA_VALIDADO'),
            template:
              course.moodleCheck?.detectedTemplate ??
              course.templateDeclared ??
              parentGroup?.template ??
              'UNKNOWN',
            score: evaluation?.score ?? null,
            observations: evaluation?.observations?.trim() || 'Sin observaciones registradas.',
          };
        })
        .sort((left, right) => left.nrc.localeCompare(right.nrc));

      if (!rows.length) continue;

      const subject = `[Seguimiento Aulas] ${payload.phase} ${moment} - ${period.code}`;
      const htmlBody = this.buildTeacherHtml({
        teacherName: teacher.fullName,
        phase: payload.phase,
        moment,
        periodCode: period.code,
        rows,
      });

      await this.prisma.outboxMessage.deleteMany({
        where: {
          teacherId: teacher.id,
          periodId: period.id,
          phase: payload.phase,
          moment,
          audience: 'DOCENTE',
        },
      });

      const createdMessage = await this.prisma.outboxMessage.create({
        data: {
          audience: 'DOCENTE',
          teacherId: teacher.id,
          coordinatorId: null,
          programCode,
          periodId: period.id,
          phase: payload.phase,
          moment,
          subject,
          recipientName: teacher.fullName,
          recipientEmail: teacherRecipientEmail(teacher),
          htmlBody,
          status: 'DRAFT',
        },
      });

      created += 1;
      createdMessages.push({
        id: createdMessage.id,
        teacherId: teacher.id,
        moment,
      });
    }

    return {
      ok: true,
      audience: 'DOCENTE',
      created,
      period: period.code,
      phase: payload.phase,
      moment: payload.moment ?? 'ALL',
      createdMessages,
    };
  }

  private async generateCoordinatorOutbox(
    period: Period,
    payload: GeneratePayload,
  ) {
    const coordinators = await this.prisma.coordinator.findMany({
      where: payload.coordinatorId ? { id: payload.coordinatorId } : undefined,
      orderBy: [{ programId: 'asc' }, { fullName: 'asc' }],
    });

    if (!coordinators.length) {
      return {
        ok: true,
        audience: 'COORDINADOR',
        created: 0,
        reason: payload.coordinatorId
          ? 'La coordinacion seleccionada no existe o no esta cargada.'
          : 'No hay coordinadores cargados. Importa el Excel con /import/teachers-xlsx.',
      };
    }

    const selectedPeriodCodes = this.normalizeGlobalSelectedPeriods(payload.periodCodes, period.code);
    const selectedMoments = normalizeMomentList(payload.moment, payload.moments);
    const effectiveMoments = selectedMoments.length
      ? selectedMoments
      : ([payload.moment ?? 'MD1'] as SupportedMoment[]);
    const coursesByCoordination = await this.collectGlobalRows({
      periodCodes: selectedPeriodCodes,
      moments: effectiveMoments,
      phase: payload.phase,
    });
    if (!coursesByCoordination.length) {
      return {
        ok: true,
        audience: 'COORDINADOR',
        created: 0,
        reason: 'No hay cursos para ese criterio.',
      };
    }

    let created = 0;
    const unmatchedCoordinators: string[] = [];
    const createdMessageIds: string[] = [];
    const previewItems: Array<{
      id: string;
      coordinatorId: string;
      programId: string;
      recipientName: string;
      recipientEmail: string | null;
      periodCodes: string[];
      moments: string[];
      courseCount: number;
      uniqueTeachers: number;
    }> = [];
    const momentLabel = effectiveMoments.join('+');

    for (const coordinator of coordinators) {
      const matches = coursesByCoordination.filter((course) => {
        const courseCoordinationKey = course.coordinationKey;
        if (!courseCoordinationKey) return false;
        return this.matchCoordinatorCourse(coordinator.programKey, courseCoordinationKey);
      }).sort((left, right) => {
        const periodCompare = left.periodCode.localeCompare(right.periodCode);
        if (periodCompare !== 0) return periodCompare;
        const teacherCompare = left.teacherName.localeCompare(right.teacherName);
        if (teacherCompare !== 0) return teacherCompare;
        const momentCompare = left.moment.localeCompare(right.moment);
        if (momentCompare !== 0) return momentCompare;
        return left.nrc.localeCompare(right.nrc);
      });

      if (!matches.length) {
        unmatchedCoordinators.push(coordinator.programId);
        continue;
      }

      const rows = matches.map((course) => ({
        periodCode: course.periodCode,
        teacherName: course.teacherName,
        nrc: course.nrc,
        subject: course.subject,
        moment: course.moment,
        status: course.status,
        template: course.template,
        score: course.score,
      }));

      const uniqueTeachers = new Set(rows.map((item) => item.teacherName)).size;
      const subject = `[Seguimiento Aulas] ${payload.phase} ${effectiveMoments
        .map((moment) => formatMomentLabel(moment))
        .join(' + ')} - CONSOLIDADO ${selectedPeriodCodes[0].slice(0, 4)} - ${coordinator.programId}`;
      const htmlBody = this.buildCoordinatorHtml({
        coordinatorName: coordinator.fullName,
        programId: coordinator.programId,
        phase: payload.phase,
        moments: effectiveMoments,
        periodCodes: selectedPeriodCodes,
        uniqueTeachers,
        rows,
      });

      await this.prisma.outboxMessage.deleteMany({
        where: {
          coordinatorId: coordinator.id,
          periodId: period.id,
          phase: payload.phase,
          moment: momentLabel,
          audience: 'COORDINADOR',
        },
      });

      const createdMessage = await this.prisma.outboxMessage.create({
        data: {
          audience: 'COORDINADOR',
          teacherId: null,
          coordinatorId: coordinator.id,
          programCode: this.encodeCoordinatorProgramMetadata(coordinator.programId, selectedPeriodCodes),
          periodId: period.id,
          phase: payload.phase,
          moment: momentLabel,
          subject,
          recipientName: coordinator.fullName,
          recipientEmail: coordinator.email,
          htmlBody,
          status: 'DRAFT',
        },
      });

      createdMessageIds.push(createdMessage.id);
      previewItems.push({
        id: createdMessage.id,
        coordinatorId: coordinator.id,
        programId: coordinator.programId,
        recipientName: coordinator.fullName,
        recipientEmail: coordinator.email,
        periodCodes: selectedPeriodCodes,
        moments: effectiveMoments,
        courseCount: rows.length,
        uniqueTeachers,
      });
      created += 1;
    }

    return {
      ok: true,
      audience: 'COORDINADOR',
      created,
      period: selectedPeriodCodes.join(', '),
      phase: payload.phase,
      moment: momentLabel,
      moments: effectiveMoments,
      periodCodes: selectedPeriodCodes,
      coordinatorId: payload.coordinatorId ?? null,
      createdMessageIds,
      previewItems,
      unmatchedCoordinators,
    };
  }

  private async generateGlobalOutbox(
    period: Period,
    payload: GeneratePayload,
  ) {
    const selectedPeriodCodes = this.normalizeGlobalSelectedPeriods(payload.periodCodes, period.code);
    const selectedMoments = normalizeMomentList(payload.moment, payload.moments);
    const effectiveMoments = selectedMoments.length ? selectedMoments : ([payload.moment ?? 'MD1'] as SupportedMoment[]);
    const rows = await this.collectGlobalRows({
      periodCodes: selectedPeriodCodes,
      moments: effectiveMoments,
      phase: payload.phase,
    });
    if (!rows.length) {
      return {
        ok: true,
        audience: 'GLOBAL',
        created: 0,
        reason: 'No hay cursos para ese criterio.',
      };
    }
    const summary = this.summarizeGlobalRows(rows, payload.phase, selectedPeriodCodes, effectiveMoments);
    const momentLabel = effectiveMoments.join('+');
    const subject = `[Seguimiento Aulas] GLOBAL ${payload.phase} ${effectiveMoments
      .map((moment) => formatMomentLabel(moment))
      .join(' + ')} - CONSOLIDADO ${selectedPeriodCodes[0].slice(0, 4)}`;
    const payloadRecipientEmails = normalizeRecipientEmails(payload.recipientEmails);
    const payloadRecipientEmail = payloadRecipientEmails.length ? payloadRecipientEmails.join('; ') : null;
    const recipientNameRaw = payload.recipientName?.trim() || process.env.OUTBOX_GLOBAL_RECIPIENT_NAME?.trim();
    const recipientEmailRaw = payloadRecipientEmail || process.env.OUTBOX_GLOBAL_RECIPIENT_EMAIL?.trim();
    const defaultTo = process.env.OUTBOX_DEFAULT_TO?.trim();
    const defaultCc = process.env.OUTBOX_DEFAULT_CC?.trim();
    const recipientName = recipientNameRaw || 'Equipo de Coordinacion Academica';
    const recipientEmail = recipientEmailRaw || defaultTo || defaultCc || null;
    const recipientsCount = parseStoredRecipientEmails(recipientEmail).length || (recipientEmail ? 1 : 0);
    const htmlBody = this.buildGlobalHtml({
      phase: payload.phase,
      moments: effectiveMoments,
      periodCodes: selectedPeriodCodes,
      totalCourses: summary.totalCourses,
      averageScore: summary.averageScore,
      excellent: summary.excellent,
      good: summary.good,
      acceptable: summary.acceptable,
      unsatisfactory: summary.unsatisfactory,
      rows: summary.rowsSummary,
      periodSummary: summary.periodSummary,
      momentSummary: summary.momentSummary,
      recipientsCount,
    });

    await this.prisma.outboxMessage.deleteMany({
      where: {
        audience: 'GLOBAL',
        periodId: period.id,
        phase: payload.phase,
        moment: momentLabel,
      },
    });

    const createdMessage = await this.prisma.outboxMessage.create({
      data: {
        audience: 'GLOBAL',
        teacherId: null,
        coordinatorId: null,
        programCode: selectedPeriodCodes.join('|'),
        periodId: period.id,
        phase: payload.phase,
        moment: momentLabel,
        subject,
        recipientName,
        recipientEmail,
        htmlBody,
        status: 'DRAFT',
      },
    });

    return {
      ok: true,
      audience: 'GLOBAL',
      created: 1,
      period: selectedPeriodCodes.join(', '),
      phase: payload.phase,
      moment: momentLabel,
      periodCodes: selectedPeriodCodes,
      moments: effectiveMoments,
      coordinations: summary.rowsSummary.length,
      totalCourses: summary.totalCourses,
      createdMessageIds: [createdMessage.id],
    };
  }

  async generate(rawPayload: unknown) {
    const parsedPayload = parseWithSchema(
      OutboxGenerateSchema,
      rawPayload,
      'outbox generate request',
    );
    const payload: GeneratePayload = {
      ...parsedPayload,
      audience: parsedPayload.audience ?? 'DOCENTE',
    };

    const period = await this.prisma.period.findUnique({ where: { code: payload.periodCode } });
    if (!period) {
      throw new NotFoundException(`No existe el periodo ${payload.periodCode}.`);
    }

    const selectedMoments = normalizeMomentList(payload.moment, payload.moments);
    if (payload.audience === 'DOCENTE' && selectedMoments.length > 1) {
      const batches = [];
      let created = 0;

      for (const selectedMoment of selectedMoments) {
        const batchPayload: GeneratePayload = {
          ...payload,
          moment: selectedMoment,
          moments: undefined,
        };
        const result = await this.generateTeacherOutbox(period, batchPayload);
        batches.push(result);
        created += Number(result?.created ?? 0);
      }

      return {
        ok: true,
        audience: payload.audience,
        period: period.code,
        phase: payload.phase,
        moments: selectedMoments,
        created,
        batches,
      };
    }

    if (selectedMoments.length === 1) {
      payload.moment = selectedMoments[0];
    }
    if (selectedMoments.length > 1) {
      payload.moments = selectedMoments;
    }

    if (payload.audience === 'COORDINADOR') {
      return this.generateCoordinatorOutbox(period, payload);
    }

    if (payload.audience === 'GLOBAL') {
      return this.generateGlobalOutbox(period, payload);
    }

    return this.generateTeacherOutbox(period, payload);
  }

  async export(rawPayload: unknown) {
    const payload = parseWithSchema(OutboxExportSchema, rawPayload, 'outbox export request');
    const outboxDir = this.resolveOutboxDir();
    await fs.mkdir(outboxDir, { recursive: true });

    const messages = await this.prisma.outboxMessage.findMany({
      where: payload.ids?.length
        ? { id: { in: payload.ids } }
        : {
            status: 'DRAFT',
          },
      include: {
        teacher: true,
        coordinator: true,
        period: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });

    const exported: Array<{ id: string; emlPath: string }> = [];

    for (const message of messages) {
      const to =
        message.recipientEmail ??
        message.teacher?.email ??
        message.coordinator?.email ??
        'sin-correo@invalid.local';
      const cc = process.env.OUTBOX_DEFAULT_CC || undefined;
      const eml = toEml({
        to,
        cc,
        subject: message.subject,
        html: message.htmlBody,
      });

      const filename = sanitizeForFilename(
        `${message.period.code}_${message.phase}_${message.moment}_${message.id}.eml`,
      );
      const absolutePath = path.join(outboxDir, filename);
      await fs.writeFile(absolutePath, eml, 'utf8');

      await this.prisma.outboxMessage.update({
        where: { id: message.id },
        data: {
          emlPath: absolutePath,
          status: 'EXPORTED',
        },
      });

      exported.push({ id: message.id, emlPath: absolutePath });
    }

    return {
      ok: true,
      exportedCount: exported.length,
      exported,
      outboxDir,
    };
  }

  private createSmtpTransport() {
    return createSmtpTransport();
  }

  private resolveDeliveryMode(): 'SMTP' | 'OUTLOOK' {
    return resolveDeliveryMode();
  }

  private parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
    return parsePositiveInt(raw, fallback, min, max);
  }

  private normalizeFingerprintToken(value: string | null | undefined): string {
    return normalizeFingerprintToken(value);
  }

  private buildSendFingerprint(input: {
    to: string;
    audience: string;
    periodCode: string;
    phase: string;
    moment: string;
    recipientName: string;
    scopeKey?: string | null;
  }): string {
    return buildSendFingerprint(input);
  }

  private async buildRecentSendFingerprintMap(since: Date): Promise<Map<string, Date>> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: 'OUTBOX_SEND_SENT',
        entityType: 'OUTBOX_MESSAGE',
        createdAt: { gte: since },
      },
      select: {
        entityId: true,
        details: true,
        createdAt: true,
      },
      take: 5000,
      orderBy: [{ createdAt: 'desc' }],
    });

    const fingerprints = new Map<string, Date>();
    const missing: Array<{ id: string; to: string; createdAt: Date }> = [];

    for (const log of logs) {
      const detail =
        log.details && typeof log.details === 'object' && !Array.isArray(log.details)
          ? (log.details as SendAuditLogDetail)
          : null;
      const rawFingerprint = detail?.fingerprint?.trim();
      if (rawFingerprint) {
        const normalized = this.normalizeFingerprintToken(rawFingerprint);
        const current = fingerprints.get(normalized);
        if (!current || log.createdAt > current) {
          fingerprints.set(normalized, log.createdAt);
        }
        continue;
      }

      const to = detail?.to?.trim();
      if (!to) continue;
      missing.push({ id: log.entityId, to, createdAt: log.createdAt });
    }

    if (!missing.length) return fingerprints;

    const messageIds = [...new Set(missing.map((item) => item.id))];
    const messages = await this.prisma.outboxMessage.findMany({
      where: { id: { in: messageIds } },
      include: { period: true, teacher: true, coordinator: true },
    });
    const messageById = new Map(messages.map((item) => [item.id, item]));

    for (const row of missing) {
      const message = messageById.get(row.id);
      if (!message) continue;
      const recipientName =
        message.recipientName ??
        message.teacher?.fullName ??
        message.coordinator?.fullName ??
        '';
      const fingerprint = this.buildSendFingerprint({
        to: row.to,
        audience: message.audience,
        periodCode: message.period.code,
        phase: message.phase,
        moment: message.moment,
        recipientName,
        scopeKey:
          message.audience === 'COORDINADOR'
            ? (message.programCode ?? message.coordinatorId ?? '')
            : message.audience === 'GLOBAL'
              ? (message.programCode ?? '')
              : (message.teacherId ?? ''),
      });
      const normalized = this.normalizeFingerprintToken(fingerprint);
      const current = fingerprints.get(normalized);
      if (!current || row.createdAt > current) {
        fingerprints.set(normalized, row.createdAt);
      }
    }

    return fingerprints;
  }

  private async collectTeacherReportRows(params: {
    periodId: string;
    teacherId: string;
    moment: GeneratePayload['moment'];
    phase: GeneratePayload['phase'];
  }): Promise<
    | {
        teacher: { fullName: string; email: string | null; email2: string | null; costCenter: string | null };
        programCode: string | null;
        rows: Array<{
          nrc: string;
          reviewedNrc: string;
          moodleCourseUrl?: string | null;
          moment: string;
          resultType: 'REVISADO' | 'REPLICADO';
          subject: string;
          program: string;
          template: string;
          score: number | null;
          observations: string;
        }>;
      }
    | null
  > {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id: params.teacherId },
      select: {
        id: true,
        fullName: true,
        email: true,
        email2: true,
        costCenter: true,
      },
    });
    if (!teacher) return null;

    const sampleGroups = await this.prisma.sampleGroup.findMany({
      where: {
        periodId: params.periodId,
        moment: params.moment,
        teacherId: params.teacherId,
      },
      include: {
        selectedCourse: {
          include: {
            teacher: true,
            moodleCheck: true,
            evaluations: {
              where: { phase: params.phase },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    if (!sampleGroups.length) {
      const courses = await this.prisma.course.findMany({
        where: {
          periodId: params.periodId,
          teacherId: params.teacherId,
          moment: params.moment,
        },
        include: {
          teacher: true,
          moodleCheck: true,
          evaluations: {
            where: { phase: params.phase },
          },
        },
        orderBy: [{ nrc: 'asc' }],
      });

      const filteredCourses = courses.filter((course) =>
        this.shouldIncludeTeacherReportCourse({
          rawJson: course.rawJson,
          templateDeclared: course.templateDeclared,
          moodleCheck: course.moodleCheck,
          evaluations: course.evaluations,
          phase: params.phase,
        }),
      );
      if (!filteredCourses.length) return null;

      const referenceIds = Array.from(
        new Set(
          filteredCourses
            .map((course) => course.evaluations[0]?.replicatedFromCourseId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const referencedCourses = referenceIds.length
        ? await this.prisma.course.findMany({
            where: { id: { in: referenceIds } },
            select: { id: true, nrc: true },
          })
        : [];
      const nrcByCourseId = new Map<string, string>();
      for (const course of filteredCourses) nrcByCourseId.set(course.id, course.nrc);
      for (const course of referencedCourses) nrcByCourseId.set(course.id, course.nrc);

      const rows = filteredCourses
        .map((course) => {
          const evaluation = course.evaluations[0];
          const replicatedFromCourseId = evaluation?.replicatedFromCourseId ?? null;
          const isReplicated = Boolean(replicatedFromCourseId);
          const resolvedProgram = resolveProgramValue({
            teacherCostCenter: course.teacher?.costCenter ?? teacher.costCenter ?? null,
            teacherLinked: !!course.teacherId,
            courseProgramCode: course.programCode,
            courseProgramName: course.programName,
          });

          return {
            nrc: course.nrc,
            reviewedNrc: replicatedFromCourseId
              ? (nrcByCourseId.get(replicatedFromCourseId) ?? course.nrc)
              : course.nrc,
            moodleCourseUrl: course.moodleCheck?.moodleCourseUrl ?? null,
            moment: course.moment ?? params.moment ?? '1',
            resultType: isReplicated ? ('REPLICADO' as const) : ('REVISADO' as const),
            subject: course.subjectName ?? '-',
            program:
              resolvedProgram.programName ??
              resolvedProgram.programCode ??
              'SIN_PROGRAMA_VALIDADO',
            template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
            score: evaluation?.score ?? null,
            observations: evaluation?.observations?.trim() || 'Sin observaciones registradas.',
          };
        })
        .sort((left, right) => left.nrc.localeCompare(right.nrc));

      return {
        teacher: {
          fullName: teacher.fullName,
          email: teacher.email,
          email2: teacher.email2 ?? null,
          costCenter: teacher.costCenter,
        },
        programCode: teacher.costCenter ?? null,
        rows,
      };
    }

    const selectedCourses = sampleGroups
      .map((group) => group.selectedCourse)
      .filter((course): course is NonNullable<typeof course> => Boolean(course));
    const selectedCourseIdSet = new Set(selectedCourses.map((course) => course.id));
    const selectedCourseIds = [...selectedCourseIdSet];
    const replicatedCourses = selectedCourseIds.length
      ? await this.prisma.course.findMany({
          where: {
            periodId: params.periodId,
            teacherId: params.teacherId,
            moment: params.moment,
            evaluations: {
              some: {
                phase: params.phase,
                replicatedFromCourseId: {
                  in: selectedCourseIds,
                },
              },
            },
          },
          include: {
            teacher: true,
            moodleCheck: true,
            evaluations: {
              where: { phase: params.phase },
            },
          },
          orderBy: [{ nrc: 'asc' }],
        })
      : [];
    const groupByCourseId = new Map(
      sampleGroups
        .filter((group) => Boolean(group.selectedCourseId))
        .map((group) => [group.selectedCourseId as string, group]),
    );
    const coursesById = new Map<string, (typeof selectedCourses)[number]>();
    for (const course of selectedCourses) coursesById.set(course.id, course);
    for (const course of replicatedCourses) coursesById.set(course.id, course);
    const nrcByCourseId = new Map<string, string>();
    for (const course of coursesById.values()) nrcByCourseId.set(course.id, course.nrc);

    const rows = [...coursesById.values()]
      .filter((course) =>
        this.shouldIncludeTeacherReportCourse({
          rawJson: course.rawJson,
          templateDeclared: course.templateDeclared,
          moodleCheck: course.moodleCheck,
          evaluations: course.evaluations,
          phase: params.phase,
        }),
      )
      .map((course) => {
        const evaluation = course.evaluations.find((item) => item.phase === params.phase);
        const isSelectedCourse = selectedCourseIdSet.has(course.id);
        const parentSelectedCourseId =
          isSelectedCourse
            ? course.id
            : evaluation?.replicatedFromCourseId &&
                selectedCourseIdSet.has(evaluation.replicatedFromCourseId)
              ? evaluation.replicatedFromCourseId
              : selectedCourseIds[0] ?? course.id;
        const parentGroup = groupByCourseId.get(parentSelectedCourseId);
        const isReplicated = !isSelectedCourse;
        const resolvedProgram = resolveProgramValue({
          teacherCostCenter: course.teacher?.costCenter ?? teacher.costCenter ?? null,
          teacherLinked: !!course.teacherId,
          courseProgramCode: course.programCode,
          courseProgramName: course.programName,
        });
        return {
          nrc: course.nrc,
          reviewedNrc: nrcByCourseId.get(parentSelectedCourseId) ?? course.nrc,
          moodleCourseUrl: course.moodleCheck?.moodleCourseUrl ?? null,
          moment: course.moment ?? params.moment ?? '1',
          resultType: isReplicated ? ('REPLICADO' as const) : ('REVISADO' as const),
          subject: course.subjectName ?? '-',
          program:
            resolvedProgram.programName ??
            resolvedProgram.programCode ??
            (!course.teacherId ? (parentGroup?.programCode ?? sampleGroups[0].programCode) : 'SIN_PROGRAMA_VALIDADO'),
          template:
            course.moodleCheck?.detectedTemplate ??
            course.templateDeclared ??
            parentGroup?.template ??
            'UNKNOWN',
          score: evaluation?.score ?? null,
          observations: evaluation?.observations?.trim() || 'Sin observaciones registradas.',
        };
      })
      .sort((left, right) => left.nrc.localeCompare(right.nrc));

    if (!rows.length) return null;

    return {
      teacher: {
        fullName: teacher.fullName,
        email: teacher.email,
        email2: teacher.email2 ?? null,
        costCenter: teacher.costCenter,
      },
      programCode: teacher.costCenter ?? sampleGroups[0]?.programCode ?? null,
      rows,
    };
  }

  private async buildTeacherMessageContent(message: {
    teacherId: string | null;
    periodId: string;
    periodCode: string;
    phase: string;
    moment: string;
  }): Promise<{
    subject: string;
    htmlBody: string;
    recipientName: string;
    recipientEmail: string | null;
    programCode: string | null;
  } | null> {
    if (!message.teacherId) return null;
    if (!isSupportedMoment(message.moment)) {
      return null;
    }
    if (!message.phase || !['ALISTAMIENTO', 'EJECUCION'].includes(message.phase)) {
      return null;
    }

    const rowsPayload = await this.collectTeacherReportRows({
      periodId: message.periodId,
      teacherId: message.teacherId,
      moment: message.moment as GeneratePayload['moment'],
      phase: message.phase as GeneratePayload['phase'],
    });
    if (!rowsPayload || !rowsPayload.rows.length) return null;

    const subject = `[Seguimiento Aulas] ${message.phase} ${message.moment} - ${message.periodCode}`;
    const htmlBody = this.buildTeacherHtml({
      teacherName: rowsPayload.teacher.fullName,
      phase: message.phase,
      moment: message.moment,
      periodCode: message.periodCode,
      rows: rowsPayload.rows,
    });

    return {
      subject,
      htmlBody,
      recipientName: rowsPayload.teacher.fullName,
      recipientEmail: rowsPayload.teacher.email,
      programCode: rowsPayload.programCode,
    };
  }

  private async refreshGeneratedMessageForSend(message: {
    id: string;
    audience: string;
    teacherId: string | null;
    coordinatorId: string | null;
    programCode: string | null;
    periodId: string;
    periodCode: string;
    phase: string;
    moment: string;
    recipientName?: string | null;
    recipientEmail?: string | null;
    htmlBody?: string | null;
  }): Promise<{
    subject: string;
    htmlBody: string;
    recipientName: string;
    recipientEmail: string | null;
    programCode?: string | null;
  } | null> {
    const refreshed =
      message.audience === 'DOCENTE'
        ? await this.buildTeacherMessageContent({
            teacherId: message.teacherId,
            periodId: message.periodId,
            periodCode: message.periodCode,
            phase: message.phase,
            moment: message.moment,
          })
        : message.audience === 'COORDINADOR'
          ? await this.buildCoordinatorMessageContent({
              coordinatorId: message.coordinatorId,
              periodId: message.periodId,
              periodCode: message.periodCode,
              phase: message.phase,
              moment: message.moment,
              programCode: message.programCode,
            })
          : message.audience === 'GLOBAL'
            ? await this.buildGlobalMessageContent({
                periodId: message.periodId,
                periodCode: message.periodCode,
                phase: message.phase,
                moment: message.moment,
                recipientName: message.recipientName,
                recipientEmail: message.recipientEmail,
                programCode: message.programCode,
                htmlBody: message.htmlBody,
              })
            : null;
    if (!refreshed) return null;

    await this.prisma.outboxMessage.update({
      where: { id: message.id },
      data: {
        subject: refreshed.subject,
        recipientName: refreshed.recipientName,
        recipientEmail: refreshed.recipientEmail,
        programCode: refreshed.programCode ?? message.programCode,
        htmlBody: refreshed.htmlBody,
        status: 'DRAFT',
      },
    });

    return {
      subject: refreshed.subject,
      htmlBody: refreshed.htmlBody,
      recipientName: refreshed.recipientName,
      recipientEmail: refreshed.recipientEmail,
      programCode: refreshed.programCode ?? message.programCode,
    };
  }

  private async sendViaOutlook(candidates: SendCandidate[]) {
    const powershellScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { throw 'No se recibio payload para envio Outlook.' }
$payload = $raw | ConvertFrom-Json
$outlook = New-Object -ComObject Outlook.Application
$sent = @()
$failed = @()
foreach ($item in $payload) {
  try {
    $mail = $outlook.CreateItem(0)
    $mail.To = [string]$item.to
    if ($null -ne $item.cc -and [string]::IsNullOrWhiteSpace([string]$item.cc) -eq $false) { $mail.CC = [string]$item.cc }
    $mail.Subject = [string]$item.subject
    $mail.HTMLBody = [string]$item.htmlBody
    $mail.Send()
    $sent += [PSCustomObject]@{ id = [string]$item.id; to = [string]$item.to; messageId = $null }
  } catch {
    $failed += [PSCustomObject]@{ id = [string]$item.id; to = [string]$item.to; error = $_.Exception.Message }
  }
}
[PSCustomObject]@{ sent = $sent; failed = $failed } | ConvertTo-Json -Compress -Depth 8
`;

    const inputPayload = candidates.map((item) => ({
      id: item.id,
      to: parseStoredRecipientEmails(item.to).join('; ') || item.to,
      cc: parseStoredRecipientEmails(item.cc).join('; '),
      subject: item.subject,
      htmlBody: item.htmlBody,
    }));

    const result = await new Promise<{ sent: Array<{ id: string; to: string; messageId: string | null }>; failed: Array<{ id: string; to: string; error: string }> }>(
      (resolve, reject) => {
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershellScript],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        );

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        child.on('error', (error) => {
          reject(
            new BadRequestException(
              `No fue posible invocar Outlook local (powershell.exe). ${error.message}`,
            ),
          );
        });

        child.on('close', (code) => {
          if (code !== 0) {
            reject(
              new BadRequestException(
                `Envio por Outlook fallo (code ${code}). ${stderr || stdout || 'Sin detalle.'}`,
              ),
            );
            return;
          }

          try {
            const parsed = JSON.parse(stdout || '{}') as {
              sent?: Array<{ id: string; to: string; messageId: string | null }>;
              failed?: Array<{ id: string; to: string; error: string }>;
            };
            resolve({
              sent: parsed.sent ?? [],
              failed: parsed.failed ?? [],
            });
          } catch (error) {
            const parseMessage = error instanceof Error ? error.message : String(error);
            reject(
              new BadRequestException(
                `No se pudo interpretar la respuesta de Outlook. ${parseMessage}. Raw: ${stdout || '(vacio)'}`,
              ),
            );
          }
        });

        child.stdin.write(Buffer.from(JSON.stringify(inputPayload), 'utf8'));
        child.stdin.end();
      },
    );

    return result;
  }

  async queueCierre(rawPayload: unknown) {
    const payload = parseWithSchema(OutboxQueueCierreSchema, rawPayload, 'outbox queue cierre');

    const period = await this.prisma.period.findUnique({ where: { code: payload.periodCode } });
    if (!period) {
      throw new NotFoundException(`No existe el periodo ${payload.periodCode}.`);
    }

    const momentKey = `CIERRE_${payload.moment}`;
    const audienceKey = `CIERRE_${payload.audience}`;

    if (payload.dryRun) {
      return {
        ok: true,
        dryRun: true,
        wouldCreate: payload.items.length,
        items: payload.items.map((item) => ({
          recipientName: item.recipientName,
          recipientEmail: item.recipientEmail ?? null,
          subject: item.subject,
        })),
      };
    }

    // Eliminar borradores previos del mismo cierre
    await this.prisma.outboxMessage.deleteMany({
      where: {
        periodId: period.id,
        phase: 'CIERRE',
        moment: momentKey,
        audience: audienceKey,
      },
    });

    const createdMessageIds: string[] = [];
    for (const item of payload.items) {
      const msg = await this.prisma.outboxMessage.create({
        data: {
          audience: audienceKey,
          teacherId: item.teacherId ?? null,
          coordinatorId: item.coordinatorId ?? null,
          programCode: null,
          periodId: period.id,
          phase: 'CIERRE',
          moment: momentKey,
          subject: item.subject,
          recipientName: item.recipientName,
          recipientEmail: item.recipientEmail ?? null,
          cc: item.cc ?? null,
          htmlBody: item.htmlBody,
          status: 'DRAFT',
        },
      });
      createdMessageIds.push(msg.id);
    }

    return {
      ok: true,
      created: createdMessageIds.length,
      createdMessageIds,
      periodCode: period.code,
      moment: momentKey,
      audience: audienceKey,
    };
  }

  async send(rawPayload: unknown) {
    const parsedPayload = parseWithSchema(OutboxSendSchema, rawPayload, 'outbox send request');
    const payload: SendPayload = {
      ...parsedPayload,
      dryRun: parsedPayload.dryRun ?? false,
      limit: parsedPayload.limit ?? 300,
    };
    const selectedMoments = normalizeMomentList(payload.moment, payload.moments);
    const selectedPeriodCodes = normalizePeriodCodeList(payload.periodCode, payload.periodCodes);
    const selectedMomentFilters = this.buildSendMomentFilterValues(selectedMoments);

    const where = payload.ids?.length
      ? {
          id: {
            in: payload.ids,
          },
        }
      : {
          status: payload.status ?? 'DRAFT',
          period: selectedPeriodCodes.length
            ? {
                code: selectedPeriodCodes.length > 1 ? { in: selectedPeriodCodes } : selectedPeriodCodes[0],
              }
            : undefined,
          phase: payload.phase,
          moment:
            selectedMomentFilters.length > 1
              ? {
                  in: selectedMomentFilters,
                }
              : (selectedMomentFilters[0] ?? payload.moment),
          audience: payload.audience,
          coordinatorId: payload.coordinatorId,
        };

    const messages = await this.prisma.outboxMessage.findMany({
      where,
      include: {
        teacher: true,
        coordinator: true,
        period: true,
      },
      orderBy: { createdAt: 'asc' },
      take: payload.limit,
    });

    if (!messages.length) {
      return {
        ok: true,
        dryRun: payload.dryRun,
        sentCount: 0,
        failedCount: 0,
        reason: 'No hay mensajes para enviar con el filtro indicado.',
      };
    }

    const shouldRefreshTeacherHtml = parseEnvBoolean(
      process.env.OUTBOX_REFRESH_DOCENTE_HTML_ON_SEND,
      true,
    );
    if (shouldRefreshTeacherHtml) {
      for (const message of messages) {
        const refreshed = await this.refreshGeneratedMessageForSend({
          id: message.id,
          audience: message.audience,
          teacherId: message.teacherId,
          coordinatorId: message.coordinatorId,
          programCode: message.programCode,
          periodId: message.periodId,
          periodCode: message.period.code,
          phase: message.phase,
          moment: message.moment,
          recipientName: message.recipientName,
          recipientEmail: message.recipientEmail,
          htmlBody: message.htmlBody,
        });
        if (!refreshed) continue;
        message.subject = refreshed.subject;
        message.htmlBody = refreshed.htmlBody;
        message.recipientName = refreshed.recipientName;
        message.recipientEmail = refreshed.recipientEmail;
      }
    }

    const defaultCc = process.env.OUTBOX_DEFAULT_CC?.trim() || undefined;
    const candidates: SendCandidate[] = messages.map((message) => {
      const originalTo =
        message.recipientEmail ??
        message.teacher?.email ??
        message.coordinator?.email ??
        'sin-correo@invalid.local';
      const to = payload.forceTo?.trim() || originalTo;
      const recipientName =
        message.recipientName ??
        message.teacher?.fullName ??
        message.coordinator?.fullName ??
        'Sin nombre';
      const fingerprint = this.buildSendFingerprint({
        to,
        audience: message.audience,
        periodCode: message.period.code,
        phase: message.phase,
        moment: message.moment,
        recipientName,
        scopeKey:
          message.audience === 'COORDINADOR'
            ? (message.programCode ?? message.coordinatorId ?? '')
            : message.audience === 'GLOBAL'
              ? (message.programCode ?? '')
              : (message.teacherId ?? ''),
      });

      const messageCc = (message as any).cc as string | null | undefined;
      const resolvedCc = [messageCc, defaultCc].filter(Boolean).join(', ') || undefined;
      return {
        id: message.id,
        originalTo,
        to,
        cc: resolvedCc,
        recipientName,
        fingerprint,
        messageCreatedAt: message.createdAt,
        subject: message.subject,
        htmlBody: message.htmlBody,
        audience: message.audience,
        periodCode: message.period.code,
        periodId: message.periodId,
        phase: message.phase,
        moment: message.moment,
        teacherId: message.teacherId ?? undefined,
        coordinatorId: message.coordinatorId ?? undefined,
      };
    });

    if (payload.dryRun) {
      return {
        ok: true,
        dryRun: true,
        candidates: candidates.length,
        preview: candidates.slice(0, 20).map((item) => ({
          id: item.id,
          to: item.to,
          originalTo: item.originalTo,
          forceToApplied: Boolean(payload.forceTo?.trim()),
          cc: item.cc ?? null,
          subject: item.subject,
          periodCode: item.periodCode,
          phase: item.phase,
          moment: item.moment,
          audience: item.audience,
        })),
      };
    }

    const sent: Array<{ id: string; to: string; messageId: string | null }> = [];
    const failed: Array<{ id: string; to: string; error: string }> = [];
    const skipped: Array<{ id: string; to: string; error: string }> = [];
    const deliveryMode = this.resolveDeliveryMode();
    const validCandidates = candidates.filter((item) => item.to && item.to !== 'sin-correo@invalid.local');
    for (const item of candidates) {
      if (!item.to || item.to === 'sin-correo@invalid.local') {
        failed.push({
          id: item.id,
          to: item.to || '(sin destinatario)',
          error: 'Mensaje sin correo destino valido.',
        });
      }
    }

    const dedupeWindowMinutes = this.parsePositiveInt(
      process.env.OUTBOX_SEND_DEDUPE_WINDOW_MINUTES,
      45,
      0,
      1440,
    );
    let deliverableCandidates = validCandidates;
    if (dedupeWindowMinutes > 0 && validCandidates.length) {
      const since = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000);
      const recentFingerprints = await this.buildRecentSendFingerprintMap(since);
      const orderedCandidates = [...validCandidates].sort((left, right) => {
        const createdDiff = right.messageCreatedAt.getTime() - left.messageCreatedAt.getTime();
        if (createdDiff !== 0) return createdDiff;
        return left.id.localeCompare(right.id, 'es');
      });
      const filtered: SendCandidate[] = [];
      for (const item of orderedCandidates) {
        const normalizedFingerprint = this.normalizeFingerprintToken(item.fingerprint);
        const lastSentAt = recentFingerprints.get(normalizedFingerprint);
        if (lastSentAt && item.messageCreatedAt.getTime() <= lastSentAt.getTime()) {
          skipped.push({
            id: item.id,
            to: item.to,
            error: `Bloqueado por duplicado reciente (${dedupeWindowMinutes} min).`,
          });
          continue;
        }
        recentFingerprints.set(normalizedFingerprint, item.messageCreatedAt);
        filtered.push(item);
      }
      deliverableCandidates = filtered;
    }

    if (deliveryMode === 'OUTLOOK') {
      const outlookResult = await this.sendViaOutlook(deliverableCandidates);
      sent.push(...outlookResult.sent);
      failed.push(...outlookResult.failed);
    } else {
      const { transporter, from, replyTo } = this.createSmtpTransport();
      await transporter.verify();

      for (const item of deliverableCandidates) {
        try {
          const info = await transporter.sendMail({
            from,
            to: parseStoredRecipientEmails(item.to).join(', ') || item.to.replace(/;\s*/g, ', '),
            cc: parseStoredRecipientEmails(item.cc).join(', ') || item.cc,
            replyTo,
            subject: item.subject,
            html: item.htmlBody,
          });

          sent.push({
            id: item.id,
            to: item.to,
            messageId: info.messageId ?? null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failed.push({
            id: item.id,
            to: item.to,
            error: message,
          });
        }
      }

      transporter.close();
    }

    if (sent.length) {
      await this.prisma.outboxMessage.updateMany({
        where: {
          id: {
            in: sent.map((item) => item.id),
          },
        },
        data: {
          status: 'SENT_AUTO',
        },
      });
    }

    if (sent.length || failed.length || skipped.length) {
      const candidateById = new Map(candidates.map((item) => [item.id, item]));
      const auditRows = [
        ...sent.map((item) => ({
          actor: 'SYSTEM',
          action: 'OUTBOX_SEND_SENT',
          entityType: 'OUTBOX_MESSAGE',
          entityId: item.id,
          details: {
            to: item.to,
            messageId: item.messageId,
            deliveryMode,
            forceToApplied: Boolean(payload.forceTo?.trim()),
            recipientName: candidateById.get(item.id)?.recipientName,
            fingerprint: candidateById.get(item.id)?.fingerprint,
          } satisfies SendAuditLogDetail,
        })),
        ...failed.map((item) => ({
          actor: 'SYSTEM',
          action: 'OUTBOX_SEND_FAILED',
          entityType: 'OUTBOX_MESSAGE',
          entityId: item.id,
          details: {
            to: item.to,
            error: item.error,
            deliveryMode,
            forceToApplied: Boolean(payload.forceTo?.trim()),
            recipientName: candidateById.get(item.id)?.recipientName,
            fingerprint: candidateById.get(item.id)?.fingerprint,
          } satisfies SendAuditLogDetail,
        })),
        ...skipped.map((item) => ({
          actor: 'SYSTEM',
          action: 'OUTBOX_SEND_SKIPPED_DUPLICATE',
          entityType: 'OUTBOX_MESSAGE',
          entityId: item.id,
          details: {
            to: item.to,
            error: item.error,
            deliveryMode,
            forceToApplied: Boolean(payload.forceTo?.trim()),
            recipientName: candidateById.get(item.id)?.recipientName,
            fingerprint: candidateById.get(item.id)?.fingerprint,
          } satisfies SendAuditLogDetail,
        })),
      ];

      await this.prisma.auditLog.createMany({
        data: auditRows,
      });
    }

    return {
      ok: failed.length === 0,
      dryRun: false,
      deliveryMode,
      sentCount: sent.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
      sent,
      failed,
      skipped,
    };
  }

  async resendUpdated(rawPayload: unknown) {
    const payload = parseWithSchema(
      OutboxResendUpdatedSchema,
      rawPayload,
      'outbox resend-updated request',
    );

    const original = await this.prisma.outboxMessage.findUnique({
      where: { id: payload.id },
      include: {
        period: true,
        teacher: true,
      },
    });
    if (!original) {
      throw new NotFoundException(`No existe mensaje outbox con id ${payload.id}.`);
    }
    if (original.audience !== 'DOCENTE' || !original.teacherId || !original.teacher) {
      throw new BadRequestException(
        'Reenvio actualizado solo aplica a correos de audiencia DOCENTE.',
      );
    }
    if (!isSupportedMoment(original.moment)) {
      throw new BadRequestException(
        `Momento invalido en mensaje ${payload.id}: ${original.moment}.`,
      );
    }
    if (!original.phase || !['ALISTAMIENTO', 'EJECUCION'].includes(original.phase)) {
      throw new BadRequestException(
        `Fase invalida en mensaje ${payload.id}: ${original.phase}.`,
      );
    }

    const regenerationStartedAt = new Date();
    const regeneration = await this.generateTeacherOutbox(original.period, {
      periodCode: original.period.code,
      phase: original.phase as 'ALISTAMIENTO' | 'EJECUCION',
      moment: original.moment,
      audience: 'DOCENTE',
      teacherId: original.teacherId,
    });
    if ((regeneration.created ?? 0) <= 0) {
      throw new NotFoundException(
        `No se genero correo actualizado para docente ${original.teacher.fullName} (${original.period.code} ${original.moment}).`,
      );
    }

    const refreshed = await this.prisma.outboxMessage.findFirst({
      where: {
        audience: 'DOCENTE',
        teacherId: original.teacherId,
        periodId: original.periodId,
        phase: original.phase,
        moment: original.moment,
        updatedAt: {
          gte: regenerationStartedAt,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!refreshed) {
      throw new NotFoundException(
        `No se pudo regenerar el correo para docente ${original.teacher.fullName}.`,
      );
    }

    await this.prisma.auditLog.create({
      data: {
        actor: 'SYSTEM',
        action: 'OUTBOX_REGENERATED',
        entityType: 'OUTBOX_MESSAGE',
        entityId: refreshed.id,
        details: {
          fromMessageId: original.id,
          teacherId: original.teacherId,
          periodCode: original.period.code,
          phase: original.phase,
          moment: original.moment,
          forceToApplied: Boolean(payload.forceTo?.trim()),
        },
      },
    });

    if (payload.dryRun) {
      return {
        ok: true,
        dryRun: true,
        regeneratedMessageId: refreshed.id,
        teacherId: original.teacherId,
        teacherName: original.teacher.fullName,
        periodCode: original.period.code,
        phase: original.phase,
        moment: original.moment,
      };
    }

    const sendResult = await this.send({
      ids: [refreshed.id],
      forceTo: payload.forceTo?.trim(),
      dryRun: false,
    });

    return {
      ok: sendResult.ok,
      regeneratedMessageId: refreshed.id,
      teacherId: original.teacherId,
      teacherName: original.teacher.fullName,
      periodCode: original.period.code,
      phase: original.phase,
      moment: original.moment,
      sendResult,
    };
  }

  async resendByCourse(rawPayload: unknown) {
    const payload = parseWithSchema(
      OutboxResendByCourseSchema,
      rawPayload,
      'outbox resend-by-course request',
    );

    const course = await this.prisma.course.findUnique({
      where: { id: payload.courseId },
      include: {
        period: true,
        teacher: true,
      },
    });
    if (!course) {
      throw new NotFoundException(`No existe curso con id ${payload.courseId}.`);
    }
    if (!course.teacherId || !course.teacher) {
      throw new BadRequestException(
        `El curso ${course.nrc} no tiene docente vinculado. No se puede reenviar reporte.`,
      );
    }

    const moment = (course.moment ?? '').trim().toUpperCase();
    if (!isSupportedMoment(moment)) {
      throw new BadRequestException(`Momento invalido en curso ${course.nrc}: ${course.moment}.`);
    }
    const phase: 'ALISTAMIENTO' | 'EJECUCION' = payload.phase ?? 'ALISTAMIENTO';

    const regenerationStartedAt = new Date();
    const regeneration = await this.generateTeacherOutbox(course.period, {
      periodCode: course.period.code,
      phase,
      moment,
      audience: 'DOCENTE',
      teacherId: course.teacherId,
    });
    if ((regeneration.created ?? 0) <= 0) {
      throw new NotFoundException(
        `No se genero correo actualizado para docente ${course.teacher.fullName} en ${course.period.code} ${moment}.`,
      );
    }

    const refreshed = await this.prisma.outboxMessage.findFirst({
      where: {
        audience: 'DOCENTE',
        teacherId: course.teacherId,
        periodId: course.periodId,
        phase,
        moment,
        updatedAt: {
          gte: regenerationStartedAt,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!refreshed) {
      throw new NotFoundException(
        `No se pudo regenerar el correo para docente ${course.teacher.fullName}.`,
      );
    }

    await this.prisma.auditLog.create({
      data: {
        actor: 'SYSTEM',
        action: 'OUTBOX_REGENERATED_BY_COURSE',
        entityType: 'OUTBOX_MESSAGE',
        entityId: refreshed.id,
        details: {
          courseId: course.id,
          nrc: course.nrc,
          teacherId: course.teacherId,
          teacherName: course.teacher.fullName,
          periodCode: course.period.code,
          phase,
          moment,
          forceToApplied: Boolean(payload.forceTo?.trim()),
        },
      },
    });

    if (payload.dryRun) {
      return {
        ok: true,
        dryRun: true,
        regeneratedMessageId: refreshed.id,
        courseId: course.id,
        nrc: course.nrc,
        teacherId: course.teacherId,
        teacherName: course.teacher.fullName,
        periodCode: course.period.code,
        phase,
        moment,
      };
    }

    const sendResult = await this.send({
      ids: [refreshed.id],
      forceTo: payload.forceTo?.trim(),
      dryRun: false,
    });

    return {
      ok: sendResult.ok,
      regeneratedMessageId: refreshed.id,
      courseId: course.id,
      nrc: course.nrc,
      teacherId: course.teacherId,
      teacherName: course.teacher.fullName,
      periodCode: course.period.code,
      phase,
      moment,
      sendResult,
    };
  }

  async previewByCourse(rawPayload: unknown) {
    const payload = parseWithSchema(
      OutboxPreviewByCourseSchema,
      rawPayload,
      'outbox preview-by-course request',
    );

    const course = await this.prisma.course.findUnique({
      where: { id: payload.courseId },
      include: {
        period: true,
        teacher: true,
      },
    });
    if (!course) {
      throw new NotFoundException(`No existe curso con id ${payload.courseId}.`);
    }
    if (!course.teacherId || !course.teacher) {
      throw new BadRequestException(
        `El curso ${course.nrc} no tiene docente vinculado. No se puede generar preview.`,
      );
    }

    const moment = (course.moment ?? '').trim().toUpperCase();
    if (!isSupportedMoment(moment)) {
      throw new BadRequestException(`Momento invalido en curso ${course.nrc}: ${course.moment}.`);
    }
    const phase: 'ALISTAMIENTO' | 'EJECUCION' = payload.phase ?? 'ALISTAMIENTO';

    const preview = await this.buildTeacherMessageContent({
      teacherId: course.teacherId,
      periodId: course.periodId,
      periodCode: course.period.code,
      phase,
      moment,
    });
    if (!preview) {
      throw new NotFoundException(
        `No se pudo generar preview para docente ${course.teacher.fullName} en ${course.period.code} ${moment}.`,
      );
    }

    return {
      id: `preview-course-${course.id}-${phase}-${moment}`,
      subject: preview.subject,
      htmlBody: preview.htmlBody,
      recipientName: preview.recipientName,
      recipientEmail: preview.recipientEmail,
      status: 'PREVIEW',
      phase,
      moment,
      audience: 'DOCENTE',
      periodCode: course.period.code,
      periodLabel: course.period.label,
      updatedAt: new Date().toISOString(),
      courseId: course.id,
      nrc: course.nrc,
      teacherId: course.teacherId,
      teacherName: course.teacher.fullName,
    };
  }

  async preview(id: string) {
    const message = await this.prisma.outboxMessage.findUnique({
      where: { id },
      include: {
        teacher: true,
        coordinator: true,
        period: true,
      },
    });

    if (!message) {
      throw new NotFoundException(`No existe el mensaje outbox ${id}.`);
    }

    let subject = message.subject;
    let htmlBody = message.htmlBody;
    let recipientName =
      message.recipientName ??
      message.teacher?.fullName ??
      message.coordinator?.fullName ??
      null;
    let recipientEmail =
      message.recipientEmail ??
      message.teacher?.email ??
      message.coordinator?.email ??
      null;

    const refreshed =
      message.audience === 'DOCENTE'
        ? await this.buildTeacherMessageContent({
            teacherId: message.teacherId,
            periodId: message.periodId,
            periodCode: message.period.code,
            phase: message.phase,
            moment: message.moment,
          })
        : message.audience === 'COORDINADOR'
          ? await this.buildCoordinatorMessageContent({
              coordinatorId: message.coordinatorId,
              periodId: message.periodId,
              periodCode: message.period.code,
              phase: message.phase,
              moment: message.moment,
              programCode: message.programCode,
            })
          : message.audience === 'GLOBAL'
            ? await this.buildGlobalMessageContent({
                periodId: message.periodId,
                periodCode: message.period.code,
                phase: message.phase,
                moment: message.moment,
                recipientName: message.recipientName,
                recipientEmail: message.recipientEmail,
                programCode: message.programCode,
                htmlBody: message.htmlBody,
              })
            : null;

    if (refreshed) {
      subject = refreshed.subject;
      htmlBody = refreshed.htmlBody;
      recipientName = refreshed.recipientName;
      recipientEmail = refreshed.recipientEmail;
    }

    return {
      id: message.id,
      subject,
      htmlBody,
      recipientName,
      recipientEmail,
      status: message.status,
      phase: message.phase,
      moment: message.moment,
      audience: message.audience,
      periodCode: message.period.code,
      periodLabel: message.period.label,
      updatedAt: message.updatedAt,
    };
  }

  async options(yearPrefix = String(new Date().getFullYear())) {
    const [periods, coordinators] = await this.prisma.$transaction([
      this.prisma.period.findMany({
        where: yearPrefix.trim()
          ? {
              code: {
                startsWith: yearPrefix.trim(),
              },
            }
          : undefined,
        orderBy: { code: 'asc' },
        select: {
          code: true,
          label: true,
          modality: true,
        },
      }),
      this.prisma.coordinator.findMany({
        orderBy: [{ programId: 'asc' }, { fullName: 'asc' }],
        select: {
          id: true,
          fullName: true,
          email: true,
          programId: true,
        },
      }),
    ]);

    return {
      periods,
      coordinators,
      supportedMoments: SUPPORTED_MOMENTS.map((value) => ({
        value,
        label: formatMomentLabel(value),
      })),
      supportedPhases: ['ALISTAMIENTO', 'EJECUCION'],
    };
  }

  async list(periodCode?: string, status?: string) {
    const items = await this.prisma.outboxMessage.findMany({
      where: {
        status: status || undefined,
        period: periodCode ? { code: periodCode } : undefined,
      },
      include: {
        teacher: true,
        coordinator: true,
        period: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 1000,
    });

    return {
      total: items.length,
      items,
    };
  }

  async tracking(query: OutboxTrackingQuery) {
    const page = this.parsePositiveInt(query.page, 1, 1, 9999);
    const pageSize = this.parsePositiveInt(query.pageSize, 25, 1, 100);
    const search = query.search?.trim();
    const where = {
      period: query.periodCode ? { code: query.periodCode.trim() } : undefined,
      phase: query.phase || undefined,
      moment: query.moment || undefined,
      audience: query.audience || undefined,
      status: query.status || undefined,
      OR: search
        ? [
            { subject: { contains: search, mode: 'insensitive' as const } },
            { recipientName: { contains: search, mode: 'insensitive' as const } },
            { recipientEmail: { contains: search, mode: 'insensitive' as const } },
            { teacher: { fullName: { contains: search, mode: 'insensitive' as const } } },
            { coordinator: { fullName: { contains: search, mode: 'insensitive' as const } } },
          ]
        : undefined,
    };

    const [total, groupedByStatus, items] = await this.prisma.$transaction([
      this.prisma.outboxMessage.count({ where }),
      this.prisma.outboxMessage.groupBy({
        by: ['status'],
        where,
        orderBy: { status: 'asc' },
        _count: { status: true },
      }),
      this.prisma.outboxMessage.findMany({
        where,
        include: {
          teacher: { select: { id: true, fullName: true, email: true, email2: true } },
          coordinator: { select: { fullName: true, email: true } },
          period: { select: { code: true, label: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const statusCounts = groupedByStatus.reduce<Record<string, number>>((acc, item) => {
      const countValue =
        typeof item._count === 'object' && item._count && 'status' in item._count
          ? Number(item._count.status ?? 0)
          : 0;
      acc[item.status] = countValue;
      return acc;
    }, {});

    const messageIds = items.map((item) => item.id);
    const logs = messageIds.length
      ? await this.prisma.auditLog.findMany({
          where: {
            entityType: 'OUTBOX_MESSAGE',
            entityId: { in: messageIds },
            action: { in: ['OUTBOX_SEND_SENT', 'OUTBOX_SEND_FAILED', 'OUTBOX_SEND_SKIPPED_DUPLICATE'] },
          },
          orderBy: [{ createdAt: 'desc' }],
        })
      : [];

    const logsByMessage = new Map<
      string,
      {
        attempts: number;
        last: {
          action: string;
          createdAt: Date;
          details: SendAuditLogDetail | null;
        } | null;
      }
    >();

    for (const log of logs) {
      const current = logsByMessage.get(log.entityId) ?? { attempts: 0, last: null };
      current.attempts += 1;
      if (!current.last) {
        const detail =
          log.details && typeof log.details === 'object' && !Array.isArray(log.details)
            ? (log.details as SendAuditLogDetail)
            : null;
        current.last = {
          action: log.action,
          createdAt: log.createdAt,
          details: detail,
        };
      }
      logsByMessage.set(log.entityId, current);
    }

    const sentTotal =
      (statusCounts.SENT_AUTO ?? 0) +
      (statusCounts.SENT_MANUAL ?? 0);
    const draftTotal =
      (statusCounts.DRAFT ?? 0) +
      (statusCounts.EXPORTED ?? 0);

    return {
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      summary: {
        sent: sentTotal,
        pending: draftTotal,
        byStatus: statusCounts,
      },
      note:
        'El estado SENT indica que Outlook/SMTP acepto el envio. La confirmacion de entrega final al destinatario depende del servidor de correo y no siempre esta disponible.',
      items: items.map((item) => {
        const sendLogs = logsByMessage.get(item.id);
        const last = sendLogs?.last ?? null;
        const lastResult =
          last?.action === 'OUTBOX_SEND_SENT'
            ? 'SENT'
            : last?.action === 'OUTBOX_SEND_FAILED'
              ? 'FAILED'
              : last?.action === 'OUTBOX_SEND_SKIPPED_DUPLICATE'
                ? 'SKIPPED_DUPLICATE'
              : null;
        return {
          id: item.id,
          periodCode: item.period.code,
          periodLabel: item.period.label,
          phase: item.phase,
          moment: item.moment,
          audience: item.audience,
          status: item.status,
          subject: item.subject,
          recipientName:
            item.recipientName ??
            item.teacher?.fullName ??
            item.coordinator?.fullName ??
            null,
          recipientEmail:
            item.recipientEmail ??
            item.teacher?.email ??
            item.coordinator?.email ??
            null,
          teacherId: item.teacher?.id ?? null,
          attempts: sendLogs?.attempts ?? 0,
          lastAttemptAt: last?.createdAt ?? null,
          lastAttemptResult: lastResult,
          lastAttemptError: last?.details?.error ?? null,
          lastDeliveryMode: last?.details?.deliveryMode ?? null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
    };
  }
}
