import type { SupportedMoment } from './outbox.constants';

export type GeneratePayload = {
  periodCode: string;
  periodCodes?: string[];
  phase: 'ALISTAMIENTO' | 'EJECUCION';
  moment?: SupportedMoment;
  moments?: SupportedMoment[];
  audience?: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL';
  teacherId?: string;
  recipientName?: string;
  recipientEmails?: string[];
};

export type SendPayload = {
  ids?: string[];
  periodCode?: string;
  periodCodes?: string[];
  phase?: 'ALISTAMIENTO' | 'EJECUCION';
  moment?: SupportedMoment;
  moments?: SupportedMoment[];
  audience?: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL';
  status?: 'DRAFT' | 'EXPORTED' | 'SENT_MANUAL' | 'SENT_AUTO';
  limit?: number;
  forceTo?: string;
  dryRun?: boolean;
};

export type OutboxTrackingQuery = {
  periodCode?: string;
  phase?: 'ALISTAMIENTO' | 'EJECUCION';
  moment?: SupportedMoment;
  audience?: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL';
  status?: string;
  search?: string;
  page?: string;
  pageSize?: string;
};

export type SendCandidate = {
  id: string;
  originalTo: string;
  to: string;
  cc?: string;
  recipientName: string;
  fingerprint: string;
  messageCreatedAt: Date;
  subject: string;
  htmlBody: string;
  audience: string;
  periodCode: string;
  periodId: string;
  phase: string;
  moment: string;
  teacherId?: string;
  coordinatorId?: string;
};

export type SendAuditLogDetail = {
  to?: string;
  error?: string;
  messageId?: string | null;
  deliveryMode?: 'SMTP' | 'OUTLOOK';
  forceToApplied?: boolean;
  recipientName?: string;
  fingerprint?: string;
};

export type CourseCoordinationRow = {
  periodCode: string;
  periodLabel: string | null;
  teacherName: string;
  nrc: string;
  subject: string;
  moment: string;
  status: string;
  template: string;
  score: number | null;
  coordinationKey: string;
  coordinationName: string;
};

export type GlobalSummaryRow = {
  coordination: string;
  total: number;
  average: number | null;
  excellent: number;
  good: number;
  acceptable: number;
  unsatisfactory: number;
};

export type GlobalPeriodSummaryRow = {
  periodCode: string;
  moments: string[];
  total: number;
  average: number | null;
  excellent: number;
  good: number;
  acceptable: number;
  unsatisfactory: number;
};

export type GlobalMomentSummaryRow = {
  moment: string;
  total: number;
  average: number | null;
  excellent: number;
  good: number;
  acceptable: number;
  unsatisfactory: number;
};
