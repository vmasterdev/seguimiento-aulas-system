export const dynamic = 'force-dynamic';

import { PageShell } from './_components/page-shell';
import { fetchJsonOrNull } from './_lib/http';

type StatsOverview = {
  periods: number;
  teachers: number;
  coordinators: number;
  courses: number;
  sampleGroups: number;
  evaluations: number;
  pendingClassify: number;
  moodleByStatus: Record<string, number>;
  outboxByStatus: Record<string, number>;
};

type CourseItem = {
  id: string;
  nrc: string;
  subjectName: string | null;
  programName: string | null;
  moment: string | null;
  teacher: { fullName: string } | null;
  moodleCheck: { status: string; detectedTemplate: string | null } | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

const MODULE_CARDS = [
  {
    href: '/rpaca',
    title: 'Carga RPACA',
    description: 'Importa nuevos periodos, actualiza cursos y revisa diferencias detectadas en la carga.',
    helper: 'Usa esta pestana cuando llegue un nuevo RPACA o necesites completar datos faltantes.',
  },
  {
    href: '/docentes',
    title: 'Docentes',
    description: 'Consulta la base de docentes y coordinadores, y corrige correos o asignaciones.',
    helper: 'Entra aqui si un docente o coordinador no aparece, tiene correo errado o quedo mal relacionado.',
  },
  {
    href: '/automatizacion-banner',
    title: 'Automatizacion Banner',
    description: 'Consulta NRC en Banner, ejecuta lotes y enlaza docentes encontrados a la base del sistema.',
    helper: 'Usa este modulo cuando necesites validar o completar el docente de un NRC desde Banner.',
  },
  {
    href: '/automatizacion-moodle',
    title: 'Automatizacion Moodle',
    description: 'Ejecuta la revision automatica de aulas, sigue el log y luego importa el resultado.',
    helper: 'Es el modulo para revisar muchos NRC a la vez desde Moodle.',
  },
  {
    href: '/review',
    title: 'Revision NRC',
    description: 'Abre la cola de revision manual para guardar checklist, puntajes y replicaciones.',
    helper: 'Usalo cuando un NRC debe revisarse manualmente o validar un caso puntual.',
  },
  {
    href: '/nrc-globales',
    title: 'NRC Globales',
    description: 'Busca NRC, filtra listados y prepara reportes o reenvios por similitud.',
    helper: 'Sirve para consultar cursos y trabajar casos especificos por NRC.',
  },
  {
    href: '/nrc-trazabilidad',
    title: 'Trazabilidad NRC',
    description: 'Muestra si una revision fue manual, replicada o usada para replicar otros NRC.',
    helper: 'Usalo cuando necesites explicar de donde salio un resultado.',
  },
  {
    href: '/correos',
    title: 'Correos',
    description: 'Genera campanas, revisa previews, confirma trazabilidad y envia reportes.',
    helper: 'Aqui se controla todo el flujo de correos a docentes, coordinadores y jefes.',
  },
];

export default async function Page() {
  const [health, stats, queueStats, courses, outbox] = await Promise.all([
    fetchJsonOrNull<{ ok: boolean; ts: string }>(`${API_BASE}/health`),
    fetchJsonOrNull<StatsOverview>(`${API_BASE}/stats/overview`),
    fetchJsonOrNull<{ queue: Record<string, number>; moodleChecks: Record<string, number> }>(`${API_BASE}/queue/stats`),
    fetchJsonOrNull<{ total: number; items: CourseItem[] }>(`${API_BASE}/courses?limit=10`),
    fetchJsonOrNull<{
      total: number;
      items: Array<{
        status: string;
        subject: string;
        recipientName: string | null;
        teacher: { fullName: string } | null;
        coordinator: { fullName: string } | null;
      }>;
    }>(`${API_BASE}/outbox?status=DRAFT`),
  ]);

  return (
    <PageShell
      active="inicio"
      title="Centro de Operaciones"
      description="Usa esta portada como punto de entrada. Desde aqui puedes ver el estado general del sistema y entrar al modulo correcto segun la tarea que vayas a realizar."
    >
      <section className="grid">
        <article className="card">
          <div className="kpi-label">Estado del sistema</div>
          <div className="kpi-value">{health?.ok ? 'Activo' : 'Sin conexion'}</div>
          <div className="actions">Confirma si la API principal esta respondiendo correctamente.</div>
        </article>
        <article className="card">
          <div className="kpi-label">Periodos cargados</div>
          <div className="kpi-value">{stats?.periods ?? 0}</div>
          <div className="actions">Cantidad de periodos disponibles para revision y reportes.</div>
        </article>
        <article className="card">
          <div className="kpi-label">Cursos registrados</div>
          <div className="kpi-value">{stats?.courses ?? 0}</div>
          <div className="actions">Total de cursos disponibles en la base del sistema.</div>
        </article>
        <article className="card">
          <div className="kpi-label">Docentes</div>
          <div className="kpi-value">{stats?.teachers ?? 0}</div>
          <div className="actions">Docentes cargados para relacion con cursos y reportes.</div>
        </article>
        <article className="card">
          <div className="kpi-label">Coordinadores</div>
          <div className="kpi-value">{stats?.coordinators ?? 0}</div>
          <div className="actions">Coordinadores disponibles para reportes por programa.</div>
        </article>
        <article className="card">
          <div className="kpi-label">Pendientes por clasificar</div>
          <div className="kpi-value">{stats?.pendingClassify ?? 0}</div>
          <div className="actions">Cursos que todavia no tienen clasificacion final desde Moodle.</div>
        </article>
      </section>

      <section className="section section-single">
        <article className="panel">
          <h2>Ruta sugerida de trabajo</h2>
          <ol className="steps-list">
            <li>Carga o actualiza el RPACA cuando llegue informacion nueva del periodo.</li>
            <li>Si faltan docentes, usa Banner para encontrarlos y relacionarlos con el curso.</li>
            <li>Revisa docentes y coordinadores para asegurarte de que cada correo salga al destinatario correcto.</li>
            <li>Ejecuta la automatizacion Moodle para clasificar aulas en lote y luego importa el resultado.</li>
            <li>Usa la revision manual o los modulos de NRC cuando necesites validar casos especiales.</li>
            <li>Genera y envia correos cuando ya tengas la informacion final consolidada.</li>
          </ol>
        </article>
      </section>

      <section className="section section-single">
        <article className="panel">
          <h2>Modulos principales</h2>
          <div className="actions">
            Cada modulo tiene su propia pestana. Entra directamente al que corresponda segun la tarea que vas a realizar.
          </div>
          <div className="module-grid" style={{ marginTop: 12 }}>
            {MODULE_CARDS.map((card) => (
              <article className="module-card" key={card.href}>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
                <div className="actions">{card.helper}</div>
                <a className="module-link" href={card.href}>
                  Abrir modulo
                </a>
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="section">
        <article className="panel">
          <h2>Ultimas aulas visibles en el sistema</h2>
          <div className="actions">
            Este bloque sirve para confirmar rapidamente si el curso, el docente, el programa y el estado Moodle quedaron cargados.
          </div>
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>NRC</th>
                <th>Docente</th>
                <th>Programa</th>
                <th>Momento</th>
                <th>Estado Moodle</th>
              </tr>
            </thead>
            <tbody>
              {(courses?.items ?? []).map((course) => (
                <tr key={course.id}>
                  <td>{course.nrc}</td>
                  <td>{course.teacher?.fullName ?? 'Sin docente asignado'}</td>
                  <td>{course.programName ?? 'Sin programa'}</td>
                  <td>{course.moment ?? 'Sin momento'}</td>
                  <td>
                    {course.moodleCheck?.status ?? 'SIN_CHECK'}
                    {course.moodleCheck?.detectedTemplate ? ` (${course.moodleCheck.detectedTemplate})` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="panel">
          <h2>Estado operativo</h2>
          <div className="actions">Resumen rapido de la cola de revision automatica y del estado general de clasificacion.</div>
          <div className="subtitle">Cola de automatizacion</div>
          <div className="badges">
            {Object.entries(queueStats?.queue ?? {}).map(([key, value]) => (
              <span className="badge" key={key}>
                {key}: {value}
              </span>
            ))}
          </div>
          <div className="subtitle">Estados Moodle</div>
          <div className="badges">
            {Object.entries(stats?.moodleByStatus ?? {}).map(([key, value]) => (
              <span className="badge" key={key}>
                {key}: {value}
              </span>
            ))}
          </div>
          <div className="subtitle">Estados de correos</div>
          <div className="badges">
            {Object.entries(stats?.outboxByStatus ?? {}).map(([key, value]) => (
              <span className="badge" key={key}>
                {key}: {value}
              </span>
            ))}
          </div>
        </article>
      </section>

      <section className="section">
        <article className="panel">
          <h2>Borradores de correo pendientes</h2>
          <div className="actions">
            Vista rapida para confirmar si ya existen borradores antes de ir a la pestana completa de correos.
          </div>
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Destinatario</th>
                <th>Asunto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {(outbox?.items ?? []).slice(0, 10).map((message, idx) => (
                <tr key={`${message.subject}-${idx}`}>
                  <td>
                    {message.teacher?.fullName ??
                      message.coordinator?.fullName ??
                      message.recipientName ??
                      'Sin nombre visible'}
                  </td>
                  <td>{message.subject}</td>
                  <td>{message.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="panel">
          <h2>Cuando usar cada modulo</h2>
          <div className="helper-list">
            <p>
              <strong>Carga RPACA:</strong> cuando llegan cursos o periodos nuevos.
            </p>
            <p>
              <strong>Automatizacion Banner:</strong> cuando necesitas encontrar o confirmar el docente principal de un NRC.
            </p>
            <p>
              <strong>Automatizacion Moodle:</strong> cuando necesitas revisar muchos NRC a la vez.
            </p>
            <p>
              <strong>Revision NRC:</strong> cuando una persona debe validar manualmente un aula.
            </p>
            <p>
              <strong>Correos:</strong> cuando el reporte ya esta listo para enviar.
            </p>
          </div>
        </article>
      </section>
    </PageShell>
  );
}
