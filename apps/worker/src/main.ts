import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import { chromium } from 'playwright';
import { normalizeTemplate } from '@seguimiento/shared';

type RedisConnection = {
  host: string;
  port: number;
  password?: string;
  db: number;
  maxRetriesPerRequest: null;
  enableReadyCheck: false;
};

type ModalityKey = 'presencial' | 'distancia' | 'posgrados' | 'moocs';

type MoodleClassifyJob = {
  courseId: string;
  periodId: string;
  nrc: string;
};

type ClassificationResult = {
  status: 'OK' | 'ERROR_REINTENTABLE' | 'DESCARTADO_NO_EXISTE' | 'REVISAR_MANUAL';
  detectedTemplate: string | null;
  errorCode: 'NO_EXISTE' | 'SIN_ACCESO' | 'TIMEOUT' | 'OTRO' | null;
  notes: string;
  evidenceHtmlPath: string | null;
  evidenceScreenshotPath: string | null;
  moodleCourseUrl: string | null;
  moodleCourseId: string | null;
  resolvedModality: string | null;
  resolvedBaseUrl: string | null;
  searchQuery: string | null;
};

type MoodleLookupResult = {
  html: string;
  screenshot: Buffer | null;
  notFound: boolean;
  noAccess: boolean;
  resolvedModality: string | null;
  resolvedBaseUrl: string | null;
  searchQuery: string | null;
  courseUrl: string | null;
  courseId: string | null;
  attemptedModalities: ModalityKey[];
};

const QUEUE_NAME = 'moodle.classify';
const prisma = new PrismaClient();

const MODALITY_DISPLAY: Record<ModalityKey, string> = {
  presencial: 'PRESENCIAL',
  distancia: 'DISTANCIA',
  posgrados: 'POSGRADOS',
  moocs: 'MOOCS',
};

const MODALITY_BY_PERIOD: Record<string, ModalityKey[]> = {
  '202610': ['presencial'],
  '202660': ['presencial'],
  '202615': ['distancia'],
  '202665': ['distancia'],
  '202611': ['posgrados'],
  '202661': ['posgrados'],
  '202621': ['posgrados'],
  '202671': ['posgrados'],
  '202641': ['posgrados'],
  '202580': ['moocs'],
};

const MODALITY_BY_NRC_PREFIX: Record<string, ModalityKey> = {
  '10': 'presencial',
  '15': 'distancia',
  '60': 'presencial',
  '65': 'distancia',
  '61': 'posgrados',
  '71': 'posgrados',
  '41': 'posgrados',
  '58': 'moocs',
  '62': 'moocs',
  '86': 'moocs',
};

const NO_ENROLLED_PATTERNS = [
  'no esta matriculado en este curso',
  'no estas matriculado en este curso',
  'no se puede auto matricular en este curso',
  'no se puede automatricular en este curso',
  'you are not enrolled in this course',
  'not enrolled in this course',
  'no tiene permisos para ver este curso',
];

const NO_RESULTS_PATTERN =
  /(no\s+courses\s+found|no\s+se\s+encontraron\s+cursos|sin\s+resultados|no\s+hay\s+cursos)/i;

const LOGIN_URL_HINTS = ['/login/', '/auth/oidc', '/oauth2/', 'login.microsoftonline.com', 'microsoftonline.com'];

const workerConfig = {
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6380',
  moodleUsername: (process.env.MOODLE_USERNAME ?? '').trim(),
  moodlePassword: (process.env.MOODLE_PASSWORD ?? '').trim(),
  evidenceDir: path.resolve(process.cwd(), process.env.EVIDENCE_DIR ?? '../../data/evidence'),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3),
  baseUrlByModality: {
    presencial: (process.env.MOODLE_BASE_URL_PRESENCIAL ?? 'https://presencial.aulasuniminuto.edu.co').trim(),
    distancia: (process.env.MOODLE_BASE_URL_DISTANCIA ?? 'https://distancia.aulasuniminuto.edu.co').trim(),
    posgrados: (process.env.MOODLE_BASE_URL_POSGRADOS ?? 'https://posgrados.aulasuniminuto.edu.co').trim(),
    moocs: (process.env.MOODLE_BASE_URL_MOOCS ?? 'https://moocs.aulasuniminuto.edu.co').trim(),
  } as Record<ModalityKey, string>,
};

function getRedisConnection(redisUrl: string): RedisConnection {
  const url = new URL(redisUrl);
  const port = Number(url.port || '6379');
  const dbFromPath = url.pathname ? Number(url.pathname.replace('/', '')) : 0;

  return {
    host: url.hostname,
    port: Number.isNaN(port) ? 6379 : port,
    password: url.password || undefined,
    db: Number.isNaN(dbFromPath) ? 0 : dbFromPath,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

function hasRealMoodleCredentials() {
  const user = workerConfig.moodleUsername.trim().toLowerCase();
  const pass = workerConfig.moodlePassword.trim().toLowerCase();
  if (!user || !pass) return false;
  if (['usuario', 'user', 'admin', '<usuario>'].includes(user)) return false;
  if (['clave', 'password', 'pass', '<password>', '<clave>'].includes(pass)) return false;
  return true;
}

function getActiveModalities(): ModalityKey[] {
  const keys = Object.keys(workerConfig.baseUrlByModality) as ModalityKey[];
  return keys.filter((key) => !!workerConfig.baseUrlByModality[key]);
}

function hasAnyMoodleTarget() {
  return getActiveModalities().length > 0;
}

function normalizePeriodCode(value: string | null | undefined): string {
  return String(value ?? '').replace(/[^\d]/g, '').slice(0, 6);
}

function uniqueKeepOrder<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function getNrcParts(nrc: string): { prefix: string; num: string } {
  const normalized = String(nrc ?? '').trim();
  const match = normalized.match(/^(\d{2})-(\d+)$/);
  if (match) {
    const num = String(Number(match[2]));
    return {
      prefix: match[1],
      num,
    };
  }

  const digits = normalized.replace(/[^\d]/g, '');
  const num = digits ? String(Number(digits.slice(-5))) : '';
  return {
    prefix: '',
    num,
  };
}

function mapPeriodSuffixToNrcPrefix(periodCode: string): string {
  return periodCode.slice(-2);
}

function buildNrcQueries(input: { nrc: string; periodCode: string }): string[] {
  const { num } = getNrcParts(input.nrc);
  if (!num) return [];
  const queries: string[] = [];

  const periodPrefix = mapPeriodSuffixToNrcPrefix(input.periodCode);
  if (periodPrefix) {
    queries.push(`${periodPrefix}-${num}`);
  }

  // No usar prefijos de otros semestres ni NRC con ceros a la izquierda.
  if (!periodPrefix) {
    queries.push(num);
  }

  return uniqueKeepOrder(queries.filter(Boolean));
}

function inferPreferredModalities(input: { periodCode: string; periodModality: string; nrc: string }): ModalityKey[] {
  const list: ModalityKey[] = [];
  const active = getActiveModalities();

  const byPeriod = MODALITY_BY_PERIOD[input.periodCode];
  if (byPeriod?.length) return uniqueKeepOrder(byPeriod.filter((modality) => active.includes(modality)));

  const periodModality = (input.periodModality ?? '').toUpperCase();
  if (periodModality === 'PP') list.push('presencial');
  if (periodModality === 'PD') list.push('distancia');
  if (periodModality.startsWith('POS')) list.push('posgrados');
  if (list.length) return uniqueKeepOrder(list.filter((modality) => active.includes(modality)));

  const { prefix } = getNrcParts(input.nrc);
  const byPrefix = prefix ? MODALITY_BY_NRC_PREFIX[prefix] : null;
  if (byPrefix) list.push(byPrefix);
  if (list.length) return uniqueKeepOrder(list.filter((modality) => active.includes(modality)));

  return active;
}

function buildSearchUrl(baseUrl: string, query: string): string {
  return `${baseUrl.replace(/\/$/, '')}/course/search.php?areaids=core_course-course&q=${encodeURIComponent(query)}`;
}

function buildFallbackLookup(input: {
  nrc: string;
  periodCode: string;
  periodModality: string;
}): {
  url: string | null;
  modality: string | null;
  baseUrl: string | null;
  query: string | null;
} {
  const modalities = inferPreferredModalities(input);
  const queries = buildNrcQueries({ nrc: input.nrc, periodCode: input.periodCode });

  for (const modality of modalities) {
    const baseUrl = workerConfig.baseUrlByModality[modality];
    if (!baseUrl) continue;
    for (const query of queries) {
      if (!query) continue;
      return {
        url: buildSearchUrl(baseUrl, query),
        modality: MODALITY_DISPLAY[modality],
        baseUrl,
        query,
      };
    }
  }

  return {
    url: null,
    modality: null,
    baseUrl: null,
    query: null,
  };
}

function classifyFromHtml(html: string): string {
  const text = html.toLowerCase();
  const cribaSignals = ['bienvenida', 'introduccion', 'objetivos', 'temario', 'calendario'];
  const cribaCount = cribaSignals.reduce((acc, signal) => acc + (text.includes(signal) ? 1 : 0), 0);

  if (text.includes('distancia 4.0') || text.includes(' d4 ') || text.includes('tema d4')) return 'D4';
  if (text.includes('innovame') || text.includes('actualizacion de actividades')) return 'INNOVAME';
  if (cribaCount >= 3) return 'CRIBA';

  const activities = (text.match(/modtype_/g) ?? []).length + (text.match(/activity/g) ?? []).length;
  if (activities <= 4) return 'VACIO';

  return 'UNKNOWN';
}

function isUsefulTemplate(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toUpperCase();
  return ['VACIO', 'CRIBA', 'INNOVAME', 'D4'].includes(normalized);
}

function classifyHeuristic(input: {
  templateDeclared: string | null;
  subjectName: string | null;
  moodleStatus: string | null;
}): Pick<ClassificationResult, 'status' | 'detectedTemplate' | 'errorCode' | 'notes'> {
  const declared = normalizeTemplate(input.templateDeclared ?? 'UNKNOWN');
  const subject = (input.subjectName ?? '').toLowerCase();

  if (input.moodleStatus === 'DESCARTADO_NO_EXISTE') {
    return {
      status: 'DESCARTADO_NO_EXISTE',
      detectedTemplate: null,
      errorCode: 'NO_EXISTE',
      notes: 'Estado previo no existe, mantenido por heuristica.',
    };
  }

  if (declared !== 'UNKNOWN') {
    return {
      status: 'OK',
      detectedTemplate: declared,
      errorCode: null,
      notes: 'Clasificacion heuristica basada en template declarado.',
    };
  }

  if (subject.includes('innov') || subject.includes('distancia')) {
    return {
      status: 'OK',
      detectedTemplate: subject.includes('distancia') ? 'D4' : 'INNOVAME',
      errorCode: null,
      notes: 'Clasificacion heuristica por nombre de asignatura.',
    };
  }

  return {
    status: 'REVISAR_MANUAL',
    detectedTemplate: 'UNKNOWN',
    errorCode: 'OTRO',
    notes: 'No fue posible inferir template sin acceso Moodle.',
  };
}

function classifyWithoutRealMoodleAccess(input: {
  templateDeclared: string | null;
  subjectName: string | null;
  moodleStatus: string | null;
}): Pick<ClassificationResult, 'status' | 'detectedTemplate' | 'errorCode' | 'notes'> {
  const heuristic = classifyHeuristic(input);

  if (heuristic.status === 'DESCARTADO_NO_EXISTE') {
    return heuristic;
  }

  return {
    status: 'REVISAR_MANUAL',
    detectedTemplate: heuristic.detectedTemplate,
    errorCode: 'OTRO',
    notes: `Automatizacion Moodle sin acceso real. ${heuristic.notes} El curso no se marca OK hasta revisar Moodle con sesion valida.`,
  };
}

function urlIndicaLogin(url: string): boolean {
  const value = String(url ?? '').toLowerCase();
  if (!value) return true;
  return LOGIN_URL_HINTS.some((hint) => value.includes(hint));
}

function sessionActiveInBase(currentUrl: string, baseUrl: string): boolean {
  const current = String(currentUrl ?? '').toLowerCase();
  const base = String(baseUrl ?? '').replace(/\/$/, '').toLowerCase();
  if (!current || !base) return false;
  return current.includes(base) && !urlIndicaLogin(current);
}

function containsNoEnrolledMessage(html: string): boolean {
  const normalized = String(html ?? '').toLowerCase();
  return NO_ENROLLED_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function extractCourseIdFromHref(href: string): string | null {
  try {
    const parsed = new URL(href);
    const id = parsed.searchParams.get('id');
    return id?.trim() || null;
  } catch {
    return null;
  }
}

function scoreCourseCandidate(params: { text: string; query: string; nrcNum: string }): number {
  const text = params.text.toLowerCase();
  const query = params.query.toLowerCase();
  if (!text) return 0;
  if (text.includes(query)) return 100;

  const compactQuery = query.replace('-', '');
  if (compactQuery && text.includes(compactQuery)) return 90;
  if (params.nrcNum && text.includes(params.nrcNum)) return 80;
  return 10;
}

async function ensureEvidenceDir() {
  await fs.mkdir(workerConfig.evidenceDir, { recursive: true });
}

async function persistEvidence(job: Job<MoodleClassifyJob>, html: string, screenshot: Buffer | null) {
  await ensureEvidenceDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${job.data.nrc.replace(/[^0-9-]/g, '')}_${job.data.courseId}_${stamp}`;

  const htmlPath = path.join(workerConfig.evidenceDir, `${baseName}.html`);
  await fs.writeFile(htmlPath, html, 'utf8');

  let screenshotPath: string | null = null;
  if (screenshot) {
    screenshotPath = path.join(workerConfig.evidenceDir, `${baseName}.png`);
    await fs.writeFile(screenshotPath, screenshot);
  }

  return {
    htmlPath,
    screenshotPath,
  };
}

async function loginIfNeeded(page: import('playwright').Page, baseUrl: string) {
  if (!hasRealMoodleCredentials()) return false;

  const base = baseUrl.replace(/\/$/, '');
  await page.goto(`${base}/login/index.php`, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  const userField = page.locator('input[name="username"], input#username').first();
  const passField = page.locator('input[name="password"], input#password').first();
  const submitButton = page.locator('button[type="submit"], input[type="submit"]').first();

  const hasUserField = (await userField.count()) > 0;
  const hasPassField = (await passField.count()) > 0;
  const hasSubmit = (await submitButton.count()) > 0;

  if (hasUserField && hasPassField && hasSubmit) {
    await userField.fill(workerConfig.moodleUsername);
    await passField.fill(workerConfig.moodlePassword);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => undefined),
      submitButton.click(),
    ]);
  }

  return sessionActiveInBase(page.url(), baseUrl);
}

async function extractCourseCandidates(page: import('playwright').Page) {
  return page.$$eval('a[href*="/course/view.php?id="]', (nodes) =>
    nodes
      .map((node) => ({
        href: (node as HTMLAnchorElement).href || '',
        text: (node.textContent || '').trim(),
      }))
      .filter((item) => !!item.href),
  );
}

async function classifyUsingMoodle(input: {
  nrc: string;
  periodCode: string;
  periodModality: string;
}): Promise<MoodleLookupResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let lastHtml = '';
  let lastScreenshot: Buffer | null = null;
  const attemptedModalities: ModalityKey[] = [];

  try {
    const modalities = inferPreferredModalities({
      periodCode: input.periodCode,
      periodModality: input.periodModality,
      nrc: input.nrc,
    });
    const queries = buildNrcQueries({
      nrc: input.nrc,
      periodCode: input.periodCode,
    });
    const { num: nrcNum } = getNrcParts(input.nrc);

    for (const modality of modalities) {
      const baseUrl = workerConfig.baseUrlByModality[modality];
      if (!baseUrl) continue;
      attemptedModalities.push(modality);

      let authenticated = sessionActiveInBase(page.url(), baseUrl);
      if (!authenticated) {
        authenticated = await loginIfNeeded(page, baseUrl);
      }

      if (!authenticated && urlIndicaLogin(page.url())) {
        continue;
      }

      for (const query of queries) {
        const searchUrl = `${baseUrl.replace(/\/$/, '')}/course/search.php?areaids=core_course-course&q=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

        if (urlIndicaLogin(page.url())) {
          const relogin = await loginIfNeeded(page, baseUrl);
          if (!relogin) continue;
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        }

        const htmlSearch = await page.content();
        lastHtml = htmlSearch;
        const candidates = await extractCourseCandidates(page);

        if (!candidates.length && NO_RESULTS_PATTERN.test(htmlSearch)) {
          continue;
        }
        if (!candidates.length) {
          continue;
        }

        const scored = candidates
          .map((item) => ({
            ...item,
            score: scoreCourseCandidate({ text: item.text, query, nrcNum }),
          }))
          .sort((a, b) => b.score - a.score);
        const selected = scored[0];
        if (!selected?.href) continue;

        await page.goto(selected.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        const htmlCourse = await page.content();
        const screenshotCourse = await page.screenshot({ fullPage: true });
        const noAccess = containsNoEnrolledMessage(htmlCourse);

        return {
          html: htmlCourse,
          screenshot: screenshotCourse,
          notFound: false,
          noAccess,
          resolvedModality: MODALITY_DISPLAY[modality],
          resolvedBaseUrl: baseUrl,
          searchQuery: query,
          courseUrl: selected.href,
          courseId: extractCourseIdFromHref(selected.href),
          attemptedModalities,
        };
      }
    }

    if (!lastScreenshot) {
      try {
        lastScreenshot = await page.screenshot({ fullPage: true });
      } catch {
        lastScreenshot = null;
      }
    }

    return {
      html: lastHtml || '<html><body>No se encontro el curso en modalidades configuradas.</body></html>',
      screenshot: lastScreenshot,
      notFound: true,
      noAccess: false,
      resolvedModality: null,
      resolvedBaseUrl: null,
      searchQuery: null,
      courseUrl: null,
      courseId: null,
      attemptedModalities,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

function mapError(error: unknown): { errorCode: ClassificationResult['errorCode']; notes: string } {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('timeout')) {
    return { errorCode: 'TIMEOUT', notes: message };
  }
  if (normalized.includes('access') || normalized.includes('permission') || normalized.includes('401')) {
    return { errorCode: 'SIN_ACCESO', notes: message };
  }
  return { errorCode: 'OTRO', notes: message };
}

async function processJob(job: Job<MoodleClassifyJob>): Promise<ClassificationResult> {
  const course = await prisma.course.findUnique({
    where: { id: job.data.courseId },
    include: { moodleCheck: true, period: true },
  });

  if (!course) {
    return {
      status: 'REVISAR_MANUAL',
      detectedTemplate: 'UNKNOWN',
      errorCode: 'OTRO',
      notes: 'Curso inexistente en base de datos al procesar job.',
      evidenceHtmlPath: null,
      evidenceScreenshotPath: null,
      moodleCourseUrl: null,
      moodleCourseId: null,
      resolvedModality: null,
      resolvedBaseUrl: null,
      searchQuery: null,
    };
  }

  await prisma.moodleCheck.upsert({
    where: { courseId: course.id },
    create: {
      courseId: course.id,
      status: 'EN_PROCESO',
      attempts: 1,
      lastAttemptAt: new Date(),
    },
    update: {
      status: 'EN_PROCESO',
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });

  try {
    if (!hasAnyMoodleTarget() || !hasRealMoodleCredentials()) {
      const heuristic = classifyWithoutRealMoodleAccess({
        templateDeclared: course.templateDeclared,
        subjectName: course.subjectName,
        moodleStatus: course.moodleCheck?.status ?? null,
      });
      const fallback = buildFallbackLookup({
        nrc: course.nrc,
        periodCode: normalizePeriodCode(course.period.code),
        periodModality: course.period.modality,
      });

      return {
        ...heuristic,
        evidenceHtmlPath: null,
        evidenceScreenshotPath: null,
        moodleCourseUrl: fallback.url,
        moodleCourseId: null,
        resolvedModality: fallback.modality,
        resolvedBaseUrl: fallback.baseUrl,
        searchQuery: fallback.query,
        notes: fallback.url
          ? `${heuristic.notes} URL de busqueda Moodle guardada para acceso rapido.`
          : heuristic.notes,
      };
    }

    const moodleData = await classifyUsingMoodle({
      nrc: course.nrc,
      periodCode: normalizePeriodCode(course.period.code),
      periodModality: course.period.modality,
    });
    const evidence = await persistEvidence(job, moodleData.html, moodleData.screenshot);

    if (moodleData.notFound) {
      const attempted = moodleData.attemptedModalities.map((key) => MODALITY_DISPLAY[key]).join(', ') || 'N/A';
      return {
        status: 'DESCARTADO_NO_EXISTE',
        detectedTemplate: null,
        errorCode: 'NO_EXISTE',
        notes: `No se encontro el curso en Moodle. Modalidades intentadas: ${attempted}`,
        evidenceHtmlPath: evidence.htmlPath,
        evidenceScreenshotPath: evidence.screenshotPath,
        moodleCourseUrl: null,
        moodleCourseId: null,
        resolvedModality: null,
        resolvedBaseUrl: null,
        searchQuery: null,
      };
    }

    if (moodleData.noAccess) {
      return {
        status: 'REVISAR_MANUAL',
        detectedTemplate: null,
        errorCode: 'SIN_ACCESO',
        notes: 'Curso encontrado pero sin matricula/permisos para revisar contenido.',
        evidenceHtmlPath: evidence.htmlPath,
        evidenceScreenshotPath: evidence.screenshotPath,
        moodleCourseUrl: moodleData.courseUrl,
        moodleCourseId: moodleData.courseId,
        resolvedModality: moodleData.resolvedModality,
        resolvedBaseUrl: moodleData.resolvedBaseUrl,
        searchQuery: moodleData.searchQuery,
      };
    }

    const detectedTemplate = classifyFromHtml(moodleData.html);
    const preservedTemplate =
      detectedTemplate === 'UNKNOWN' && isUsefulTemplate(course.moodleCheck?.detectedTemplate)
        ? String(course.moodleCheck?.detectedTemplate)
        : detectedTemplate;

    return {
      status: preservedTemplate === 'UNKNOWN' ? 'REVISAR_MANUAL' : 'OK',
      detectedTemplate: preservedTemplate,
      errorCode: preservedTemplate === 'UNKNOWN' ? 'OTRO' : null,
      notes:
        preservedTemplate === 'UNKNOWN'
          ? 'Sin senales suficientes para clasificar automaticamente.'
          : detectedTemplate === 'UNKNOWN'
            ? 'Clasificacion Moodle UI sin nueva señal; se preserva tipo previo.'
            : 'Clasificacion Moodle UI completada.',
      evidenceHtmlPath: evidence.htmlPath,
      evidenceScreenshotPath: evidence.screenshotPath,
      moodleCourseUrl: moodleData.courseUrl,
      moodleCourseId: moodleData.courseId,
      resolvedModality: moodleData.resolvedModality,
      resolvedBaseUrl: moodleData.resolvedBaseUrl,
      searchQuery: moodleData.searchQuery,
    };
  } catch (error) {
    const mapped = mapError(error);

    return {
      status: 'ERROR_REINTENTABLE',
      detectedTemplate: null,
      errorCode: mapped.errorCode,
      notes: mapped.notes,
      evidenceHtmlPath: null,
      evidenceScreenshotPath: null,
      moodleCourseUrl: null,
      moodleCourseId: null,
      resolvedModality: null,
      resolvedBaseUrl: null,
      searchQuery: null,
    };
  }
}

async function bootstrap() {
  await ensureEvidenceDir();

  const worker = new Worker<MoodleClassifyJob>(
    QUEUE_NAME,
    async (job) => {
      const result = await processJob(job);

      await prisma.moodleCheck.updateMany({
        where: { courseId: job.data.courseId },
        data: {
          status: result.status,
          detectedTemplate: result.detectedTemplate,
          errorCode: result.errorCode,
          notes: result.notes,
          evidenceHtmlPath: result.evidenceHtmlPath,
          evidenceScreenshotPath: result.evidenceScreenshotPath,
          moodleCourseUrl: result.moodleCourseUrl,
          moodleCourseId: result.moodleCourseId,
          resolvedModality: result.resolvedModality,
          resolvedBaseUrl: result.resolvedBaseUrl,
          searchQuery: result.searchQuery,
          resolvedAt:
            result.status === 'DESCARTADO_NO_EXISTE' || !!result.moodleCourseUrl || !!result.moodleCourseId
              ? new Date()
              : null,
          lastAttemptAt: new Date(),
        },
      });

      if (result.status === 'ERROR_REINTENTABLE') {
        throw new Error(result.notes);
      }

      return result;
    },
    {
      connection: getRedisConnection(workerConfig.redisUrl),
      concurrency: Number.isNaN(workerConfig.concurrency) ? 3 : workerConfig.concurrency,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[worker] completed job=${job.id} course=${job.data.courseId}`);
  });

  worker.on('failed', async (job, error) => {
    if (!job) return;
    console.error(`[worker] failed job=${job.id} attempts=${job.attemptsMade}: ${error?.message}`);

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      await prisma.moodleCheck.updateMany({
        where: { courseId: job.data.courseId },
        data: {
          status: 'REVISAR_MANUAL',
          notes: `Se agotaron reintentos. Ultimo error: ${error?.message ?? 'sin detalle'}`,
        },
      });
    }
  });

  const shutdown = async () => {
    console.log('[worker] cerrando...');
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const activeModalities = getActiveModalities()
    .map((key) => `${MODALITY_DISPLAY[key]}=${workerConfig.baseUrlByModality[key]}`)
    .join(' | ');

  console.log(
    `[worker] iniciado cola=${QUEUE_NAME} redis=${workerConfig.redisUrl} concurrency=${workerConfig.concurrency}`,
  );
  console.log(`[worker] modalidades activas: ${activeModalities || 'N/A'}`);
}

bootstrap().catch(async (error) => {
  console.error('[worker] fatal', error);
  await prisma.$disconnect();
  process.exit(1);
});
