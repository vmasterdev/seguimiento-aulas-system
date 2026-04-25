import { errorMessage } from "../core/errors.js";
import type { EvidencePaths, LookupRequest } from "../core/types.js";
import { ResultStatus } from "../core/types.js";
import { BannerResultRepository } from "../db/repositories/bannerResultRepository.js";
import { EvidenceService } from "../evidence/evidenceService.js";
import type { AppLogger } from "../logging/logger.js";
import type { LookupAutomationSession } from "../banner/bannerClient.js";

export class LookupService {
  constructor(
    private readonly resultRepository: BannerResultRepository,
    private readonly evidenceService: EvidenceService,
    private readonly logger: AppLogger
  ) {}

  async execute(params: {
    automationSession: LookupAutomationSession;
    queryId: string;
    sessionId: string;
    request: LookupRequest;
  }) {
    try {
      const payload = await params.automationSession.lookup(params.request);
      return this.resultRepository.save({
        queryId: params.queryId,
        sessionId: params.sessionId,
        nrc: payload.nrc,
        period: payload.period,
        teacherName: payload.teacherName,
        teacherId: payload.teacherId,
        programName: payload.programName,
        rawPayload: payload.rawPayload,
        additionalData: {
          statusText: payload.statusText,
          ...payload.additionalData
        },
        status: payload.status,
        checkedAt: new Date(),
        errorMessage: null,
        screenshotPath: null,
        htmlPath: null
      });
    } catch (error) {
      const evidence = await this.captureEvidence(params.automationSession, params, "lookup-error");
      const message = errorMessage(error);

      this.logger.error("Error consultando NRC", {
        queryId: params.queryId,
        nrc: params.request.nrc,
        period: params.request.period ?? "",
        error: message
      });

      const saveInput = {
        queryId: params.queryId,
        sessionId: params.sessionId,
        nrc: params.request.nrc,
        rawPayload: {
          stage: "lookup"
        },
        additionalData: {},
        status: ResultStatus.ERROR,
        checkedAt: new Date(),
        errorMessage: message,
        screenshotPath: evidence.screenshotPath,
        htmlPath: evidence.htmlPath
      } as {
        queryId: string;
        sessionId: string;
        nrc: string;
        period?: string;
        rawPayload: { stage: string };
        additionalData: Record<string, never>;
        status: ResultStatus;
        checkedAt: Date;
        errorMessage: string;
        screenshotPath: string | null;
        htmlPath: string | null;
      };

      if (params.request.period) {
        saveInput.period = params.request.period;
      }

      return this.resultRepository.save(saveInput);
    }
  }

  private async captureEvidence(
    automationSession: LookupAutomationSession,
    params: {
      queryId: string;
      request: LookupRequest;
    },
    label: string
  ): Promise<EvidencePaths> {
    const captureInput = {
      queryId: params.queryId,
      nrc: params.request.nrc,
      label
    } as { queryId: string; nrc: string; period?: string; label: string };

    if (params.request.period) {
      captureInput.period = params.request.period;
    }

    return this.evidenceService.capture(automationSession.page, captureInput);
  }
}
