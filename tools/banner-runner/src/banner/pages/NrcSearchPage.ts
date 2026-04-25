import type { Frame, Locator, Page } from "playwright";

import type { BannerProfile } from "../../config/bannerProfile.js";
import type { LookupRequest, LookupResultPayload } from "../../core/types.js";
import { ResultStatus } from "../../core/types.js";
import type { AppLogger } from "../../logging/logger.js";
import { resolveFrameRoot } from "../frameResolver.js";
import { clickFirst, exists, fillFirst, textFromFirst } from "../selectors.js";

type SearchRoot = Page | Frame;

interface InstructorCell {
  member: string;
  row: string | null;
  rowId: string | null;
  text: string | null;
}

interface InstructorAssignment {
  rowIndex: number;
  rowId: string | null;
  category: string | null;
  teacherIdRaw: string | null;
  teacherId: string | null;
  teacherName: string | null;
}

function normalizeText(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTeacherId(value: string | null): string | null {
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

function buildInstructorAssignments(cells: InstructorCell[]): InstructorAssignment[] {
  const rows = new Map<string, InstructorAssignment>();

  for (const cell of cells) {
    const rowKey = cell.rowId ?? cell.row ?? `${rows.size}`;
    const rowIndex = Number.parseInt(cell.row ?? "", 10);
    const current =
      rows.get(rowKey) ??
      ({
        rowIndex: Number.isNaN(rowIndex) ? rows.size : rowIndex,
        rowId: cell.rowId,
        category: null,
        teacherIdRaw: null,
        teacherId: null,
        teacherName: null
      } satisfies InstructorAssignment);

    const text = normalizeText(cell.text);

    if (cell.member === "SIRASGN_CATEGORY") {
      current.category = text;
    }

    if (cell.member === "SIRASGN_IDNO") {
      current.teacherIdRaw = text;
      current.teacherId = normalizeTeacherId(text);
    }

    if (cell.member === "NAME") {
      current.teacherName = text;
    }

    rows.set(rowKey, current);
  }

  return [...rows.values()].sort((left, right) => left.rowIndex - right.rowIndex);
}

function hasAssignedInstructor(assignment: InstructorAssignment): boolean {
  return assignment.teacherId !== null || assignment.teacherName !== null;
}

function selectPrimaryInstructor(assignments: InstructorAssignment[]): InstructorAssignment | null {
  const assigned = assignments.filter(hasAssignedInstructor);
  if (assigned.length === 0) {
    return null;
  }

  return assigned.find((assignment) => assignment.category === "01") ?? assigned[0] ?? null;
}

async function extractInstructorAssignments(resultsRoot: SearchRoot): Promise<InstructorAssignment[]> {
  const cells = (await resultsRoot
    .locator("div[data-member='SIRASGN_CATEGORY'], div[data-member='SIRASGN_IDNO'], div[data-member='NAME']")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const cell = element as unknown as {
          dataset?: {
            member?: string;
            row?: string;
            rowid?: string;
          };
          textContent?: string | null;
        };

        return {
          member: cell.dataset?.member ?? "",
          row: cell.dataset?.row ?? null,
          rowId: cell.dataset?.rowid ?? null,
          text: cell.textContent?.trim() ?? null
        };
      })
    )) as InstructorCell[];

  return buildInstructorAssignments(cells);
}

async function readLocatorTextOrValue(locator: Locator): Promise<string | null> {
  const text = normalizeText(await locator.textContent().catch(() => null));
  if (text) {
    return text;
  }

  return normalizeText(await locator.inputValue().catch(() => null));
}

async function firstNonEmptyValue(root: SearchRoot, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (count === 0) {
      continue;
    }

    const value = await readLocatorTextOrValue(locator);
    if (value) {
      return value;
    }
  }

  return null;
}

async function extractMeetingDateRange(resultsRoot: SearchRoot): Promise<{
  startDate: string | null;
  endDate: string | null;
}> {
  const startDate = await firstNonEmptyValue(resultsRoot, [
    "[data-member='SSRMEET_START_DATE']",
    "input[data-member='SSRMEET_START_DATE']"
  ]);
  const endDate = await firstNonEmptyValue(resultsRoot, [
    "[data-member='SSRMEET_END_DATE']",
    "input[data-member='SSRMEET_END_DATE']",
    "input[aria-labelledby*='page_dates'][value]"
  ]);

  return {
    startDate,
    endDate
  };
}

export class NrcSearchPage {
  constructor(
    private readonly page: Page,
    private readonly profile: BannerProfile,
    private readonly logger: AppLogger,
    private readonly timeouts: {
      navigationTimeoutMs: number;
      actionTimeoutMs: number;
    }
  ) {}

  async open(): Promise<void> {
    if (this.profile.navigation.searchUrl) {
      await this.page.goto(this.profile.navigation.searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.timeouts.navigationTimeoutMs
      });
      await this.assertSearchPageState();
    }

    if (this.profile.navigation.menuPath.length === 0) {
      return;
    }

    const root = await resolveFrameRoot(
      this.page,
      this.profile.navigation.framePath,
      this.timeouts.navigationTimeoutMs
    );

    for (const step of this.profile.navigation.menuPath) {
      await clickFirst(root, step, this.timeouts.actionTimeoutMs);
    }
  }

  private async assertSearchPageState(): Promise<void> {
    const pageText = await this.page.locator("body").innerText().catch(() => "");
    const currentUrl = this.page.url();

    if (/Service Invocation Failed|Couldn't access remote service/i.test(pageText)) {
      throw new Error(
        "Banner devolvio 'Service Invocation Failed' al abrir SSASECT. Vuelve a autenticarte desde la interfaz grafica."
      );
    }

    if (
      /commonauth|login\.microsoftonline\.com|applicationNavigator\/seamless/i.test(currentUrl) ||
      /Iniciar sesion en la cuenta|Sign in to your account/i.test(pageText)
    ) {
      throw new Error(
        "La sesion Banner expiro o requiere inicio de sesion en Microsoft. Usa 'Abrir login Banner' y luego 'Guardar sesion Banner'."
      );
    }
  }

  async lookup(request: LookupRequest): Promise<LookupResultPayload> {
    const optionalFieldTimeoutMs = Math.min(this.timeouts.actionTimeoutMs, 750);
    const formRoot = await resolveFrameRoot(
      this.page,
      this.profile.lookup.formFramePath,
      this.timeouts.navigationTimeoutMs
    );

    if (this.profile.lookup.resetButton) {
      await clickFirst(
        formRoot,
        this.profile.lookup.resetButton,
        Math.min(this.timeouts.actionTimeoutMs, 1200)
      ).catch(() => undefined);
    }

    if (this.profile.lookup.preSearchWaitMs > 0) {
      await this.page.waitForTimeout(this.profile.lookup.preSearchWaitMs);
    }

    if (request.period && this.profile.lookup.periodInput) {
      await fillFirst(
        formRoot,
        this.profile.lookup.periodInput,
        request.period,
        this.timeouts.actionTimeoutMs
      );
    }

    await fillFirst(formRoot, this.profile.lookup.nrcInput, request.nrc, this.timeouts.actionTimeoutMs);

    if (this.profile.lookup.searchButton && this.profile.lookup.searchButton.length > 0) {
      await clickFirst(formRoot, this.profile.lookup.searchButton, this.timeouts.actionTimeoutMs);
    }

    if (this.profile.lookup.postSearchWaitMs > 0) {
      await this.page.waitForTimeout(this.profile.lookup.postSearchWaitMs);
    }

    if (this.profile.lookup.postSearchActions.length > 0) {
      const actionRoot = await resolveFrameRoot(
        this.page,
        this.profile.lookup.actionFramePath,
        this.timeouts.navigationTimeoutMs
      );

      for (const action of this.profile.lookup.postSearchActions) {
        await clickFirst(actionRoot, action, this.timeouts.actionTimeoutMs);
      }

      if (this.profile.lookup.postSearchWaitMs > 0) {
        await this.page.waitForTimeout(this.profile.lookup.postSearchWaitMs);
      }
    }

    const resultsRoot = await resolveFrameRoot(
      this.page,
      this.profile.lookup.resultsFramePath,
      this.timeouts.navigationTimeoutMs
    );

    const noResults = await exists(
      resultsRoot,
      this.profile.lookup.noResultsIndicators,
      Math.min(this.timeouts.actionTimeoutMs, 2000)
    );

    if (noResults) {
      return {
        nrc: request.nrc,
        period: request.period ?? "",
        teacherName: null,
        teacherId: null,
        programName: null,
        statusText: null,
        additionalData: {},
        rawPayload: {
          reason: "no_results_indicator"
        },
        status: ResultStatus.NO_ENCONTRADO
      };
    }

    if (this.profile.lookup.resultsContainer) {
      const resultsFound = await exists(
        resultsRoot,
        this.profile.lookup.resultsContainer,
        this.timeouts.actionTimeoutMs
      );

      if (!resultsFound) {
        return {
          nrc: request.nrc,
          period: request.period ?? "",
          teacherName: null,
          teacherId: null,
          programName: null,
          statusText: null,
          additionalData: {},
          rawPayload: {
            reason: "results_container_missing"
          },
          status: ResultStatus.NO_ENCONTRADO
        };
      }
    }

    const instructors = await extractInstructorAssignments(resultsRoot);
    const primaryInstructor = selectPrimaryInstructor(instructors);
    const assignedInstructors = instructors.filter(hasAssignedInstructor);
    const hasInstructorRows = instructors.length > 0;
    const teacherName =
      primaryInstructor?.teacherName ??
      (await textFromFirst(resultsRoot, this.profile.lookup.teacherName, optionalFieldTimeoutMs));
    const teacherIdRaw =
      primaryInstructor?.teacherIdRaw ??
      (await textFromFirst(resultsRoot, this.profile.lookup.teacherId, optionalFieldTimeoutMs));
    const teacherId = primaryInstructor?.teacherId ?? normalizeTeacherId(teacherIdRaw);
    const programName = await textFromFirst(
      resultsRoot,
      this.profile.lookup.programName,
      optionalFieldTimeoutMs
    );
    const { startDate, endDate } = await extractMeetingDateRange(resultsRoot);
    const statusText = await textFromFirst(
      resultsRoot,
      this.profile.lookup.statusText,
      optionalFieldTimeoutMs
    );

    const additionalData: Record<string, string | null> = {};
    for (const [fieldName, selectors] of Object.entries(this.profile.lookup.additionalFields)) {
      additionalData[fieldName] = await textFromFirst(resultsRoot, selectors, optionalFieldTimeoutMs);
    }

    const hasTeacher = Boolean(teacherName || teacherId || assignedInstructors.length > 0);
    const blankInstructorRowsDetected = hasInstructorRows && assignedInstructors.length === 0;
    const teacherMissingMarker = await exists(
      resultsRoot,
      this.profile.lookup.noTeacherIndicators,
      optionalFieldTimeoutMs
    );

    const status = hasTeacher
      ? ResultStatus.ENCONTRADO
      : teacherMissingMarker || blankInstructorRowsDetected
        ? ResultStatus.SIN_DOCENTE
        : ResultStatus.SIN_DOCENTE;

    const payload: LookupResultPayload = {
      nrc: request.nrc,
      period: request.period ?? "",
      teacherName,
      teacherId,
      programName,
      statusText,
      additionalData: {
        ...additionalData,
        teacherIdRaw,
        startDate,
        endDate,
        primaryCategory: primaryInstructor?.category ?? null,
        primaryInstructorFound: primaryInstructor ? "true" : "false",
        visibleInstructorRows: hasInstructorRows ? String(instructors.length) : "0",
        hasSecondaryInstructors: assignedInstructors.length > 1 ? "true" : "false"
      },
      rawPayload: {
        teacherName,
        teacherIdRaw,
        teacherId,
        programName,
        statusText,
        startDate,
        endDate,
        additionalData,
        instructors
      },
      status
    };

    this.logger.debug("Consulta Banner completada", {
      nrc: request.nrc,
      period: request.period ?? "",
      status
    });

    await this.returnToSearchForm(resultsRoot);

    return payload;
  }

  private async returnToSearchForm(resultsRoot: SearchRoot): Promise<void> {
    if (!this.profile.lookup.restartButton || this.profile.lookup.restartButton.length === 0) {
      return;
    }

    await clickFirst(resultsRoot, this.profile.lookup.restartButton, this.timeouts.actionTimeoutMs).catch(
      async () =>
        clickFirst(this.page, this.profile.lookup.restartButton!, this.timeouts.actionTimeoutMs).catch(
          () => undefined
        )
    );

    if (this.profile.lookup.postSearchWaitMs > 0) {
      await this.page.waitForTimeout(this.profile.lookup.postSearchWaitMs);
    }
  }
}

export const bannerFieldNormalizers = {
  normalizeTeacherId,
  buildInstructorAssignments,
  selectPrimaryInstructor
};
