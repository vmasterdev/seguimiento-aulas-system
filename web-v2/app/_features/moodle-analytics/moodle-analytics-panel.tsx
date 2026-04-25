'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';

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
  const toneClass =
    tone === 'warm' ? 'tone-amber' : tone === 'danger' ? 'tone-red' : tone === 'cool' ? 'tone-teal' : 'tone-default';

  return (
    <article className={`stat-card ${toneClass}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
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
    <section className="analytics-panel">
      <div className="analytics-panel-head">
        <h3>{title}</h3>
      </div>
      <div className="bar-list">
        {items.length ? (
          items.map((item) => (
            <div className="bar-row" key={`${title}-${item.label}`}>
              <div>
                <strong>{item.label}</strong>
                {item.meta ? <small>{item.meta}</small> : null}
              </div>
              <div className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.max(6, (item.value / max) * 100)}%`, background: accent }} />
              </div>
              <div className="bar-value">
                {item.value}
                {suffix}
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
  return (
    <section className="analytics-panel">
      <div className="analytics-panel-head">
        <h3>{title}</h3>
      </div>
      <div className="day-bars">
        {items.length ? (
          items.map((item) => (
            <div className="day-bar" key={`${title}-${item.day}`}>
              <div
                className={`day-bar-fill ${tone}`}
                style={{ height: `${Math.max(10, (item.count / max) * 100)}%` }}
                title={`${item.day}: ${item.count}`}
              />
              <span>{item.day.slice(5)}</span>
            </div>
          ))
        ) : (
          <div className="empty-state">Sin serie temporal.</div>
        )}
      </div>
    </section>
  );
}

export default function MoodleAnalyticsPanel({ apiBase }: MoodlAnalyticsPanelProps) {
  const [options, setOptions] = useState<AnalyticsOptionsResponse | null>(null);
  const [bannerBatchOptions, setBannerBatchOptions] = useState<BannerBatchOptionsResponse | null>(null);
  const [sidecarBatchOptions, setSidecarBatchOptions] = useState<SidecarBatchOptionsResponse | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverviewResponse | null>(null);
  const [dateReport, setDateReport] = useState<AttendanceDateReportResponse | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [dateLoading, setDateLoading] = useState(false);
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
    moments: [],
  });

  const nrcCount = useMemo(() => parseNrcList(filters.nrcsText).length, [filters.nrcsText]);

  async function loadOptionsAndOverview(nextFilters: FilterState) {
    try {
      setLoading(true);
      setMessage('');
      const params = buildQuery(nextFilters);
      const [nextOptions, nextOverview] = await Promise.all([
        fetchJson<AnalyticsOptionsResponse>(`${apiBase}/integrations/moodle-analytics/options?${params.toString()}`),
        fetchJson<AnalyticsOverviewResponse>(`${apiBase}/integrations/moodle-analytics/overview?${params.toString()}`),
      ]);
      setOptions(nextOptions);
      setOverview(nextOverview);
      setDateReport(null);
      if (nextFilters.sessionDay && !nextOptions.sessionDays.includes(nextFilters.sessionDay)) {
        setFilters((current) => ({ ...current, sessionDay: '' }));
      }
    } catch (error) {
      setMessage(`No se pudo cargar la analitica: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
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
    void loadOptionsAndOverview(filters);
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
    <div className="moodle-analytics-root">
      <section className="analytics-hero analytics-hero-compact">
        <div className="analytics-hero-copy">
          <h2>Revision masiva de asistencia y uso</h2>
          <p>
            Ejecuta la extraccion de Moodle por periodos RPACA y deja la analitica actualizada sin ir a otras
            pantallas ni importar archivos a mano.
          </p>
        </div>
        <div className="analytics-actions analytics-actions-wrap">
          <button
            type="button"
            className="primary"
            onClick={() => void runMoodleQuickSync('all')}
            disabled={moodleSyncLoading || !!importingKind}
          >
            {moodleSyncLoading && moodleQuickRun?.kind === 'all' ? 'Actualizando Moodle...' : 'Actualizar todo Moodle'}
          </button>
          <button type="button" className="ghost" onClick={() => void loadOptionsAndOverview(filters)} disabled={loading}>
            {loading ? 'Actualizando...' : 'Refrescar indicadores'}
          </button>
          {sidecarStatus?.running && (
            <button
              type="button"
              className="ghost"
              onClick={() => void cancelMoodleQuickSync()}
            >
              Cancelar corrida
            </button>
          )}
        </div>
      </section>

      {message ? <div className="message-strip">{message}</div> : null}

      <section className="analytics-panel quick-sync-panel">
        <div className="analytics-panel-head">
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
          <div className="analytics-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setMoodleSyncPeriodCodes(sidecarAvailablePeriods.map((period) => period.code))}
              disabled={!sidecarAvailablePeriods.length}
            >
              Seleccionar todos
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setMoodleSyncPeriodCodes([])}
              disabled={!moodleSyncPeriodCodes.length}
            >
              Usar todos sin marcar
            </button>
          </div>
        </div>

        <div className="chip-grid">
          {sidecarAvailablePeriods.length ? (
            sidecarAvailablePeriods.map((period) => (
              <button
                type="button"
                key={`sidecar-period-${period.code}`}
                className={`chip-button${moodleSyncPeriodCodes.includes(period.code) ? ' active' : ''}`}
                onClick={() => setMoodleSyncPeriodCodes((current) => togglePeriodCode(current, period.code))}
              >
                {period.code}
              </button>
            ))
          ) : (
            <span className="inline-note">Todavia no hay periodos RPACA con aulas Moodle listas para la corrida masiva.</span>
          )}
        </div>

        <div className="analytics-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => void runMoodleQuickSync('participants')}
            disabled={moodleSyncLoading || !!importingKind}
          >
            {moodleSyncLoading && moodleQuickRun?.currentCommand === 'participants' ? 'Extrayendo...' : 'Solo participantes'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => void runMoodleQuickSync('activity')}
            disabled={moodleSyncLoading || !!importingKind}
          >
            {moodleSyncLoading && moodleQuickRun?.currentCommand === 'activity' ? 'Extrayendo...' : 'Solo actividad'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => void runMoodleQuickSync('attendance')}
            disabled={moodleSyncLoading || !!importingKind}
          >
            {moodleSyncLoading && moodleQuickRun?.currentCommand === 'attendance' ? 'Extrayendo...' : 'Solo asistencia'}
          </button>
        </div>
      </section>

      <section className="analytics-panel quick-progress-panel">
        <div className="analytics-panel-head">
          <div>
            <h3>Seguimiento de la extraccion Moodle</h3>
            <small>{moodleQuickRunCopy}</small>
          </div>
          <div className="analytics-actions">
            <span className={`banner-run-badge is-${sidecarVisibleRun?.status?.toLowerCase() ?? 'completed'}`}>
              {sidecarVisibleRun?.status ?? 'LISTO'}
            </span>
            <button type="button" className="ghost" onClick={() => void loadSidecarStatus()} disabled={moodleSyncLoading}>
              Actualizar seguimiento
            </button>
          </div>
        </div>

        <div className="quick-progress-grid">
          <div className="quick-progress-card">
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
          <div className="quick-progress-card">
            <span>Inicio</span>
            <strong>{formatDateTime(sidecarVisibleRun?.startedAt)}</strong>
            <small>Ultima lectura {formatDateTime(sidecarStatusCheckedAt)}</small>
          </div>
          <div className="quick-progress-card">
            <span>Duracion</span>
            <strong>{formatDuration(sidecarVisibleRun?.startedAt, sidecarVisibleRun?.endedAt)}</strong>
            <small>{sidecarStatus?.running ? 'Extraccion en curso' : 'Proceso inactivo'}</small>
          </div>
          <div className="quick-progress-card">
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

        <div className="banner-progress-track quick-progress-track" aria-hidden="true">
          <span
            className={`banner-progress-fill${sidecarStatus?.running ? ' is-running' : ''}`}
            style={{ width: `${sidecarProgressPercent ?? (sidecarStatus?.running ? 8 : 100)}%` }}
          />
        </div>

        <div className="quick-progress-counters">
          <span>Total aulas: <strong>{formatCompactCount(sidecarArtifact?.totalCourses ?? sidecarSelectedCourseCount)}</strong></span>
          <span>Completadas: <strong>{formatCompactCount(sidecarArtifact?.completedCourses ?? 0)}</strong></span>
          <span>Fallidas: <strong>{formatCompactCount(sidecarArtifact?.failedCourses ?? 0)}</strong></span>
          <span>Sin archivo: <strong>{formatCompactCount(sidecarArtifact?.skippedCourses ?? 0)}</strong></span>
        </div>

        {sidecarStatus?.logTail ? (
          <details className="banner-log-detail">
            <summary>Ver ultimo tramo de la extraccion Moodle</summary>
            <pre>{sidecarStatus.logTail}</pre>
          </details>
        ) : null}
      </section>

      <details className="analytics-panel analytics-disclosure banner-source-panel">
        <summary>
          <div>
            <strong>Herramientas avanzadas y matricula Banner</strong>
            <small>Importaciones manuales, automatizacion Banner y ajustes puntuales.</small>
          </div>
          <span>Abrir</span>
        </summary>
        <div className="advanced-tools-stack">
          <div className="banner-source-block">
            <div className="section-lead">
              <h4>Logs de acceso Moodle por docente</h4>
              <p>
                Exporta el log de actividad desde Moodle para cada NRC y guardalo en{' '}
                <code>storage/imports/moodle-logs/</code> con nombre <code>logs_NRC_*.csv</code>{' '}
                (ej: <code>logs_15-79471_20260328.csv</code>). El sistema identifica al docente, cuenta sus dias de acceso y actualiza el puntaje de ingresos.
              </p>
            </div>
            <div className="analytics-actions">
              <button type="button" className="primary" onClick={() => void importMoodleLogsFromFolder()} disabled={moodleLogsLoading}>
                {moodleLogsLoading ? 'Procesando logs...' : 'Procesar logs de acceso Moodle'}
              </button>
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
          <div className="banner-source-block">
            <div className="section-lead">
              <h4>Fechas Banner desde carpeta</h4>
              <p>
                Coloca un CSV con columnas <code>nrc, period, start_date, end_date</code> en{' '}
                <code>storage/imports/banner-dates/</code> y haz clic para importar. Los ingresos se recalculan automaticamente.
              </p>
            </div>
            <div className="analytics-actions">
              <button type="button" className="primary" onClick={() => void importBannerDatesFromFolder()} disabled={bannerDatesLoading}>
                {bannerDatesLoading ? 'Importando fechas...' : 'Importar fechas Banner desde carpeta'}
              </button>
            </div>
            {bannerDatesResult && (
              <small>
                Archivos: <strong>{bannerDatesResult.filesProcessed}</strong> &middot; Actualizados:{' '}
                <strong>{bannerDatesResult.updated}</strong> &middot; Sin cambios: <strong>{bannerDatesResult.skipped}</strong>
              </small>
            )}
          </div>
          <div className="analytics-actions analytics-actions-wrap advanced-actions">
            <button type="button" className="primary" onClick={() => void importLatest('participants')} disabled={!!importingKind}>
              {importingKind === 'participants' ? 'Importando participantes...' : 'Importar ultimos participantes'}
            </button>
            <button type="button" className="primary" onClick={() => void importLatest('activity')} disabled={!!importingKind}>
              {importingKind === 'activity' ? 'Importando actividad...' : 'Importar ultima actividad'}
            </button>
            <button type="button" className="primary" onClick={() => void importLatest('attendance')} disabled={!!importingKind}>
              {importingKind === 'attendance' ? 'Importando asistencia...' : 'Importar ultima asistencia'}
            </button>
          </div>
          <div className="analytics-panel-head">
            <h3>Matricula oficial Banner</h3>
            <small>Si este archivo existe, la analitica toma Banner como roster principal por NRC y periodo.</small>
          </div>
        <div className="banner-source-block">
          <div className="section-lead">
            <h4>Importar archivo ya descargado</h4>
            <p>Usa esta opcion si ya tienes un export de matricula oficial generado fuera de esta pantalla.</p>
          </div>
          <div className="banner-import-grid">
            <label className="filter-block filter-block-wide">
              <span>Ruta del archivo Banner</span>
              <input
                value={bannerImportPath}
                onChange={(event) => setBannerImportPath(event.target.value)}
                placeholder="storage/exports/banner_matricula_oficial.xlsx"
              />
            </label>
            <label className="filter-block">
              <span>Periodo por defecto</span>
              <input
                value={bannerImportPeriodCode}
                onChange={(event) => setBannerImportPeriodCode(event.target.value)}
                placeholder="202615"
              />
              <small>Usalo si el archivo no trae columna de periodo.</small>
            </label>
            <label className="filter-block">
              <span>NRC por defecto</span>
              <input value={bannerImportNrc} onChange={(event) => setBannerImportNrc(event.target.value)} placeholder="15-72305" />
              <small>Solo aplica si el export corresponde a un NRC puntual.</small>
            </label>
            <label className="filter-block filter-block-wide">
              <span>Etiqueta del corte</span>
              <input
                value={bannerImportSourceLabel}
                onChange={(event) => setBannerImportSourceLabel(event.target.value)}
                placeholder="matricula-banner-corte-marzo"
              />
              <small>Sirve para identificar la importacion en los snapshots internos.</small>
            </label>
            <div className="analytics-actions">
              <button type="button" className="primary" onClick={() => void importLatest('banner-enrollment')} disabled={!!importingKind}>
                {importingKind === 'banner-enrollment' ? 'Importando Banner...' : 'Importar matricula Banner'}
              </button>
            </div>
          </div>
        </div>
        <div className="banner-source-block">
          <div className="section-lead">
            <h4>Consultar Banner desde esta pantalla</h4>
            <p>El sistema entra a Banner, busca el periodo y los NRC indicados, y luego importa la matricula oficial.</p>
          </div>
          <div className="banner-import-grid">
            <label className="filter-block">
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
            <label className="filter-block filter-block-wide">
              <span>NRCs a consultar en Banner</span>
              <textarea
                value={bannerAutomationNrcsText}
                onChange={(event) => setBannerAutomationNrcsText(event.target.value)}
                rows={3}
                placeholder="72307, 72308, 72310"
              />
              <small>Si lo dejas vacio, recorre todas las aulas RPACA de los periodos elegidos abajo. Si no eliges periodos, usa todos los periodos RPACA disponibles. Si escribes NRCs, usa ese listado puntual.</small>
            </label>
            <div className="analytics-actions">
              <button type="button" className="primary" onClick={() => void importBannerFromAutomation()} disabled={bannerAutomationLoading}>
                {bannerAutomationLoading ? 'Consultando Banner...' : 'Buscar matricula en Banner e importar'}
              </button>
            </div>
          </div>

          <div className="banner-period-selector">
            <div className="banner-period-selector-head">
              <div>
                <h5>Periodos RPACA para la corrida masiva</h5>
                <p>Esta lista sale de los periodos cargados en la base por RPACA. Puedes marcar varios o dejar todo vacio para recorrerlos todos.</p>
              </div>
              <div className="analytics-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setBannerAutomationPeriodCodes((bannerBatchOptions?.periods ?? []).map((item) => item.code))}
                  disabled={!(bannerBatchOptions?.periods?.length)}
                >
                  Seleccionar todos
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setBannerAutomationPeriodCodes([])}
                  disabled={!bannerAutomationPeriodCodes.length}
                >
                  Limpiar seleccion
                </button>
              </div>
            </div>
            <div className="chip-grid">
              {(bannerBatchOptions?.periods ?? []).length ? (
                bannerBatchOptions?.periods.map((period) => (
                  <button
                    type="button"
                    key={`banner-period-${period.code}`}
                    className={`chip-button${bannerAutomationPeriodCodes.includes(period.code) ? ' active' : ''}`}
                    onClick={() =>
                      setBannerAutomationPeriodCodes((current) => togglePeriodCode(current, period.code))
                    }
                  >
                    {period.code}
                  </button>
                ))
              ) : (
                <span className="inline-note">Todavia no hay periodos RPACA disponibles para Banner.</span>
              )}
            </div>
            <div className="banner-period-summary">
              {bannerAutomationPeriodCodes.length ? (
                <span>
                  Periodos seleccionados para la automatizacion: <strong>{bannerAutomationPeriodCodes.join(', ')}</strong>
                </span>
              ) : (
                <span>Sin seleccion manual: la automatizacion tomara <strong>todos los periodos RPACA disponibles</strong>.</span>
              )}
            </div>
          </div>

          <div className="banner-run-panel">
            <div className="banner-run-head">
              <div>
                <h4>Seguimiento de Banner</h4>
                <p>{bannerRunStateText}</p>
              </div>
              <div className="banner-run-actions">
                {bannerVisibleRun ? (
                  <span className={`banner-run-badge is-${bannerVisibleRun.status.toLowerCase()}`}>
                    {bannerVisibleRun.status === 'RUNNING' ? 'En curso' : bannerVisibleRun.status}
                  </span>
                ) : null}
                <button type="button" className="ghost" onClick={() => void loadBannerStatus()} disabled={bannerStatusLoading}>
                  {bannerStatusLoading ? 'Actualizando...' : 'Actualizar seguimiento'}
                </button>
              </div>
            </div>

            <div className="banner-run-stats">
              <div className="banner-run-stat">
                <span>Tarea</span>
                <strong>{formatBannerCommandLabel(bannerVisibleRun?.command)}</strong>
              </div>
              <div className="banner-run-stat">
                <span>Inicio</span>
                <strong>{formatDateTime(bannerVisibleRun?.startedAt)}</strong>
              </div>
              <div className="banner-run-stat">
                <span>Duracion</span>
                <strong>{formatDuration(bannerVisibleRun?.startedAt, bannerVisibleRun?.endedAt)}</strong>
              </div>
              <div className="banner-run-stat">
                <span>Ultima lectura</span>
                <strong>{formatDateTime(bannerStatusCheckedAt)}</strong>
              </div>
            </div>

            <div className="banner-live-board">
              <div className="banner-live-strip">
                <div className="banner-live-state">
                  <span className={`banner-live-dot${bannerCurrentRun ? ' is-running' : ''}`} aria-hidden="true" />
                  <div className="banner-live-copy">
                    <strong>{bannerPhaseLabel}</strong>
                    <span>{bannerRunStateText}</span>
                  </div>
                </div>
                <div className="banner-live-current">
                  <span>Ahora</span>
                  <strong>{bannerCurrentTarget}</strong>
                  <small>{formatRelativeTime(bannerLiveActivity?.lastEventAt)}</small>
                </div>
              </div>

              {bannerLiveActivity ? (
                <>
                  <div className="banner-progress-copy">
                    <strong>
                      {bannerLiveActivity.totalRequested != null
                        ? `${formatCompactCount(bannerLiveActivity.processed)} de ${formatCompactCount(
                            bannerLiveActivity.totalRequested,
                          )} NRC revisados`
                        : `${formatCompactCount(bannerLiveActivity.processed)} NRC revisados`}
                    </strong>
                    <span>
                      {bannerLiveActivity.pending != null
                        ? `${formatCompactCount(bannerLiveActivity.pending)} pendientes`
                        : 'Banner sigue preparando o cerrando la corrida.'}
                    </span>
                  </div>
                  <div className="banner-progress-track" aria-hidden="true">
                    <span
                      className={`banner-progress-fill${bannerCurrentRun ? ' is-running' : ''}`}
                      style={{ width: `${bannerProgressPercent ?? (bannerCurrentRun ? 8 : 100)}%` }}
                    />
                  </div>
                  <div className="banner-progress-labels">
                    <span>{bannerProgressPercent != null ? `${bannerProgressPercent}% completado` : 'Sin porcentaje aun'}</span>
                    <span>Ritmo {bannerRateLabel}</span>
                    <span>ETA {bannerEtaLabel}</span>
                  </div>
                  <div className="banner-live-stats">
                    <div className="banner-live-stat">
                      <span>Encontrados</span>
                      <strong>{formatCompactCount(bannerLiveActivity.found)}</strong>
                    </div>
                    <div className="banner-live-stat">
                      <span>Sin estudiantes</span>
                      <strong>{formatCompactCount(bannerLiveActivity.empty)}</strong>
                    </div>
                    <div className="banner-live-stat">
                      <span>Con fallo</span>
                      <strong>{formatCompactCount(bannerLiveActivity.failed)}</strong>
                    </div>
                    <div className="banner-live-stat">
                      <span>Estudiantes leidos</span>
                      <strong>{formatCompactCount(bannerLiveActivity.totalStudents)}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <div className="banner-progress-copy">
                  <strong>{bannerCurrentRun ? 'Banner ya recibio la solicitud.' : 'Sin progreso en pantalla todavia.'}</strong>
                  <span>
                    {bannerCurrentRun
                      ? 'Todavia no hay eventos suficientes en el log. Normalmente esto pasa durante el arranque o la autenticacion.'
                      : 'En cuanto haya una corrida de matricula, aqui veras el avance y el ultimo tramo del proceso.'}
                  </span>
                </div>
              )}

              <div className="banner-phase-strip" aria-label="etapas del proceso">
                <div
                  className={`banner-phase-step${
                    bannerLiveActivity?.phase === 'BOOTSTRAP' || bannerLiveActivity?.phase === 'LOOKUP' || bannerLiveActivity?.phase === 'IMPORT' || bannerVisibleRun?.status === 'COMPLETED'
                      ? ' is-complete'
                      : ''
                  }${bannerLiveActivity?.phase === 'BOOTSTRAP' ? ' is-current' : ''}`}
                >
                  Preparar
                </div>
                <div
                  className={`banner-phase-step${
                    bannerLiveActivity?.phase === 'LOOKUP' || bannerLiveActivity?.phase === 'IMPORT' || bannerVisibleRun?.status === 'COMPLETED'
                      ? ' is-complete'
                      : ''
                  }${bannerLiveActivity?.phase === 'LOOKUP' ? ' is-current' : ''}`}
                >
                  Consultar
                </div>
                <div
                  className={`banner-phase-step${
                    bannerLiveActivity?.phase === 'IMPORT' || bannerVisibleRun?.status === 'COMPLETED' ? ' is-complete' : ''
                  }${bannerLiveActivity?.phase === 'IMPORT' ? ' is-current' : ''}`}
                >
                  Importar
                </div>
                <div
                  className={`banner-phase-step${bannerVisibleRun?.status === 'COMPLETED' ? ' is-complete is-current' : ''}${
                    bannerVisibleRun?.status === 'FAILED' ? ' is-danger' : ''
                  }`}
                >
                  Finalizar
                </div>
              </div>
            </div>

            <div className="banner-event-list">
              {(bannerLiveActivity?.recentEvents ?? []).length ? (
                bannerLiveActivity?.recentEvents.map((event, index) => (
                  <div className="banner-event-row" key={`banner-event-${event.at}-${event.nrc ?? 'none'}-${index}`}>
                    <div className={`banner-event-stage stage-${event.stage.toLowerCase()}`}>{formatBannerStage(event.stage)}</div>
                    <div className="banner-event-body">
                      <strong>{describeBannerEvent(event)}</strong>
                      <small>
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
              <details className="banner-log-detail">
                <summary>Ver ultimo tramo del log</summary>
                <pre>{bannerStatus.runner.logTail}</pre>
              </details>
            ) : null}
          </div>
        </div>
        </div>
      </details>

      <details className="analytics-panel analytics-disclosure filter-panel">
        <summary>
          <div>
            <strong>Filtros y reporte puntual</strong>
            <small>Abre este bloque solo cuando necesites refinar por programa, sede, docente o fecha.</small>
          </div>
          <span>Abrir</span>
        </summary>
        <div className="analytics-panel-head">
          <h3>Filtros ejecutivos</h3>
          <small>Combina periodos, programas, sedes, docente y NRCs especificos.</small>
        </div>

        <div className="filter-grid">
          <div className="filter-block">
            <span>Periodos</span>
            <div className="chip-grid">
              {(options?.periods ?? []).map((period) => (
                <button
                  type="button"
                  key={period.code}
                  className={`chip-button${filters.periodCodes.includes(period.code) ? ' active' : ''}`}
                  onClick={() => setFilters((current) => ({ ...current, periodCodes: toggleSelection(current.periodCodes, period.code) }))}
                >
                  {period.code}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <span>Momento</span>
            <div className="chip-grid">
              {['1', '2', '3', '4'].map((m) => (
                <button
                  type="button"
                  key={m}
                  className={`chip-button${filters.moments.includes(m) ? ' active' : ''}`}
                  onClick={() => setFilters((current) => ({ ...current, moments: toggleSelection(current.moments, m) }))}
                >
                  Momento {m}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <span>Sedes</span>
            <div className="chip-grid">
              {(options?.campuses ?? []).map((campus) => (
                <button
                  type="button"
                  key={campus.code}
                  className={`chip-button${filters.campusCodes.includes(campus.code) ? ' active' : ''}`}
                  onClick={() => setFilters((current) => ({ ...current, campusCodes: toggleSelection(current.campusCodes, campus.code) }))}
                >
                  {campus.code}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block filter-block-wide">
            <span>Programas</span>
            <div className="chip-grid chip-grid-tall">
              {(options?.programs ?? []).map((program) => (
                <button
                  type="button"
                  key={program.code}
                  className={`chip-button${filters.programCodes.includes(program.code) ? ' active' : ''}`}
                  onClick={() => setFilters((current) => ({ ...current, programCodes: toggleSelection(current.programCodes, program.code) }))}
                >
                  {program.label}
                </button>
              ))}
            </div>
          </div>

          <label className="filter-block">
            <span>Docente</span>
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

          <label className="filter-block filter-block-wide">
            <span>NRCs especificos</span>
            <textarea
              value={filters.nrcsText}
              onChange={(event) => setFilters((current) => ({ ...current, nrcsText: event.target.value }))}
              rows={3}
              placeholder="72305, 72308, 15-72314"
            />
            <small>{nrcCount ? `${nrcCount} NRC cargados para filtrar.` : 'Si lo dejas vacio, toma todos los cursos importados.'}</small>
          </label>

          <label className="filter-block">
            <span>Fecha puntual de asistencia</span>
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
        </div>

        <div className="analytics-actions analytics-actions-spaced">
          <button type="button" className="primary" onClick={() => void loadOptionsAndOverview(filters)} disabled={loading}>
            {loading ? 'Aplicando...' : 'Aplicar filtros'}
          </button>
          <button type="button" className="ghost" onClick={() => void loadDateReport()} disabled={dateLoading}>
            {dateLoading ? 'Consultando fecha...' : 'Consultar reporte del dia'}
          </button>
          <button type="button" className="ghost" onClick={exportDateReportCsv} disabled={!dateReport?.courses.length}>
            Descargar CSV del reporte diario
          </button>
        </div>
      </details>

      <section className="stats-grid analytics-stats-grid">
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

      <details className="analytics-panel analytics-disclosure">
        <summary>
          <div>
            <strong>Alertas y seguimiento detallado</strong>
            <small>Abre este bloque para revisar cursos en riesgo, usuarios marcados y el detalle del cruce.</small>
          </div>
          <span>Abrir</span>
        </summary>
        <div className="analytics-panel-head">
          <h3>Alertas de consistencia y seguimiento</h3>
          <small>
            Cruce entre participantes, asistencia y logs para detectar roles raros, huecos de clasificacion e
            inactividad.
          </small>
        </div>

        <div className="stats-grid analytics-stats-grid analytics-stats-grid-compact">
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

        <div className="analytics-grid" style={{ marginTop: 16 }}>
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

        <div className="analytics-grid" style={{ marginTop: 16 }}>
          <section className="analytics-panel analytics-panel-subtle">
            <div className="analytics-panel-head">
              <h3>Cursos a revisar</h3>
              <small>Ordenados por riesgo para seguimiento operativo.</small>
            </div>
            <div className="table-wrap">
              <table className="analytics-table">
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
                          <span className={`risk-text risk-${course.riskLevel.toLowerCase()}`}>{course.riskLevel}</span>
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
                      <td colSpan={10} className="empty-table-cell">
                        No hay cursos con alertas para los filtros actuales.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="analytics-panel analytics-panel-subtle">
            <div className="analytics-panel-head">
              <h3>Usuarios a revisar</h3>
              <small>Casos concretos para seguimiento manual y depuracion.</small>
            </div>
            <div className="analytics-actions analytics-actions-spaced">
              <button type="button" className="ghost" onClick={exportAlertsCsv} disabled={!overview?.alerts.users.length}>
                Descargar CSV de alertas
              </button>
            </div>
            <div className="table-wrap">
              <table className="analytics-table">
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
                          <div className="table-support">
                            {user.email ?? '-'}
                            {user.institutionalId ? ` · ${user.institutionalId}` : ''}
                          </div>
                        </td>
                        <td>{user.rolesLabel ?? user.actorCategory ?? '-'}</td>
                        <td>
                          {user.detail}
                          {user.count > 0 ? <div className="table-support">{user.count} eventos</div> : null}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty-table-cell">
                        No hay usuarios marcados para seguimiento con los filtros actuales.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </details>

      <details className="analytics-panel analytics-disclosure">
        <summary>
          <div>
            <strong>Analisis adicional</strong>
            <small>Series por fecha, cursos criticos, actividad del aula y reporte puntual por fecha.</small>
          </div>
          <span>Abrir</span>
        </summary>

      <div className="analytics-grid">
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

      <div className="analytics-grid">
        <section className="analytics-panel">
          <div className="analytics-panel-head">
            <h3>Cursos que mas concentran inasistencia</h3>
            <small>Usalo para escalar priorizacion y acompanamiento.</small>
          </div>
          <div className="table-wrap">
            <table className="analytics-table">
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

        <section className="analytics-panel">
          <div className="analytics-panel-head">
            <h3>Actividad dentro del aula</h3>
            <small>Lectura rapida para coordinacion academica y monitoreo de uso.</small>
          </div>
          <div className="stacked-lists">
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

      <section className="analytics-panel">
        <div className="analytics-panel-head">
          <h3>Reporte puntual por fecha de asistencia</h3>
          <small>
            Selecciona una fecha y el sistema te devuelve los NRC, los participantes del curso y los estudiantes que
            estuvieron presentes ese dia.
          </small>
        </div>

        <div className="stats-grid analytics-stats-grid analytics-stats-grid-compact">
          <MetricCard label="Cursos ese dia" value={dateReport?.summary.courseCount ?? '-'} tone="warm" />
          <MetricCard label="Participantes" value={dateReport?.summary.participantCount ?? '-'} tone="default" />
          <MetricCard label="Presentes" value={dateReport?.summary.presentCount ?? '-'} tone="cool" />
          <MetricCard label="Ausentes" value={dateReport?.summary.absentCount ?? '-'} tone="danger" />
          <MetricCard label="Asistencia del dia" value={formatPercent(dateReport?.summary.attendanceRate)} tone="warm" />
          <MetricCard label="Inasistencia del dia" value={formatPercent(dateReport?.summary.inattendanceRate)} tone="danger" />
        </div>

        <div className="course-report-list">
          {(dateReport?.courses ?? []).length ? (
            dateReport?.courses.map((course) => (
              <details className="course-report-item" key={`date-course-${course.nrc}`}>
                <summary>
                  <div>
                    <strong>
                      {course.nrc} · {course.subjectName ?? 'Sin nombre'}
                    </strong>
                    <small>
                      {course.programName ?? 'Sin programa'} · {course.campusCode ?? 'Sin sede'} · {course.teacherName ?? 'Sin docente'}
                    </small>
                  </div>
                  <div className="summary-metrics">
                    <span>{course.participantCount} participantes</span>
                    <span>{course.presentCount} presentes</span>
                    <span>{formatPercent(course.attendanceRate)}</span>
                  </div>
                </summary>
                <div className="report-card-body">
                  <div className="badge-strip">
                    {course.sessionLabels.map((label) => (
                      <span className="mini-badge" key={`${course.nrc}-${label}`}>
                        {label}
                      </span>
                    ))}
                  </div>
                  <table className="analytics-table nested">
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
      </details>

      <details className="analytics-panel analytics-disclosure" open>
        <summary>
          <strong>Ingresos docente</strong>
          <small>Cumplimiento de 3 dias/semana — solo NRCs seleccionados en revision (muestreo)</small>
        </summary>
        <div className="disclosure-body">
          <div className="teacher-sync-bar">
            <div className="teacher-sync-moments">
              <span>Momento a sincronizar:</span>
              {['1', 'MD1', 'MD2', 'INTER'].map((m) => (
                <button
                  type="button"
                  key={m}
                  className={`chip-button${syncActivityMoments.includes(m) ? ' active' : ''}`}
                  onClick={() => setSyncActivityMoments((current) => toggleSelection(current, m))}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="analytics-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void runMoodleQuickSync('activity', { moments: syncActivityMoments, autoCalcTeacherReport: true, source: 'SAMPLING', workers: 3 })}
                disabled={moodleSyncLoading || !!importingKind || !syncActivityMoments.length}
                title="Descarga logs de actividad solo para NRCs seleccionados en revision (muestreo)"
              >
                {moodleSyncLoading && moodleQuickRun?.currentCommand === 'activity'
                  ? moodleQuickRun.phase === 'IMPORTING'
                    ? 'Importando logs...'
                    : `Descargando logs... (${sidecarArtifact ? `${sidecarProgressCount}/${sidecarArtifact.totalCourses}` : '...'})`
                  : `Sincronizar logs NRCs en revision${syncActivityMoments.length ? ` — momento ${syncActivityMoments.join('+')}` : ''}`}
              </button>
              <button
                type="button"
                onClick={() => void loadTeacherAccessReport()}
                disabled={teacherAccessLoading || moodleSyncLoading}
              >
                {teacherAccessLoading ? 'Calculando...' : 'Solo calcular ingresos'}
              </button>
              {moodleSyncLoading && moodleQuickRun?.currentCommand === 'activity' && (
                <button type="button" className="ghost" onClick={() => void cancelMoodleQuickSync()}>
                  Cancelar descarga
                </button>
              )}
            </div>
          </div>

          {moodleSyncLoading && moodleQuickRun?.currentCommand === 'activity' && (
            <div className="teacher-sync-progress">
              <div className="banner-progress-track quick-progress-track" aria-hidden="true">
                <span
                  className="banner-progress-fill is-running"
                  style={{ width: `${sidecarProgressPercent ?? 8}%` }}
                />
              </div>
              <div className="quick-progress-counters">
                <span>Total: <strong>{formatCompactCount(sidecarArtifact?.totalCourses ?? sidecarSelectedCourseCount)}</strong></span>
                <span>Descargados: <strong>{formatCompactCount(sidecarArtifact?.completedCourses ?? 0)}</strong></span>
                <span>Fallidos: <strong>{formatCompactCount(sidecarArtifact?.failedCourses ?? 0)}</strong></span>
                <span>Duracion: <strong>{formatDuration(sidecarVisibleRun?.startedAt, sidecarVisibleRun?.endedAt)}</strong></span>
              </div>
            </div>
          )}

          <div className="panel-row">
            {teacherAccessReport && (
              <>
                <span className="panel-meta">
                  {teacherAccessReport.summary.courseCount} NRCs analizados
                  {teacherAccessReport.summary.complianceRate != null && (
                    <> &middot; Cumplimiento promedio: <strong>{teacherAccessReport.summary.complianceRate.toFixed(1)}%</strong></>
                  )}
                </span>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void applyTeacherAccessToChecklists()}
                  disabled={applyTeacherAccessLoading}
                  title="Escribe el puntaje de ingresos en el checklist de ejecucion de cada NRC"
                >
                  {applyTeacherAccessLoading ? 'Aplicando al checklist...' : 'Aplicar ingresos al checklist de ejecucion'}
                </button>
                {applyTeacherAccessResult && (
                  <span className="panel-meta">
                    Actualizados: <strong>{applyTeacherAccessResult.updated}</strong>
                    {applyTeacherAccessResult.skipped > 0 && <> &middot; Sin NRC en BD: <strong>{applyTeacherAccessResult.skipped}</strong></>}
                  </span>
                )}
              </>
            )}
          </div>

          {teacherAccessReport && (
            <>
              <div className="kpi-row">
                <div className="kpi-card kpi-ok">
                  <span className="kpi-value">{teacherAccessReport.summary.compliantCourses}</span>
                  <span className="kpi-label">Cumplen</span>
                </div>
                <div className="kpi-card kpi-warn">
                  <span className="kpi-value">{teacherAccessReport.summary.partialCourses}</span>
                  <span className="kpi-label">Parcial</span>
                </div>
                <div className="kpi-card kpi-bad">
                  <span className="kpi-value">{teacherAccessReport.summary.nonCompliantCourses}</span>
                  <span className="kpi-label">Incumplen</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-value">{teacherAccessReport.summary.noDataCourses}</span>
                  <span className="kpi-label">Sin ingresos</span>
                </div>
                {teacherAccessReport.summary.noDatesCourses > 0 && (
                  <div className="kpi-card">
                    <span className="kpi-value">{teacherAccessReport.summary.noDatesCourses}</span>
                    <span className="kpi-label">Sin fechas Banner</span>
                  </div>
                )}
              </div>

              <div className="table-wrap">
                <table className="data-table">
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
                      const statusClass: Record<string, string> = {
                        CUMPLE: 'badge-ok',
                        PARCIAL: 'badge-warn',
                        INCUMPLE: 'badge-bad',
                        SIN_INGRESOS: 'badge-bad',
                        SIN_FECHAS: 'badge-neutral',
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
                            <span className={`badge ${statusClass[course.status] ?? 'badge-neutral'}`}>
                              {statusLabel[course.status] ?? course.status}
                            </span>
                            {course.isShortCourse && (
                              <span className="badge badge-info" style={{ marginLeft: 4 }}>Corto</span>
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

      <style jsx>{`
        .moodle-analytics-root {
          display: grid;
          gap: 16px;
          color: var(--ink);
        }

        .analytics-hero,
        .analytics-panel,
        .analytics-card {
          border: 1px solid var(--line);
          background: var(--surface);
          box-shadow: var(--shadow);
        }

        .analytics-hero {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) auto;
          gap: 16px;
          padding: 20px;
          align-items: start;
          border-radius: var(--radius-lg);
        }

        .analytics-hero h2 {
          margin: 0;
          font-family: var(--font-display);
          font-size: 1.05rem;
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .analytics-hero p {
          margin: 6px 0 0;
          max-width: 72ch;
          color: var(--muted);
          line-height: 1.45;
        }

        .analytics-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }

        .analytics-hero .analytics-actions {
          justify-content: flex-end;
        }

        .analytics-actions-spaced {
          margin-top: 16px;
        }

        .analytics-actions button,
        .chip-button {
          border: 1px solid var(--line);
          background: var(--surface);
          color: var(--slate-700);
          border-radius: 6px;
          padding: 7px 12px;
          font-size: 0.82rem;
          font-weight: 500;
          cursor: pointer;
          transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
        }

        .analytics-actions button:hover,
        .chip-button:hover {
          border-color: var(--slate-300);
          background: var(--slate-50);
        }

        .analytics-actions .primary {
          background: var(--teal);
          border-color: var(--teal);
          color: #fff;
          font-weight: 600;
        }

        .analytics-actions .primary:hover {
          background: var(--teal-dark);
          border-color: var(--teal-dark);
        }

        .analytics-actions .ghost {
          background: transparent;
          color: var(--muted);
        }

        .message-strip {
          padding: 10px 14px;
          border-radius: 6px;
          border-left: 3px solid var(--teal);
          background: var(--teal-light);
          color: var(--teal-dark);
        }

        .analytics-panel {
          padding: 20px;
          border-radius: var(--radius-lg);
        }

        .analytics-disclosure {
          padding: 0;
          overflow: hidden;
        }

        .analytics-disclosure > summary {
          list-style: none;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          cursor: pointer;
          padding: 18px 20px;
        }

        .analytics-disclosure > summary::-webkit-details-marker {
          display: none;
        }

        .analytics-disclosure > summary strong {
          display: block;
          font-size: 0.92rem;
          color: var(--slate-800);
        }

        .analytics-disclosure > summary small {
          display: block;
          margin-top: 4px;
          max-width: 62ch;
          color: var(--muted);
          line-height: 1.45;
        }

        .analytics-disclosure > summary span {
          font-size: 0.75rem;
          color: var(--muted);
          white-space: nowrap;
        }

        .analytics-disclosure[open] > summary {
          border-bottom: 1px solid var(--line);
          background: var(--slate-50);
        }

        .analytics-disclosure > :not(summary) {
          padding: 18px 20px 20px;
        }

        .analytics-panel-subtle {
          background: var(--slate-50);
          border-color: var(--line);
          box-shadow: none;
        }

        .analytics-panel-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          margin-bottom: 14px;
        }

        .analytics-panel-head h3 {
          margin: 0;
          font-family: var(--font-display);
          font-size: 0.98rem;
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .analytics-panel-head small {
          max-width: 62ch;
          color: var(--muted);
          line-height: 1.45;
        }

        .banner-source-panel {
          display: grid;
          gap: 18px;
        }

        .advanced-tools-stack {
          display: grid;
          gap: 18px;
        }

        .advanced-actions {
          margin-bottom: -2px;
        }

        .banner-source-block + .banner-source-block {
          border-top: 1px solid var(--line);
          padding-top: 18px;
        }

        .quick-sync-panel,
        .quick-progress-panel {
          display: grid;
          gap: 14px;
        }

        .quick-progress-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }

        .quick-progress-card {
          border: 1px solid var(--line);
          background: var(--slate-50);
          border-radius: 8px;
          padding: 12px;
          display: grid;
          gap: 4px;
        }

        .quick-progress-card span {
          font-size: 0.72rem;
          color: var(--muted);
        }

        .quick-progress-card strong {
          font-size: 0.9rem;
          color: var(--slate-800);
        }

        .quick-progress-card small {
          color: var(--muted);
          font-size: 0.76rem;
          line-height: 1.4;
        }

        .quick-progress-track {
          margin: 2px 0 4px;
        }

        .quick-progress-counters {
          display: flex;
          flex-wrap: wrap;
          gap: 10px 16px;
          color: var(--muted);
          font-size: 0.78rem;
        }

        .quick-progress-counters strong {
          color: var(--slate-800);
        }

        .section-lead {
          margin-bottom: 12px;
        }

        .section-lead h4 {
          margin: 0;
          font-size: 0.88rem;
          font-weight: 600;
          color: var(--slate-800);
        }

        .section-lead p {
          margin: 4px 0 0;
          font-size: 0.8rem;
          line-height: 1.4;
          color: var(--muted);
        }

        .banner-run-panel {
          margin-top: 16px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--slate-50);
          padding: 16px;
          display: grid;
          gap: 14px;
        }

        .banner-period-selector {
          margin-top: 14px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--slate-50);
          padding: 14px;
          display: grid;
          gap: 12px;
        }

        .banner-period-selector-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }

        .banner-period-selector-head h5 {
          margin: 0;
          font-size: 0.82rem;
          font-weight: 600;
          color: var(--slate-800);
        }

        .banner-period-selector-head p {
          margin: 4px 0 0;
          font-size: 0.76rem;
          line-height: 1.4;
          color: var(--muted);
        }

        .banner-period-summary {
          font-size: 0.77rem;
          color: var(--muted);
        }

        .banner-period-summary strong {
          color: var(--slate-800);
        }

        .inline-note {
          font-size: 0.77rem;
          color: var(--muted);
        }

        .banner-run-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }

        .banner-run-head h4 {
          margin: 0;
          font-size: 0.88rem;
          font-weight: 600;
          color: var(--slate-800);
        }

        .banner-run-head p {
          margin: 4px 0 0;
          font-size: 0.79rem;
          line-height: 1.4;
          color: var(--muted);
        }

        .banner-run-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .banner-run-actions button {
          border: 1px solid var(--line);
          background: transparent;
          color: var(--muted);
          border-radius: 6px;
          padding: 7px 10px;
          font-size: 0.78rem;
          cursor: pointer;
        }

        .banner-run-actions button:hover {
          background: var(--surface);
          border-color: var(--slate-300);
          color: var(--slate-700);
        }

        .banner-run-badge {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 0.74rem;
          font-weight: 600;
          border: 1px solid var(--line);
          background: var(--surface);
          color: var(--slate-700);
        }

        .banner-run-badge.is-running {
          border-color: rgba(13, 148, 136, 0.2);
          background: var(--teal-light);
          color: var(--teal-dark);
        }

        .banner-run-badge.is-completed {
          border-color: rgba(22, 163, 74, 0.18);
          background: rgba(22, 163, 74, 0.08);
          color: var(--green);
        }

        .banner-run-badge.is-failed,
        .banner-run-badge.is-cancelled {
          border-color: rgba(220, 38, 38, 0.18);
          background: rgba(220, 38, 38, 0.08);
          color: var(--red);
        }

        .banner-run-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }

        .banner-run-stat {
          border: 1px solid var(--line);
          background: var(--surface);
          border-radius: 8px;
          padding: 10px 12px;
          display: grid;
          gap: 4px;
        }

        .banner-run-stat span {
          font-size: 0.72rem;
          color: var(--muted);
        }

        .banner-run-stat strong {
          font-size: 0.84rem;
          color: var(--slate-800);
        }

        .banner-live-board {
          display: grid;
          gap: 12px;
        }

        .banner-live-strip {
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) minmax(220px, 0.7fr);
          gap: 12px;
        }

        .banner-live-state,
        .banner-live-current,
        .banner-live-stat {
          border: 1px solid var(--line);
          background: var(--surface);
          border-radius: 8px;
        }

        .banner-live-state {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 12px;
        }

        .banner-live-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: var(--slate-300);
          margin-top: 5px;
          flex: 0 0 auto;
        }

        .banner-live-dot.is-running {
          background: var(--teal);
          box-shadow: 0 0 0 4px rgba(13, 148, 136, 0.14);
          animation: bannerPulse 1.4s ease-in-out infinite;
        }

        .banner-live-copy {
          display: grid;
          gap: 4px;
        }

        .banner-live-copy strong {
          font-size: 0.9rem;
          color: var(--slate-800);
        }

        .banner-live-copy span {
          font-size: 0.79rem;
          line-height: 1.45;
          color: var(--muted);
        }

        .banner-live-current {
          display: grid;
          gap: 4px;
          padding: 12px;
          align-content: start;
        }

        .banner-live-current span,
        .banner-live-current small {
          color: var(--muted);
          font-size: 0.74rem;
        }

        .banner-live-current strong {
          font-size: 0.92rem;
          color: var(--slate-800);
        }

        .banner-progress-copy {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          font-size: 0.8rem;
        }

        .banner-progress-copy strong {
          color: var(--slate-800);
        }

        .banner-progress-copy span {
          color: var(--muted);
        }

        .banner-progress-track {
          height: 10px;
          border-radius: 999px;
          background: var(--slate-100);
          overflow: hidden;
        }

        .banner-progress-fill {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: var(--teal);
          transition: width 180ms ease;
        }

        .banner-progress-fill.is-running {
          background: linear-gradient(90deg, var(--teal), #2baea1);
        }

        .banner-progress-labels {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 0.74rem;
          color: var(--muted);
        }

        .banner-live-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }

        .banner-live-stat {
          padding: 10px 12px;
          display: grid;
          gap: 4px;
        }

        .banner-live-stat span {
          color: var(--muted);
          font-size: 0.72rem;
        }

        .banner-live-stat strong {
          font-size: 1rem;
          color: var(--slate-800);
        }

        .banner-phase-strip {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }

        .banner-phase-step {
          border: 1px solid var(--line);
          background: var(--surface);
          border-radius: 8px;
          padding: 9px 10px;
          font-size: 0.75rem;
          text-align: center;
          color: var(--muted);
        }

        .banner-phase-step.is-complete {
          border-color: rgba(13, 148, 136, 0.2);
          color: var(--teal-dark);
        }

        .banner-phase-step.is-current {
          background: var(--teal-light);
          font-weight: 600;
        }

        .banner-phase-step.is-danger {
          border-color: rgba(220, 38, 38, 0.18);
          color: var(--red);
        }

        .banner-event-list {
          display: grid;
          gap: 8px;
        }

        .banner-event-row {
          display: grid;
          grid-template-columns: 108px minmax(0, 1fr);
          gap: 12px;
          align-items: flex-start;
          border: 1px solid var(--line);
          background: var(--surface);
          border-radius: 8px;
          padding: 10px 12px;
        }

        .banner-event-stage {
          display: inline-flex;
          justify-content: center;
          align-items: center;
          min-height: 30px;
          border-radius: 6px;
          border: 1px solid var(--line);
          background: var(--slate-50);
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--slate-700);
        }

        .banner-event-stage.stage-lookup {
          color: var(--teal-dark);
          border-color: rgba(13, 148, 136, 0.18);
          background: var(--teal-light);
        }

        .banner-event-stage.stage-done {
          color: var(--green);
          border-color: rgba(22, 163, 74, 0.18);
          background: rgba(22, 163, 74, 0.08);
        }

        .banner-event-stage.stage-warn {
          color: var(--red);
          border-color: rgba(220, 38, 38, 0.18);
          background: rgba(220, 38, 38, 0.08);
        }

        .banner-event-body {
          display: grid;
          gap: 4px;
        }

        .banner-event-body strong {
          color: var(--slate-800);
          font-size: 0.82rem;
          line-height: 1.35;
        }

        .banner-event-body small {
          color: var(--muted);
          font-size: 0.74rem;
        }

        @keyframes bannerPulse {
          0%,
          100% {
            box-shadow: 0 0 0 4px rgba(13, 148, 136, 0.14);
          }
          50% {
            box-shadow: 0 0 0 7px rgba(13, 148, 136, 0.06);
          }
        }

        .banner-log-detail {
          border-top: 1px solid var(--line);
          padding-top: 12px;
        }

        .banner-log-detail summary {
          cursor: pointer;
          color: var(--slate-700);
          font-size: 0.8rem;
          font-weight: 600;
        }

        .banner-log-detail pre {
          margin: 10px 0 0;
          max-height: 240px;
          overflow: auto;
          border-radius: 8px;
          border: 1px solid var(--line);
          background: #101828;
          color: #d0d7e2;
          padding: 12px;
          font-size: 0.72rem;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .filter-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .banner-import-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) repeat(2, minmax(180px, 0.7fr)) auto;
          gap: 12px;
          align-items: end;
        }

        .filter-block {
          display: grid;
          gap: 6px;
        }

        .filter-block-wide {
          grid-column: span 2;
        }

        .filter-block span {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--slate-600);
        }

        .chip-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .chip-grid-tall {
          max-height: 180px;
          overflow: auto;
          padding-right: 6px;
        }

        .chip-button.active {
          background: var(--teal-light);
          border-color: rgba(13, 148, 136, 0.28);
          color: var(--teal-dark);
          font-weight: 600;
        }

        .filter-block input,
        .filter-block textarea,
        .filter-block select {
          width: 100%;
          border-radius: 6px;
          border: 1px solid var(--line);
          background: var(--surface);
          color: var(--ink);
          padding: 8px 10px;
        }

        .filter-block select[multiple] {
          min-height: 132px;
        }

        .filter-block small {
          font-size: 0.72rem;
          line-height: 1.35;
          color: var(--muted);
        }

        .analytics-stats-grid {
          margin-bottom: 0;
        }

        .analytics-stats-grid .stat-card {
          min-height: 104px;
        }

        .analytics-stats-grid-compact {
          margin-bottom: 14px;
        }

        .analytics-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .day-bars {
          min-height: 220px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(18px, 1fr));
          gap: 8px;
          align-items: end;
        }

        .day-bar {
          display: grid;
          gap: 6px;
          align-items: end;
          justify-items: center;
        }

        .day-bar-fill {
          width: 100%;
          border-radius: 6px 6px 2px 2px;
          background: var(--amber);
          min-height: 14px;
        }

        .day-bar-fill.cool {
          background: var(--teal);
        }

        .day-bar span {
          font-size: 0.7rem;
          color: var(--muted);
          writing-mode: vertical-rl;
          text-orientation: mixed;
        }

        .bar-list {
          display: grid;
          gap: 12px;
        }

        .bar-row {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.1fr) auto;
          gap: 12px;
          align-items: center;
        }

        .bar-row strong {
          display: block;
        }

        .bar-row small {
          color: var(--muted);
        }

        .bar-track {
          height: 8px;
          border-radius: 999px;
          background: var(--slate-100);
          overflow: hidden;
        }

        .bar-fill {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: var(--accent);
        }

        .bar-value {
          font-variant-numeric: tabular-nums;
          color: var(--slate-700);
        }

        .stacked-lists {
          display: grid;
          gap: 16px;
        }

        .analytics-table {
          width: 100%;
          border-collapse: collapse;
        }

        .analytics-table th,
        .analytics-table td {
          padding: 9px 8px;
          border-bottom: 1px solid var(--slate-100);
          text-align: left;
          vertical-align: top;
        }

        .analytics-table th {
          color: var(--muted);
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          border-bottom-color: var(--line);
        }

        .analytics-table tbody tr:hover {
          background: var(--slate-50);
        }

        .table-support {
          margin-top: 4px;
          color: var(--muted);
          font-size: 0.75rem;
        }

        .empty-table-cell {
          color: var(--muted);
          padding: 18px 8px;
        }

        .risk-text {
          font-weight: 700;
          letter-spacing: 0.03em;
        }

        .risk-alto {
          color: var(--red);
        }

        .risk-medio {
          color: var(--amber);
        }

        .risk-bajo {
          color: var(--green);
        }

        .risk-sin_alertas {
          color: var(--muted);
        }

        .course-report-list {
          display: grid;
          gap: 10px;
        }

        .course-report-item {
          border-radius: 8px;
          border: 1px solid var(--line);
          background: var(--surface);
          overflow: hidden;
        }

        .course-report-item summary {
          list-style: none;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px;
          padding: 12px 14px;
          cursor: pointer;
        }

        .course-report-item summary::-webkit-details-marker {
          display: none;
        }

        .course-report-item summary small {
          display: block;
          margin-top: 4px;
          color: var(--muted);
        }

        .summary-metrics {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
          justify-content: flex-end;
          color: var(--slate-700);
          font-size: 0.78rem;
        }

        .report-card-body {
          padding: 0 14px 14px;
          border-top: 1px solid var(--slate-100);
        }

        .badge-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 12px 0;
        }

        .mini-badge {
          border-radius: 4px;
          padding: 3px 8px;
          background: var(--slate-100);
          color: var(--slate-700);
          font-size: 0.72rem;
        }

        .empty-state {
          padding: 14px 0;
          color: var(--muted);
        }

        .teacher-sync-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid var(--line);
          margin-bottom: 12px;
        }

        .teacher-sync-moments {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .teacher-sync-moments span {
          font-size: 0.8rem;
          color: var(--muted);
          font-weight: 500;
        }

        .teacher-sync-progress {
          margin: 0 0 12px;
        }

        .panel-row {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }

        .panel-meta {
          font-size: 0.82rem;
          color: var(--muted);
        }

        .kpi-row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 16px;
        }

        .kpi-card {
          flex: 1 1 90px;
          min-width: 90px;
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 10px 14px;
          text-align: center;
          background: var(--surface);
        }

        .kpi-card.kpi-ok { border-color: #22c55e; background: #f0fdf4; }
        .kpi-card.kpi-warn { border-color: #f59e0b; background: #fffbeb; }
        .kpi-card.kpi-bad { border-color: #ef4444; background: #fef2f2; }

        .kpi-value {
          display: block;
          font-size: 1.5rem;
          font-weight: 700;
          line-height: 1.1;
        }

        .kpi-label {
          display: block;
          font-size: 0.75rem;
          color: var(--muted);
          margin-top: 2px;
        }

        .badge {
          display: inline-block;
          font-size: 0.72rem;
          padding: 2px 7px;
          border-radius: 4px;
          font-weight: 600;
          white-space: nowrap;
        }

        .badge-ok { background: #dcfce7; color: #16a34a; }
        .badge-warn { background: #fef9c3; color: #92400e; }
        .badge-bad { background: #fee2e2; color: #b91c1c; }
        .badge-info { background: #dbeafe; color: #1d4ed8; }
        .badge-neutral { background: var(--slate-100, #f1f5f9); color: var(--slate-600, #475569); }

        .table-wrap {
          overflow-x: auto;
          overflow-y: auto;
          max-height: 340px;
        }

        .data-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.82rem;
        }

        .data-table th,
        .data-table td {
          padding: 7px 10px;
          border-bottom: 1px solid var(--line);
          text-align: left;
          white-space: nowrap;
        }

        .data-table th {
          font-weight: 600;
          color: var(--muted);
          background: var(--surface-alt, #f8fafc);
        }

        .data-table tbody tr:hover {
          background: var(--surface-alt, #f8fafc);
        }

        @media (max-width: 1200px) {
          .filter-grid,
          .analytics-grid,
          .analytics-hero,
          .quick-progress-grid,
          .banner-import-grid,
          .banner-run-stats,
          .banner-live-strip,
          .banner-live-stats,
          .banner-phase-strip {
            grid-template-columns: 1fr;
          }

          .analytics-hero .analytics-actions {
            justify-content: flex-start;
          }

          .filter-block-wide {
            grid-column: span 1;
          }
        }

        @media (max-width: 780px) {
          .bar-row,
          .course-report-item summary,
          .banner-event-row {
            grid-template-columns: 1fr;
          }

          .analytics-disclosure > summary {
            flex-direction: column;
            align-items: flex-start;
          }

          .summary-metrics,
          .analytics-actions {
            justify-content: flex-start;
          }

          .analytics-panel-head {
            flex-direction: column;
          }

          .banner-run-head,
          .banner-progress-copy,
          .banner-period-selector-head,
          .banner-progress-labels {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </div>
  );
}
