import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { DirectorioData, Persona } from '../../../_features/directorio/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATA_PATH = join(process.cwd(), '..', 'storage', 'runtime', 'directorio', 'staff.json');
const DATA_DIR = join(process.cwd(), '..', 'storage', 'runtime', 'directorio');

const DEFAULT_DATA: DirectorioData = {
  personas: [],
  actualizado: new Date().toISOString().split('T')[0],
};

function readData(): DirectorioData {
  if (!existsSync(DATA_PATH)) return DEFAULT_DATA;
  try {
    return JSON.parse(readFileSync(DATA_PATH, 'utf-8')) as DirectorioData;
  } catch {
    return DEFAULT_DATA;
  }
}

function writeData(data: DirectorioData): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export async function GET() {
  try {
    const data = readData();
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error leyendo directorio' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<Persona>;
    if (!body.nombres?.trim() || !body.apellidos?.trim() || !body.cargo?.trim() || !body.area?.trim()) {
      return NextResponse.json({ ok: false, error: 'Faltan campos requeridos: nombres, apellidos, cargo, area' }, { status: 400 });
    }
    const data = readData();
    const existing = data.personas.findIndex((p) => p.id === body.id);
    const persona: Persona = {
      id: body.id || `p${Date.now()}`,
      nombres: body.nombres.trim(),
      apellidos: body.apellidos.trim(),
      cargo: body.cargo.trim(),
      area: body.area.trim(),
      email: body.email?.trim() ?? '',
      contactoTeams: body.contactoTeams?.trim(),
      telefono: body.telefono?.trim(),
      horario: body.horario ?? {
        lunes: 'presencial',
        martes: 'presencial',
        miercoles: 'remoto',
        jueves: 'presencial',
        viernes: 'presencial',
        turno: 'completo',
      },
      tramites: body.tramites ?? [],
      esLiderazgo: body.esLiderazgo ?? false,
      enlaceAgenda: body.enlaceAgenda?.trim(),
      visible: body.visible ?? true,
      campusCode: body.campusCode?.trim(),
      notas: body.notas?.trim(),
      orden: body.orden,
    };
    if (existing >= 0) {
      data.personas[existing] = persona;
    } else {
      data.personas.push(persona);
    }
    data.actualizado = new Date().toISOString().split('T')[0];
    writeData(data);
    return NextResponse.json({ ok: true, persona });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error guardando persona' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ ok: false, error: 'Falta id' }, { status: 400 });
    const data = readData();
    const before = data.personas.length;
    data.personas = data.personas.filter((p) => p.id !== id);
    if (data.personas.length === before) {
      return NextResponse.json({ ok: false, error: 'Persona no encontrada' }, { status: 404 });
    }
    data.actualizado = new Date().toISOString().split('T')[0];
    writeData(data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error eliminando persona' },
      { status: 500 },
    );
  }
}
