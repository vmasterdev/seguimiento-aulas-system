export type LogLevel = "debug" | "info" | "warn" | "error";

export enum ResultStatus {
  ENCONTRADO = "ENCONTRADO",
  SIN_DOCENTE = "SIN_DOCENTE",
  NO_ENCONTRADO = "NO_ENCONTRADO",
  ERROR = "ERROR"
}

export enum QueryStatus {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  PARTIAL = "PARTIAL",
  FAILED = "FAILED"
}

export interface BannerCredentials {
  username: string;
  password: string;
}

export interface LookupRequest {
  nrc: string;
  period?: string;
}

export interface LookupResultPayload {
  nrc: string;
  period: string;
  teacherName: string | null;
  teacherId: string | null;
  programName: string | null;
  statusText: string | null;
  additionalData: Record<string, string | null>;
  rawPayload: Record<string, unknown>;
  status: ResultStatus;
}

export interface BannerEnrollmentStudent {
  registrationSequence: number | null;
  institutionalId: string | null;
  fullName: string | null;
  statusCode: string | null;
  statusDate: string | null;
  gradeMode: string | null;
  creditHours: string | null;
  rolled: boolean | null;
  rawData: Record<string, string | null>;
}

export interface BannerEnrollmentCoursePayload {
  nrc: string;
  period: string;
  termDescription: string | null;
  subjectCode: string | null;
  courseNumber: string | null;
  sequenceNumber: string | null;
  status: "FOUND" | "EMPTY";
  students: BannerEnrollmentStudent[];
  rawPayload: Record<string, unknown>;
}

export interface BannerPersonPayload {
  personId: string;
  normalizedPersonId: string;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  email: string | null;
  status: "FOUND" | "NOT_FOUND";
  rawPayload: Record<string, unknown>;
}

export interface BannerPersonBatchInputItem {
  personId: string;
}

export interface BannerPersonBatchItemResult extends BannerPersonPayload {
  errorMessage: string | null;
}

export interface BannerPersonBatchSummary {
  ok: true;
  processed: number;
  found: number;
  notFound: number;
  failed: number;
  outputPath: string | null;
  items: BannerPersonBatchItemResult[];
}

export interface PersistedLookupResult extends LookupResultPayload {
  errorMessage: string | null;
  screenshotPath: string | null;
  htmlPath: string | null;
  checkedAt: Date;
}

export interface BatchItem {
  nrc: string;
  period?: string;
  lineNumber?: number;
}

export interface BatchProcessOptions {
  items: BatchItem[];
  queryId?: string;
  queryName?: string;
  inputPath?: string;
  requestedPeriod?: string;
  resume?: boolean;
  workers?: number;
}

export interface BatchProcessSummary {
  queryId: string;
  queryName: string;
  processed: number;
  total: number;
  counts: Record<ResultStatus, number>;
}

export interface EvidencePaths {
  screenshotPath: string | null;
  htmlPath: string | null;
}

export interface RetryOptions {
  queryId: string;
}
