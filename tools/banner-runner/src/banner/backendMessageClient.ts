import type { Page } from "playwright";

import {
  ResultStatus,
  type BannerEnrollmentCoursePayload,
  type BannerEnrollmentStudent,
  type BannerPersonPayload,
  type LookupRequest,
  type LookupResultPayload
} from "../core/types.js";
import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../logging/logger.js";

interface BannerAction {
  "@name": string;
  "@item"?: string;
  "@block"?: string;
  "@kind"?: string;
  "@validateNewRow"?: boolean;
  "@taskValidation"?: boolean;
  "@recordValidation"?: boolean;
  "@validation"?: boolean;
  parameter?: Array<Record<string, string | boolean>>;
}

interface BannerControl {
  action?: BannerAction[];
  "@isSuspended"?: string;
  "@modal"?: string;
  "@isChanged"?: string;
  "@task"?: string;
  "@taskName"?: string;
  "@item"?: string;
  "@block"?: string;
}

interface BannerResponseItem {
  "@name": string;
  value?: string;
}

interface BannerResponseRecord {
  "@id": string;
  item?: BannerResponseItem[];
}

interface BannerResponseBlock {
  "@name": string;
  "@selected"?: string;
  page?: Array<Record<string, string | number>>;
  record?: BannerResponseRecord[];
}

interface BannerResponseAlert {
  "@name": string;
}

interface BannerMessageResponse {
  header?: Array<{
    control?: BannerControl[];
  }>;
  body?: Array<{
    block?: BannerResponseBlock[];
    alert?: BannerResponseAlert[];
  }>;
}

interface BackendLookupAssignment {
  rowId: string;
  category: string | null;
  teacherIdRaw: string | null;
  teacherId: string | null;
  teacherName: string | null;
  primary: boolean;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "xsi:nil") {
    return null;
  }
  return trimmed;
}

function normalizeTeacherId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed.replace(/^0+(?=\d)/, "");
}

function responseControl(response: BannerMessageResponse): BannerControl | null {
  return response.header?.[0]?.control?.[0] ?? null;
}

function responseBlocks(response: BannerMessageResponse): BannerResponseBlock[] {
  return response.body?.[0]?.block ?? [];
}

function itemValue(record: BannerResponseRecord, itemName: string): string | null {
  const item = record.item?.find((candidate) => candidate["@name"] === itemName);
  return normalizeText(item?.value);
}

function itemMap(record: BannerResponseRecord): Record<string, string | null> {
  const values: Record<string, string | null> = {};

  for (const item of record.item ?? []) {
    values[item["@name"]] = normalizeText(item.value);
  }

  return values;
}

function parseInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBooleanFlag(value: string | null): boolean | null {
  if (value === "Y") return true;
  if (value === "N") return false;
  return null;
}

function parseAssignments(block: BannerResponseBlock | null): BackendLookupAssignment[] {
  if (!block?.record?.length) {
    return [];
  }

  return block.record.map((record) => {
    const teacherIdRaw = itemValue(record, "SIRASGN_IDNO");
    const category = itemValue(record, "SIRASGN_CATEGORY");
    const teacherName = itemValue(record, "NAME");

    return {
      rowId: record["@id"],
      category,
      teacherIdRaw,
      teacherId: normalizeTeacherId(teacherIdRaw),
      teacherName,
      primary: category === "01" || itemValue(record, "SIRASGN_PRIMARY_IND") === "Y"
    };
  });
}

function selectPrimaryAssignment(assignments: BackendLookupAssignment[]): BackendLookupAssignment | null {
  const assigned = assignments.filter(
    (assignment) => assignment.teacherId !== null || assignment.teacherName !== null
  );

  if (assigned.length === 0) {
    return null;
  }

  return assigned.find((assignment) => assignment.primary) ?? assigned[0] ?? null;
}

const bannerDatePattern = /^(?:\d{1,2}-[A-Za-z]{3}-\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s+\d{2}:\d{2}:\d{2})?$/;

function normalizeBannerDate(value: string | null): string | null {
  if (!value) return null;
  // Strip time component if present: '14/02/2026 00:00:00' -> '14/02/2026'
  const datePart = value.split(' ')[0].trim();
  return datePart || null;
}

function findBlockValue(
  block: BannerResponseBlock | null,
  options: {
    exactNames?: string[];
    includes?: string[];
    valuePattern?: RegExp;
  }
): string | null {
  if (!block?.record?.length) {
    return null;
  }

  const exactNames = new Set((options.exactNames ?? []).map((name) => normalizedFieldName(name)));
  const includes = (options.includes ?? []).map((value) => normalizedFieldName(value));

  for (const record of block.record ?? []) {
    for (const item of record.item ?? []) {
      const value = normalizeText(item.value);
      if (!value) {
        continue;
      }

      if (options.valuePattern && !options.valuePattern.test(value)) {
        continue;
      }

      const itemKey = normalizedFieldName(item["@name"]);

      if (exactNames.size > 0 && exactNames.has(itemKey)) {
        return value;
      }

      if (includes.length > 0 && includes.some((candidate) => itemKey.includes(candidate))) {
        return value;
      }
    }
  }

  return null;
}

function extractSectionDateRange(response: BannerMessageResponse) {
  const meetingsBlock = blockByName(response, "SSRMEET");

  const startDate =
    findBlockValue(meetingsBlock, {
      exactNames: ["SSRMEET_START_DATE"],
      includes: ["startdate", "begindate", "fromdate"],
      valuePattern: bannerDatePattern
    }) ??
    findResponseValue(response, {
      exactNames: ["SSRMEET_START_DATE"],
      includes: ["startdate", "begindate", "fromdate"],
      valuePattern: bannerDatePattern
    });

  const endDate =
    findBlockValue(meetingsBlock, {
      exactNames: ["SSRMEET_END_DATE"],
      includes: ["enddate", "todate", "stopdate"],
      valuePattern: bannerDatePattern
    }) ??
    findResponseValue(response, {
      exactNames: ["SSRMEET_END_DATE"],
      includes: ["enddate", "todate", "stopdate"],
      valuePattern: bannerDatePattern
    });

  return {
    startDate: normalizeBannerDate(startDate),
    endDate: normalizeBannerDate(endDate)
  };
}

function blockByName(response: BannerMessageResponse, blockName: string): BannerResponseBlock | null {
  return responseBlocks(response).find((block) => block["@name"] === blockName) ?? null;
}

function responseAlerts(response: BannerMessageResponse): BannerResponseAlert[] {
  return response.body?.[0]?.alert ?? [];
}

function parseEnrollmentStudents(block: BannerResponseBlock | null): BannerEnrollmentStudent[] {
  if (!block?.record?.length) {
    return [];
  }

  return block.record
    .map((record) => {
      const rawData = itemMap(record);
      return {
        registrationSequence: parseInteger(rawData.SFRSTCR_REG_SEQ ?? null),
        institutionalId: rawData.SPRIDEN_ID ?? null,
        fullName: rawData.SPRIDEN_CURR_NAME ?? null,
        statusCode: rawData.SFRSTCR_RSTS_CODE ?? null,
        statusDate: rawData.SFRSTCR_RSTS_DATE ?? null,
        gradeMode: rawData.SFRSTCR_GMOD_CODE ?? null,
        creditHours: rawData.SFRSTCR_CREDIT_HR ?? null,
        rolled: parseBooleanFlag(rawData.ROLLED ?? null),
        rawData
      } satisfies BannerEnrollmentStudent;
    })
    .filter((student) => student.institutionalId !== null || student.fullName !== null);
}

function normalizePersonId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return trimmed;
  if (trimmed.length >= 8) return trimmed;
  return trimmed.padStart(9, "0");
}

function normalizedFieldName(value: string | null | undefined): string {
  return (value ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function responseItemsWithContext(response: BannerMessageResponse) {
  return responseBlocks(response).flatMap((block) =>
    (block.record ?? []).flatMap((record) =>
      (record.item ?? []).map((item) => ({
        blockName: block["@name"],
        recordId: record["@id"],
        itemName: item["@name"],
        value: normalizeText(item.value)
      }))
    )
  );
}

function findResponseValue(
  response: BannerMessageResponse,
  options: {
    exactNames?: string[];
    includes?: string[];
    valuePattern?: RegExp;
  }
): string | null {
  const exactNames = new Set((options.exactNames ?? []).map((name) => normalizedFieldName(name)));
  const includes = (options.includes ?? []).map((value) => normalizedFieldName(value));

  for (const entry of responseItemsWithContext(response)) {
    if (!entry.value) {
      continue;
    }

    if (options.valuePattern && !options.valuePattern.test(entry.value)) {
      continue;
    }

    const itemKey = normalizedFieldName(entry.itemName);

    if (exactNames.size > 0 && exactNames.has(itemKey)) {
      return entry.value;
    }

    if (includes.length > 0 && includes.some((candidate) => itemKey.includes(candidate))) {
      return entry.value;
    }
  }

  return null;
}

function decodeHtmlValue(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractHiddenHtmlForm(html: string): { action: string; fields: Record<string, string> } | null {
  const formMatch = html.match(/<form[^>]+action="([^"]+)"[^>]*>/i);
  if (!formMatch?.[1]) {
    return null;
  }

  const fields: Record<string, string> = {};
  for (const match of html.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"[^>]*>/gi)) {
    const name = match[1]?.trim();
    if (!name) {
      continue;
    }

    fields[name] = decodeHtmlValue(match[2] ?? "");
  }

  return {
    action: decodeHtmlValue(formMatch[1]),
    fields
  };
}

async function postJsonViaRequest(page: Page, url: string, payload: Record<string, unknown>) {
  const response = await page.context().request.post(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json"
    },
    data: payload,
    failOnStatusCode: false
  });

  return {
    status: response.status(),
    ok: response.ok(),
    text: await response.text()
  };
}

async function postJsonViaPage(page: Page, url: string, payload: Record<string, unknown>) {
  return page.evaluate(
    async ({ nextUrl, nextPayload }) => {
      const response = await fetch(nextUrl, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify(nextPayload)
      });

      return {
        status: response.status,
        ok: response.ok,
        text: await response.text()
      };
    },
    {
      nextUrl: url,
      nextPayload: payload
    }
  );
}

export class BannerBackendMessageClient {
  private readonly messageUrl: string;
  private guainitTaskId: string | null = null;
  private ssasectTaskId: string | null = null;
  private sfaalstTaskId: string | null = null;
  private spaidenTaskId: string | null = null;
  private observedGuainitTaskId: string | null = null;
  private observedSsasectTaskId: string | null = null;
  private readonly reuseObservedTask: boolean;

  constructor(
    private readonly page: Page,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    options: {
      reuseObservedTask?: boolean;
      observeResponses?: boolean;
    } = {}
  ) {
    this.messageUrl = new URL("/BannerAdmin.ws/rest-services/message/", this.config.banner.baseUrl).toString();
    this.reuseObservedTask = options.reuseObservedTask ?? true;

    if (options.observeResponses !== false) {
      this.page.on("response", (response) => {
        void this.observeMessageResponse(response);
      });
    }
  }

  fork(): BannerBackendMessageClient {
    return new BannerBackendMessageClient(this.page, this.config, this.logger, {
      reuseObservedTask: false,
      observeResponses: false
    });
  }

  async initialize(): Promise<void> {
    if (this.ssasectTaskId) {
      return;
    }

    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForLoadState("networkidle").catch(() => undefined);

    const discoveredTaskId = this.reuseObservedTask ? await this.waitForObservedSsasectTaskId(3000) : null;
    if (discoveredTaskId) {
      this.ssasectTaskId = discoveredTaskId;
      this.guainitTaskId = this.observedGuainitTaskId;
      this.logger.info("Sesion backend Banner reutilizada desde trafico de la pagina", {
        taskId: discoveredTaskId
      });
      return;
    }

    const workspaceResponse = await this.send(this.workspaceInitPayload());
    const workspaceControl = responseControl(workspaceResponse);
    const guainitTaskId = workspaceControl?.["@task"] ?? null;
    this.logger.info("Bootstrap backend WORKSPACE_INIT", {
      task: workspaceControl?.["@task"] ?? null,
      taskName: workspaceControl?.["@taskName"] ?? null
    });

    if (!guainitTaskId) {
      throw new Error("No fue posible resolver la tarea GUAINIT");
    }

    this.guainitTaskId = guainitTaskId;

    const callFormResponse = await this.send(this.callFormPayload(guainitTaskId));
    this.logger.info("Bootstrap backend respuesta", {
      step: "CALL_FORM",
      task: responseControl(callFormResponse)?.["@task"] ?? null,
      taskName: responseControl(callFormResponse)?.["@taskName"] ?? null,
      blockNames: responseBlocks(callFormResponse).map((block) => block["@name"])
    });

    const unlockResponse = await this.send(this.unlockGlobalsPayload(guainitTaskId));
    this.logger.info("Bootstrap backend respuesta", {
      step: "UNLOCK_GLOBALS",
      task: responseControl(unlockResponse)?.["@task"] ?? null,
      taskName: responseControl(unlockResponse)?.["@taskName"] ?? null,
      blockNames: responseBlocks(unlockResponse).map((block) => block["@name"])
    });

    const ssasectControl = [callFormResponse, unlockResponse]
      .map((response) => responseControl(response))
      .find((control) => control?.["@taskName"] === "SSASECT") ?? null;

    let ssasectTaskId = ssasectControl?.["@task"] ?? null;

    if (!ssasectTaskId) {
      const refreshResponse = await this.send(this.workspaceRefreshPayload(guainitTaskId));
      const refreshControl = responseControl(refreshResponse);
      const refreshedGuainitTaskId = refreshControl?.["@task"] ?? guainitTaskId;

      this.logger.info("Bootstrap backend WORKSPACE_REFRESH", {
        task: refreshControl?.["@task"] ?? null,
        taskName: refreshControl?.["@taskName"] ?? null
      });

      const refreshedCallFormResponse = await this.send(this.callFormPayload(refreshedGuainitTaskId));
      this.logger.info("Bootstrap backend respuesta", {
        step: "CALL_FORM_REFRESH",
        task: responseControl(refreshedCallFormResponse)?.["@task"] ?? null,
        taskName: responseControl(refreshedCallFormResponse)?.["@taskName"] ?? null,
        blockNames: responseBlocks(refreshedCallFormResponse).map((block) => block["@name"])
      });

      const refreshedUnlockResponse = await this.send(this.unlockGlobalsPayload(refreshedGuainitTaskId));
      this.logger.info("Bootstrap backend respuesta", {
        step: "UNLOCK_GLOBALS_REFRESH",
        task: responseControl(refreshedUnlockResponse)?.["@task"] ?? null,
        taskName: responseControl(refreshedUnlockResponse)?.["@taskName"] ?? null,
        blockNames: responseBlocks(refreshedUnlockResponse).map((block) => block["@name"])
      });

      const refreshedSsasectControl = [refreshedCallFormResponse, refreshedUnlockResponse]
        .map((response) => responseControl(response))
        .find((control) => control?.["@taskName"] === "SSASECT") ?? null;

      ssasectTaskId = refreshedSsasectControl?.["@task"] ?? null;
    }

    if (!ssasectTaskId) {
      throw new Error("No fue posible resolver la tarea SSASECT");
    }

    this.ssasectTaskId = ssasectTaskId;
    this.logger.info("Sesion backend Banner inicializada", {
      taskId: ssasectTaskId
    });
  }

  async initializeEnrollment(): Promise<void> {
    if (this.sfaalstTaskId) {
      return;
    }

    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForLoadState("networkidle").catch(() => undefined);

    const workspaceResponse = await this.send(this.workspaceInitPayload("SFAALST"));
    const workspaceControl = responseControl(workspaceResponse);
    const guainitTaskId = workspaceControl?.["@task"] ?? null;
    this.logger.info("Bootstrap backend WORKSPACE_INIT", {
      form: "SFAALST",
      task: workspaceControl?.["@task"] ?? null,
      taskName: workspaceControl?.["@taskName"] ?? null
    });

    if (!guainitTaskId) {
      throw new Error("No fue posible resolver la tarea GUAINIT para SFAALST");
    }

    this.guainitTaskId = guainitTaskId;

    const callFormResponse = await this.send(this.callFormPayload(guainitTaskId, "SFAALST"));
    this.logger.info("Bootstrap backend respuesta", {
      form: "SFAALST",
      step: "CALL_FORM",
      task: responseControl(callFormResponse)?.["@task"] ?? null,
      taskName: responseControl(callFormResponse)?.["@taskName"] ?? null,
      blockNames: responseBlocks(callFormResponse).map((block) => block["@name"])
    });

    const unlockResponse = await this.send(this.unlockGlobalsPayload(guainitTaskId));
    this.logger.info("Bootstrap backend respuesta", {
      form: "SFAALST",
      step: "UNLOCK_GLOBALS",
      task: responseControl(unlockResponse)?.["@task"] ?? null,
      taskName: responseControl(unlockResponse)?.["@taskName"] ?? null,
      blockNames: responseBlocks(unlockResponse).map((block) => block["@name"])
    });

    const sfaalstControl = [callFormResponse, unlockResponse]
      .map((response) => responseControl(response))
      .find((control) => control?.["@taskName"] === "SFAALST") ?? null;

    let sfaalstTaskId = sfaalstControl?.["@task"] ?? null;

    if (!sfaalstTaskId) {
      const refreshResponse = await this.send(this.workspaceRefreshPayload(guainitTaskId, "SFAALST"));
      const refreshControl = responseControl(refreshResponse);
      const refreshedGuainitTaskId = refreshControl?.["@task"] ?? guainitTaskId;

      const refreshedCallFormResponse = await this.send(this.callFormPayload(refreshedGuainitTaskId, "SFAALST"));
      const refreshedUnlockResponse = await this.send(this.unlockGlobalsPayload(refreshedGuainitTaskId));
      const refreshedSfaalstControl = [refreshedCallFormResponse, refreshedUnlockResponse]
        .map((response) => responseControl(response))
        .find((control) => control?.["@taskName"] === "SFAALST") ?? null;

      sfaalstTaskId = refreshedSfaalstControl?.["@task"] ?? null;
    }

    if (!sfaalstTaskId) {
      throw new Error("No fue posible resolver la tarea SFAALST");
    }

    this.sfaalstTaskId = sfaalstTaskId;
    this.logger.info("Sesion backend Banner SFAALST inicializada", {
      taskId: sfaalstTaskId
    });
  }

  async initializeSpaiden(): Promise<void> {
    if (this.spaidenTaskId) {
      return;
    }

    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForLoadState("networkidle").catch(() => undefined);

    const workspaceResponse = await this.send(this.workspaceInitPayload("SPAIDEN"));
    const workspaceControl = responseControl(workspaceResponse);
    const guainitTaskId = workspaceControl?.["@task"] ?? null;
    this.logger.info("Bootstrap backend WORKSPACE_INIT", {
      form: "SPAIDEN",
      task: workspaceControl?.["@task"] ?? null,
      taskName: workspaceControl?.["@taskName"] ?? null
    });

    if (!guainitTaskId) {
      throw new Error("No fue posible resolver la tarea GUAINIT para SPAIDEN");
    }

    this.guainitTaskId = guainitTaskId;

    const callFormResponse = await this.send(this.callFormPayload(guainitTaskId, "SPAIDEN"));
    this.logger.info("Bootstrap backend respuesta", {
      form: "SPAIDEN",
      step: "CALL_FORM",
      task: responseControl(callFormResponse)?.["@task"] ?? null,
      taskName: responseControl(callFormResponse)?.["@taskName"] ?? null,
      blockNames: responseBlocks(callFormResponse).map((block) => block["@name"])
    });

    const unlockResponse = await this.send(this.unlockGlobalsPayload(guainitTaskId));
    this.logger.info("Bootstrap backend respuesta", {
      form: "SPAIDEN",
      step: "UNLOCK_GLOBALS",
      task: responseControl(unlockResponse)?.["@task"] ?? null,
      taskName: responseControl(unlockResponse)?.["@taskName"] ?? null,
      blockNames: responseBlocks(unlockResponse).map((block) => block["@name"])
    });

    const spaidenControl = [callFormResponse, unlockResponse]
      .map((response) => responseControl(response))
      .find((control) => control?.["@taskName"] === "SPAIDEN") ?? null;

    let spaidenTaskId = spaidenControl?.["@task"] ?? null;

    if (!spaidenTaskId) {
      const refreshResponse = await this.send(this.workspaceRefreshPayload(guainitTaskId, "SPAIDEN"));
      const refreshControl = responseControl(refreshResponse);
      const refreshedGuainitTaskId = refreshControl?.["@task"] ?? guainitTaskId;

      const refreshedCallFormResponse = await this.send(
        this.callFormPayload(refreshedGuainitTaskId, "SPAIDEN")
      );
      const refreshedUnlockResponse = await this.send(this.unlockGlobalsPayload(refreshedGuainitTaskId));
      const refreshedSpaidenControl = [refreshedCallFormResponse, refreshedUnlockResponse]
        .map((response) => responseControl(response))
        .find((control) => control?.["@taskName"] === "SPAIDEN") ?? null;

      spaidenTaskId = refreshedSpaidenControl?.["@task"] ?? null;
    }

    if (!spaidenTaskId) {
      throw new Error("No fue posible resolver la tarea SPAIDEN");
    }

    this.spaidenTaskId = spaidenTaskId;
    this.logger.info("Sesion backend Banner SPAIDEN inicializada", {
      taskId: spaidenTaskId
    });
  }

  private async observeMessageResponse(response: {
    url(): string;
    request(): { method(): string };
    text(): Promise<string>;
  }): Promise<void> {
    if (response.request().method() !== "POST" || response.url() !== this.messageUrl) {
      return;
    }

    const responseText = await response.text().catch(() => null);
    if (!responseText) {
      return;
    }

    let payload: BannerMessageResponse;
    try {
      payload = JSON.parse(responseText) as BannerMessageResponse;
    } catch {
      return;
    }

    const control = responseControl(payload);
    if (!control) {
      return;
    }

    if (control["@taskName"] === "GUAINIT" && control["@task"]) {
      this.observedGuainitTaskId = control["@task"];
    }

    if (control["@taskName"] === "SSASECT" && control["@task"]) {
      this.observedSsasectTaskId = control["@task"];
    }
  }

  private async waitForObservedSsasectTaskId(timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.observedSsasectTaskId) {
        return this.observedSsasectTaskId;
      }

      await this.page.waitForTimeout(100);
    }

    return this.observedSsasectTaskId;
  }

  async lookup(request: LookupRequest): Promise<LookupResultPayload> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.ssasectTaskId) {
        await this.initialize();
      }

      const taskId = this.ssasectTaskId;
      if (!taskId) {
        throw new Error("La tarea SSASECT no esta disponible");
      }

      try {
        const period = request.period ?? "";
        await this.send(this.gotoItemPayload(taskId, period));
        const instructorResponse = await this.send(this.instructorMenuPayload(taskId, request.nrc));
        await this.send(this.clearFormPayload(taskId));


        // Consultar fechas de inicio/fin del NRC desde SSBSECT/SSRMEET
        let sectionDates: { startDate: string | null; endDate: string | null } | undefined;
        try {
          await this.send(this.gotoItemPayload(taskId, period));
          const ssbsectResponse = await this.send(this.sectionNextBlockPayload(taskId, period, request.nrc));
          sectionDates = extractSectionDateRange(ssbsectResponse);
          if (!sectionDates.startDate && !sectionDates.endDate) {
            const ssrmeetResponse = await this.send(this.meetingsNextBlockPayload(taskId)).catch(() => null);
            if (ssrmeetResponse) {
              const meetDates = extractSectionDateRange(ssrmeetResponse);
              if (meetDates.startDate || meetDates.endDate) {
                sectionDates = meetDates;
              }
            }
          }
          await this.send(this.clearFormPayload(taskId));
        } catch {
          // Si falla la consulta de fechas, continuar sin ellas
        }
        return this.mapLookupResponse(instructorResponse, request, sectionDates);
      } catch (error) {
        this.logger.warn("Fallo lookup backend, reinicializando tarea Banner", {
          nrc: request.nrc,
          period: request.period ?? "",
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error)
        });
        this.guainitTaskId = null;
        this.ssasectTaskId = null;
      }
    }

    throw new Error(`No fue posible consultar NRC ${request.nrc} por backend`);
  }

  async fetchEnrollment(request: LookupRequest): Promise<BannerEnrollmentCoursePayload> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.sfaalstTaskId) {
        await this.initializeEnrollment();
      }

      const taskId = this.sfaalstTaskId;
      if (!taskId) {
        throw new Error("La tarea SFAALST no esta disponible");
      }

      try {
        const period = request.period ?? "";
        let response = await this.send(this.sfaalstNextBlockPayload(taskId, period, request.nrc));
        const requiresAlertClose = responseAlerts(response).some((alert) => alert["@name"] === "S$_GRADE_COMPONENTS");

        if (requiresAlertClose) {
          response = await this.send(this.sfaalstCloseAlertPayload(taskId));
        }

        const payload = this.mapEnrollmentResponse(response, request);
        await this.send(this.sfaalstClearFormPayload(taskId)).catch((error) => {
          this.logger.warn("Fallo limpiando SFAALST despues de consultar matricula", {
            nrc: request.nrc,
            period: period,
            error: error instanceof Error ? error.message : String(error)
          });
        });

        return payload;
      } catch (error) {
        this.logger.warn("Fallo consulta de matricula backend, reinicializando tarea Banner", {
          nrc: request.nrc,
          period: request.period ?? "",
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error)
        });
        this.guainitTaskId = null;
        this.sfaalstTaskId = null;
      }
    }

    throw new Error(`No fue posible consultar matricula Banner para NRC ${request.nrc}`);
  }

  async fetchPerson(personId: string): Promise<BannerPersonPayload> {
    const normalizedPerson = normalizePersonId(personId);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.spaidenTaskId) {
        await this.initializeSpaiden();
      }

      const taskId = this.spaidenTaskId;
      if (!taskId) {
        throw new Error("La tarea SPAIDEN no esta disponible");
      }

      try {
        let response = await this.send(this.spaidenNextBlockPayload(taskId, normalizedPerson));
        if (responseAlerts(response).length > 0) {
          response = await this.send(this.spaidenCloseAlertPayload(taskId));
        }

        let payload = this.mapSpaidenResponse(response, personId, normalizedPerson);
        if (!payload.email) {
          const emailLookups = await this.fetchSpaidenEmailVariants(taskId, personId, normalizedPerson);
          const firstWithEmail = emailLookups.find((candidate) => candidate.email);

          payload = {
            ...payload,
            email: firstWithEmail?.email ?? payload.email,
            rawPayload: {
              ...payload.rawPayload,
              emailLookup: emailLookups.map((candidate) => candidate.rawPayload)
            }
          };
        }

        await this.send(this.spaidenClearFormPayload(taskId)).catch((error) => {
          this.logger.warn("Fallo limpiando SPAIDEN despues de consultar persona", {
            personId: normalizedPerson,
            error: error instanceof Error ? error.message : String(error)
          });
        });

        return payload;
      } catch (error) {
        this.logger.warn("Fallo consulta SPAIDEN backend, reinicializando tarea Banner", {
          personId: normalizedPerson,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error)
        });
        this.guainitTaskId = null;
        this.spaidenTaskId = null;
      }
    }

    throw new Error(`No fue posible consultar persona ${normalizedPerson} en SPAIDEN`);
  }

  private mapLookupResponse(
    response: BannerMessageResponse,
    request: LookupRequest,
    sectionDates?: { startDate: string | null; endDate: string | null }
  ): LookupResultPayload {
    const instructorsBlock = blockByName(response, "SIRASGN");
    const assignments = parseAssignments(instructorsBlock);
    const { startDate, endDate } = sectionDates ?? extractSectionDateRange(response);
    const primary = selectPrimaryAssignment(assignments);
    const hasRows = assignments.length > 0;
    const teacherName = primary?.teacherName ?? null;
    const teacherIdRaw = primary?.teacherIdRaw ?? null;
    const teacherId = primary?.teacherId ?? null;
    const hasAssignedInstructor = assignments.some(
      (assignment) => assignment.teacherId !== null || assignment.teacherName !== null
    );

    return {
      nrc: request.nrc,
      period: request.period ?? "",
      teacherName,
      teacherId,
      programName: null,
      statusText: null,
      additionalData: {
        teacherIdRaw,
        startDate,
        endDate,
        primaryCategory: primary?.category ?? null,
        primaryInstructorFound: primary ? "true" : "false",
        visibleInstructorRows: String(assignments.length),
        hasSecondaryInstructors: assignments.filter((assignment) => assignment.rowId !== primary?.rowId).length > 0
          ? "true"
          : "false"
      },
      rawPayload: {
        backend: "message",
        instructors: assignments,
        meetingDates: {
          startDate,
          endDate
        }
      },
      status: hasAssignedInstructor
        ? ResultStatus.ENCONTRADO
        : hasRows
          ? ResultStatus.SIN_DOCENTE
          : ResultStatus.NO_ENCONTRADO
    };
  }

  private mapEnrollmentResponse(
    response: BannerMessageResponse,
    request: LookupRequest
  ): BannerEnrollmentCoursePayload {
    const keyBlock = blockByName(response, "KEY_BLOCK");
    const keyRecord = keyBlock?.record?.[0] ?? null;
    const studentsBlock = blockByName(response, "SFRSTCR");
    const students = parseEnrollmentStudents(studentsBlock);

    return {
      nrc: itemValue(keyRecord ?? { "@id": "", item: [] }, "SSBSECT_CRNT") ?? request.nrc,
      period: itemValue(keyRecord ?? { "@id": "", item: [] }, "SSBSECT_TERM_CODET") ?? request.period ?? "",
      termDescription: itemValue(keyRecord ?? { "@id": "", item: [] }, "TERM_DESC"),
      subjectCode: itemValue(keyRecord ?? { "@id": "", item: [] }, "KEYBLOC_SUBJ_CODE"),
      courseNumber: itemValue(keyRecord ?? { "@id": "", item: [] }, "KEYBLOC_CRSE_NUMB"),
      sequenceNumber: itemValue(keyRecord ?? { "@id": "", item: [] }, "KEYBLOC_SEQ_NUMB"),
      status: students.length > 0 ? "FOUND" : "EMPTY",
      students,
      rawPayload: {
        backend: "message",
        alertClosed: responseAlerts(response).length === 0,
        totalRecords: students.length
      }
    };
  }

  private mapSpaidenResponse(
    response: BannerMessageResponse,
    rawPersonId: string,
    normalizedPerson: string
  ): BannerPersonPayload {
    const lastName = findResponseValue(response, {
      exactNames: ["PERS_LAST_NAME", "persLastName"],
      includes: ["lastname"]
    });
    const firstName = findResponseValue(response, {
      exactNames: ["PERS_FIRST_NAME", "persFirstName"],
      includes: ["firstname"]
    });
    const middleName = findResponseValue(response, {
      exactNames: ["PERS_MI", "persMi"],
      includes: ["middlename", "secondname"]
    });
    const email = findResponseValue(response, {
      exactNames: ["GOREMAL_EMAIL_ADDRESS", "goremalEmailAddress_0", "EMAIL_ADDRESS"],
      includes: ["emailaddress", "email"],
      valuePattern: /@/
    });
    const resolvedPersonId =
      findResponseValue(response, {
        exactNames: ["SPRIDEN_ID", "spridenId", "ID", "id"]
      }) ?? normalizedPerson;

    const found = Boolean(lastName || firstName || middleName || email);
    const itemNames = responseItemsWithContext(response).map((entry) => entry.itemName);

    return {
      personId: rawPersonId,
      normalizedPersonId: resolvedPersonId,
      lastName,
      firstName,
      middleName,
      email,
      status: found ? "FOUND" : "NOT_FOUND",
      rawPayload: {
        backend: "message",
        alertNames: responseAlerts(response).map((alert) => alert["@name"]),
        blockNames: responseBlocks(response).map((block) => block["@name"]),
        blockSummary: responseBlocks(response).map((block) => ({
          blockName: block["@name"],
          recordCount: block.record?.length ?? 0,
          itemNames: (block.record ?? []).flatMap((record) => (record.item ?? []).map((item) => item["@name"]))
        })),
        itemNames
      }
    };
  }

  private async fetchSpaidenEmailVariants(
    taskId: string,
    rawPersonId: string,
    normalizedPerson: string
  ): Promise<BannerPersonPayload[]> {
    const attempts = [
      {
        label: "menu-goto-key",
        payload: this.spaidenEmailMenuPayload(taskId, normalizedPerson, {
          actionKind: "Menu",
          menuName: "GoTo",
          itemName: "ID",
          blockName: "KEY_BLOCK"
        })
      },
      {
        label: "menu-options-key",
        payload: this.spaidenEmailMenuPayload(taskId, normalizedPerson, {
          actionKind: "Menu",
          menuName: "Options",
          itemName: "ID",
          blockName: "KEY_BLOCK"
        })
      },
      {
        label: "action-key",
        payload: this.spaidenEmailMenuPayload(taskId, normalizedPerson, {
          actionKind: "Action",
          itemName: "ID",
          blockName: "KEY_BLOCK"
        })
      },
      {
        label: "action-current",
        payload: this.spaidenEmailMenuPayload(taskId, normalizedPerson, {
          actionKind: "Action",
          itemName: "PERS_LAST_NAME",
          blockName: "SPRIDEN_CURRENT"
        })
      },
      {
        label: "menu-options-current",
        payload: this.spaidenEmailMenuPayload(taskId, normalizedPerson, {
          actionKind: "Menu",
          menuName: "Options",
          itemName: "PERS_LAST_NAME",
          blockName: "SPRIDEN_CURRENT"
        })
      }
    ];

    const results: BannerPersonPayload[] = [];
    for (const attempt of attempts) {
      try {
        const response = await this.send(attempt.payload);
        const payload = this.mapSpaidenResponse(response, rawPersonId, normalizedPerson);
        results.push({
          ...payload,
          rawPayload: {
            ...payload.rawPayload,
            emailAttempt: attempt.label
          }
        });

        if (payload.email) {
          break;
        }
      } catch (error) {
        results.push({
          personId: rawPersonId,
          normalizedPersonId: normalizedPerson,
          lastName: null,
          firstName: null,
          middleName: null,
          email: null,
          status: "NOT_FOUND",
          rawPayload: {
            backend: "message",
            emailAttempt: attempt.label,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }

    return results;
  }

  private async completeSsoHandshake(html: string): Promise<boolean> {
    const hiddenForm = extractHiddenHtmlForm(html);
    if (!hiddenForm || !hiddenForm.fields.SAMLResponse) {
      return false;
    }

    this.logger.info("Ejecutando handshake SAML para Banner backend", {
      action: hiddenForm.action,
      fieldNames: Object.keys(hiddenForm.fields)
    });

    const response = await this.page.context().request.post(hiddenForm.action, {
      form: hiddenForm.fields,
      failOnStatusCode: false
    });

    this.logger.info("Handshake SAML completado", {
      status: response.status(),
      ok: response.ok()
    });

    await this.page.goto(this.config.banner.searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: this.config.banner.navigationTimeoutMs
    }).catch(() => undefined);
    await this.page.waitForLoadState("networkidle").catch(() => undefined);

    return response.ok() || response.status() < 500;
  }

  private async send(payload: Record<string, unknown>): Promise<BannerMessageResponse> {
    let response = await postJsonViaRequest(this.page, this.messageUrl, payload);

    if (
      (!response.ok || response.text.trim().startsWith("<")) &&
      /<form[^>]+action="https:\/\/sso\.uniminuto\.edu\/commonauth"/i.test(response.text)
    ) {
      const recovered = await this.completeSsoHandshake(response.text);
      if (recovered) {
        response = await postJsonViaRequest(this.page, this.messageUrl, payload);
      }
    }

    if (
      (!response.ok || response.text.trim().startsWith("<")) &&
      /commonauth|SAMLResponse|Sign in to your account|<html/i.test(response.text)
    ) {
      this.logger.warn("Fallback a fetch del navegador por respuesta SSO/HTML", {
        status: response.status,
        snippet: response.text.slice(0, 220).replace(/\s+/g, " ").trim()
      });
      try {
        response = await postJsonViaPage(this.page, this.messageUrl, payload);
      } catch (error) {
        const pageUrl = this.page.url();
        const pageText = await this.page.locator("body").innerText().catch(() => "");
        this.logger.error("Fallback fetch del navegador fallo", {
          status: response.status,
          pageUrl,
          pageText: pageText.slice(0, 220).replace(/\s+/g, " ").trim(),
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }

    if (/Service Invocation Failed|Couldn't access remote service/i.test(response.text)) {
      throw new Error(
        "Banner devolvio 'Service Invocation Failed'. La sesion no quedo habilitada para SSASECT."
      );
    }

    if (/commonauth|SAMLResponse|Sign in to your account|Iniciar sesi[oó]n en la cuenta/i.test(response.text)) {
      throw new Error(
        "La sesion Banner expiro o requiere inicio de sesion en Microsoft. Reautentica desde la interfaz grafica."
      );
    }

    if (response.text.trim().startsWith("<")) {
      throw new Error(
        `Banner devolvio HTML inesperado en vez de JSON. Respuesta inicial: ${response.text.slice(0, 180).replace(/\s+/g, " ").trim()}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Banner backend respondio ${response.status}: ${response.text.slice(0, 300).trim()}`
      );
    }

    try {
      return JSON.parse(response.text) as BannerMessageResponse;
    } catch (error) {
      throw new Error(
        `Respuesta backend invalida: ${error instanceof Error ? error.message : String(error)} :: ${response.text
          .slice(0, 300)
          .trim()}`
      );
    }
  }

  private workspaceInitPayload(formName = "SSASECT") {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  parameter: [
                    { "@datatype": "String", "@value": formName, "@name": "form" },
                    { "@datatype": "String", "@value": "true", "@name": "ban_args" },
                    { "@datatype": "String", "@value": "xe", "@name": "ban_mode" }
                  ],
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": true,
                  "@kind": "Action",
                  "@name": "WORKSPACE_INIT"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false"
            }
          ]
        }
      ]
    };
  }

  private callFormPayload(guainitTaskId: string, formName = "SSASECT") {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": true,
                  "@kind": "Action",
                  "@name": "CALL_FORM",
                  "@item": "MENU_TREE",
                  "@block": "$MAIN$_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": guainitTaskId,
              "@taskName": "GUAINIT",
              "@item": "MENU_TREE",
              "@block": "$MAIN$_BLOCK"
            }
          ]
        }
      ],
      body: [
        {
          callForm: [
            {
              "@taskName": formName,
              parameters: [
                {
                  parameter: [
                    { "@name": "ban_args", "@value": "true" },
                    { "@name": "ban_mode", "@value": "xe" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
  }

  private unlockGlobalsPayload(guainitTaskId: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": true,
                  "@kind": "Action",
                  "@name": "UNLOCK_GLOBALS",
                  "@item": "MENU_TREE",
                  "@block": "$MAIN$_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": guainitTaskId,
              "@taskName": "GUAINIT",
              "@item": "MENU_TREE",
              "@block": "$MAIN$_BLOCK"
            }
          ]
        }
      ]
    };
  }

  private workspaceRefreshPayload(guainitTaskId: string, formName = "SSASECT") {
    const searchUrl = new URL(this.config.banner.searchUrl);
    const configuredForm = searchUrl.searchParams.get("form") ?? "SSASECT";
    const form = formName === "SSASECT" ? configuredForm : formName;
    const banMode =
      formName === "SSASECT"
        ? `${searchUrl.searchParams.get("ban_mode") ?? "xe"}${searchUrl.hash ?? ""}`
        : "xe";

    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  parameter: [
                    { "@datatype": "String", "@value": form, "@name": "form" },
                    { "@datatype": "String", "@value": "true", "@name": "ban_args" },
                    { "@datatype": "String", "@value": banMode, "@name": "ban_mode" }
                  ],
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": true,
                  "@kind": "Action",
                  "@name": "WORKSPACE_REFRESH"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": guainitTaskId
            }
          ]
        }
      ]
    };
  }

  private gotoItemPayload(taskId: string, period: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  parameter: [
                    { "@datatype": "string", "@value": "SSASECT_TERM_CODE", "@name": "previousItem" },
                    { "@datatype": "string", "@value": "KEY_BLOCK", "@name": "previousBlock" },
                    { "@datatype": "string", "@value": "", "@name": "previousRecord" },
                    { "@datatype": "string", "@value": "SSASECT_CRN", "@name": "item" },
                    { "@datatype": "string", "@value": "KEY_BLOCK", "@name": "block" },
                    { "@datatype": "string", "@value": "", "@name": "record" },
                    { "@datatype": "string", "@value": "", "@name": "actionValue" },
                    { "@datatype": "string", "@value": "", "@name": "fireItemAction" }
                  ],
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": false,
                  "@kind": "Action",
                  "@name": "PROC:GOTOITEM",
                  "@item": "SSASECT_TERM_CODE",
                  "@block": "KEY_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SSASECT",
              "@item": "SSASECT_TERM_CODE",
              "@block": "KEY_BLOCK"
            }
          ]
        }
      ],
      body: [
        {
          block: [
            {
              "@name": "KEY_BLOCK",
              record: [
                {
                  "@id": "",
                  item: [
                    {
                      "@name": "SSASECT_TERM_CODE",
                      value: period
                    }
                  ],
                  "@status": "C"
                }
              ]
            }
          ]
        }
      ]
    };
  }

  private instructorMenuPayload(taskId: string, nrc: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": true,
                  "@kind": "Menu",
                  "@name": "OPT_INST_TRIGGER",
                  "@item": "SSASECT_CRN",
                  "@block": "KEY_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SSASECT",
              "@item": "SSASECT_CRN",
              "@block": "KEY_BLOCK"
            }
          ]
        }
      ],
      body: [
        {
          block: [
            {
              "@name": "KEY_BLOCK",
              record: [
                {
                  "@id": "",
                  item: [
                    {
                      "@name": "SSASECT_CRN",
                      value: nrc
                    }
                  ],
                  "@status": "C"
                }
              ]
            }
          ],
          menu: [
            {
              "@kind": "Main",
              "@name": "GoTo",
              "@item": "SIRASGN#P"
            }
          ]
        }
      ]
    };
  }

  private clearFormPayload(taskId: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": false,
                  "@kind": "Action",
                  "@name": "CLEAR-FORM",
                  "@item": "KEY-CLRFRM_BTN",
                  "@block": "KEY_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SSASECT",
              "@item": "SIRASGN_CATEGORY",
              "@block": "SIRASGN"
            }
          ]
        }
      ]
    };
  }

  private sfaalstNextBlockPayload(taskId: string, period: string, nrc: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": true,
                  "@kind": "Action",
                  "@name": "NEXT_BLOCK",
                  "@item": "EXECUTE_BTN",
                  "@block": "KEY_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SFAALST",
              "@item": "EXECUTE_BTN",
              "@block": "KEY_BLOCK"
            }
          ]
        }
      ],
      body: [
        {
          block: [
            {
              "@name": "KEY_BLOCK",
              record: [
                {
                  "@id": "",
                  item: [
                    {
                      "@name": "SSBSECT_TERM_CODET",
                      value: period
                    },
                    {
                      "@name": "SSBSECT_CRNT",
                      value: nrc
                    }
                  ],
                  "@status": "C"
                }
              ]
            }
          ]
        }
      ]
    };
  }

  private sfaalstCloseAlertPayload(taskId: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": false,
                  "@kind": "Action",
                  "@name": "CLOSE_ALERT",
                  "@item": "SSBSECT_TERM_CODET",
                  "@block": "KEY_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SFAALST",
              "@item": "SSBSECT_TERM_CODET",
              "@block": "KEY_BLOCK"
            }
          ]
        }
      ]
    };
  }

  private sfaalstClearFormPayload(taskId: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": false,
                  "@kind": "Action",
                  "@name": "CLEAR-FORM",
                  "@item": "KEY-CLRFRM_BTN",
                  "@block": "KEY_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SFAALST",
              "@item": "KEY-CLRFRM_BTN",
              "@block": "KEY_BLOCK"
            }
          ]
        }
      ]
    };
  }

  private spaidenNextBlockPayload(taskId: string, personId: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": true,
                  "@kind": "Action",
                  "@name": "NEXT_BLOCK",
                  "@item": "EXECUTE_BTN",
                  "@block": "KEY_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SPAIDEN",
              "@item": "EXECUTE_BTN",
              "@block": "KEY_BLOCK"
            }
          ]
        }
      ],
      body: [
        {
          block: [
            {
              "@name": "KEY_BLOCK",
              record: [
                {
                  "@id": "",
                  item: [
                    {
                      "@name": "ID",
                      value: personId
                    }
                  ],
                  "@status": "C"
                }
              ]
            }
          ]
        }
      ]
    };
  }

  private spaidenClearFormPayload(taskId: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": false,
                  "@kind": "Action",
                  "@name": "CLEAR-FORM",
                  "@item": "KEY-CLRFRM_BTN",
                  "@block": "KEY_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SPAIDEN",
              "@item": "KEY-CLRFRM_BTN",
              "@block": "KEY_BLOCK"
            }
          ]
        }
      ]
    };
  }

  private spaidenCloseAlertPayload(taskId: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": false,
                  "@kind": "Action",
                  "@name": "CLOSE_ALERT",
                  "@item": "ID",
                  "@block": "KEY_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SPAIDEN",
              "@item": "ID",
              "@block": "KEY_BLOCK"
            }
          ]
        }
      ]
    };
  }

  private spaidenEmailMenuPayload(
    taskId: string,
    personId: string,
    options: {
      actionKind: "Action" | "Menu";
      menuName?: string;
      itemName: string;
      blockName: string;
    }
  ) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": true,
                  "@kind": options.actionKind,
                  "@name": "SHOW_EMAIL",
                  "@item": options.itemName,
                  "@block": options.blockName
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SPAIDEN",
              "@item": options.itemName,
              "@block": options.blockName
            }
          ]
        }
      ],
      body: [
        {
          block: [
            {
              "@name": "KEY_BLOCK",
              record: [
                {
                  "@id": "",
                  item: [
                    {
                      "@name": "ID",
                      value: personId
                    }
                  ],
                  "@status": "C"
                }
              ]
            }
          ],
          ...(options.actionKind === "Menu"
            ? {
                menu: [
                  {
                    "@kind": "Main",
                    "@name": options.menuName ?? "GoTo",
                    "@item": "GOREMAL#P"
                  }
                ]
              }
            : {})
        }
      ]
    };
  }

  private sectionNextBlockPayload(taskId: string, period: string, nrc: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": true,
                  "@kind": "Action",
                  "@name": "NEXT_BLOCK",
                  "@item": "SSASECT_CRN",
                  "@block": "KEY_BLOCK"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SSASECT",
              "@item": "SSASECT_CRN",
              "@block": "KEY_BLOCK"
            }
          ]
        }
      ],
      body: [
        {
          block: [
            {
              "@name": "KEY_BLOCK",
              record: [
                {
                  "@id": "",
                  item: [
                    { "@name": "SSASECT_TERM_CODE", value: period },
                    { "@name": "SSASECT_CRN", value: nrc }
                  ],
                  "@status": "C"
                }
              ]
            }
          ]
        }
      ]
    };
  }

  private meetingsNextBlockPayload(taskId: string) {
    return {
      header: [
        {
          control: [
            {
              action: [
                {
                  "@validateNewRow": false,
                  "@taskValidation": false,
                  "@recordValidation": false,
                  "@validation": false,
                  "@kind": "Action",
                  "@name": "NEXT_BLOCK",
                  "@item": "SSBSECT_TERM_CODE",
                  "@block": "SSBSECT"
                }
              ],
              "@isSuspended": "false",
              "@modal": "false",
              "@isChanged": "false",
              "@task": taskId,
              "@taskName": "SSASECT",
              "@item": "SSBSECT_TERM_CODE",
              "@block": "SSBSECT"
            }
          ]
        }
      ]
    };
  }
}
