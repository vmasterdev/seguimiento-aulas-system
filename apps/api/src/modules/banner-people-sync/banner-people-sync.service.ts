import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { TeachersService } from '../teachers/teachers.service';

const execFileAsync = promisify(execFile);

const SyncBannerPeopleSchema = z.object({
  scope: z.enum(['teachers', 'coordinators', 'students', 'all']).default('all'),
  limitPerScope: z.coerce.number().int().min(1).max(5000).optional(),
});

const RosterSyncSchema = z.object({
  periodCode: z.string().trim().min(3),
  moment: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

type RosterCliSummary = {
  ok: boolean;
  kind: string;
  sourceLabel: string | null;
  outputPath: string;
  outputJsonPath: string;
  processedCourses: number;
  foundCourses: number;
  emptyCourses: number;
  failedCourses: number;
  totalStudents: number;
};

type SyncScope = z.infer<typeof SyncBannerPeopleSchema>['scope'];

type RunnerBatchResultItem = {
  personId: string;
  normalizedPersonId: string;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  email: string | null;
  status: 'FOUND' | 'NOT_FOUND';
  rawPayload: Record<string, unknown>;
  errorMessage: string | null;
};

type RunnerBatchSummary = {
  ok: true;
  processed: number;
  found: number;
  notFound: number;
  failed: number;
  outputPath: string | null;
  items: RunnerBatchResultItem[];
};

type BannerIdConsolidationResult = {
  ok: boolean;
  reviewedCourses: number;
  candidateTeachers: number;
  updatedTeachers: number;
  alreadyConsistent: number;
  conflicts: number;
  skippedWithoutLinkedTeacher: number;
  skippedWithoutBannerId: number;
  conflictSamples: Array<{ teacherId: string; fullName: string; bannerIds: string[] }>;
};

type SyncCandidate =
  | {
      entityType: 'teacher';
      entityId: string;
      personId: string;
      currentFullName: string;
      currentEmail: string | null;
    }
  | {
      entityType: 'coordinator';
      entityId: string;
      personId: string;
      currentFullName: string;
      currentEmail: string | null;
      matchedBy: 'email' | 'fullName';
      matchedTeacherId: string;
      programId: string;
    }
  | {
      entityType: 'student';
      entityId: string;
      personId: string;
      currentFullName: string;
      currentEmail: string | null;
    };

function normalizePersonId(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (!/^\d+$/.test(trimmed)) return trimmed;
  // IDs >=8 digits: dejar sin padding (cedulas de 8-9 digitos)
  // IDs <8 digits: padear a 9 con ceros a la izquierda
  if (trimmed.length >= 8) return trimmed;
  return trimmed.padStart(9, '0');
}

function normalizeNameKey(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toUpperCase();
}

function composeDisplayName(parts: {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}): string {
  return [parts.firstName, parts.middleName, parts.lastName]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function composeStoredFirstName(parts: { firstName: string | null; middleName: string | null }): string | null {
  const joined = [parts.firstName, parts.middleName]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return joined || null;
}

function uniquePersonIds(candidates: SyncCandidate[]): string[] {
  return [...new Set(candidates.map((item) => normalizePersonId(item.personId)).filter(Boolean))];
}

function buildEntityCounter(candidates: SyncCandidate[]) {
  return {
    teachers: candidates.filter((item) => item.entityType === 'teacher').length,
    coordinators: candidates.filter((item) => item.entityType === 'coordinator').length,
    students: candidates.filter((item) => item.entityType === 'student').length,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function uniquePaths(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

@Injectable()
export class BannerPeopleSyncService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeachersService) private readonly teachersService: TeachersService,
  ) {}

  private resolveSystemRoot() {
    const candidates = [
      process.cwd(),
      path.resolve(process.cwd(), '..'),
      path.resolve(process.cwd(), '..', '..'),
    ];

    return (
      candidates.find(
        (candidate) => existsSync(path.join(candidate, 'apps')) && existsSync(path.join(candidate, 'web-v2')),
      ) ?? candidates[0]
    );
  }

  private readRunnerConfiguredRoot(systemRoot: string) {
    const configPath = path.join(systemRoot, 'storage', 'runtime', 'banner', 'runner-config.json');
    try {
      const raw = readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw) as { projectRoot?: string | null };
      return parsed.projectRoot?.trim() || null;
    } catch {
      return null;
    }
  }

  private resolveBannerRunnerRoot(systemRoot: string) {
    const configured = this.readRunnerConfiguredRoot(systemRoot);
    const repoParent = path.resolve(systemRoot, '..');
    const homeDir = process.env.HOME ?? '';
    const candidates = uniquePaths([
      configured,
      process.env.BANNER_PROJECT_ROOT,
      path.join(systemRoot, 'tools', 'banner-runner'),
      path.join(repoParent, 'banner-docente-runner'),
      path.join(repoParent, 'banner-batch-run-current'),
      homeDir ? path.join(homeDir, 'banner-docente-runner') : null,
      homeDir ? path.join(homeDir, 'banner-batch-run-current') : null,
    ]);

    const resolved = candidates.find((candidate) => existsSync(path.join(candidate, 'src', 'cli.ts')));
    if (!resolved) {
      throw new Error('No fue posible ubicar el runner Banner con SPAIDEN habilitado.');
    }

    return resolved;
  }

  private async runSpaidenBatch(personIds: string[]) {
    const systemRoot = this.resolveSystemRoot();
    const bannerRoot = this.resolveBannerRunnerRoot(systemRoot);
    const runtimeDir = path.join(systemRoot, 'storage', 'runtime', 'banner', 'spaiden-sync');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const inputPath = path.join(runtimeDir, `${stamp}_input.json`);
    const outputPath = path.join(runtimeDir, `${stamp}_output.json`);
    const storageRoot = path.join(bannerRoot, 'storage');

    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      inputPath,
      JSON.stringify(
        {
          items: personIds.map((personId) => ({ personId })),
        },
        null,
        2,
      ),
      'utf8',
    );

    const { stdout } = await execFileAsync(
      'node',
      ['--import', 'tsx', 'src/cli.ts', 'spaiden-batch', '--input', inputPath, '--output', outputPath],
      {
        cwd: bannerRoot,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          STORAGE_ROOT: storageRoot,
          LOGS_DIR: path.join(storageRoot, 'logs'),
          EVIDENCE_DIR: path.join(storageRoot, 'evidence'),
          EXPORTS_DIR: path.join(storageRoot, 'exports'),
          AUTH_DIR: path.join(storageRoot, 'auth'),
          BANNER_PROFILE_PATH: path.join(bannerRoot, 'config', 'banner.profile.json'),
          BANNER_STORAGE_STATE_PATH: path.join(storageRoot, 'auth', 'banner-storage-state.json'),
          BANNER_BROWSER_PROFILE_DIR: path.join(storageRoot, 'auth', 'edge-profile'),
        },
      },
    );

    const outputRaw = await readFile(outputPath, 'utf8').catch(() => stdout);
    const parsed = JSON.parse(outputRaw) as RunnerBatchSummary;
    if (!parsed?.ok || !Array.isArray(parsed.items)) {
      throw new Error('El runner SPAIDEN devolvio una respuesta invalida.');
    }

    return {
      ...parsed,
      outputPath,
      inputPath,
      runnerRoot: bannerRoot,
    };
  }

  private async collectTeacherCandidates(limitPerScope?: number): Promise<{
    candidates: SyncCandidate[];
    skippedWithoutId: Array<{ id: string; fullName: string }>;
  }> {
    const teachers = await this.prisma.teacher.findMany({
      select: {
        id: true,
        sourceId: true,
        documentId: true,
        fullName: true,
        email: true,
        extraJson: true,
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      ...(limitPerScope ? { take: limitPerScope } : {}),
    });

    const candidates: SyncCandidate[] = [];
    const skippedWithoutId: Array<{ id: string; fullName: string }> = [];

    for (const teacher of teachers) {
      const personId =
        normalizePersonId(String(asRecord(teacher.extraJson).bannerPersonId ?? '')) ||
        normalizePersonId(teacher.id) ||
        normalizePersonId(teacher.sourceId) ||
        normalizePersonId(teacher.documentId) ||
        '';

      if (!personId) {
        skippedWithoutId.push({ id: teacher.id, fullName: teacher.fullName });
        continue;
      }

      candidates.push({
        entityType: 'teacher',
        entityId: teacher.id,
        personId,
        currentFullName: teacher.fullName,
        currentEmail: teacher.email,
      });
    }

    return { candidates, skippedWithoutId };
  }

  private async collectCoordinatorCandidates(limitPerScope?: number): Promise<{
    candidates: SyncCandidate[];
    skippedWithoutMatch: Array<{ id: string; programId: string; fullName: string; email: string }>;
  }> {
    const [coordinators, teachers] = await Promise.all([
      this.prisma.coordinator.findMany({
        select: {
          id: true,
          programId: true,
          fullName: true,
          email: true,
        },
        orderBy: [{ programId: 'asc' }, { fullName: 'asc' }],
        ...(limitPerScope ? { take: limitPerScope } : {}),
      }),
      this.prisma.teacher.findMany({
        select: {
          id: true,
          sourceId: true,
          documentId: true,
          fullName: true,
          email: true,
          extraJson: true,
        },
      }),
    ]);

    const emailMap = new Map<string, Set<string>>();
    const nameMap = new Map<string, Set<string>>();
    const teacherIdByPersonId = new Map<string, string>();

    for (const teacher of teachers) {
      const personId =
        normalizePersonId(String(asRecord(teacher.extraJson).bannerPersonId ?? '')) ||
        normalizePersonId(teacher.id) ||
        normalizePersonId(teacher.sourceId) ||
        normalizePersonId(teacher.documentId) ||
        '';
      if (!personId) continue;
      teacherIdByPersonId.set(personId, teacher.id);

      const emailKey = String(teacher.email ?? '').trim().toLowerCase();
      if (emailKey) {
        const bucket = emailMap.get(emailKey) ?? new Set<string>();
        bucket.add(personId);
        emailMap.set(emailKey, bucket);
      }

      const nameKey = normalizeNameKey(teacher.fullName);
      if (nameKey) {
        const bucket = nameMap.get(nameKey) ?? new Set<string>();
        bucket.add(personId);
        nameMap.set(nameKey, bucket);
      }
    }

    const candidates: SyncCandidate[] = [];
    const skippedWithoutMatch: Array<{ id: string; programId: string; fullName: string; email: string }> = [];

    for (const coordinator of coordinators) {
      const emailKey = coordinator.email.trim().toLowerCase();
      const nameKey = normalizeNameKey(coordinator.fullName);
      const emailMatches = emailKey ? [...(emailMap.get(emailKey) ?? new Set<string>())] : [];
      const nameMatches = nameKey ? [...(nameMap.get(nameKey) ?? new Set<string>())] : [];

      const emailResolved = emailMatches.length === 1 ? emailMatches[0] : null;
      const nameResolved = nameMatches.length === 1 ? nameMatches[0] : null;

      const personId = emailResolved ?? nameResolved;
      const matchedBy: 'email' | 'fullName' | null = emailResolved ? 'email' : nameResolved ? 'fullName' : null;

      if (!personId || !matchedBy) {
        skippedWithoutMatch.push({
          id: coordinator.id,
          programId: coordinator.programId,
          fullName: coordinator.fullName,
          email: coordinator.email,
        });
        continue;
      }

      candidates.push({
        entityType: 'coordinator',
        entityId: coordinator.id,
        personId,
        currentFullName: coordinator.fullName,
        currentEmail: coordinator.email,
        matchedBy,
        matchedTeacherId: teacherIdByPersonId.get(personId) ?? personId,
        programId: coordinator.programId,
      });
    }

    return { candidates, skippedWithoutMatch };
  }

  private async collectStudentCandidates(limitPerScope?: number): Promise<{
    candidates: SyncCandidate[];
    skippedWithoutId: number;
  }> {
    const records = await this.prisma.bannerEnrollmentRecord.findMany({
      where: {
        institutionalId: {
          not: null,
        },
      },
      select: {
        institutionalId: true,
        fullName: true,
        email: true,
      },
      distinct: ['institutionalId'],
      orderBy: [{ institutionalId: 'asc' }],
      ...(limitPerScope ? { take: limitPerScope } : {}),
    });

    const candidates: SyncCandidate[] = [];

    for (const record of records) {
      const personId = normalizePersonId(record.institutionalId);
      if (!personId) continue;

      candidates.push({
        entityType: 'student',
        entityId: record.institutionalId ?? personId,
        personId,
        currentFullName: record.fullName,
        currentEmail: record.email,
      });
    }

    return {
      candidates,
      skippedWithoutId: 0,
    };
  }

  async sync(rawPayload: unknown) {
    const payload = parseWithSchema(SyncBannerPeopleSchema, rawPayload, 'spaiden sync payload');
    const startedAt = new Date().toISOString();
    const preSyncConsolidation: BannerIdConsolidationResult | null =
      payload.scope === 'students' ? null : await this.teachersService.consolidateBannerIdsFromResolvedCourses();
    const teacherCandidates = payload.scope === 'coordinators' || payload.scope === 'students'
      ? { candidates: [], skippedWithoutId: [] as Array<{ id: string; fullName: string }> }
      : await this.collectTeacherCandidates(payload.limitPerScope);
    const coordinatorCandidates = payload.scope === 'teachers' || payload.scope === 'students'
      ? { candidates: [], skippedWithoutMatch: [] as Array<{ id: string; programId: string; fullName: string; email: string }> }
      : await this.collectCoordinatorCandidates(payload.limitPerScope);
    const studentCandidates = payload.scope === 'teachers' || payload.scope === 'coordinators'
      ? { candidates: [], skippedWithoutId: 0 }
      : await this.collectStudentCandidates(payload.limitPerScope);

    const candidates =
      payload.scope === 'teachers'
        ? teacherCandidates.candidates
        : payload.scope === 'coordinators'
          ? coordinatorCandidates.candidates
          : payload.scope === 'students'
            ? studentCandidates.candidates
            : [...teacherCandidates.candidates, ...coordinatorCandidates.candidates, ...studentCandidates.candidates];

    const personIds = uniquePersonIds(candidates);
    const candidateCounts = buildEntityCounter(candidates);

    if (!personIds.length) {
      return {
        ok: true,
        scope: payload.scope,
        startedAt,
        finishedAt: new Date().toISOString(),
        candidates: {
          ...candidateCounts,
          personIds: 0,
        },
        skipped: {
          teachersWithoutId: teacherCandidates.skippedWithoutId.length,
          coordinatorsWithoutMatch: coordinatorCandidates.skippedWithoutMatch.length,
          studentsWithoutId: studentCandidates.skippedWithoutId,
        },
        preSyncConsolidation,
        batch: {
          processed: 0,
          found: 0,
          notFound: 0,
          failed: 0,
          outputPath: null,
        },
        updates: {
          teachersSynced: 0,
          coordinatorsSynced: 0,
          studentIdsSynced: 0,
          studentRowsSynced: 0,
        },
      };
    }

    const batch = await this.runSpaidenBatch(personIds);
    const resolvedMap = new Map(batch.items.map((item) => [normalizePersonId(item.normalizedPersonId || item.personId), item]));
    let teachersSynced = 0;
    let coordinatorsSynced = 0;
    let studentIdsSynced = 0;
    let studentRowsSynced = 0;
    const notFoundEntities: Array<{ entityType: SyncCandidate['entityType']; entityId: string; personId: string }> = [];

    for (const candidate of candidates) {
      const resolved = resolvedMap.get(normalizePersonId(candidate.personId));
      if (!resolved || resolved.status !== 'FOUND' || resolved.errorMessage) {
        notFoundEntities.push({
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          personId: candidate.personId,
        });
        continue;
      }

      const fullName = composeDisplayName(resolved);
      const email = resolved.email?.trim().toLowerCase() || null;

      if (candidate.entityType === 'teacher') {
        await this.prisma.teacher.update({
          where: { id: candidate.entityId },
          data: {
            fullName: fullName || candidate.currentFullName,
            email,
          },
        });
        teachersSynced += 1;
        continue;
      }

      if (candidate.entityType === 'coordinator') {
        await this.prisma.coordinator.update({
          where: { id: candidate.entityId },
          data: {
            fullName: fullName || candidate.currentFullName,
            email: email || candidate.currentEmail || '',
          },
        });
        coordinatorsSynced += 1;
        continue;
      }

      const updateResult = await this.prisma.bannerEnrollmentRecord.updateMany({
        where: {
          institutionalId: candidate.entityId,
        },
        data: {
          fullName: fullName || candidate.currentFullName,
          firstName: composeStoredFirstName(resolved),
          lastName: resolved.lastName?.trim() || null,
          email,
        },
      });
      studentIdsSynced += 1;
      studentRowsSynced += updateResult.count;
    }

    return {
      ok: true,
      scope: payload.scope,
      startedAt,
      finishedAt: new Date().toISOString(),
      candidates: {
        ...candidateCounts,
        personIds: personIds.length,
      },
      skipped: {
        teachersWithoutId: teacherCandidates.skippedWithoutId.length,
        coordinatorsWithoutMatch: coordinatorCandidates.skippedWithoutMatch.length,
        studentsWithoutId: studentCandidates.skippedWithoutId,
      },
      preSyncConsolidation,
      batch: {
        processed: batch.processed,
        found: batch.found,
        notFound: batch.notFound,
        failed: batch.failed,
        outputPath: batch.outputPath,
      },
      updates: {
        teachersSynced,
        coordinatorsSynced,
        studentIdsSynced,
        studentRowsSynced,
      },
      samples: {
        skippedTeachers: teacherCandidates.skippedWithoutId.slice(0, 10),
        skippedCoordinators: coordinatorCandidates.skippedWithoutMatch.slice(0, 10),
        notFoundEntities: notFoundEntities.slice(0, 20),
      },
    };
  }

  async rosterSync(rawPayload: unknown): Promise<{
    ok: boolean;
    periodCode: string;
    nrcsQueried: number;
    rosterCsvPath: string;
    processedCourses: number;
    foundCourses: number;
    emptyCourses: number;
    failedCourses: number;
    totalStudentRows: number;
  }> {
    const payload = parseWithSchema(RosterSyncSchema, rawPayload, 'roster sync payload');
    const systemRoot = this.resolveSystemRoot();
    const bannerRoot = this.resolveBannerRunnerRoot(systemRoot);

    const courses = await this.prisma.course.findMany({
      where: {
        period: { code: payload.periodCode },
        ...(payload.moment ? { moment: payload.moment } : {}),
      },
      select: { nrc: true, period: { select: { code: true } } },
      ...(payload.limit ? { take: payload.limit } : {}),
    });

    if (!courses.length) {
      throw new Error(`No hay NRCs en la base de datos para el periodo ${payload.periodCode}.`);
    }

    const runtimeDir = path.join(systemRoot, 'storage', 'runtime', 'banner', 'roster-sync');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const inputCsvPath = path.join(runtimeDir, `${stamp}_nrcs.csv`);

    await mkdir(runtimeDir, { recursive: true });

    const csvRows = ['nrc,period', ...courses.map((c) => `${c.nrc},${c.period.code}`)];
    await writeFile(inputCsvPath, csvRows.join('\n') + '\n', 'utf8');

    const storageRoot = path.join(bannerRoot, 'storage');
    const { stdout } = await execFileAsync(
      'node',
      [
        '--import', 'tsx',
        'src/cli.ts',
        'roster',
        '--input', inputCsvPath,
        '--period', payload.periodCode,
        '--source-label', `roster-sync-${payload.periodCode}${payload.moment ? `-${payload.moment}` : ''}`,
      ],
      {
        cwd: bannerRoot,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 3 * 60 * 60 * 1000,
        env: {
          ...process.env,
          STORAGE_ROOT: storageRoot,
          LOGS_DIR: path.join(storageRoot, 'logs'),
          EVIDENCE_DIR: path.join(storageRoot, 'evidence'),
          EXPORTS_DIR: path.join(storageRoot, 'exports'),
          AUTH_DIR: path.join(storageRoot, 'auth'),
          BANNER_PROFILE_PATH: path.join(bannerRoot, 'config', 'banner.profile.json'),
          BANNER_STORAGE_STATE_PATH: path.join(storageRoot, 'auth', 'banner-storage-state.json'),
          BANNER_BROWSER_PROFILE_DIR: path.join(storageRoot, 'auth', 'edge-profile'),
        },
      },
    );

    const summary = JSON.parse(stdout.trim()) as RosterCliSummary;

    return {
      ok: true,
      periodCode: payload.periodCode,
      nrcsQueried: courses.length,
      rosterCsvPath: summary.outputPath,
      processedCourses: summary.processedCourses,
      foundCourses: summary.foundCourses,
      emptyCourses: summary.emptyCourses,
      failedCourses: summary.failedCourses,
      totalStudentRows: summary.totalStudents,
    };
  }

  async uniqueStudentCount(periodCode: string): Promise<{
    periodCode: string;
    uniqueStudents: number;
    totalRows: number;
  }> {
    const reports = await this.prisma.bannerEnrollmentReport.findMany({
      where: { course: { period: { code: periodCode } } },
      select: { id: true },
    });
    const reportIds = reports.map((r) => r.id);
    if (!reportIds.length) {
      return { periodCode, uniqueStudents: 0, totalRows: 0 };
    }

    const [uniqueResult, totalResult] = await Promise.all([
      this.prisma.bannerEnrollmentRecord.findMany({
        where: { reportId: { in: reportIds }, institutionalId: { not: null } },
        select: { institutionalId: true },
        distinct: ['institutionalId'],
      }),
      this.prisma.bannerEnrollmentRecord.count({
        where: { reportId: { in: reportIds } },
      }),
    ]);

    return {
      periodCode,
      uniqueStudents: uniqueResult.length,
      totalRows: totalResult,
    };
  }
}
