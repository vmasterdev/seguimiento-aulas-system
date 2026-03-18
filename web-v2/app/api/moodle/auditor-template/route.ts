import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const TEMPLATE_PATH = '/mnt/c/Users/Duvan/Downloads/FORMATO CREACION DE USUARIOS OFICIAL.xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DEFAULT_IDENTITY = {
  firstName: 'Jaime Duvan',
  lastName: 'Lozano Ardila',
  institutionalEmail: 'jaime.lozano.a@uniminuto.edu',
  roleName: 'Auditor con todos los permisos',
};

type FollowupRow = {
  id?: string;
  nrc: string;
  subjectName?: string | null;
  moodleCourseUrl?: string | null;
  followupKind?: string;
};

type RequestBody = {
  rows?: unknown;
  identity?: Partial<typeof DEFAULT_IDENTITY>;
};

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRows(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('Debes enviar una lista de NRC para generar el formato oficial.');
  }

  return value
    .map((raw): FollowupRow | null => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const row = raw as Record<string, unknown>;
      const nrc = cleanText(row.nrc);
      if (!nrc) return null;
      const followupKind = cleanText(row.followupKind).toLowerCase();
      if (followupKind && followupKind !== 'sin_matricula') return null;
      return {
        id: cleanText(row.id) || undefined,
        nrc,
        subjectName: cleanText(row.subjectName) || null,
        moodleCourseUrl: cleanText(row.moodleCourseUrl) || null,
        followupKind: followupKind || 'sin_matricula',
      };
    })
    .filter((row): row is FollowupRow => Boolean(row));
}

function resolveIdentity(value: Partial<typeof DEFAULT_IDENTITY> | undefined) {
  return {
    firstName: cleanText(value?.firstName) || DEFAULT_IDENTITY.firstName,
    lastName: cleanText(value?.lastName) || DEFAULT_IDENTITY.lastName,
    institutionalEmail: cleanText(value?.institutionalEmail) || DEFAULT_IDENTITY.institutionalEmail,
    roleName: cleanText(value?.roleName) || DEFAULT_IDENTITY.roleName,
  };
}

function buildCourseLabel(row: FollowupRow) {
  const title = cleanText(row.subjectName) || cleanText(row.moodleCourseUrl) || 'Curso sin nombre corto';
  return `${row.nrc} - ${title}`;
}

function buildDownloadName() {
  return `FORMATO_AUDITOR_MOODLE_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
}

function extractErrorMessage(stdout: string, stderr: string) {
  return cleanText(stderr) || cleanText(stdout) || 'No se pudo generar el formato oficial.';
}

export async function POST(request: NextRequest) {
  try {
    if (!fs.existsSync(TEMPLATE_PATH)) {
      return NextResponse.json(
        {
          ok: false,
          error: `No existe la plantilla oficial en ${TEMPLATE_PATH}.`,
        },
        { status: 500 },
      );
    }

    const body = (await request.json()) as RequestBody;
    const rows = normalizeRows(body.rows);
    if (!rows.length) {
      return NextResponse.json(
        {
          ok: false,
          error: 'No hay NRC sin matricula para llenar el formato oficial.',
        },
        { status: 400 },
      );
    }

    const identity = resolveIdentity(body.identity);
    const webRoot = process.cwd();
    const repoRoot = path.resolve(webRoot, '..');
    const scriptPath = path.join(webRoot, 'scripts', 'fill_auditor_template.py');
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        {
          ok: false,
          error: `No existe el generador Python en ${scriptPath}.`,
        },
        { status: 500 },
      );
    }
    const outputDir = path.join(repoRoot, 'storage', 'outputs', 'validation', 'moodle-auditor-requests');
    const downloadName = buildDownloadName();
    const outputPath = path.join(outputDir, downloadName);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moodle-auditor-template-'));
    const payloadPath = path.join(tempDir, 'payload.json');

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          templatePath: TEMPLATE_PATH,
          outputPath,
          identity,
          rows: rows.map((row) => ({
            ...row,
            courseLabel: buildCourseLabel(row),
          })),
        },
        null,
        2,
      ),
      'utf8',
    );

    const pythonRun = spawnSync('python3', [scriptPath, payloadPath], {
      cwd: webRoot,
      encoding: 'utf8',
    });

    fs.rmSync(tempDir, { recursive: true, force: true });

    if (pythonRun.status !== 0) {
      const message = extractErrorMessage(pythonRun.stdout, pythonRun.stderr);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }

    const fileBuffer = fs.readFileSync(outputPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'X-Auditor-Row-Count': String(rows.length),
        'X-Auditor-Output-Name': downloadName,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo generar el formato oficial.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
