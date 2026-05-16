export type DaySchedule = 'presencial' | 'remoto' | 'no-labora';
export type Turno = 'mañana' | 'tarde' | 'completo';

export type HorarioSemanal = {
  lunes: DaySchedule;
  martes: DaySchedule;
  miercoles: DaySchedule;
  jueves: DaySchedule;
  viernes: DaySchedule;
  turno: Turno;
};

export type Persona = {
  id: string;
  nombres: string;
  apellidos: string;
  cargo: string;
  area: string;
  email: string;
  contactoTeams?: string;
  telefono?: string;
  horario: HorarioSemanal;
  tramites: string[];
  esLiderazgo: boolean;
  enlaceAgenda?: string;
  visible: boolean;
  campusCode?: string;
  notas?: string;
  orden?: number;
};

export type DirectorioData = {
  personas: Persona[];
  actualizado: string;
};

export type ServicioArea = {
  id: string;
  nombre: string;
  descripcion: string;
  area: string;
  keywords: string[];
  tipoContacto: 'directo' | 'agendado';
};

export const SERVICIOS: ServicioArea[] = [
  {
    id: 'matricula',
    nombre: 'Matrícula y Registro',
    descripcion: 'Inscripción, renovación de matrícula, pagos de semestre, carga académica.',
    area: 'Registro y Control Académico',
    keywords: ['matricula', 'matrícula', 'inscripcion', 'inscripción', 'registro', 'semestre', 'carga académica', 'carga academica'],
    tipoContacto: 'directo',
  },
  {
    id: 'certificados',
    nombre: 'Certificados y Constancias',
    descripcion: 'Certificado de estudio, constancia de notas, certificado de egresado, historias académicas.',
    area: 'Registro y Control Académico',
    keywords: ['certificado', 'constancia', 'notas', 'historia académica', 'historia academica', 'egresado', 'documento'],
    tipoContacto: 'directo',
  },
  {
    id: 'pagos',
    nombre: 'Pagos y Financiero',
    descripcion: 'Consulta de deudas, paz y salvos, refinanciaciones, becas económicas, facturas.',
    area: 'Financiera',
    keywords: ['pago', 'deuda', 'financiero', 'factura', 'paz y salvo', 'paz salvo', 'refinanciacion', 'refinanciación', 'beca economica', 'beca económica'],
    tipoContacto: 'directo',
  },
  {
    id: 'bienestar',
    nombre: 'Bienestar Universitario',
    descripcion: 'Apoyo psicológico, salud, deportes, actividades culturales, apoyo socioeconómico.',
    area: 'Bienestar Universitario',
    keywords: ['bienestar', 'psicología', 'psicologia', 'salud', 'deporte', 'cultural', 'apoyo', 'beca bienestar'],
    tipoContacto: 'directo',
  },
  {
    id: 'academico',
    nombre: 'Coordinación Académica',
    descripcion: 'Pensum, homologaciones, transferencias, pérdida de calidad de estudiante, asuntos académicos.',
    area: 'Coordinación Académica',
    keywords: ['coordinacion', 'coordinación', 'pensum', 'homologacion', 'homologación', 'transferencia', 'calidad estudiante', 'retiro', 'cancelación', 'cancelacion'],
    tipoContacto: 'agendado',
  },
  {
    id: 'grado',
    nombre: 'Proceso de Grado',
    descripcion: 'Requisitos de grado, trabajo de grado, titulación, acto de grado.',
    area: 'Coordinación Académica',
    keywords: ['grado', 'titulacion', 'titulación', 'graduacion', 'graduación', 'trabajo de grado', 'proyecto de grado'],
    tipoContacto: 'agendado',
  },
  {
    id: 'plataforma',
    nombre: 'Plataforma Virtual y TICs',
    descripcion: 'Acceso a Moodle, correo institucional, problemas de plataforma, herramientas digitales.',
    area: 'TICs',
    keywords: ['moodle', 'plataforma', 'virtual', 'acceso', 'correo', 'email', 'tics', 'contraseña', 'contrasena'],
    tipoContacto: 'directo',
  },
  {
    id: 'biblioteca',
    nombre: 'Biblioteca y Recursos',
    descripcion: 'Préstamo de libros, bases de datos, recursos digitales, sala de estudio.',
    area: 'Biblioteca',
    keywords: ['biblioteca', 'libro', 'base de datos', 'recurso digital', 'préstamo', 'prestamo'],
    tipoContacto: 'directo',
  },
];

export const HORARIO_VACIO: HorarioSemanal = {
  lunes: 'presencial',
  martes: 'presencial',
  miercoles: 'remoto',
  jueves: 'presencial',
  viernes: 'presencial',
  turno: 'completo',
};

export function getTodaySchedule(horario: HorarioSemanal): DaySchedule {
  const day = new Date().getDay();
  const map: Record<number, DaySchedule> = {
    1: horario.lunes,
    2: horario.martes,
    3: horario.miercoles,
    4: horario.jueves,
    5: horario.viernes,
  };
  return map[day] ?? 'no-labora';
}

export function getTurnLabel(turno: Turno): string {
  return turno === 'mañana' ? 'Mañana' : turno === 'tarde' ? 'Tarde' : 'Jornada completa';
}
