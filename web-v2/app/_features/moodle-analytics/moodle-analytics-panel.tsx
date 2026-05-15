'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';
import { AlertBox, Button } from '../../_components/ui';
import { useFetch } from '../../_lib/use-fetch';

type AnalyticsOptionsResponse = {
  ok: boolean;
  filters: {
    periodCodes: string[];
    programCodes: string[];
    campusCodes: string[];
    teacherIds: string[];
    nrcs: string[];
  };
  totals: {
    attendanceCourses: number;
    activityCourses: number;
    participantCourses: number;
    bannerEnrollmentCourses: number;
  };
  periods: Array<{ code: string; label: string; semester: number | null; count: number }>;
  programs: Array<{ code: string; label: string; count: number }>;
  campuses: Array<{ code: string; count: number }>;
  teachers: Array<{ id: string; fullName: string; count: number }>;
  sessionDays: string[];
};

type AnalyticsOverviewResponse = {
  ok: boolean;
  attendance: {
    courseCount: number;
    studentCount: number;
    sessionCount: number;
    presentCount: number;
    absentCount: number;
    justifiedCount: number;
    unknownCount: number;
    trackedEntries: number;
    attendanceRate: number | null;
    inattendanceRate: number | null;
    byDay: Array<{
      day: string;
      present: number;
      absent: number;
      justified: number;
      unknown: number;
      tracked: number;
      attendanceRate: number | null;
      inattendanceRate: number | null;
    }>;
    byProgram: Array<{
      key: string;
      label: string;
      courseCount: number;
      studentCount: number;
      attendanceRate: number | null;
      inattendanceRate: number | null;
      presentCount: number;
      absentCount: number;
    }>;
    byCampus: Array<{
      key: string;
      label: string;
      courseCount: number;
      studentCount: number;
      attendanceRate: number | null;
      inattendanceRate: number | null;
      presentCount: number;
      absentCount: number;
    }>;
    worstCourses: Array<{
      nrc: string;
      subjectName: string | null;
      programName: string | null;
      campusCode: string | null;
      teacherName: string | null;
      studentCount: number;
      trackedEntries: number;
      attendanceRate: number | null;
      inattendanceRate: number | null;
      absentCount: number;
      presentCount: number;
    }>;
  };
  activity: {
    courseCount: number;
    reportCount: number;
    totalEvents: number;
    summedUniqueUsers: number;
    byDay: Array<{ day: string; count: number }>;
    byComponent: Array<{ key: string; value: number }>;
    byEventName: Array<{ key: string; value: number }>;
    byActorCategory: Array<{ key: string; value: number }>;
    topCourses: Array<{
      nrc: string;
      subjectName: string | null;
      programName: string | null;
      campusCode: string | null;
      teacherName: string | null;
      events: number;
      users: number;
    }>;
  };
  participants: {
    courseCount: number;
    reportCount: number;
    totalParticipants: number;
    byActorCategory: Array<{ key: string; value: number }>;
    byRole: Array<{ key: string; value: number }>;
  };
  enrollment: {
    courseCount: number;
    reportCount: number;
    totalStudents: number;
  };
  alerts: {
    totals: {
      courseCount: number;
      userCount: number;
      bannerRosterCourses: number;
      activityActorsOutsideRoster: number;
      activityUnclassified: number;
      participantUnusualRoles: number;
      studentsWithoutActivity: number;
      studentsWithoutAttendance: number;
    };
    byType: Array<{ key: string; label: string; count: number; courseCount: number }>;
    byProgram: Array<{ key: string; label: string; count: number; courseCount: number }>;
    byCampus: Array<{ key: string; label: string; count: number; courseCount: number }>;
    courses: Array<{
      nrc: string;
      subjectName: string | null;
      programName: string | null;
      campusCode: string | null;
      teacherName: string | null;
      rosterSource: 'BANNER' | 'MOODLE_PARTICIPANTS' | 'SIN_ROSTER';
      outsideRosterActors: number;
      unclassifiedActors: number;
      unusualRoleParticipants: number;
      studentsWithoutActivity: number;
      studentsWithoutAttendance: number;
      totalAlerts: number;
      riskScore: number;
      riskLevel: string;
    }>;
    users: Array<{
      kind: string;
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
    }>;
  };
};

type AttendanceDateReportResponse = {
  ok: boolean;
  summary: {
    courseCount: number;
    participantCount: number;
    presentCount: number;
    absentCount: number;
    justifiedCount: number;
    unknownCount: number;
    attendanceRate: number | null;
    inattendanceRate: number | null;
  };
  courses: Array<{
    nrc: string;
    subjectName: string | null;
    programName: string | null;
    campusCode: string | null;
    teacherName: string | null;
    periodCode: string;
    participantCount: number;
    presentCount: number;
    absentCount: number;
    justifiedCount: number;
    unknownCount: number;
    attendanceRate: number | null;
    inattendanceRate: number | null;
    sessionLabels: string[];
    presentStudents: Array<{
      fullName: string;
      email: string | null;
      institutionalId: string | null;
    }>;
  }>;
};

type AttendanceStudentReportResponse = {
  ok: boolean;
  summary: {
    selectedDayCount: number;
    matchedSessionCount: number;
    courseCount: number;
    studentCount: number;
    rowCount: number;
    presentCount: number;
    absentCount: number;
    justifiedCount: number;
    unknownCount: number;
    attendanceRate: number | null;
    inattendanceRate: number | null;
  };
  rows: Array<{
    sessionDay: string;
    sessionLabel: string;
    periodCode: string;
    nrc: string;
    subjectName: string | null;
    programName: string | null;
    campusCode: string | null;
    teacherName: string | null;
    studentName: string;
    studentEmail: string | null;
    studentId: string | null;
    statusCode: string | null;
    statusLabel: string;
    rawValue: string | null;
    present: boolean;
    justified: boolean;
  }>;
};

type BannerAutomationImportResponse = {
  ok: boolean;
  result: {
    ok: boolean;
    inputPath: string;
    export: {
      processedCourses: number;
      foundCourses: number;
      emptyCourses: number;
      failedCourses: number;
      totalStudents: number;
      outputPath: string;
    };
    import: {
      importedReports: number;
      importedStudents: number;
      skippedCourses: string[];
    };
  };
};

type BannerRunnerRun = {
  id: string;
  command: 'lookup' | 'batch' | 'retry-errors' | 'export' | 'auth' | 'enrollment';
  args: string[];
  startedAt: string;
  endedAt?: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  exitCode?: number | null;
  pid?: number;
  logPath: string;
  awaitingInput?: boolean;
};

type BannerLiveActivity = {
  queryId: string | null;
  totalRequested: number | null;
  workers: number | null;
  processed: number;
  pending: number | null;
  phase: 'BOOTSTRAP' | 'LOOKUP' | 'IMPORT' | 'COMPLETE' | 'ERROR';
  found: number;
  empty: number;
  failed: number;
  totalStudents: number;
  currentNrc: string | null;
  currentPeriod: string | null;
  lastEventAt: string | null;
  recentEvents: Array<{
    at: string;
    stage: 'PREPARING' | 'LOOKUP' | 'DONE' | 'WARN';
    message: string;
    worker: number | null;
    queryId: string | null;
    nrc: string | null;
    period: string | null;
    status: string | null;
  }>;
  workerStates: Array<{
    worker: number;
    at: string;
    stage: 'PREPARING' | 'LOOKUP' | 'DONE' | 'WARN';
    nrc: string | null;
    period: string | null;
    status: string | null;
  }>;
};

type BannerStatusResponse = {
  ok: boolean;
  projectRoot: string;
  projectRootExists: boolean;
  runner: {
    running: boolean;
    current: BannerRunnerRun | null;
    lastRun: BannerRunnerRun | null;
    logTail: string;
    liveActivity: BannerLiveActivity | null;
  };
  exportSummary: {
    latestFile: string | null;
    modifiedAt: string | null;
    rowCount: number;
    statusCounts: Record<string, number>;
  };
};

type BannerBatchOptionsResponse = {
  ok?: boolean;
  periods: Array<{
    code: string;
    label: string;
    modality: string;
    year: string;
    courseCount: number;
  }>;
  years: Array<{
    year: string;
    periodCodes: string[];
    courseCount: number;
  }>;
  defaults: {
    source: 'ALL' | 'MISSING_TEACHER' | 'PENDING_BANNER';
    selectedPeriodCodes: string[];
    latestYear: string | null;
  };
};

type SidecarRunCommand = 'attendance' | 'activity' | 'participants';

type SidecarArtifactSummary = {
  kind: SidecarRunCommand;
  startedAt: string;
  endedAt: string;
  outputDir: string;
  totalCourses: number;
  completedCourses: number;
  failedCourses: number;
  skippedCourses: number;
};

type SidecarStatusResponse = {
  running: boolean;
  current: {
    id: string;
    command: SidecarRunCommand;
    status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    startedAt: string;
    endedAt?: string;
    outputPath?: string;
    logPath: string;
  } | null;
  lastRun: {
    id: string;
    command: SidecarRunCommand;
    status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    startedAt: string;
    endedAt?: string;
    outputPath?: string;
    logPath: string;
  } | null;
  logTail: string;
  artifactSummary?: SidecarArtifactSummary | null;
};

type SidecarBatchOptionsResponse = {
  periods: Array<{
    code: string;
    label: string;
    modality: string;
    courseCount: number;
  }>;
};

type MoodleQuickSyncKind = 'all' | SidecarRunCommand;

type MoodleQuickRunState = {
  kind: MoodleQuickSyncKind;
  totalSteps: number;
  currentStep: number;
  currentCommand: SidecarRunCommand | null;
  phase: 'EXTRACTING' | 'IMPORTING' | 'DONE' | 'FAILED';
};

type TeacherAccessCourse = {
  nrc: string;
  subjectName: string | null;
  programName: string | null;
  campusCode: string | null;
  teacherName: string | null;
  periodCode: string;
  calendarState: string;
  isShortCourse: boolean;
  totalCourseWeeks: number | null;
  requiredLoginDays: number | null;
  totalTeacherDays: number;
  weeksDetail: Array<{ week: string; days: string[]; dayCount: number; compliant: boolean }>;
  compliantWeeks: number | null;
  complianceRate: number | null;
  status: string;
};

type TeacherAccessReportResponse = {
  ok: boolean;
  summary: {
    courseCount: number;
    compliantCourses: number;
    partialCourses: number;
    nonCompliantCourses: number;
    noDataCourses: number;
    noDatesCourses: number;
    complianceRate: number | null;
  };
  courses: TeacherAccessCourse[];
};

type MoodlAnalyticsPanelProps = {
  apiBase: string;
};

type FilterState = {
  periodCodes: string[];
  programCodes: string[];
  campusCodes: string[];
  teacherIds: string[];
  nrcsText: string;
  sessionDay: string;
  sessionDays: string[];
  moments: string[];
};

function toggleSelection(current: string[], value: string) {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function formatPercent(value: number | null | undefined) {
  return value == null ? '-' : `${value.toFixed(1)}%`;
}

function parseNrcList(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function escapeCsvCell(value: string | number | null | undefined) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatDuration(startedAt?: string, endedAt?: string) {
  if (!startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '-';

  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatCompactCount(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('es-CO').format(value);
}

function formatRelativeTime(value?: string | null) {
  if (!value) return '-';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '-';

  const totalSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (totalSeconds < 5) return 'ahora';
  if (totalSeconds < 60) return `hace ${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  return `hace ${hours}h`;
}

function formatRatePerMinute(processed: number, startedAt?: string, endedAt?: string) {
  if (!processed || !startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '-';

  const elapsedMinutes = (end - start) / 60000;
  if (elapsedMinutes <= 0) return '-';
  return `${Math.max(1, Math.round(processed / elapsedMinutes))}/min`;
}

function formatEta(totalRequested: number | null | undefined, processed: number, startedAt?: string, endedAt?: string) {
  if (!totalRequested || processed <= 0 || processed >= totalRequested || !startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '-';

  const elapsedMs = end - start;
  const remaining = totalRequested - processed;
  if (remaining <= 0) return '0s';

  const etaMs = Math.round((elapsedMs / processed) * remaining);
  if (!Number.isFinite(etaMs) || etaMs <= 0) return '-';
  return formatDuration(new Date(0).toISOString(), new Date(etaMs).toISOString());
}

function formatBannerCommandLabel(command?: BannerRunnerRun['command']) {
  switch (command) {
    case 'enrollment':
      return 'Matricula Banner';
    case 'batch':
      return 'Lote Banner';
    case 'lookup':
      return 'Consulta individual';
    case 'retry-errors':
      return 'Reintento Banner';
    case 'export':
      return 'Exportacion Banner';
    case 'auth':
      return 'Autenticacion Banner';
    default:
      return 'Banner';
  }
}

function describeBannerEvent(event: BannerLiveActivity['recentEvents'][number] | null | undefined) {
  if (!event) return 'Banner esta preparando la consulta.';

  if (event.message === 'Consultando matricula oficial Banner') {
    return `Consultando NRC ${event.nrc ?? '-'} del periodo ${event.period ?? '-'}.`;
  }

  if (event.message === 'Matricula Banner obtenida') {
    return `Matricula obtenida para NRC ${event.nrc ?? '-'} del periodo ${event.period ?? '-'}.`;
  }

  if (event.message === 'Fallo consulta de matricula Banner') {
    return `Hubo un fallo al consultar NRC ${event.nrc ?? '-'} del periodo ${event.period ?? '-'}.`;
  }

  if (event.message === 'Importando matricula Banner a analitica') {
    return 'Banner ya termino la consulta y ahora esta importando el resultado a la analitica.';
  }

  if (event.message === 'Matricula Banner importada en analitica') {
    return 'La matricula ya quedo importada en la analitica.';
  }

  return event.message;
}

function formatBannerStage(stage: BannerLiveActivity['recentEvents'][number]['stage']) {
  switch (stage) {
    case 'PREPARING':
      return 'Preparando';
    case 'LOOKUP':
      return 'Consultando';
    case 'DONE':
      return 'Completado';
    case 'WARN':
      return 'Con novedad';
    default:
      return stage;
  }
}

function formatBannerPhase(phase?: BannerLiveActivity['phase'], status?: BannerRunnerRun['status']) {
  if (status === 'FAILED') return 'Con error';
  if (status === 'CANCELLED') return 'Cancelado';
  if (status === 'COMPLETED' || phase === 'COMPLETE') return 'Importado';

  switch (phase) {
    case 'BOOTSTRAP':
      return 'Preparando sesion';
    case 'LOOKUP':
      return 'Consultando NRC';
    case 'IMPORT':
      return 'Importando a analitica';
    case 'ERROR':
      return 'Con error';
    default:
      return 'En curso';
  }
}

function formatSidecarCommand(command?: SidecarRunCommand | null) {
  switch (command) {
    case 'participants':
      return 'participantes';
    case 'activity':
      return 'actividad';
    case 'attendance':
      return 'asistencia';
    default:
      return 'Moodle';
  }
}

function togglePeriodCode(current: string[], periodCode: string) {
  return current.includes(periodCode)
    ? current.filter((item) => item !== periodCode)
    : [...current, periodCode];
}

function buildQuery(filters: FilterState) {
  const params = new URLSearchParams();
  if (filters.periodCodes.length) params.set('periodCodes', filters.periodCodes.join(','));
  if (filters.programCodes.length) params.set('programCodes', filters.programCodes.join(','));
  if (filters.campusCodes.length) params.set('campusCodes', filters.campusCodes.join(','));
  if (filters.teacherIds.length) params.set('teacherIds', filters.teacherIds.join(','));
  if (filters.moments.length) params.set('moments', filters.moments.join(','));
  const nrcs = parseNrcList(filters.nrcsText);
  if (nrcs.length) params.set('nrcs', nrcs.join(','));
  return params;
}

function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'warm' | 'danger' | 'cool';
}) {
  const bg =
    tone === 'warm'
      ? 'linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)'
      : tone === 'danger'
      ? 'linear-gradient(135deg,#fff1f2 0%,#fce7f3 100%)'
      : tone === 'cool'
      ? 'linear-gradient(135deg,#f0fdfa 0%,#ccfbf1 100%)'
      : 'linear-gradient(135deg,var(--n-50) 0%,#f1f5f9 100%)';
  return (
    <article className="ds-stat-card" style={{ background: bg }}>
      <div className="ds-stat-label">{label}</div>
      <div className="ds-stat-value">{value}</div>
      {hint ? <div className="ds-stat-hint">{hint}</div> : null}
    </article>
  );
}

function BarList({
  title,
  items,
  accent = 'var(--teal)',
  suffix = '',
}: {
  title: string;
  items: Array<{ label: string; value: number; meta?: string }>;
  accent?: string;
  suffix?: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <section className="premium-card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h3>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {items.length ? (
          items.map((item) => (
            <div key={`${title}-${item.label}`} style={{ display: 'grid', gridTemplateColumns: '1fr 3fr auto', gap: 8, alignItems: 'center', fontSize: '0.8rem' }}>
              <div>
                <strong style={{ fontSize: '0.8rem' }}>{item.label}</strong>
                {item.meta ? <small style={{ display: 'block', color: 'var(--muted)', fontSize: '0.72rem' }}>{item.meta}</small> : null}
              </div>
              <div style={{ height: 8, background: 'var(--n-100)', borderRadius: 4, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.max(6, (item.value / max) * 100)}%`, background: accent, borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--slate-700)', minWidth: 32, textAlign: 'right' }}>
                {item.value}{suffix}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">Sin datos para este bloque.</div>
        )}
      </div>
    </section>
  );
}

function DayBars({
  title,
  items,
  tone = 'warm',
}: {
  title: string;
  items: Array<{ day: string; count: number; secondary?: number }>;
  tone?: 'warm' | 'cool';
}) {
  const max = Math.max(...items.map((item) => item.count), 1);
  const barColor = tone === 'cool' ? 'var(--teal)' : 'var(--amber)';
  return (
    <section className="premium-card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h3>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, paddingBottom: 4 }}>
        {items.length ? (
          items.map((item) => (
            <div key={`${title}-${item.day}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
              <div
                style={{ width: '100%', background: barColor, borderRadius: '3px 3px 0 0', height: `${Math.max(10, (item.count / max) * 100)}%`, minHeight: 4, transition: 'height 200ms ease' }}
                title={`${item.day}: ${item.count}`}
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{item.day.slice(5)}</span>
            </div>
          ))
        ) : (
          <div className="empty-state" style={{ alignSelf: 'center' }}>Sin serie temporal.</div>
        )}
      </div>
    </section>
  );
}

export default function MoodleAnalyticsPanel({ apiBase }: MoodlAnalyticsPanelProps) {
  const [analyticsQueryParams, setAnalyticsQueryParams] = useState<string>('');
  const { data: options, loading, refresh: refreshOptions } = useFetch<AnalyticsOptionsResponse>(
    `${apiBase}/integrations/moodle-analytics/options?${analyticsQueryParams}`,
  );
  const { data: overview, refresh: refreshOverview } = useFetch<AnalyticsOverviewResponse>(
    `${apiBase}/integrations/moodle-analytics/overview?${analyticsQueryParams}`,
  );
  const [bannerBatchOptions, setBannerBatchOptions] = useState<BannerBatchOptionsResponse | null>(null);
  const [sidecarBatchOptions, setSidecarBatchOptions] = useState<SidecarBatchOptionsResponse | null>(null);
  const [dateReport, setDateReport] = useState<AttendanceDateReportResponse | null>(null);
  const [studentReport, setStudentReport] = useState<AttendanceStudentReportResponse | null>(null);
  const [message, setMessage] = useState('');
  const [dateLoading, setDateLoading] = useState(false);
  const [studentReportLoading, setStudentReportLoading] = useState(false);
  const [importingKind, setImportingKind] = useState<'attendance' | 'activity' | 'participants' | 'banner-enrollment' | null>(null);
  const [moodleSyncLoading, setMoodleSyncLoading] = useState(false);
  const [moodleQuickRun, setMoodleQuickRun] = useState<MoodleQuickRunState | null>(null);
  const [moodleSyncPeriodCodes, setMoodleSyncPeriodCodes] = useState<string[]>([]);
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatusResponse | null>(null);
  const [sidecarStatusCheckedAt, setSidecarStatusCheckedAt] = useState('');
  const [bannerImportPath, setBannerImportPath] = useState('');
  const [bannerImportPeriodCode, setBannerImportPeriodCode] = useState('');
  const [bannerImportNrc, setBannerImportNrc] = useState('');
  const [bannerImportSourceLabel, setBannerImportSourceLabel] = useState('');
  const [bannerAutomationPeriodCode, setBannerAutomationPeriodCode] = useState('');
  const [bannerAutomationPeriodCodes, setBannerAutomationPeriodCodes] = useState<string[]>([]);
  const [bannerAutomationNrcsText, setBannerAutomationNrcsText] = useState('');
  const [bannerAutomationLoading, setBannerAutomationLoading] = useState(false);
  const [bannerStatus, setBannerStatus] = useState<BannerStatusResponse | null>(null);
  const [bannerStatusLoading, setBannerStatusLoading] = useState(false);
  const [bannerStatusCheckedAt, setBannerStatusCheckedAt] = useState('');
  const [teacherAccessReport, setTeacherAccessReport] = useState<TeacherAccessReportResponse | null>(null);
  const [teacherAccessLoading, setTeacherAccessLoading] = useState(false);
  const [applyTeacherAccessLoading, setApplyTeacherAccessLoading] = useState(false);
  const [applyTeacherAccessResult, setApplyTeacherAccessResult] = useState<{ updated: number; skipped: number } | null>(null);
  const [bannerDatesLoading, setBannerDatesLoading] = useState(false);
  const [bannerDatesResult, setBannerDatesResult] = useState<{ updated: number; skipped: number; filesProcessed: number } | null>(null);
  const [moodleLogsLoading, setMoodleLogsLoading] = useState(false);
  const [moodleLogsResult, setMoodleLogsResult] = useState<{ processed: number; skipped: number; filesFound: number; details: Array<{ nrc: string; status: string; teacherDays?: number; ingresosScore?: number }> } | null>(null);
  const [syncActivityMoments, setSyncActivityMoments] = useState<string[]>(['1']);

  const [filters, setFilters] = useState<FilterState>({
    periodCodes: [],
    programCodes: [],
    campusCodes: [],
    teacherIds: [],
    nrcsText: '',
    sessionDay: '',
    sessionDays: [],
    moments: [],
  });

  const nrcCount = useMemo(() => parseNrcList(filters.nrcsText).length, [filters.nrcsText]);

  useEffect(() => {
    if (!options) return;
    setDateReport(null);
    setStudentReport(null);
    if (filters.sessionDay && !options.sessionDays.includes(filters.sessionDay)) {
      setFilters((current) => ({ ...current, sessionDay: '' }));
    }
    if (filters.sessionDays.some((day) => !options.sessionDays.includes(day))) {
      setFilters((current) => ({
        ...current,
        sessionDays: current.sessionDays.filter((day) => options.sessionDays.includes(day)),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  function loadOptionsAndOverview(nextFilters: FilterState) {
    setMessage('');
    const params = buildQuery(nextFilters);
    const nextQueryParams = params.toString();
    if (nextQueryParams === analyticsQueryParams) {
      void refreshOptions();
      void refreshOverview();
    } else {
      setAnalyticsQueryParams(nextQueryParams);
    }
  }

  async function loadBannerStatus(options: { silent?: boolean } = {}) {
    try {
      if (!options.silent) {
        setBannerStatusLoading(true);
      }
      const status = await fetchJson<BannerStatusResponse>('/api/banner/status');
      setBannerStatus(status);
      setBannerStatusCheckedAt(new Date().toISOString());
      return status;
    } catch (error) {
      if (!options.silent) {
        setMessage(`No se pudo consultar el estado de Banner: ${error instanceof Error ? error.message : String(error)}`);
      }
      return null;
    } finally {
      if (!options.silent) {
        setBannerStatusLoading(false);
      }
    }
  }

  async function loadBannerBatchOptions() {
    try {
      const data = await fetchJson<BannerBatchOptionsResponse>('/api/banner/batch/options');
      setBannerBatchOptions(data);
      setBannerAutomationPeriodCodes((current) => {
        if (current.length) return current;
        return [...new Set((data.defaults?.selectedPeriodCodes ?? []).map((value) => value.trim()).filter(Boolean))];
      });
    } catch (error) {
      setMessage(`No se pudieron cargar los periodos RPACA de Banner: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadSidecarStatus(options: { silent?: boolean } = {}) {
    try {
      const status = await fetchJson<SidecarStatusResponse>(`${apiBase}/integrations/moodle-sidecar/run/status`);
      setSidecarStatus(status);
      setSidecarStatusCheckedAt(new Date().toISOString());
      return status;
    } catch (error) {
      if (!options.silent) {
        setMessage(
          `No se pudo consultar el estado de la extraccion Moodle: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }
  }

  async function loadSidecarBatchOptions() {
    try {
      const data = await fetchJson<SidecarBatchOptionsResponse>(`${apiBase}/integrations/moodle-sidecar/run/batch/options`);
      setSidecarBatchOptions(data);
    } catch (error) {
      setMessage(
        `No se pudieron cargar los periodos RPACA de Moodle: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  useEffect(() => {
    void loadBannerStatus({ silent: true });
    void loadBannerBatchOptions();
    void loadSidecarStatus({ silent: true });
    void loadSidecarBatchOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!bannerAutomationLoading && !bannerStatus?.runner.running) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void loadBannerStatus({ silent: true });
    }, 1200);

    return () => {
      window.clearInterval(timer);
    };
  }, [bannerAutomationLoading, bannerStatus?.runner.running]);

  useEffect(() => {
    if (!moodleSyncLoading && !sidecarStatus?.running) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void loadSidecarStatus({ silent: true });
    }, 1400);

    return () => {
      window.clearInterval(timer);
    };
  }, [moodleSyncLoading, sidecarStatus?.running]);

  async function importLatest(
    kind: 'attendance' | 'activity' | 'participants' | 'banner-enrollment',
    options: { silent?: boolean; successMessage?: string } = {},
  ) {
    try {
      if (kind === 'banner-enrollment' && !bannerImportPath.trim()) {
        setMessage('Escribe la ruta del archivo oficial de matricula Banner antes de importarlo.');
        return;
      }
      setImportingKind(kind);
      if (!options.silent) {
        setMessage('');
      }
      const payload =
        kind === 'banner-enrollment'
          ? {
              inputPath: bannerImportPath.trim(),
              defaultPeriodCode: bannerImportPeriodCode.trim() || undefined,
              defaultNrc: bannerImportNrc.trim() || undefined,
              sourceLabel: bannerImportSourceLabel.trim() || undefined,
            }
          : {};
      await fetchJson(`${apiBase}/integrations/moodle-analytics/import/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!options.silent) {
        setMessage(
          options.successMessage ??
            (kind === 'attendance'
              ? 'Importacion de asistencia completada.'
              : kind === 'banner-enrollment'
                ? 'Matricula Banner importada. Las alertas ahora priorizan Banner donde exista esa matricula oficial.'
                : kind === 'participants'
                  ? 'Importacion de participantes completada. Reimporta actividad si quieres recalcular roles en los logs.'
                  : 'Importacion de actividad completada.'),
        );
      }
      await loadOptionsAndOverview(filters);
    } catch (error) {
      if (!options.silent) {
        setMessage(`No se pudo importar ${kind}: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    } finally {
      setImportingKind(null);
    }
  }

  function resolveMoodleSyncPeriods() {
    const available = (sidecarBatchOptions?.periods ?? []).filter((period) => period.courseCount > 0);
    const selected = moodleSyncPeriodCodes.length
      ? available.filter((period) => moodleSyncPeriodCodes.includes(period.code))
      : available;
    return selected.map((period) => period.code);
  }

  function delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function waitForSidecarCompletion(command: SidecarRunCommand) {
    for (;;) {
      const status = await loadSidecarStatus({ silent: true });
      const current = status?.current ?? null;
      const lastRun = status?.lastRun ?? null;
      const relevantRun = current?.command === command ? current : lastRun?.command === command ? lastRun : null;

      if (current?.command === command && current.status === 'RUNNING') {
        await delay(1500);
        continue;
      }

      if (!relevantRun) {
        await delay(1500);
        continue;
      }

      if (relevantRun.status === 'COMPLETED') {
        return status;
      }
      if (relevantRun.status === 'CANCELLED') {
        throw new Error(`La extraccion de ${formatSidecarCommand(command)} fue cancelada.`);
      }
      if (relevantRun.status === 'FAILED') {
        throw new Error(`La extraccion de ${formatSidecarCommand(command)} termino con error.`);
      }

      await delay(1500);
    }
  }

  async function runMoodleQuickSync(kind: MoodleQuickSyncKind, opts: { moments?: string[]; autoCalcTeacherReport?: boolean; source?: 'ALL' | 'SAMPLING'; workers?: number } = {}) {
    const sequence: SidecarRunCommand[] =
      kind === 'all' ? ['participants', 'activity', 'attendance'] : [kind];
    const periodCodes = resolveMoodleSyncPeriods();

    if (!periodCodes.length) {
      setMessage('No hay periodos RPACA con aulas Moodle resueltas para ejecutar la corrida masiva.');
      return;
    }

    if (sidecarStatus?.running) {
      setMessage('Ya hay una extraccion Moodle en curso. Espera a que termine o cancelala antes de iniciar otra.');
      return;
    }

    try {
      setMoodleSyncLoading(true);
      setMoodleQuickRun({
        kind,
        totalSteps: sequence.length,
        currentStep: 1,
        currentCommand: sequence[0] ?? null,
        phase: 'EXTRACTING',
      });
      const momentLabel = opts.moments?.length ? ` (momento ${opts.moments.join(', ')})` : '';
      setMessage(`Extraccion Moodle${momentLabel} iniciada. Esta pantalla ira importando cada bloque en cuanto termine.`);

      for (const [index, command] of sequence.entries()) {
        setMoodleQuickRun({
          kind,
          totalSteps: sequence.length,
          currentStep: index + 1,
          currentCommand: command,
          phase: 'EXTRACTING',
        });

        const syncBody: Record<string, unknown> = { source: opts.source ?? 'ALL', periodCodes };
        if (opts.moments?.length) syncBody.moments = opts.moments;
        if (opts.workers && opts.workers > 1) syncBody.workers = opts.workers;

        await fetchJson(`${apiBase}/integrations/moodle-sidecar/run/start-${command}-from-db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(syncBody),
        });

        await loadSidecarStatus({ silent: true });
        await waitForSidecarCompletion(command);

        setMoodleQuickRun({
          kind,
          totalSteps: sequence.length,
          currentStep: index + 1,
          currentCommand: command,
          phase: 'IMPORTING',
        });

        await importLatest(command, { silent: true });
      }

      setMoodleQuickRun({
        kind,
        totalSteps: sequence.length,
        currentStep: sequence.length,
        currentCommand: sequence.length ? sequence[sequence.length - 1] : null,
        phase: 'DONE',
      });
      await loadSidecarStatus({ silent: true });
      setMessage(
        kind === 'all'
          ? 'La actualizacion masiva de participantes, actividad y asistencia ya termino.'
          : `La actualizacion de ${formatSidecarCommand(kind)} ya termino.`,
      );
      if (opts.autoCalcTeacherReport || kind === 'activity' || kind === 'all') {
        await loadTeacherAccessReport();
      }
    } catch (error) {
      setMoodleQuickRun((current) =>
        current
          ? {
              ...current,
              phase: 'FAILED',
            }
          : null,
      );
      await loadSidecarStatus({ silent: true });
      setMessage(`No se pudo completar la corrida Moodle: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMoodleSyncLoading(false);
    }
  }

  async function cancelMoodleQuickSync() {
    try {
      await fetchJson(`${apiBase}/integrations/moodle-sidecar/run/cancel`, {
        method: 'POST',
      });
      await loadSidecarStatus({ silent: true });
      setMoodleSyncLoading(false);
      setMoodleQuickRun((current) =>
        current
          ? {
              ...current,
              phase: 'FAILED',
            }
          : null,
      );
      setMessage('Cancelacion enviada al proceso Moodle.');
    } catch (error) {
      setMessage(`No se pudo cancelar la corrida Moodle: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function importBannerFromAutomation() {
    const selectedPeriodCodes = [...new Set(filters.periodCodes.map((value) => value.trim()).filter(Boolean))];
    const selectedAutomationPeriodCodes = [...new Set(bannerAutomationPeriodCodes.map((value) => value.trim()).filter(Boolean))];
    const allAvailablePeriodCodes = [
      ...new Set((bannerBatchOptions?.periods ?? []).map((item) => item.code.trim()).filter(Boolean)),
    ];
    const explicitPeriodCode = bannerAutomationPeriodCode.trim();
    const singleAutomationPeriodCode = selectedAutomationPeriodCodes.length === 1 ? selectedAutomationPeriodCodes[0] : '';
    const periodCode =
      explicitPeriodCode ||
      singleAutomationPeriodCode ||
      (selectedPeriodCodes.length === 1 ? selectedPeriodCodes[0] : '');
    const nrcs = parseNrcList(bannerAutomationNrcsText || filters.nrcsText);

    const payload = nrcs.length
      ? (() => {
          if (!periodCode) {
            setMessage('Escribe el periodo Banner o deja un solo periodo seleccionado en los filtros antes de automatizar la matricula.');
            return null;
          }

          return {
            periodCode,
            nrcs,
            sourceLabel: bannerImportSourceLabel.trim() || undefined,
          };
        })()
      : (() => {
          const periodCodes = explicitPeriodCode
            ? [explicitPeriodCode]
            : selectedAutomationPeriodCodes.length
              ? selectedAutomationPeriodCodes
            : selectedPeriodCodes.length
              ? selectedPeriodCodes
              : allAvailablePeriodCodes;
          if (!periodCodes.length) {
            setMessage('No hay periodos disponibles para recorrer las aulas cargadas por RPACA.');
            return null;
          }

          return {
            periodCodes,
            sourceLabel: bannerImportSourceLabel.trim() || undefined,
          };
        })();

    if (!payload) return;

    try {
      setBannerAutomationLoading(true);
      setMessage('Solicitud enviada a Banner. Puedes seguir el avance en el bloque de seguimiento de esta misma pantalla.');
      void loadBannerStatus({ silent: true });
      const result = await fetchJson<BannerAutomationImportResponse>('/api/banner/enrollment/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      await loadBannerStatus({ silent: true });
      setMessage(
        `Matricula Banner importada. NRC consultados: ${result.result.export.processedCourses}. ` +
          `Reportes cargados: ${result.result.import.importedReports}. ` +
          `Estudiantes cargados: ${result.result.import.importedStudents}.`,
      );
      await loadOptionsAndOverview(filters);
    } catch (error) {
      await loadBannerStatus({ silent: true });
      setMessage(
        `No se pudo automatizar la matricula Banner: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBannerAutomationLoading(false);
    }
  }

  async function loadTeacherAccessReport() {
    try {
      setTeacherAccessLoading(true);
      setMessage('');
      const params = buildQuery(filters);
      const result = await fetchJson<TeacherAccessReportResponse>(
        `${apiBase}/integrations/moodle-analytics/teacher-access-report?${params.toString()}`,
      );
      setTeacherAccessReport(result);
    } catch (error) {
      setMessage(`No se pudo cargar el reporte de ingresos docente: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTeacherAccessLoading(false);
    }
  }

  async function importMoodleLogsFromFolder() {
    try {
      setMoodleLogsLoading(true);
      setMessage('');
      const periodCode = filters.periodCodes[0] ?? '';
      const result = await fetchJson<{ ok: boolean; processed: number; skipped: number; filesFound: number; details: Array<{ nrc: string; status: string; teacherDays?: number; ingresosScore?: number }> }>(
        `${apiBase}/import/moodle-log-folder`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ periodCode }),
        },
      );
      setMoodleLogsResult(result);
      setMessage(`Logs Moodle procesados: ${result.processed} NRCs con ingresos actualizados, ${result.skipped} sin procesar.`);
    } catch (error) {
      setMessage(`Error procesando logs Moodle: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMoodleLogsLoading(false);
    }
  }

  async function importBannerDatesFromFolder() {
    try {
      setBannerDatesLoading(true);
      setMessage('');
      const periodCode = filters.periodCodes[0] ?? '';
      const result = await fetchJson<{ ok: boolean; updated: number; skipped: number; filesProcessed: number; message?: string }>(
        `${apiBase}/import/banner-dates-folder`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ periodCode }),
        },
      );
      setBannerDatesResult({ updated: result.updated, skipped: result.skipped, filesProcessed: result.filesProcessed ?? 0 });
      setMessage(result.message ?? `Fechas Banner importadas: ${result.updated} cursos actualizados, ${result.skipped} sin cambios. Los ingresos se recalcularon automaticamente.`);
    } catch (error) {
      setMessage(`Error importando fechas Banner: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBannerDatesLoading(false);
    }
  }

  async function applyTeacherAccessToChecklists() {
    try {
      setApplyTeacherAccessLoading(true);
      setMessage('');
      const params = buildQuery(filters);
      const result = await fetchJson<{ ok: boolean; summary: { total: number; updated: number; skipped: number } }>(
        `${apiBase}/integrations/moodle-analytics/apply-teacher-access`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(params)),
        },
      );
      setApplyTeacherAccessResult(result.summary);
      setMessage(
        `Ingresos aplicados al checklist de ejecucion: ${result.summary.updated} NRCs actualizados, ${result.summary.skipped} sin evaluacion previa creada.`,
      );
    } catch (error) {
      setMessage(`No se pudo aplicar ingresos al checklist: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setApplyTeacherAccessLoading(false);
    }
  }

  async function loadDateReport() {
    if (!filters.sessionDay) {
      setMessage('Selecciona una fecha de asistencia antes de consultar el reporte puntual.');
      return;
    }
    try {
      setDateLoading(true);
      setMessage('');
      const params = buildQuery(filters);
      params.set('sessionDay', filters.sessionDay);
      const result = await fetchJson<AttendanceDateReportResponse>(
        `${apiBase}/integrations/moodle-analytics/attendance/date-report?${params.toString()}`,
      );
      setDateReport(result);
    } catch (error) {
      setMessage(`No se pudo cargar el reporte por fecha: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDateLoading(false);
    }
  }

  function exportDateReportCsv() {
    if (!dateReport?.courses.length) return;
    const rows = [
      [
        'fecha',
        'periodo',
        'nrc',
        'curso',
        'programa',
        'sede',
        'docente',
        'participantes',
        'presentes',
        'ausentes',
        'justificados',
        'attendance_rate',
        'student_name',
        'student_email',
        'student_id',
      ].join(','),
    ];

    for (const course of dateReport.courses) {
      const students = course.presentStudents.length ? course.presentStudents : [{ fullName: '', email: '', institutionalId: '' }];
      for (const student of students) {
        rows.push(
          [
            filters.sessionDay,
            course.periodCode,
            course.nrc,
            course.subjectName ?? '',
            course.programName ?? '',
            course.campusCode ?? '',
            course.teacherName ?? '',
            String(course.participantCount),
            String(course.presentCount),
            String(course.absentCount),
            String(course.justifiedCount),
            formatPercent(course.attendanceRate),
            student.fullName,
            student.email ?? '',
            student.institutionalId ?? '',
          ]
            .map((value) => escapeCsvCell(value))
            .join(','),
        );
      }
    }

    const blob = new Blob([`${rows.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `reporte_asistencia_${filters.sessionDay}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function loadStudentAttendanceReport() {
    if (!filters.sessionDays.length) {
      setMessage('Selecciona una o varias fechas de asistencia antes de generar el reporte de estudiantes.');
      return;
    }
    try {
      setStudentReportLoading(true);
      setMessage('');
      const params = buildQuery(filters);
      params.set('sessionDays', filters.sessionDays.join(','));
      const result = await fetchJson<AttendanceStudentReportResponse>(
        `${apiBase}/integrations/moodle-analytics/attendance/student-report?${params.toString()}`,
      );
      setStudentReport(result);
      setMessage(`Reporte generado: ${result.summary.rowCount} registros de asistencia.`);
    } catch (error) {
      setMessage(`No se pudo generar el reporte de estudiantes: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setStudentReportLoading(false);
    }
  }

  function exportStudentAttendanceCsv() {
    if (!studentReport?.rows.length) return;
    const rows = [
      [
        'fecha',
        'sesion',
        'periodo',
        'nrc',
        'curso',
        'programa',
        'sede',
        'docente',
        'estudiante',
        'correo',
        'id_estudiante',
        'estado',
        'codigo_estado',
        'valor_original',
      ].join(','),
    ];

    for (const row of studentReport.rows) {
      rows.push(
        [
          row.sessionDay,
          row.sessionLabel,
          row.periodCode,
          row.nrc,
          row.subjectName ?? '',
          row.programName ?? '',
          row.campusCode ?? '',
          row.teacherName ?? '',
          row.studentName,
          row.studentEmail ?? '',
          row.studentId ?? '',
          row.statusLabel,
          row.statusCode ?? '',
          row.rawValue ?? '',
        ]
          .map((value) => escapeCsvCell(value))
          .join(','),
      );
    }

    const suffix = filters.sessionDays.length === 1 ? filters.sessionDays[0] : `${filters.sessionDays.length}_fechas`;
    const blob = new Blob([`${rows.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `reporte_asistencia_estudiantes_${suffix}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportAlertsCsv() {
    if (!overview?.alerts.users.length) return;
    const rows = [
      [
        'tipo_alerta',
        'nrc',
        'curso',
        'programa',
        'sede',
        'docente',
        'usuario',
        'correo',
        'id_institucional',
        'categoria_actor',
        'rol_visible',
        'conteo',
        'detalle',
      ].join(','),
    ];

    for (const user of overview.alerts.users) {
      rows.push(
        [
          user.kindLabel,
          user.nrc,
          user.subjectName ?? '',
          user.programName ?? '',
          user.campusCode ?? '',
          user.teacherName ?? '',
          user.fullName,
          user.email ?? '',
          user.institutionalId ?? '',
          user.actorCategory ?? '',
          user.rolesLabel ?? '',
          String(user.count),
          user.detail,
        ]
          .map((value) => escapeCsvCell(value))
          .join(','),
      );
    }

    const blob = new Blob([`${rows.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'seguimiento_alertas_moodle.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const attendanceDayBars = overview?.attendance.byDay.slice(-14).map((item) => ({
    day: item.day,
    count: item.present,
  })) ?? [];
  const activityDayBars = overview?.activity.byDay.slice(-14) ?? [];
  const sidecarVisibleRun = sidecarStatus?.current ?? sidecarStatus?.lastRun ?? null;
  const sidecarArtifact = sidecarStatus?.artifactSummary ?? null;
  const sidecarAvailablePeriods = (sidecarBatchOptions?.periods ?? []).filter((period) => period.courseCount > 0);
  const sidecarSelectedPeriods = moodleSyncPeriodCodes.length
    ? sidecarAvailablePeriods.filter((period) => moodleSyncPeriodCodes.includes(period.code))
    : sidecarAvailablePeriods;
  const sidecarSelectedCourseCount = sidecarSelectedPeriods.reduce((total, period) => total + period.courseCount, 0);
  const sidecarProgressCount = sidecarArtifact
    ? sidecarArtifact.completedCourses + sidecarArtifact.failedCourses + sidecarArtifact.skippedCourses
    : 0;
  const sidecarProgressPercent =
    sidecarArtifact?.totalCourses && sidecarArtifact.totalCourses > 0
      ? Math.min(100, Math.round((sidecarProgressCount / sidecarArtifact.totalCourses) * 100))
      : null;
  const moodleQuickRunLabel =
    moodleQuickRun?.currentCommand != null ? formatSidecarCommand(moodleQuickRun.currentCommand) : 'Moodle';
  const moodleQuickRunCopy =
    moodleQuickRun?.phase === 'IMPORTING'
      ? `Importando ${moodleQuickRunLabel} en la analitica.`
      : moodleQuickRun?.phase === 'DONE'
        ? 'La corrida masiva ya termino y los indicadores se actualizaron.'
        : moodleQuickRun?.phase === 'FAILED'
          ? 'La ultima corrida masiva se detuvo con error o cancelacion.'
          : moodleQuickRun?.phase === 'EXTRACTING'
            ? `Extrayendo ${moodleQuickRunLabel} desde las aulas Moodle.`
            : sidecarVisibleRun?.status === 'RUNNING'
              ? `Extrayendo ${formatSidecarCommand(sidecarVisibleRun.command)} desde Moodle.`
              : 'Todavia no hay una corrida masiva de Moodle en curso.';
  const bannerCurrentRun = bannerStatus?.runner.current?.command === 'enrollment' ? bannerStatus.runner.current : null;
  const bannerLastRun = bannerStatus?.runner.lastRun?.command === 'enrollment' ? bannerStatus.runner.lastRun : null;
  const bannerVisibleRun = bannerCurrentRun ?? bannerLastRun;
  const bannerLiveActivity = bannerStatus?.runner.liveActivity ?? null;
  const bannerProgressPercent =
    bannerLiveActivity?.totalRequested && bannerLiveActivity.totalRequested > 0
      ? Math.min(100, Math.round((bannerLiveActivity.processed / bannerLiveActivity.totalRequested) * 100))
      : null;
  const bannerLeadEvent = bannerLiveActivity?.recentEvents[0] ?? null;
  const bannerPhaseLabel = formatBannerPhase(bannerLiveActivity?.phase, bannerVisibleRun?.status);
  const bannerRateLabel = formatRatePerMinute(
    bannerLiveActivity?.processed ?? 0,
    bannerVisibleRun?.startedAt,
    bannerVisibleRun?.endedAt,
  );
  const bannerEtaLabel = formatEta(
    bannerLiveActivity?.totalRequested,
    bannerLiveActivity?.processed ?? 0,
    bannerVisibleRun?.startedAt,
    bannerVisibleRun?.endedAt,
  );
  const bannerCurrentTarget =
    bannerLiveActivity?.currentNrc || bannerLiveActivity?.currentPeriod
      ? `${bannerLiveActivity?.currentNrc ?? 'Sin NRC'}${bannerLiveActivity?.currentPeriod ? ` · ${bannerLiveActivity.currentPeriod}` : ''}`
      : bannerLeadEvent?.nrc || bannerLeadEvent?.period
        ? `${bannerLeadEvent?.nrc ?? 'Sin NRC'}${bannerLeadEvent?.period ? ` · ${bannerLeadEvent.period}` : ''}`
        : '-';
  const bannerRunStateText = bannerCurrentRun
    ? describeBannerEvent(bannerLeadEvent)
    : bannerVisibleRun?.status === 'COMPLETED'
      ? 'La ultima corrida de matricula Banner termino correctamente.'
      : bannerVisibleRun?.status === 'FAILED'
        ? 'La ultima corrida de matricula Banner termino con error.'
        : bannerVisibleRun?.status === 'CANCELLED'
          ? 'La ultima corrida de matricula Banner fue cancelada.'
          : 'Todavia no hay una corrida de matricula Banner registrada en esta pantalla.';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="hero-banner">
        <div className="hero-banner-body">
          <div className="hero-banner-copy">
            <h2 className="hero-banner-title">Revision masiva de asistencia y uso</h2>
            <p style={{ margin: '6px 0 0', maxWidth: '72ch', color: 'rgba(255,255,255,0.75)', lineHeight: 1.45 }}>
              Ejecuta la extraccion de Moodle por periodos RPACA y deja la analitica actualizada sin ir a otras
              pantallas ni importar archivos a mano.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              style={{ background: '#fff', color: 'var(--teal)', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
              onClick={() => void runMoodleQuickSync('all')}
              disabled={moodleSyncLoading || !!importingKind}
            >
              {moodleSyncLoading && moodleQuickRun?.kind === 'all' ? 'Actualizando Moodle...' : 'Actualizar todo Moodle'}
            </button>
            <Button variant="ghost" size="sm" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' } as React.CSSProperties} onClick={() => void loadOptionsAndOverview(filters)} disabled={loading}>
              {loading ? 'Actualizando...' : 'Refrescar indicadores'}
            </Button>
            {sidecarStatus?.running && (
              <Button variant="ghost" size="sm" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' } as React.CSSProperties} onClick={() => void cancelMoodleQuickSync()}>
                Cancelar corrida
              </Button>
            )}
          </div>
        </div>
      </section>

      {message ? <AlertBox tone={message.startsWith('No se pud') ? 'error' : message.startsWith('Ya hay') || message.startsWith('Escribe') ? 'warn' : 'info'}>{message}</AlertBox> : null}

      <section className="premium-card" style={{ padding: '20px', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <h3>Periodos para la corrida masiva</h3>
            <small>
              {moodleSyncPeriodCodes.length
                ? `${sidecarSelectedPeriods.length} periodos seleccionados · ${formatCompactCount(sidecarSelectedCourseCount)} aulas listas para revisar`
                : `Sin seleccion manual: se usaran todos los periodos RPACA con aulas resueltas (${formatCompactCount(
                    sidecarAvailablePeriods.length,
                  )} periodos · ${formatCompactCount(
                    sidecarAvailablePeriods.reduce((total, period) => total + period.courseCount, 0),
                  )} aulas)`}
            </small>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMoodleSyncPeriodCodes(sidecarAvailablePeriods.map((period) => period.code))}
              disabled={!sidecarAvailablePeriods.length}
            >
              Seleccionar todos
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMoodleSyncPeriodCodes([])}
              disabled={!moodleSyncPeriodCodes.length}
            >
              Usar todos sin marcar
            </Button>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sidecarAvailablePeriods.length ? (
            sidecarAvailablePeriods.map((period) => (
              <button
                type="button"
                key={`sidecar-period-${period.code}`}
                style={{
                  border: `1px solid ${moodleSyncPeriodCodes.includes(period.code) ? 'var(--teal)' : 'var(--line)'}`,
                  background: moodleSyncPeriodCodes.includes(period.code) ? 'var(--teal)' : 'var(--surface)',
                  color: moodleSyncPeriodCodes.includes(period.code) ? '#fff' : 'var(--slate-700)',
                  borderRadius: 6,
                  padding: '5px 10px',
                  fontSize: '0.78rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
                onClick={() => setMoodleSyncPeriodCodes((current) => togglePeriodCode(current, period.code))}
              >
                {period.code}
              </button>
            ))
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic' }}>Todavia no hay periodos RPACA con aulas Moodle listas para la corrida masiva.</span>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void runMoodleQuickSync('participants')}
            disabled={moodleSyncLoading || !!importingKind}
          >
            {moodleSyncLoading && moodleQuickRun?.currentCommand === 'participants' ? 'Extrayendo...' : 'Solo participantes'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void runMoodleQuickSync('activity')}
            disabled={moodleSyncLoading || !!importingKind}
          >
            {moodleSyncLoading && moodleQuickRun?.currentCommand === 'activity' ? 'Extrayendo...' : 'Solo actividad'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void runMoodleQuickSync('attendance')}
            disabled={moodleSyncLoading || !!importingKind}
          >
            {moodleSyncLoading && moodleQuickRun?.currentCommand === 'attendance' ? 'Extrayendo...' : 'Solo asistencia'}
          </Button>
        </div>
      </section>

      <section className="premium-card" style={{ padding: '20px', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <h3>Seguimiento de la extraccion Moodle</h3>
            <small>{moodleQuickRunCopy}</small>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: (sidecarVisibleRun?.status ?? 'COMPLETED') === 'RUNNING' ? 'var(--teal)' : (sidecarVisibleRun?.status ?? 'COMPLETED') === 'FAILED' ? 'var(--red)' : (sidecarVisibleRun?.status ?? 'COMPLETED') === 'CANCELLED' ? 'var(--amber)' : 'var(--n-200)', color: (sidecarVisibleRun?.status ?? 'COMPLETED') === 'RUNNING' || (sidecarVisibleRun?.status ?? 'COMPLETED') === 'FAILED' ? '#fff' : 'var(--slate-700)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
              {sidecarVisibleRun?.status ?? 'LISTO'}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void loadSidecarStatus()} disabled={moodleSyncLoading}>
              Actualizar seguimiento
            </Button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
          <div style={{ border: '1px solid var(--line)', background: 'var(--n-50)', borderRadius: 8, padding: 12, display: 'grid', gap: 4 }}>
            <span>Bloque actual</span>
            <strong>{formatSidecarCommand(moodleQuickRun?.currentCommand ?? sidecarVisibleRun?.command ?? null)}</strong>
            <small>
              {moodleQuickRun
                ? `Paso ${moodleQuickRun.currentStep} de ${moodleQuickRun.totalSteps}`
                : sidecarVisibleRun?.startedAt
                  ? `Ultima corrida: ${formatDateTime(sidecarVisibleRun.startedAt)}`
                  : 'Sin corrida registrada'}
            </small>
          </div>
          <div style={{ border: '1px solid var(--line)', background: 'var(--n-50)', borderRadius: 8, padding: 12, display: 'grid', gap: 4 }}>
            <span>Inicio</span>
            <strong>{formatDateTime(sidecarVisibleRun?.startedAt)}</strong>
            <small>Ultima lectura {formatDateTime(sidecarStatusCheckedAt)}</small>
          </div>
          <div style={{ border: '1px solid var(--line)', background: 'var(--n-50)', borderRadius: 8, padding: 12, display: 'grid', gap: 4 }}>
            <span>Duracion</span>
            <strong>{formatDuration(sidecarVisibleRun?.startedAt, sidecarVisibleRun?.endedAt)}</strong>
            <small>{sidecarStatus?.running ? 'Extraccion en curso' : 'Proceso inactivo'}</small>
          </div>
          <div style={{ border: '1px solid var(--line)', background: 'var(--n-50)', borderRadius: 8, padding: 12, display: 'grid', gap: 4 }}>
            <span>Cobertura del lote</span>
            <strong>
              {sidecarArtifact
                ? `${formatCompactCount(sidecarProgressCount)} / ${formatCompactCount(sidecarArtifact.totalCourses)}`
                : formatCompactCount(sidecarSelectedCourseCount)}
            </strong>
            <small>
              {sidecarArtifact ? `${sidecarProgressPercent ?? 0}% procesado` : 'Se calculara en cuanto arranque la corrida'}
            </small>
          </div>
        </div>

        <div style={{ height: 6, background: 'var(--n-100)', borderRadius: 3, overflow: 'hidden' }} aria-hidden="true">
          <span style={{ display: 'block', height: '100%', width: `${sidecarProgressPercent ?? (sidecarStatus?.running ? 8 : 100)}%`, background: 'var(--teal)', borderRadius: 3, transition: 'width 500ms ease' }} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', color: 'var(--muted)', fontSize: '0.78rem' }}>
          <span>Total aulas: <strong>{formatCompactCount(sidecarArtifact?.totalCourses ?? sidecarSelectedCourseCount)}</strong></span>
          <span>Completadas: <strong>{formatCompactCount(sidecarArtifact?.completedCourses ?? 0)}</strong></span>
          <span>Fallidas: <strong>{formatCompactCount(sidecarArtifact?.failedCourses ?? 0)}</strong></span>
          <span>Sin archivo: <strong>{formatCompactCount(sidecarArtifact?.skippedCourses ?? 0)}</strong></span>
        </div>

        {sidecarStatus?.logTail ? (
          <details style={{ marginTop: 8 }}>
            <summary>Ver ultimo tramo de la extraccion Moodle</summary>
            <pre>{sidecarStatus.logTail}</pre>
          </details>
        ) : null}
      </section>

      <details className="premium-card" style={{ padding: 0, overflow: 'hidden', display: 'grid', gap: 18 }}>
        <summary style={{ listStyle: 'none', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', cursor: 'pointer', padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <strong>Herramientas avanzadas y matricula Banner</strong>
            <small>Importaciones manuales, automatizacion Banner y ajustes puntuales.</small>
          </div>
          <span>Abrir</span>
        </summary>
        <div style={{ display: 'grid', gap: 18, padding: '18px 20px 20px' }}>
          <div>
            <div style={{ marginBottom: 12 }}>
              <h4>Logs de acceso Moodle por docente</h4>
              <p>
                Exporta el log de actividad desde Moodle para cada NRC y guardalo en{' '}
                <code>storage/imports/moodle-logs/</code> con nombre <code>logs_NRC_*.csv</code>{' '}
                (ej: <code>logs_15-79471_20260328.csv</code>). El sistema identifica al docente, cuenta sus dias de acceso y actualiza el puntaje de ingresos.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Button variant="primary" size="sm" onClick={() => void importMoodleLogsFromFolder()} disabled={moodleLogsLoading}>
                {moodleLogsLoading ? 'Procesando logs...' : 'Procesar logs de acceso Moodle'}
              </Button>
            </div>
            {moodleLogsResult && (
              <div>
                <small>
                  Archivos: <strong>{moodleLogsResult.filesFound}</strong> &middot; Procesados:{' '}
                  <strong>{moodleLogsResult.processed}</strong> &middot; Omitidos: <strong>{moodleLogsResult.skipped}</strong>
                </small>
                {moodleLogsResult.details.filter((d) => d.status === 'OK').length > 0 && (
                  <ul style={{ fontSize: 12, marginTop: 6, paddingLeft: 16 }}>
                    {moodleLogsResult.details.filter((d) => d.status === 'OK').map((d) => (
                      <li key={d.nrc}>
                        {d.nrc}: {d.teacherDays} dias acceso → ingresos <strong>{d.ingresosScore}/10</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div style={{ marginTop: 18 }}>
            <div style={{ marginBottom: 12 }}>
              <h4>Fechas Banner desde carpeta</h4>
              <p>
                Coloca un CSV con columnas <code>nrc, period, start_date, end_date</code> en{' '}
                <code>storage/imports/banner-dates/</code> y haz clic para importar. Los ingresos se recalculan automaticamente.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Button variant="primary" size="sm" onClick={() => void importBannerDatesFromFolder()} disabled={bannerDatesLoading}>
                {bannerDatesLoading ? 'Importando fechas...' : 'Importar fechas Banner desde carpeta'}
              </Button>
            </div>
            {bannerDatesResult && (
              <small>
                Archivos: <strong>{bannerDatesResult.filesProcessed}</strong> &middot; Actualizados:{' '}
                <strong>{bannerDatesResult.updated}</strong> &middot; Sin cambios: <strong>{bannerDatesResult.skipped}</strong>
              </small>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Button variant="primary" size="sm" onClick={() => void importLatest('participants')} disabled={!!importingKind}>
              {importingKind === 'participants' ? 'Importando participantes...' : 'Importar ultimos participantes'}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void importLatest('activity')} disabled={!!importingKind}>
              {importingKind === 'activity' ? 'Importando actividad...' : 'Importar ultima actividad'}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void importLatest('attendance')} disabled={!!importingKind}>
              {importingKind === 'attendance' ? 'Importando asistencia...' : 'Importar ultima asistencia'}
            </Button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
            <h3>Matricula oficial Banner</h3>
            <small>Si este archivo existe, la analitica toma Banner como roster principal por NRC y periodo.</small>
          </div>
        <div style={{ marginTop: 18 }}>
          <div style={{ marginBottom: 12 }}>
            <h4>Importar archivo ya descargado</h4>
            <p>Usa esta opcion si ya tienes un export de matricula oficial generado fuera de esta pantalla.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginTop: 8 }}>
            <label style={{ gridColumn: 'span 2', display: 'grid', gap: 6 }}>
              <span>Ruta del archivo Banner</span>
              <input
                value={bannerImportPath}
                onChange={(event) => setBannerImportPath(event.target.value)}
                placeholder="storage/exports/banner_matricula_oficial.xlsx"
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Periodo por defecto</span>
              <input
                value={bannerImportPeriodCode}
                onChange={(event) => setBannerImportPeriodCode(event.target.value)}
                placeholder="202615"
              />
              <small>Usalo si el archivo no trae columna de periodo.</small>
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>NRC por defecto</span>
              <input value={bannerImportNrc} onChange={(event) => setBannerImportNrc(event.target.value)} placeholder="15-72305" />
              <small>Solo aplica si el export corresponde a un NRC puntual.</small>
            </label>
            <label style={{ gridColumn: 'span 2', display: 'grid', gap: 6 }}>
              <span>Etiqueta del corte</span>
              <input
                value={bannerImportSourceLabel}
                onChange={(event) => setBannerImportSourceLabel(event.target.value)}
                placeholder="matricula-banner-corte-marzo"
              />
              <small>Sirve para identificar la importacion en los snapshots internos.</small>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Button variant="primary" size="sm" onClick={() => void importLatest('banner-enrollment')} disabled={!!importingKind}>
                {importingKind === 'banner-enrollment' ? 'Importando Banner...' : 'Importar matricula Banner'}
              </Button>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={{ marginBottom: 12 }}>
            <h4>Consultar Banner desde esta pantalla</h4>
            <p>El sistema entra a Banner, busca el periodo y los NRC indicados, y luego importa la matricula oficial.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginTop: 8 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Periodo Banner</span>
              <input
                value={bannerAutomationPeriodCode}
                onChange={(event) => setBannerAutomationPeriodCode(event.target.value)}
                placeholder={
                  bannerAutomationPeriodCodes.length === 1
                    ? bannerAutomationPeriodCodes[0]
                    : filters.periodCodes.length === 1
                      ? filters.periodCodes[0]
                      : '202615'
                }
              />
              <small>Usalo para una consulta puntual o para forzar un unico periodo. Si lo dejas vacio, puedes usar la seleccion multiple de abajo.</small>
            </label>
            <label style={{ gridColumn: 'span 2', display: 'grid', gap: 6 }}>
              <span>NRCs a consultar en Banner</span>
              <textarea
                value={bannerAutomationNrcsText}
                onChange={(event) => setBannerAutomationNrcsText(event.target.value)}
                rows={3}
                placeholder="72307, 72308, 72310"
              />
              <small>Si lo dejas vacio, recorre todas las aulas RPACA de los periodos elegidos abajo. Si no eliges periodos, usa todos los periodos RPACA disponibles. Si escribes NRCs, usa ese listado puntual.</small>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Button variant="primary" size="sm" onClick={() => void importBannerFromAutomation()} disabled={bannerAutomationLoading}>
                {bannerAutomationLoading ? 'Consultando Banner...' : 'Buscar matricula en Banner e importar'}
              </Button>
            </div>
          </div>

          <div style={{ marginTop: 14, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--n-50)', padding: 14, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h5>Periodos RPACA para la corrida masiva</h5>
                <p>Esta lista sale de los periodos cargados en la base por RPACA. Puedes marcar varios o dejar todo vacio para recorrerlos todos.</p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBannerAutomationPeriodCodes((bannerBatchOptions?.periods ?? []).map((item) => item.code))}
                  disabled={!(bannerBatchOptions?.periods?.length)}
                >
                  Seleccionar todos
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBannerAutomationPeriodCodes([])}
                  disabled={!bannerAutomationPeriodCodes.length}
                >
                  Limpiar seleccion
                </Button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(bannerBatchOptions?.periods ?? []).length ? (
                bannerBatchOptions?.periods.map((period) => (
                  <button
                    type="button"
                    key={`banner-period-${period.code}`}
                    style={{
                      border: `1px solid ${bannerAutomationPeriodCodes.includes(period.code) ? 'var(--teal)' : 'var(--line)'}`,
                      background: bannerAutomationPeriodCodes.includes(period.code) ? 'var(--teal)' : 'var(--surface)',
                      color: bannerAutomationPeriodCodes.includes(period.code) ? '#fff' : 'var(--slate-700)',
                      borderRadius: 6,
                      padding: '5px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                    onClick={() =>
                      setBannerAutomationPeriodCodes((current) => togglePeriodCode(current, period.code))
                    }
                  >
                    {period.code}
                  </button>
                ))
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontStyle: 'italic' }}>Todavia no hay periodos RPACA disponibles para Banner.</span>
              )}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
              {bannerAutomationPeriodCodes.length ? (
                <span>
                  Periodos seleccionados para la automatizacion: <strong>{bannerAutomationPeriodCodes.join(', ')}</strong>
                </span>
              ) : (
                <span>Sin seleccion manual: la automatizacion tomara <strong>todos los periodos RPACA disponibles</strong>.</span>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--n-50)', padding: 16, display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div>
                <h4>Seguimiento de Banner</h4>
                <p>{bannerRunStateText}</p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {bannerVisibleRun ? (
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: bannerVisibleRun.status === 'RUNNING' ? 'var(--teal)' : bannerVisibleRun.status === 'FAILED' ? 'var(--red)' : bannerVisibleRun.status === 'CANCELLED' ? 'var(--amber)' : 'var(--n-200)', color: bannerVisibleRun.status === 'RUNNING' || bannerVisibleRun.status === 'FAILED' ? '#fff' : 'var(--slate-700)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                    {bannerVisibleRun.status === 'RUNNING' ? 'En curso' : bannerVisibleRun.status}
                  </span>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => void loadBannerStatus()} disabled={bannerStatusLoading}>
                  {bannerStatusLoading ? 'Actualizando...' : 'Actualizar seguimiento'}
                </Button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Tarea</span>
                <strong style={{ fontSize: '0.88rem' }}>{formatBannerCommandLabel(bannerVisibleRun?.command)}</strong>
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Inicio</span>
                <strong style={{ fontSize: '0.88rem' }}>{formatDateTime(bannerVisibleRun?.startedAt)}</strong>
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Duracion</span>
                <strong style={{ fontSize: '0.88rem' }}>{formatDuration(bannerVisibleRun?.startedAt, bannerVisibleRun?.endedAt)}</strong>
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Ultima lectura</span>
                <strong style={{ fontSize: '0.88rem' }}>{formatDateTime(bannerStatusCheckedAt)}</strong>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: bannerCurrentRun ? 'var(--teal)' : 'var(--n-300)', display: 'inline-block', flexShrink: 0 }} aria-hidden="true" />
                  <div style={{ display: 'grid', gap: 2 }}>
                    <strong style={{ fontSize: '0.88rem' }}>{bannerPhaseLabel}</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{bannerRunStateText}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)', display: 'block' }}>Ahora</span>
                  <strong>{bannerCurrentTarget}</strong>
                  <small style={{ color: 'var(--muted)', fontSize: '0.72rem', display: 'block' }}>{formatRelativeTime(bannerLiveActivity?.lastEventAt)}</small>
                </div>
              </div>

              {bannerLiveActivity ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                    <strong>
                      {bannerLiveActivity.totalRequested != null
                        ? `${formatCompactCount(bannerLiveActivity.processed)} de ${formatCompactCount(
                            bannerLiveActivity.totalRequested,
                          )} NRC revisados`
                        : `${formatCompactCount(bannerLiveActivity.processed)} NRC revisados`}
                    </strong>
                    <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                      {bannerLiveActivity.pending != null
                        ? `${formatCompactCount(bannerLiveActivity.pending)} pendientes`
                        : 'Banner sigue preparando o cerrando la corrida.'}
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--n-100)', borderRadius: 3, overflow: 'hidden' }} aria-hidden="true">
                    <span style={{ display: 'block', height: '100%', width: `${bannerProgressPercent ?? (bannerCurrentRun ? 8 : 100)}%`, background: 'var(--teal)', borderRadius: 3, transition: 'width 500ms ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '0.78rem' }}>
                    <span>{bannerProgressPercent != null ? `${bannerProgressPercent}% completado` : 'Sin porcentaje aun'}</span>
                    <span>Ritmo {bannerRateLabel}</span>
                    <span>ETA {bannerEtaLabel}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
                    <div style={{ display: 'grid', gap: 2 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Encontrados</span>
                      <strong style={{ fontSize: '0.9rem' }}>{formatCompactCount(bannerLiveActivity.found)}</strong>
                    </div>
                    <div style={{ display: 'grid', gap: 2 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Sin estudiantes</span>
                      <strong style={{ fontSize: '0.9rem' }}>{formatCompactCount(bannerLiveActivity.empty)}</strong>
                    </div>
                    <div style={{ display: 'grid', gap: 2 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Con fallo</span>
                      <strong style={{ fontSize: '0.9rem' }}>{formatCompactCount(bannerLiveActivity.failed)}</strong>
                    </div>
                    <div style={{ display: 'grid', gap: 2 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Estudiantes leidos</span>
                      <strong style={{ fontSize: '0.9rem' }}>{formatCompactCount(bannerLiveActivity.totalStudents)}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{bannerCurrentRun ? 'Banner ya recibio la solicitud.' : 'Sin progreso en pantalla todavia.'}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                    {bannerCurrentRun
                      ? 'Todavia no hay eventos suficientes en el log. Normalmente esto pasa durante el arranque o la autenticacion.'
                      : 'En cuanto haya una corrida de matricula, aqui veras el avance y el ultimo tramo del proceso.'}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 4 }} aria-label="etapas del proceso">
                {(() => {
                  const bootstrapComplete = bannerLiveActivity?.phase === 'BOOTSTRAP' || bannerLiveActivity?.phase === 'LOOKUP' || bannerLiveActivity?.phase === 'IMPORT' || bannerVisibleRun?.status === 'COMPLETED';
                  const bootstrapCurrent = bannerLiveActivity?.phase === 'BOOTSTRAP';
                  const lookupComplete = bannerLiveActivity?.phase === 'LOOKUP' || bannerLiveActivity?.phase === 'IMPORT' || bannerVisibleRun?.status === 'COMPLETED';
                  const lookupCurrent = bannerLiveActivity?.phase === 'LOOKUP';
                  const importComplete = bannerLiveActivity?.phase === 'IMPORT' || bannerVisibleRun?.status === 'COMPLETED';
                  const importCurrent = bannerLiveActivity?.phase === 'IMPORT';
                  const finalComplete = bannerVisibleRun?.status === 'COMPLETED';
                  const finalDanger = bannerVisibleRun?.status === 'FAILED';
                  return (
                    <>
                      <div style={{ padding: '4px 10px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, background: bootstrapComplete ? 'var(--teal)' : 'var(--n-100)', color: bootstrapComplete ? '#fff' : 'var(--muted)', border: bootstrapCurrent ? '2px solid var(--teal-dark)' : '2px solid transparent' }}>Preparar</div>
                      <div style={{ padding: '4px 10px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, background: lookupComplete ? 'var(--teal)' : 'var(--n-100)', color: lookupComplete ? '#fff' : 'var(--muted)', border: lookupCurrent ? '2px solid var(--teal-dark)' : '2px solid transparent' }}>Consultar</div>
                      <div style={{ padding: '4px 10px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, background: importComplete ? 'var(--teal)' : 'var(--n-100)', color: importComplete ? '#fff' : 'var(--muted)', border: importCurrent ? '2px solid var(--teal-dark)' : '2px solid transparent' }}>Importar</div>
                      <div style={{ padding: '4px 10px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, background: finalComplete ? 'var(--teal)' : 'var(--n-100)', color: finalComplete ? '#fff' : 'var(--muted)', border: finalComplete ? '2px solid var(--teal-dark)' : '2px solid transparent', outline: finalDanger ? '2px solid var(--red)' : 'none' }}>Finalizar</div>
                    </>
                  );
                })()}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 0, borderTop: '1px solid var(--line)' }}>
              {(bannerLiveActivity?.recentEvents ?? []).length ? (
                bannerLiveActivity?.recentEvents.map((event, index) => (
                  <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line2)', alignItems: 'flex-start' }} key={`banner-event-${event.at}-${event.nrc ?? 'none'}-${index}`}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'var(--n-100)', color: 'var(--slate-700)', whiteSpace: 'nowrap' }}>{formatBannerStage(event.stage)}</div>
                    <div style={{ display: 'grid', gap: 2 }}>
                      <strong style={{ fontSize: '0.82rem' }}>{describeBannerEvent(event)}</strong>
                      <small style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
                        {formatDateTime(event.at)}
                        {event.worker ? ` · canal ${event.worker}` : ''}
                        {event.status ? ` · ${event.status}` : ''}
                      </small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state">Todavia no hay eventos de progreso para mostrar.</div>
              )}
            </div>

            {bannerStatus?.runner.logTail ? (
              <details style={{ marginTop: 8 }}>
                <summary>Ver ultimo tramo del log</summary>
                <pre>{bannerStatus.runner.logTail}</pre>
              </details>
            ) : null}
          </div>
        </div>
        </div>
      </details>

      <details className="premium-card" style={{ padding: 0, overflow: 'hidden' }}>
        <summary style={{ listStyle: 'none', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', cursor: 'pointer', padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <strong>Filtros y reporte puntual</strong>
            <small>Abre este bloque solo cuando necesites refinar por programa, sede, docente o fecha.</small>
          </div>
          <span>Abrir</span>
        </summary>
        <div style={{ padding: '18px 20px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
          <h3>Filtros ejecutivos</h3>
          <small>Combina periodos, programas, sedes, docente y NRCs especificos.</small>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Periodos</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(options?.periods ?? []).map((period) => (
                <button
                  type="button"
                  key={period.code}
                  style={{
                    border: `1px solid ${filters.periodCodes.includes(period.code) ? 'var(--teal)' : 'var(--line)'}`,
                    background: filters.periodCodes.includes(period.code) ? 'var(--teal)' : 'var(--surface)',
                    color: filters.periodCodes.includes(period.code) ? '#fff' : 'var(--slate-700)',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                  onClick={() => setFilters((current) => ({ ...current, periodCodes: toggleSelection(current.periodCodes, period.code) }))}
                >
                  {period.code}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Momento</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['1', '2', '3', '4'].map((m) => (
                <button
                  type="button"
                  key={m}
                  style={{
                    border: `1px solid ${filters.moments.includes(m) ? 'var(--teal)' : 'var(--line)'}`,
                    background: filters.moments.includes(m) ? 'var(--teal)' : 'var(--surface)',
                    color: filters.moments.includes(m) ? '#fff' : 'var(--slate-700)',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                  onClick={() => setFilters((current) => ({ ...current, moments: toggleSelection(current.moments, m) }))}
                >
                  Momento {m}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Sedes</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(options?.campuses ?? []).map((campus) => (
                <button
                  type="button"
                  key={campus.code}
                  style={{
                    border: `1px solid ${filters.campusCodes.includes(campus.code) ? 'var(--teal)' : 'var(--line)'}`,
                    background: filters.campusCodes.includes(campus.code) ? 'var(--teal)' : 'var(--surface)',
                    color: filters.campusCodes.includes(campus.code) ? '#fff' : 'var(--slate-700)',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                  onClick={() => setFilters((current) => ({ ...current, campusCodes: toggleSelection(current.campusCodes, campus.code) }))}
                >
                  {campus.code}
                </button>
              ))}
            </div>
          </div>

          <div style={{ gridColumn: 'span 2', display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Programas</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
              {(options?.programs ?? []).map((program) => (
                <button
                  type="button"
                  key={program.code}
                  style={{
                    border: `1px solid ${filters.programCodes.includes(program.code) ? 'var(--teal)' : 'var(--line)'}`,
                    background: filters.programCodes.includes(program.code) ? 'var(--teal)' : 'var(--surface)',
                    color: filters.programCodes.includes(program.code) ? '#fff' : 'var(--slate-700)',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                  onClick={() => setFilters((current) => ({ ...current, programCodes: toggleSelection(current.programCodes, program.code) }))}
                >
                  {program.label}
                </button>
              ))}
            </div>
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Docente</span>
            <select
              multiple
              value={filters.teacherIds}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  teacherIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                }))
              }
            >
              {(options?.teachers ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName}
                </option>
              ))}
            </select>
          </label>

          <label style={{ gridColumn: 'span 2', display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>NRCs especificos</span>
            <textarea
              value={filters.nrcsText}
              onChange={(event) => setFilters((current) => ({ ...current, nrcsText: event.target.value }))}
              rows={3}
              placeholder="72305, 72308, 15-72314"
            />
            <small>{nrcCount ? `${nrcCount} NRC cargados para filtrar.` : 'Si lo dejas vacio, toma todos los cursos importados.'}</small>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>Fecha puntual de asistencia</span>
            <select
              value={filters.sessionDay}
              onChange={(event) => setFilters((current) => ({ ...current, sessionDay: event.target.value }))}
            >
              <option value="">Selecciona una fecha</option>
              {(options?.sessionDays ?? []).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span>Fechas para reporte de estudiantes</span>
            <select
              multiple
              value={filters.sessionDays}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  sessionDays: Array.from(event.target.selectedOptions).map((option) => option.value),
                }))
              }
            >
              {(options?.sessionDays ?? []).map((day) => (
                <option key={`student-day-${day}`} value={day}>
                  {day}
                </option>
              ))}
            </select>
            <small>{filters.sessionDays.length ? `${filters.sessionDays.length} fechas seleccionadas.` : 'Selecciona una o varias fechas.'}</small>
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 16 }}>
          <Button variant="primary" size="sm" onClick={() => void loadOptionsAndOverview(filters)} disabled={loading}>
            {loading ? 'Aplicando...' : 'Aplicar filtros'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void loadDateReport()} disabled={dateLoading}>
            {dateLoading ? 'Consultando fecha...' : 'Consultar reporte del dia'}
          </Button>
          <Button variant="ghost" size="sm" onClick={exportDateReportCsv} disabled={!dateReport?.courses.length}>
            Descargar CSV del reporte diario
          </Button>
          <Button variant="primary" size="sm" onClick={() => void loadStudentAttendanceReport()} disabled={studentReportLoading}>
            {studentReportLoading ? 'Generando...' : 'Generar reporte estudiantes'}
          </Button>
          <Button variant="ghost" size="sm" onClick={exportStudentAttendanceCsv} disabled={!studentReport?.rows.length}>
            Descargar CSV estudiantes
          </Button>
        </div>
        </div>
      </details>

      <section className="ds-stats-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
        <MetricCard
          label="Cobertura asistencia"
          value={formatCompactCount(overview?.attendance.courseCount ?? 0)}
          hint={`${formatCompactCount(overview?.attendance.sessionCount ?? 0)} sesiones trazables`}
          tone="warm"
        />
        <MetricCard
          label="Asistencia media"
          value={formatPercent(overview?.attendance.attendanceRate)}
          hint={`${formatCompactCount(overview?.attendance.presentCount ?? 0)} presentes · ${formatCompactCount(
            overview?.attendance.absentCount ?? 0,
          )} ausentes`}
          tone="cool"
        />
        <MetricCard
          label="Cobertura actividad"
          value={formatCompactCount(overview?.activity.courseCount ?? 0)}
          hint={`${formatCompactCount(overview?.activity.totalEvents ?? 0)} eventos descargados`}
          tone="default"
        />
        <MetricCard
          label="Participantes visibles"
          value={formatCompactCount(overview?.participants.totalParticipants ?? 0)}
          hint={`${formatCompactCount(overview?.participants.courseCount ?? 0)} cursos con participantes`}
          tone="default"
        />
        <MetricCard
          label="Matricula Banner"
          value={formatCompactCount(overview?.enrollment.totalStudents ?? 0)}
          hint={`${formatCompactCount(overview?.enrollment.courseCount ?? 0)} cursos con roster oficial`}
          tone="cool"
        />
        <MetricCard
          label="Alertas activas"
          value={formatCompactCount(overview?.alerts.totals.courseCount ?? 0)}
          hint={`${formatCompactCount(overview?.alerts.totals.userCount ?? 0)} usuarios por revisar`}
          tone="danger"
        />
      </section>

      <details className="premium-card" style={{ padding: 0, overflow: 'hidden' }}>
        <summary style={{ listStyle: 'none', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', cursor: 'pointer', padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <strong>Alertas y seguimiento detallado</strong>
            <small>Abre este bloque para revisar cursos en riesgo, usuarios marcados y el detalle del cruce.</small>
          </div>
          <span>Abrir</span>
        </summary>
        <div style={{ padding: '18px 20px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
          <h3>Alertas de consistencia y seguimiento</h3>
          <small>
            Cruce entre participantes, asistencia y logs para detectar roles raros, huecos de clasificacion e
            inactividad.
          </small>
        </div>

        <div className="ds-stats-grid">
          <MetricCard
            label="Cursos con alertas"
            value={overview?.alerts.totals.courseCount ?? '-'}
            hint={`${overview?.alerts.totals.userCount ?? 0} usuarios a revisar`}
            tone="danger"
          />
          <MetricCard
            label="Cursos usando Banner"
            value={overview?.alerts.totals.bannerRosterCourses ?? '-'}
            hint="Cruce contra matricula oficial"
            tone="cool"
          />
          <MetricCard
            label="Fuera del listado"
            value={overview?.alerts.totals.activityActorsOutsideRoster ?? '-'}
            hint="Actores en logs que no cruzan contra el roster de referencia"
            tone="danger"
          />
          <MetricCard
            label="No clasificados"
            value={overview?.alerts.totals.activityUnclassified ?? '-'}
            hint="Actores en logs sin categoria final"
            tone="danger"
          />
          <MetricCard
            label="Roles no academicos"
            value={overview?.alerts.totals.participantUnusualRoles ?? '-'}
            hint="Participantes con perfil admin, auditor o no clasificado"
            tone="default"
          />
          <MetricCard
            label="Sin actividad"
            value={overview?.alerts.totals.studentsWithoutActivity ?? '-'}
            hint="Estudiantes matriculados que no aparecen en logs"
            tone="warm"
          />
          <MetricCard
            label="Sin asistencia"
            value={overview?.alerts.totals.studentsWithoutAttendance ?? '-'}
            hint="Estudiantes matriculados que no aparecen en el export de asistencia"
            tone="warm"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginTop: 16 }}>
          <BarList
            title="Alertas por tipo"
            items={(overview?.alerts.byType ?? []).map((item) => ({
              label: item.label,
              value: item.count,
              meta: `${item.courseCount} cursos`,
            }))}
            accent="var(--red)"
          />
          <BarList
            title="Programas con mayor concentracion de alertas"
            items={(overview?.alerts.byProgram ?? []).map((item) => ({
              label: item.label,
              value: item.count,
              meta: `${item.courseCount} cursos`,
            }))}
            accent="var(--amber)"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginTop: 16 }}>
          <section className="premium-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
              <h3>Cursos a revisar</h3>
              <small>Ordenados por riesgo para seguimiento operativo.</small>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="fast-table">
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Curso</th>
                    <th>Programa</th>
                    <th>Riesgo</th>
                    <th>Fuente</th>
                    <th>Total</th>
                    <th>Fuera lista</th>
                    <th>No clas.</th>
                    <th>Sin activ.</th>
                    <th>Sin asist.</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview?.alerts.courses ?? []).length ? (
                    overview?.alerts.courses.map((course) => (
                      <tr key={`alert-course-${course.nrc}`}>
                        <td>{course.nrc}</td>
                        <td>{course.subjectName ?? '-'}</td>
                        <td>{course.programName ?? '-'}</td>
                        <td>
                          <span style={{ fontWeight: 700, color: course.riskLevel === 'ALTO' ? 'var(--red)' : course.riskLevel === 'MEDIO' ? 'var(--amber)' : 'var(--teal)' }}>{course.riskLevel}</span>
                        </td>
                        <td>{course.rosterSource === 'BANNER' ? 'Banner' : course.rosterSource === 'MOODLE_PARTICIPANTS' ? 'Moodle' : '-'}</td>
                        <td>{course.totalAlerts}</td>
                        <td>{course.outsideRosterActors}</td>
                        <td>{course.unclassifiedActors}</td>
                        <td>{course.studentsWithoutActivity}</td>
                        <td>{course.studentsWithoutAttendance}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16, fontSize: '0.82rem' }}>
                        No hay cursos con alertas para los filtros actuales.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="premium-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
              <h3>Usuarios a revisar</h3>
              <small>Casos concretos para seguimiento manual y depuracion.</small>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 16 }}>
              <Button variant="ghost" size="sm" onClick={exportAlertsCsv} disabled={!overview?.alerts.users.length}>
                Descargar CSV de alertas
              </Button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="fast-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>NRC</th>
                    <th>Usuario</th>
                    <th>Categoria / rol</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview?.alerts.users ?? []).length ? (
                    overview?.alerts.users.map((user, index) => (
                      <tr key={`alert-user-${user.nrc}-${user.fullName}-${index}`}>
                        <td>{user.kindLabel}</td>
                        <td>{user.nrc}</td>
                        <td>
                          <strong>{user.fullName}</strong>
                          <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                            {user.email ?? '-'}
                            {user.institutionalId ? ` · ${user.institutionalId}` : ''}
                          </div>
                        </td>
                        <td>{user.rolesLabel ?? user.actorCategory ?? '-'}</td>
                        <td>
                          {user.detail}
                          {user.count > 0 ? <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{user.count} eventos</div> : null}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16, fontSize: '0.82rem' }}>
                        No hay usuarios marcados para seguimiento con los filtros actuales.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        </div>
      </details>

      <details className="premium-card" style={{ padding: 0, overflow: 'hidden' }}>
        <summary style={{ listStyle: 'none', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', cursor: 'pointer', padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <strong>Analisis adicional</strong>
            <small>Series por fecha, cursos criticos, actividad del aula y reporte puntual por fecha.</small>
          </div>
          <span>Abrir</span>
        </summary>
        <div style={{ padding: '18px 20px 20px' }}>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        <DayBars title="Presencias por fecha" items={attendanceDayBars} tone="warm" />
        <DayBars title="Actividad por fecha" items={activityDayBars} tone="cool" />
        <BarList
          title="Programas con mayor inasistencia"
          items={(overview?.attendance.byProgram ?? []).map((item) => ({
            label: item.label,
            value: item.inattendanceRate ?? 0,
            meta: `${item.courseCount} cursos · ${item.studentCount} estudiantes`,
          }))}
          accent="var(--amber)"
          suffix="%"
        />
        <BarList
          title="Sedes con mayor inasistencia"
          items={(overview?.attendance.byCampus ?? []).map((item) => ({
            label: item.label,
            value: item.inattendanceRate ?? 0,
            meta: `${item.courseCount} cursos`,
          }))}
          accent="var(--teal)"
          suffix="%"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        <section className="premium-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
            <h3>Cursos que mas concentran inasistencia</h3>
            <small>Usalo para escalar priorizacion y acompanamiento.</small>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="fast-table">
              <thead>
                <tr>
                  <th>NRC</th>
                  <th>Curso</th>
                  <th>Programa</th>
                  <th>Inasistencia</th>
                  <th>Presentes</th>
                  <th>Ausentes</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.attendance.worstCourses ?? []).map((course) => (
                  <tr key={`worst-${course.nrc}`}>
                    <td>{course.nrc}</td>
                    <td>{course.subjectName ?? '-'}</td>
                    <td>{course.programName ?? '-'}</td>
                    <td>{formatPercent(course.inattendanceRate)}</td>
                    <td>{course.presentCount}</td>
                    <td>{course.absentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="premium-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
            <h3>Actividad dentro del aula</h3>
            <small>Lectura rapida para coordinacion academica y monitoreo de uso.</small>
          </div>
          <div style={{ display: 'grid', gap: 16 }}>
            <BarList
              title="Participantes por categoria"
              items={(overview?.participants.byActorCategory ?? []).map((item) => ({ label: item.key, value: item.value }))}
              accent="var(--slate-500)"
            />
            <BarList
              title="Componentes mas usados"
              items={(overview?.activity.byComponent ?? []).map((item) => ({ label: item.key, value: item.value }))}
              accent="var(--teal)"
            />
            <BarList
              title="Categorias de actor"
              items={(overview?.activity.byActorCategory ?? []).map((item) => ({ label: item.key, value: item.value }))}
              accent="var(--slate-700)"
            />
          </div>
        </section>
      </div>

      <section className="premium-card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
          <h3>Reporte puntual por fecha de asistencia</h3>
          <small>
            Selecciona una fecha y el sistema te devuelve los NRC, los participantes del curso y los estudiantes que
            estuvieron presentes ese dia.
          </small>
        </div>

        <div className="ds-stats-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
          <MetricCard label="Cursos ese dia" value={dateReport?.summary.courseCount ?? '-'} tone="warm" />
          <MetricCard label="Participantes" value={dateReport?.summary.participantCount ?? '-'} tone="default" />
          <MetricCard label="Presentes" value={dateReport?.summary.presentCount ?? '-'} tone="cool" />
          <MetricCard label="Ausentes" value={dateReport?.summary.absentCount ?? '-'} tone="danger" />
          <MetricCard label="Asistencia del dia" value={formatPercent(dateReport?.summary.attendanceRate)} tone="warm" />
          <MetricCard label="Inasistencia del dia" value={formatPercent(dateReport?.summary.inattendanceRate)} tone="danger" />
        </div>

        {studentReport ? (
          <section className="premium-card" style={{ marginTop: 16, padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
              <h3>Reporte de estudiantes por fechas seleccionadas</h3>
              <small>
                {studentReport.summary.selectedDayCount} fechas · {studentReport.summary.courseCount} NRC · {studentReport.summary.rowCount} registros
              </small>
            </div>
            <div className="ds-stats-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
              <MetricCard label="Estudiantes" value={studentReport.summary.studentCount} tone="default" />
              <MetricCard label="Presentes" value={studentReport.summary.presentCount} tone="cool" />
              <MetricCard label="Ausentes" value={studentReport.summary.absentCount} tone="danger" />
              <MetricCard label="Justificados" value={studentReport.summary.justifiedCount} tone="warm" />
              <MetricCard label="Asistencia" value={formatPercent(studentReport.summary.attendanceRate)} tone="cool" />
              <MetricCard label="Inasistencia" value={formatPercent(studentReport.summary.inattendanceRate)} tone="danger" />
            </div>
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table className="fast-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>NRC</th>
                    <th>Estudiante</th>
                    <th>Estado</th>
                    <th>Curso</th>
                  </tr>
                </thead>
                <tbody>
                  {studentReport.rows.slice(0, 500).map((row, index) => (
                    <tr key={`student-attendance-${row.sessionDay}-${row.nrc}-${row.studentName}-${index}`}>
                      <td>
                        {row.sessionDay}
                        <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{row.sessionLabel}</div>
                      </td>
                      <td>{row.nrc}</td>
                      <td>
                        <strong>{row.studentName}</strong>
                        <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                          {row.studentEmail ?? '-'}
                          {row.studentId ? ` · ${row.studentId}` : ''}
                        </div>
                      </td>
                      <td>{row.statusLabel}</td>
                      <td>{row.subjectName ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {studentReport.rows.length > 500 ? (
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', padding: 10 }}>
                  Vista limitada a 500 registros. Descarga el CSV para ver el reporte completo.
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <div style={{ display: 'grid', gap: 8 }}>
          {(dateReport?.courses ?? []).length ? (
            dateReport?.courses.map((course) => (
              <details style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }} key={`date-course-${course.nrc}`}>
                <summary>
                  <div>
                    <strong>
                      {course.nrc} · {course.subjectName ?? 'Sin nombre'}
                    </strong>
                    <small>
                      {course.programName ?? 'Sin programa'} · {course.campusCode ?? 'Sin sede'} · {course.teacherName ?? 'Sin docente'}
                    </small>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: '0.8rem', color: 'var(--muted)' }}>
                    <span>{course.participantCount} participantes</span>
                    <span>{course.presentCount} presentes</span>
                    <span>{formatPercent(course.attendanceRate)}</span>
                  </div>
                </summary>
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {course.sessionLabels.map((label) => (
                      <span style={{ fontSize: '0.72rem', background: 'var(--n-100)', color: 'var(--slate-700)', padding: '2px 8px', borderRadius: 4 }} key={`${course.nrc}-${label}`}>
                        {label}
                      </span>
                    ))}
                  </div>
                  <table className="fast-table">
                    <thead>
                      <tr>
                        <th>Nombre completo</th>
                        <th>Correo</th>
                        <th>ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {course.presentStudents.map((student) => (
                        <tr key={`${course.nrc}-${student.fullName}-${student.institutionalId ?? 'sin-id'}`}>
                          <td>{student.fullName}</td>
                          <td>{student.email ?? '-'}</td>
                          <td>{student.institutionalId ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))
          ) : (
            <div className="empty-state">Todavia no hay un reporte puntual cargado para la fecha seleccionada.</div>
          )}
        </div>
      </section>
        </div>
      </details>

      <details className="premium-card" style={{ padding: 0, overflow: 'hidden' }} open>
        <summary style={{ listStyle: 'none', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', cursor: 'pointer', padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
          <strong>Ingresos docente</strong>
          <small>Cumplimiento de 3 dias/semana — solo NRCs seleccionados en revision (muestreo)</small>
        </summary>
        <div style={{ padding: '18px 20px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: '0.82rem', color: 'var(--muted)' }}>
              <span>Momento a sincronizar:</span>
              {['1', 'MD1', 'MD2', 'INTER'].map((m) => (
                <button
                  type="button"
                  key={m}
                  style={{
                    border: `1px solid ${syncActivityMoments.includes(m) ? 'var(--teal)' : 'var(--line)'}`,
                    background: syncActivityMoments.includes(m) ? 'var(--teal)' : 'var(--surface)',
                    color: syncActivityMoments.includes(m) ? '#fff' : 'var(--slate-700)',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                  onClick={() => setSyncActivityMoments((current) => toggleSelection(current, m))}
                >
                  {m}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void runMoodleQuickSync('activity', { moments: syncActivityMoments, autoCalcTeacherReport: true, source: 'SAMPLING', workers: 3 })}
                disabled={moodleSyncLoading || !!importingKind || !syncActivityMoments.length}
                title="Descarga logs de actividad solo para NRCs seleccionados en revision (muestreo)"
              >
                {moodleSyncLoading && moodleQuickRun?.currentCommand === 'activity'
                  ? moodleQuickRun.phase === 'IMPORTING'
                    ? 'Importando logs...'
                    : `Descargando logs... (${sidecarArtifact ? `${sidecarProgressCount}/${sidecarArtifact.totalCourses}` : '...'})`
                  : `Sincronizar logs NRCs en revision${syncActivityMoments.length ? ` — momento ${syncActivityMoments.join('+')}` : ''}`}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadTeacherAccessReport()}
                disabled={teacherAccessLoading || moodleSyncLoading}
              >
                {teacherAccessLoading ? 'Calculando...' : 'Solo calcular ingresos'}
              </Button>
              {moodleSyncLoading && moodleQuickRun?.currentCommand === 'activity' && (
                <Button variant="ghost" size="sm" onClick={() => void cancelMoodleQuickSync()}>
                  Cancelar descarga
                </Button>
              )}
            </div>
          </div>

          {moodleSyncLoading && moodleQuickRun?.currentCommand === 'activity' && (
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              <div style={{ height: 6, background: 'var(--n-100)', borderRadius: 3, overflow: 'hidden' }} aria-hidden="true">
                <span style={{ display: 'block', height: '100%', width: `${sidecarProgressPercent ?? 8}%`, background: 'var(--teal)', borderRadius: 3, transition: 'width 500ms ease' }} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', color: 'var(--muted)', fontSize: '0.78rem' }}>
                <span>Total: <strong>{formatCompactCount(sidecarArtifact?.totalCourses ?? sidecarSelectedCourseCount)}</strong></span>
                <span>Descargados: <strong>{formatCompactCount(sidecarArtifact?.completedCourses ?? 0)}</strong></span>
                <span>Fallidos: <strong>{formatCompactCount(sidecarArtifact?.failedCourses ?? 0)}</strong></span>
                <span>Duracion: <strong>{formatDuration(sidecarVisibleRun?.startedAt, sidecarVisibleRun?.endedAt)}</strong></span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            {teacherAccessReport && (
              <>
                <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                  {teacherAccessReport.summary.courseCount} NRCs analizados
                  {teacherAccessReport.summary.complianceRate != null && (
                    <> &middot; Cumplimiento promedio: <strong>{teacherAccessReport.summary.complianceRate.toFixed(1)}%</strong></>
                  )}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void applyTeacherAccessToChecklists()}
                  disabled={applyTeacherAccessLoading}
                  title="Escribe el puntaje de ingresos en el checklist de ejecucion de cada NRC"
                >
                  {applyTeacherAccessLoading ? 'Aplicando al checklist...' : 'Aplicar ingresos al checklist de ejecucion'}
                </Button>
                {applyTeacherAccessResult && (
                  <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                    Actualizados: <strong>{applyTeacherAccessResult.updated}</strong>
                    {applyTeacherAccessResult.skipped > 0 && <> &middot; Sin NRC en BD: <strong>{applyTeacherAccessResult.skipped}</strong></>}
                  </span>
                )}
              </>
            )}
          </div>

          {teacherAccessReport && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--teal)', color: '#fff', textAlign: 'center', minWidth: 80 }}>
                  <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{teacherAccessReport.summary.compliantCourses}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', marginTop: 4, opacity: 0.85 }}>Cumplen</span>
                </div>
                <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--amber)', color: '#fff', textAlign: 'center', minWidth: 80 }}>
                  <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{teacherAccessReport.summary.partialCourses}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', marginTop: 4, opacity: 0.85 }}>Parcial</span>
                </div>
                <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--red)', color: '#fff', textAlign: 'center', minWidth: 80 }}>
                  <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{teacherAccessReport.summary.nonCompliantCourses}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', marginTop: 4, opacity: 0.85 }}>Incumplen</span>
                </div>
                <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--n-100)', color: 'var(--slate-700)', textAlign: 'center', minWidth: 80 }}>
                  <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{teacherAccessReport.summary.noDataCourses}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', marginTop: 4, opacity: 0.85 }}>Sin ingresos</span>
                </div>
                {teacherAccessReport.summary.noDatesCourses > 0 && (
                  <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--n-100)', color: 'var(--slate-700)', textAlign: 'center', minWidth: 80 }}>
                    <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{teacherAccessReport.summary.noDatesCourses}</span>
                    <span style={{ display: 'block', fontSize: '0.72rem', marginTop: 4, opacity: 0.85 }}>Sin fechas Banner</span>
                  </div>
                )}
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="fast-table">
                  <thead>
                    <tr>
                      <th>NRC</th>
                      <th>Docente</th>
                      <th>Materia</th>
                      <th>Sede</th>
                      <th>Estado</th>
                      <th>Semanas</th>
                      <th>Dias docente</th>
                      <th>Dias requeridos</th>
                      <th>Cumplimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teacherAccessReport.courses.map((course) => {
                      const statusLabel: Record<string, string> = {
                        CUMPLE: 'Cumple',
                        PARCIAL: 'Parcial',
                        INCUMPLE: 'Incumple',
                        SIN_INGRESOS: 'Sin ingresos',
                        SIN_FECHAS: 'Sin fechas',
                      };
                      const statusBg: Record<string, string> = {
                        CUMPLE: 'var(--teal)',
                        PARCIAL: 'var(--amber)',
                        INCUMPLE: 'var(--red)',
                        SIN_INGRESOS: 'var(--red)',
                        SIN_FECHAS: 'var(--n-200)',
                      };
                      const statusColor: Record<string, string> = {
                        CUMPLE: '#fff',
                        PARCIAL: '#fff',
                        INCUMPLE: '#fff',
                        SIN_INGRESOS: '#fff',
                        SIN_FECHAS: 'var(--slate-700)',
                      };
                      const weeksSummary = course.compliantWeeks != null && course.totalCourseWeeks != null
                        ? `${course.compliantWeeks}/${course.totalCourseWeeks}`
                        : course.isShortCourse
                        ? 'Corto'
                        : '-';
                      return (
                        <tr key={`${course.nrc}-${course.periodCode}`}>
                          <td><strong>{course.nrc}</strong></td>
                          <td>{course.teacherName ?? '-'}</td>
                          <td>{course.subjectName ?? '-'}</td>
                          <td>{course.campusCode ?? '-'}</td>
                          <td>
                            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700, background: statusBg[course.status] ?? 'var(--n-200)', color: statusColor[course.status] ?? 'var(--slate-700)' }}>
                              {statusLabel[course.status] ?? course.status}
                            </span>
                            {course.isShortCourse && (
                              <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700, background: '#e0f2fe', color: '#0369a1', marginLeft: 4 }}>Corto</span>
                            )}
                          </td>
                          <td>{weeksSummary}</td>
                          <td>{course.totalTeacherDays}</td>
                          <td>{course.requiredLoginDays ?? '-'}</td>
                          <td>{course.complianceRate != null ? `${course.complianceRate}%` : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!teacherAccessReport && !teacherAccessLoading && (
            <div className="empty-state">Presiona el boton para calcular el cumplimiento de ingresos por NRC.</div>
          )}
        </div>
      </details>

    </div>
  );
}