export type ApiHealth = {
  ok: boolean;
  ts?: string;
};

export type ApiStats = {
  periods: number;
  teachers: number;
  coordinators: number;
  courses: number;
  sampleGroups: number;
  evaluations: number;
  pendingClassify: number;
  moodleByStatus: Record<string, number>;
  outboxByStatus: Record<string, number>;
  modalityByType?: Record<string, number>;
  virtualCount?: number;
  virtual100Count?: number;
  presencialCount?: number;
  generatedAt?: string;
};

export type QueueStats = {
  queue: Record<string, number>;
  moodleChecks: Record<string, number>;
};

export type CourseRecord = {
  id: string;
  nrc: string;
  period: {
    code: string;
    modality?: string | null;
  };
  moment: string | null;
  subjectName: string | null;
  programCode: string | null;
  programName: string | null;
  teacherId: string | null;
  teacher: {
    id: string;
    sourceId: string | null;
    documentId: string | null;
    fullName: string;
    email?: string | null;
    costCenter?: string | null;
    coordination?: string | null;
  } | null;
  moodleCheck: {
    status: string;
    detectedTemplate: string | null;
    errorCode?: string | null;
    moodleCourseUrl?: string | null;
    moodleCourseId?: string | null;
    resolvedModality?: string | null;
    searchQuery?: string | null;
    notes?: string | null;
  } | null;
  bannerStartDate?: string | null;
  bannerEndDate?: string | null;
  bannerReviewStatus?: string | null;
  reviewExcluded?: boolean;
  reviewExcludedReason?: string | null;
  selectedForChecklist?: boolean;
  selectedSampleGroups?: Array<{
    id: string;
    moment: string;
    template: string;
    modality: string;
    programCode: string;
  }>;
  checklistTemporal?: {
    active: boolean;
    reason: string | null;
    at: string | null;
  };
  evaluationSummary?: {
    alistamientoScore: number | null;
    ejecucionScore: number | null;
    latestPhase: string | null;
    latestScore: number | null;
    latestObservations: string | null;
    latestComputedAt: string | null;
    latestReplicatedFromCourseId: string | null;
  } | null;
  integrations: {
    moodleSidecar: SidecarCourseRecord | null;
    urlValidation: UrlValidationRecord | null;
    bannerExport: BannerExportRecord | null;
  };
};

export type OutboxItem = {
  status: string;
  subject: string;
  recipientName: string | null;
  recipientEmail: string | null;
  teacher: {
    fullName: string;
  } | null;
  coordinator: {
    fullName: string;
  } | null;
};

export type SidecarCourseRecord = {
  nrc: string;
  type: string | null;
  participants: number | null;
  participantsDetected: number | null;
  empty: boolean;
  confidence: string | null;
  status: string | null;
  error: string | null;
  moodleCourseName: string | null;
  moodleCourseId: string | null;
  moodleLinks: string | null;
  queryUsed: string | null;
  modality: string | null;
};

export type UrlValidationRecord = {
  nrc: string;
  period: string | null;
  teacherName: string | null;
  subjectName: string | null;
  modality: string | null;
  moodleUrl: string | null;
};

export type BannerExportRecord = {
  queryId?: string | null;
  nrc: string;
  period: string | null;
  teacherName: string | null;
  teacherId: string | null;
  programName: string | null;
  status: string | null;
  checkedAt: string | null;
  errorMessage: string | null;
};

export type FileEntry = {
  name: string;
  path: string;
  relativePath: string;
  sizeBytes: number;
  sizeLabel: string;
  modifiedAt: string;
  source: 'system' | 'banner';
  category: string;
};

export type SidecarSummary = {
  latestFile: string | null;
  modifiedAt: string | null;
  rowCount: number;
  okCount: number;
  errorCount: number;
  emptyClassrooms: number;
  typeCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  participantAverage: number | null;
  preview: SidecarCourseRecord[];
  sampleByNrc: Record<string, SidecarCourseRecord>;
};

export type UrlValidationSummary = {
  latestFile: string | null;
  modifiedAt: string | null;
  rowCount: number;
  withUrlCount: number;
  preview: UrlValidationRecord[];
  sampleByNrc: Record<string, UrlValidationRecord>;
};

export type BannerExportSummary = {
  latestFile: string | null;
  modifiedAt: string | null;
  rowCount: number;
  statusCounts: Record<string, number>;
  preview: BannerExportRecord[];
  sampleByNrc: Record<string, BannerExportRecord>;
};

export type BannerRunnerStatus = {
  running: boolean;
  current: BannerRunnerRun | null;
  lastRun: BannerRunnerRun | null;
  logTail: string;
  liveActivity: {
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
  } | null;
};

export type BannerRunnerRun = {
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

export type OpsData = {
  generatedAt: string;
  projectRoot: string;
  bannerProjectRoot: string;
  apiBase: string;
  apiReachable: boolean;
  health: ApiHealth | null;
  stats: ApiStats | null;
  queue: QueueStats | null;
  courses: {
    total: number;
    items: CourseRecord[];
  };
  outbox: {
    total: number;
    items: OutboxItem[];
  };
  sidecar: {
    config: Record<string, unknown> | null;
    runner: Record<string, unknown> | null;
    summary: SidecarSummary;
    urlValidation: UrlValidationSummary;
  };
  banner: {
    runner: BannerRunnerStatus;
    exportSummary: BannerExportSummary;
  };
  files: FileEntry[];
  derived: {
    withTeacher: number;
    withoutTeacher: number;
    moodleOk: number;
    moodlePending: number;
    moodleErrors: number;
    withMoodleUrl: number;
    withSidecarData: number;
    bannerFound: number;
    bannerWithoutTeacher: number;
    outboxDrafts: number;
    reviewExcluded: number;
    attention: Array<{
      id: string;
      nrc: string;
      subjectName: string | null;
      periodCode: string;
      teacherName: string | null;
      reason: string;
    }>;
  };
};

export type ActionResponse = {
  ok: boolean;
  action: string;
  result?: unknown;
  error?: string;
};
