import 'dotenv/config';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PrismaClient, type AuditLog, type OutboxMessage, type SampleGroup } from '@prisma/client';
import { normalizeProgramKey } from '@seguimiento/shared';

type CourseWithRelations = Awaited<ReturnType<typeof loadCourses>>[number];

type CompactOutboxMessage = Pick<
  OutboxMessage,
  | 'id'
  | 'audience'
  | 'teacherId'
  | 'coordinatorId'
  | 'programCode'
  | 'periodId'
  | 'phase'
  | 'moment'
  | 'subject'
  | 'recipientName'
  | 'recipientEmail'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
>;

type CompactAuditLog = Pick<AuditLog, 'id' | 'actor' | 'action' | 'entityType' | 'entityId' | 'details' | 'createdAt'>;

type CompactSampleGroup = Pick<
  SampleGroup,
  | 'id'
  | 'teacherId'
  | 'periodId'
  | 'programCode'
  | 'moment'
  | 'modality'
  | 'template'
  | 'selectedCourseId'
  | 'selectionSeed'
  | 'createdAt'
>;

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv<T extends Record<string, unknown>>(rows: T[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function toIso(value: Date | null | undefined): string {
  return value ? value.toISOString() : '';
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function compactUnique(values: Array<string | null | undefined>): string {
  return Array.from(
    new Set(values.map((value) => normalizeText(value)).filter(Boolean)),
  ).join(' | ');
}

function scoreBand(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return 'SIN_CALIFICACION';
  if (score >= 45) return 'EXCELENTE';
  if (score >= 35) return 'BUENO';
  if (score >= 25) return 'ACEPTABLE';
  return 'INSATISFACTORIO';
}

function parseOutboxPeriodCodes(programCode: string | null | undefined): string[] {
  return Array.from(
    new Set(
      String(programCode ?? '')
        .split(/[|,;]+/)
        .map((value) => value.trim())
        .filter((value) => /^\d{6}$/.test(value)),
    ),
  );
}

function summarizeMessages(messages: CompactOutboxMessage[]) {
  const ordered = [...messages].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const last = ordered[0] ?? null;
  return {
    total: messages.length,
    draft: messages.filter((item) => item.status === 'DRAFT').length,
    exported: messages.filter((item) => item.status === 'EXPORTED').length,
    sentAuto: messages.filter((item) => item.status === 'SENT_AUTO').length,
    sentManual: messages.filter((item) => item.status === 'SENT_MANUAL').length,
    lastStatus: last?.status ?? '',
    lastSubject: last?.subject ?? '',
    lastRecipientEmail: last?.recipientEmail ?? '',
    lastCreatedAt: toIso(last?.createdAt),
    lastUpdatedAt: toIso(last?.updatedAt),
    phases: compactUnique(messages.map((item) => item.phase)),
    moments: compactUnique(messages.map((item) => item.moment)),
  };
}

function summarizeAudits(logs: CompactAuditLog[]) {
  const ordered = [...logs].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const last = ordered[0] ?? null;
  return {
    total: logs.length,
    lastAction: last?.action ?? '',
    lastActor: last?.actor ?? '',
    lastCreatedAt: toIso(last?.createdAt),
    actions: compactUnique(logs.map((item) => item.action)),
  };
}

function uniqueMessages(messages: CompactOutboxMessage[]): CompactOutboxMessage[] {
  const seen = new Set<string>();
  const output: CompactOutboxMessage[] = [];
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    output.push(message);
  }
  return output;
}

function uniqueAudits(logs: CompactAuditLog[]): CompactAuditLog[] {
  const seen = new Set<string>();
  const output: CompactAuditLog[] = [];
  for (const log of logs) {
    if (seen.has(log.id)) continue;
    seen.add(log.id);
    output.push(log);
  }
  return output;
}

function buildProgramCandidates(course: CourseWithRelations): string[] {
  const values = [
    course.programCode,
    course.programName,
    course.teacher?.costCenter,
    course.teacher?.coordination,
  ];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeProgramKey(value))
        .filter(Boolean),
    ),
  );
}

async function loadCourses(prisma: PrismaClient) {
  return prisma.course.findMany({
    include: {
      period: true,
      teacher: true,
      moodleCheck: true,
      evaluations: {
        orderBy: [{ phase: 'asc' }],
      },
      selectedInGroups: {
        orderBy: [{ createdAt: 'asc' }],
      },
    },
    orderBy: [{ periodId: 'asc' }, { programName: 'asc' }, { teacher: { fullName: 'asc' } }, { nrc: 'asc' }],
  });
}

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    const [courses, coordinators, sampleGroups, outboxMessages, auditLogs] = await Promise.all([
      loadCourses(prisma),
      prisma.coordinator.findMany({
        orderBy: [{ programId: 'asc' }, { fullName: 'asc' }],
      }),
      prisma.sampleGroup.findMany({
        select: {
          id: true,
          teacherId: true,
          periodId: true,
          programCode: true,
          moment: true,
          modality: true,
          template: true,
          selectedCourseId: true,
          selectionSeed: true,
          createdAt: true,
        },
      }),
      prisma.outboxMessage.findMany({
        select: {
          id: true,
          audience: true,
          teacherId: true,
          coordinatorId: true,
          programCode: true,
          periodId: true,
          phase: true,
          moment: true,
          subject: true,
          recipientName: true,
          recipientEmail: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'asc' }],
      }),
      prisma.auditLog.findMany({
        select: {
          id: true,
          actor: true,
          action: true,
          entityType: true,
          entityId: true,
          details: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }],
      }),
    ]);

    const coordinatorsByProgramKey = new Map<string, typeof coordinators>();
    for (const coordinator of coordinators) {
      const key = normalizeProgramKey(coordinator.programKey);
      if (!key) continue;
      const bucket = coordinatorsByProgramKey.get(key) ?? [];
      bucket.push(coordinator);
      coordinatorsByProgramKey.set(key, bucket);
    }

    const sampleGroupsByTeacherPeriod = new Map<string, CompactSampleGroup[]>();
    const sampleGroupsBySelectedCourse = new Map<string, CompactSampleGroup[]>();
    for (const group of sampleGroups) {
      const teacherPeriodKey = `${group.teacherId}|${group.periodId}`;
      const teacherPeriodBucket = sampleGroupsByTeacherPeriod.get(teacherPeriodKey) ?? [];
      teacherPeriodBucket.push(group);
      sampleGroupsByTeacherPeriod.set(teacherPeriodKey, teacherPeriodBucket);

      if (group.selectedCourseId) {
        const selectedBucket = sampleGroupsBySelectedCourse.get(group.selectedCourseId) ?? [];
        selectedBucket.push(group);
        sampleGroupsBySelectedCourse.set(group.selectedCourseId, selectedBucket);
      }
    }

    const teacherOutboxByTeacherPeriod = new Map<string, CompactOutboxMessage[]>();
    const coordinatorOutboxByCoordinatorPeriod = new Map<string, CompactOutboxMessage[]>();
    const globalOutboxByPeriod = new Map<string, CompactOutboxMessage[]>();
    for (const message of outboxMessages) {
      if (message.audience === 'DOCENTE' && message.teacherId) {
        const key = `${message.teacherId}|${message.periodId}`;
        const bucket = teacherOutboxByTeacherPeriod.get(key) ?? [];
        bucket.push(message);
        teacherOutboxByTeacherPeriod.set(key, bucket);
      }

      if (message.audience === 'COORDINADOR' && message.coordinatorId) {
        const periodCodes = parseOutboxPeriodCodes(message.programCode);
        const keys = periodCodes.length ? periodCodes : [message.periodId];
        for (const periodCodeOrId of keys) {
          const key = `${message.coordinatorId}|${periodCodeOrId}`;
          const bucket = coordinatorOutboxByCoordinatorPeriod.get(key) ?? [];
          bucket.push(message);
          coordinatorOutboxByCoordinatorPeriod.set(key, bucket);
        }
      }

      if (message.audience === 'GLOBAL') {
        const periodCodes = parseOutboxPeriodCodes(message.programCode);
        const keys = periodCodes.length ? periodCodes : [message.periodId];
        for (const periodCodeOrId of keys) {
          const bucket = globalOutboxByPeriod.get(periodCodeOrId) ?? [];
          bucket.push(message);
          globalOutboxByPeriod.set(periodCodeOrId, bucket);
        }
      }
    }

    const auditsByEntityKey = new Map<string, CompactAuditLog[]>();
    const outboxAuditsByMessageId = new Map<string, CompactAuditLog[]>();
    for (const log of auditLogs) {
      const key = `${log.entityType}|${log.entityId}`;
      const bucket = auditsByEntityKey.get(key) ?? [];
      bucket.push(log);
      auditsByEntityKey.set(key, bucket);

      if (log.entityType === 'OUTBOX_MESSAGE') {
        const outboxBucket = outboxAuditsByMessageId.get(log.entityId) ?? [];
        outboxBucket.push(log);
        outboxAuditsByMessageId.set(log.entityId, outboxBucket);
      }
    }

    const rows = courses.map((course) => {
      const teacherPeriodKey = course.teacherId ? `${course.teacherId}|${course.periodId}` : '';
      const teacherPeriodGroups = teacherPeriodKey
        ? (sampleGroupsByTeacherPeriod.get(teacherPeriodKey) ?? [])
        : [];
      const selectedGroups = sampleGroupsBySelectedCourse.get(course.id) ?? course.selectedInGroups;
      const programCandidates = buildProgramCandidates(course);
      const coordinatorMatches = Array.from(
        new Set(
          programCandidates.flatMap((candidate) => {
            const exact = coordinatorsByProgramKey.get(candidate) ?? [];
            if (exact.length) return exact;
            return coordinators.filter((coordinator) => {
              const coordinatorKey = normalizeProgramKey(coordinator.programKey);
              return coordinatorKey.includes(candidate) || candidate.includes(coordinatorKey);
            });
          }),
        ),
      );
      const primaryCoordinator = coordinatorMatches[0] ?? null;

      const teacherOutboxMessages = teacherPeriodKey
        ? (teacherOutboxByTeacherPeriod.get(teacherPeriodKey) ?? [])
        : [];

      const coordinatorOutboxMessages = primaryCoordinator
        ? uniqueMessages([
            ...(coordinatorOutboxByCoordinatorPeriod.get(`${primaryCoordinator.id}|${course.period.code}`) ?? []),
            ...(coordinatorOutboxByCoordinatorPeriod.get(`${primaryCoordinator.id}|${course.periodId}`) ?? []),
          ])
        : [];

      const globalOutboxMessages = uniqueMessages([
        ...(globalOutboxByPeriod.get(course.period.code) ?? []),
        ...(globalOutboxByPeriod.get(course.periodId) ?? []),
      ]);

      const teacherOutboxIds = new Set(teacherOutboxMessages.map((item) => item.id));
      const coordinatorOutboxIds = new Set(coordinatorOutboxMessages.map((item) => item.id));
      const globalOutboxIds = new Set(globalOutboxMessages.map((item) => item.id));

      const courseAudits = auditsByEntityKey.get(`COURSE|${course.id}`) ?? [];
      const teacherOutboxAudits = uniqueAudits(
        Array.from(teacherOutboxIds).flatMap((id) => outboxAuditsByMessageId.get(id) ?? []),
      );
      const coordinatorOutboxAudits = uniqueAudits(
        Array.from(coordinatorOutboxIds).flatMap((id) => outboxAuditsByMessageId.get(id) ?? []),
      );
      const globalOutboxAudits = uniqueAudits(
        Array.from(globalOutboxIds).flatMap((id) => outboxAuditsByMessageId.get(id) ?? []),
      );

      const evaluationsByPhase = new Map(
        course.evaluations.map((evaluation) => [evaluation.phase.toUpperCase(), evaluation]),
      );
      const alistamiento = evaluationsByPhase.get('ALISTAMIENTO') ?? null;
      const ejecucion = evaluationsByPhase.get('EJECUCION') ?? null;

      const teacherOutboxSummary = summarizeMessages(teacherOutboxMessages);
      const coordinatorOutboxSummary = summarizeMessages(coordinatorOutboxMessages);
      const globalOutboxSummary = summarizeMessages(globalOutboxMessages);
      const courseAuditSummary = summarizeAudits(courseAudits);
      const teacherOutboxAuditSummary = summarizeAudits(teacherOutboxAudits);
      const coordinatorOutboxAuditSummary = summarizeAudits(coordinatorOutboxAudits);
      const globalOutboxAuditSummary = summarizeAudits(globalOutboxAudits);

      return {
        course_id: course.id,
        course_nrc: course.nrc,
        period_id: course.periodId,
        period_code: course.period.code,
        period_label: course.period.label,
        period_semester: course.period.semester,
        period_modality: course.period.modality,
        period_execution_policy: course.period.executionPolicy,
        course_created_at: toIso(course.createdAt),
        course_updated_at: toIso(course.updatedAt),
        campus_code: course.campusCode ?? '',
        program_code: course.programCode ?? '',
        program_name: course.programName ?? '',
        program_key_normalized: normalizeProgramKey(course.programName ?? course.programCode ?? ''),
        subject_name: course.subjectName ?? '',
        course_moment: course.moment ?? '',
        salon: course.salon ?? '',
        salon_1: course.salon1 ?? '',
        template_declared: course.templateDeclared ?? '',
        d4_flag_legacy: course.d4FlagLegacy,
        course_raw_json: toJson(course.rawJson),
        teacher_id: course.teacher?.id ?? '',
        teacher_source_id: course.teacher?.sourceId ?? '',
        teacher_document_id: course.teacher?.documentId ?? '',
        teacher_full_name: course.teacher?.fullName ?? '',
        teacher_email: course.teacher?.email ?? '',
        teacher_cost_center: course.teacher?.costCenter ?? '',
        teacher_coordination: course.teacher?.coordination ?? '',
        teacher_campus: course.teacher?.campus ?? '',
        teacher_region: course.teacher?.region ?? '',
        teacher_created_at: toIso(course.teacher?.createdAt),
        teacher_updated_at: toIso(course.teacher?.updatedAt),
        teacher_extra_json: toJson(course.teacher?.extraJson),
        coordinator_id: primaryCoordinator?.id ?? '',
        coordinator_program_id: primaryCoordinator?.programId ?? '',
        coordinator_program_key: primaryCoordinator?.programKey ?? '',
        coordinator_full_name: primaryCoordinator?.fullName ?? '',
        coordinator_email: primaryCoordinator?.email ?? '',
        coordinator_campus: primaryCoordinator?.campus ?? '',
        coordinator_region: primaryCoordinator?.region ?? '',
        coordinator_source_sheet: primaryCoordinator?.sourceSheet ?? '',
        coordinator_match_count: coordinatorMatches.length,
        coordinator_match_candidates_json: toJson(
          coordinatorMatches.map((item) => ({
            id: item.id,
            programId: item.programId,
            programKey: item.programKey,
            fullName: item.fullName,
            email: item.email,
          })),
        ),
        moodle_id: course.moodleCheck?.id ?? '',
        moodle_status: course.moodleCheck?.status ?? '',
        moodle_detected_template: course.moodleCheck?.detectedTemplate ?? '',
        moodle_error_code: course.moodleCheck?.errorCode ?? '',
        moodle_course_url: course.moodleCheck?.moodleCourseUrl ?? '',
        moodle_course_id: course.moodleCheck?.moodleCourseId ?? '',
        moodle_resolved_modality: course.moodleCheck?.resolvedModality ?? '',
        moodle_resolved_base_url: course.moodleCheck?.resolvedBaseUrl ?? '',
        moodle_search_query: course.moodleCheck?.searchQuery ?? '',
        moodle_resolved_at: toIso(course.moodleCheck?.resolvedAt),
        moodle_attempts: course.moodleCheck?.attempts ?? 0,
        moodle_last_attempt_at: toIso(course.moodleCheck?.lastAttemptAt),
        moodle_evidence_screenshot_path: course.moodleCheck?.evidenceScreenshotPath ?? '',
        moodle_evidence_html_path: course.moodleCheck?.evidenceHtmlPath ?? '',
        moodle_notes: course.moodleCheck?.notes ?? '',
        moodle_created_at: toIso(course.moodleCheck?.createdAt),
        moodle_updated_at: toIso(course.moodleCheck?.updatedAt),
        sample_group_count_teacher_period: teacherPeriodGroups.length,
        sample_group_ids_teacher_period: compactUnique(teacherPeriodGroups.map((item) => item.id)),
        sample_group_program_codes_teacher_period: compactUnique(
          teacherPeriodGroups.map((item) => item.programCode),
        ),
        sample_group_moments_teacher_period: compactUnique(teacherPeriodGroups.map((item) => item.moment)),
        sample_group_templates_teacher_period: compactUnique(teacherPeriodGroups.map((item) => item.template)),
        sample_group_modalities_teacher_period: compactUnique(teacherPeriodGroups.map((item) => item.modality)),
        selected_in_sample_group: selectedGroups.length > 0,
        selected_group_count_course: selectedGroups.length,
        selected_group_ids_course: compactUnique(selectedGroups.map((item) => item.id)),
        selected_group_selection_seeds_course: compactUnique(
          selectedGroups.map((item) => item.selectionSeed),
        ),
        selected_group_created_at_course: compactUnique(
          selectedGroups.map((item) => toIso(item.createdAt)),
        ),
        selected_groups_json: toJson(selectedGroups),
        evaluation_total_count: course.evaluations.length,
        evaluation_phases_present: compactUnique(course.evaluations.map((item) => item.phase)),
        evaluation_scores_json: toJson(
          course.evaluations.map((item) => ({
            phase: item.phase,
            score: item.score,
            computedAt: item.computedAt,
            observations: item.observations,
            replicatedFromCourseId: item.replicatedFromCourseId,
          })),
        ),
        evaluation_checklists_json: toJson(
          course.evaluations.map((item) => ({
            phase: item.phase,
            checklist: item.checklist,
          })),
        ),
        alistamiento_score: alistamiento?.score ?? '',
        alistamiento_score_band: scoreBand(alistamiento?.score),
        alistamiento_observations: alistamiento?.observations ?? '',
        alistamiento_computed_at: toIso(alistamiento?.computedAt),
        alistamiento_replicated_from_course_id: alistamiento?.replicatedFromCourseId ?? '',
        alistamiento_checklist_json: toJson(alistamiento?.checklist),
        alistamiento_created_at: toIso(alistamiento?.createdAt),
        alistamiento_updated_at: toIso(alistamiento?.updatedAt),
        ejecucion_score: ejecucion?.score ?? '',
        ejecucion_score_band: scoreBand(ejecucion?.score),
        ejecucion_observations: ejecucion?.observations ?? '',
        ejecucion_computed_at: toIso(ejecucion?.computedAt),
        ejecucion_replicated_from_course_id: ejecucion?.replicatedFromCourseId ?? '',
        ejecucion_checklist_json: toJson(ejecucion?.checklist),
        ejecucion_created_at: toIso(ejecucion?.createdAt),
        ejecucion_updated_at: toIso(ejecucion?.updatedAt),
        teacher_outbox_total_period: teacherOutboxSummary.total,
        teacher_outbox_draft_period: teacherOutboxSummary.draft,
        teacher_outbox_exported_period: teacherOutboxSummary.exported,
        teacher_outbox_sent_auto_period: teacherOutboxSummary.sentAuto,
        teacher_outbox_sent_manual_period: teacherOutboxSummary.sentManual,
        teacher_outbox_last_status_period: teacherOutboxSummary.lastStatus,
        teacher_outbox_last_subject_period: teacherOutboxSummary.lastSubject,
        teacher_outbox_last_recipient_email_period: teacherOutboxSummary.lastRecipientEmail,
        teacher_outbox_last_created_at_period: teacherOutboxSummary.lastCreatedAt,
        teacher_outbox_last_updated_at_period: teacherOutboxSummary.lastUpdatedAt,
        teacher_outbox_phases_period: teacherOutboxSummary.phases,
        teacher_outbox_moments_period: teacherOutboxSummary.moments,
        teacher_outbox_json_period: toJson(teacherOutboxMessages),
        coordinator_outbox_total_period: coordinatorOutboxSummary.total,
        coordinator_outbox_draft_period: coordinatorOutboxSummary.draft,
        coordinator_outbox_exported_period: coordinatorOutboxSummary.exported,
        coordinator_outbox_sent_auto_period: coordinatorOutboxSummary.sentAuto,
        coordinator_outbox_sent_manual_period: coordinatorOutboxSummary.sentManual,
        coordinator_outbox_last_status_period: coordinatorOutboxSummary.lastStatus,
        coordinator_outbox_last_subject_period: coordinatorOutboxSummary.lastSubject,
        coordinator_outbox_last_recipient_email_period: coordinatorOutboxSummary.lastRecipientEmail,
        coordinator_outbox_last_created_at_period: coordinatorOutboxSummary.lastCreatedAt,
        coordinator_outbox_last_updated_at_period: coordinatorOutboxSummary.lastUpdatedAt,
        coordinator_outbox_phases_period: coordinatorOutboxSummary.phases,
        coordinator_outbox_moments_period: coordinatorOutboxSummary.moments,
        coordinator_outbox_json_period: toJson(coordinatorOutboxMessages),
        global_outbox_total_period: globalOutboxSummary.total,
        global_outbox_draft_period: globalOutboxSummary.draft,
        global_outbox_exported_period: globalOutboxSummary.exported,
        global_outbox_sent_auto_period: globalOutboxSummary.sentAuto,
        global_outbox_sent_manual_period: globalOutboxSummary.sentManual,
        global_outbox_last_status_period: globalOutboxSummary.lastStatus,
        global_outbox_last_subject_period: globalOutboxSummary.lastSubject,
        global_outbox_last_recipient_email_period: globalOutboxSummary.lastRecipientEmail,
        global_outbox_last_created_at_period: globalOutboxSummary.lastCreatedAt,
        global_outbox_last_updated_at_period: globalOutboxSummary.lastUpdatedAt,
        global_outbox_phases_period: globalOutboxSummary.phases,
        global_outbox_moments_period: globalOutboxSummary.moments,
        global_outbox_json_period: toJson(globalOutboxMessages),
        course_audit_total: courseAuditSummary.total,
        course_audit_last_action: courseAuditSummary.lastAction,
        course_audit_last_actor: courseAuditSummary.lastActor,
        course_audit_last_created_at: courseAuditSummary.lastCreatedAt,
        course_audit_actions: courseAuditSummary.actions,
        course_audit_json: toJson(courseAudits),
        teacher_outbox_audit_total_period: teacherOutboxAuditSummary.total,
        teacher_outbox_audit_last_action_period: teacherOutboxAuditSummary.lastAction,
        teacher_outbox_audit_last_actor_period: teacherOutboxAuditSummary.lastActor,
        teacher_outbox_audit_last_created_at_period: teacherOutboxAuditSummary.lastCreatedAt,
        teacher_outbox_audit_actions_period: teacherOutboxAuditSummary.actions,
        teacher_outbox_audit_json_period: toJson(teacherOutboxAudits),
        coordinator_outbox_audit_total_period: coordinatorOutboxAuditSummary.total,
        coordinator_outbox_audit_last_action_period: coordinatorOutboxAuditSummary.lastAction,
        coordinator_outbox_audit_last_actor_period: coordinatorOutboxAuditSummary.lastActor,
        coordinator_outbox_audit_last_created_at_period: coordinatorOutboxAuditSummary.lastCreatedAt,
        coordinator_outbox_audit_actions_period: coordinatorOutboxAuditSummary.actions,
        coordinator_outbox_audit_json_period: toJson(coordinatorOutboxAudits),
        global_outbox_audit_total_period: globalOutboxAuditSummary.total,
        global_outbox_audit_last_action_period: globalOutboxAuditSummary.lastAction,
        global_outbox_audit_last_actor_period: globalOutboxAuditSummary.lastActor,
        global_outbox_audit_last_created_at_period: globalOutboxAuditSummary.lastCreatedAt,
        global_outbox_audit_actions_period: globalOutboxAuditSummary.actions,
        global_outbox_audit_json_period: toJson(globalOutboxAudits),
        has_teacher: Boolean(course.teacherId),
        has_coordinator_match: Boolean(primaryCoordinator),
        has_moodle_check: Boolean(course.moodleCheck),
        has_alistamiento: Boolean(alistamiento),
        has_ejecucion: Boolean(ejecucion),
        has_any_outbox: teacherOutboxSummary.total + coordinatorOutboxSummary.total + globalOutboxSummary.total > 0,
      };
    });

    const projectRoot = path.resolve(process.cwd(), '..', '..');
    const reportsDir = path.join(projectRoot, 'storage', 'outputs', 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
    const outputPath = path.join(reportsDir, `bi_dataset_full_${stamp}.csv`);

    writeFileSync(outputPath, toCsv(rows), 'utf8');

    console.log(
      JSON.stringify(
        {
          ok: true,
          outputPath,
          rowCount: rows.length,
          counts: {
            courses: courses.length,
            coordinators: coordinators.length,
            sampleGroups: sampleGroups.length,
            outboxMessages: outboxMessages.length,
            auditLogs: auditLogs.length,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
