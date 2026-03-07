export const dynamic = 'force-dynamic';
import { ReviewLauncherPanel } from './review-launcher-panel';
import { SidecarIntegrationPanel } from './sidecar-integration-panel';
import { OutboxEmailPanel } from './outbox-email-panel';
import { MainMenu } from './main-menu';

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
const CLIENT_API_BASE = '/api/backend';
const MOODLE_URL_TEMPLATE = process.env.NEXT_PUBLIC_MOODLE_URL_TEMPLATE ?? '';

async function fetchJson<T>(resource: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_BASE}${resource}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default async function Page() {
  const [health, stats, queueStats, courses, outbox] = await Promise.all([
    fetchJson<{ ok: boolean; ts: string }>('/health'),
    fetchJson<StatsOverview>('/stats/overview'),
    fetchJson<{ queue: Record<string, number>; moodleChecks: Record<string, number> }>('/queue/stats'),
    fetchJson<{ total: number; items: CourseItem[] }>('/courses?limit=12'),
    fetchJson<{
      total: number;
      items: Array<{
        status: string;
        subject: string;
        recipientName: string | null;
        teacher: { fullName: string } | null;
        coordinator: { fullName: string } | null;
      }>;
    }>(
      '/outbox?status=DRAFT',
    ),
  ]);

  return (
    <main>
      <MainMenu active="inicio" />

      <header className="hero">
        <div>
          <h1>Seguimiento de Aulas Moodle</h1>
          <p>
            Panel operativo para clasificacion, muestreo, evaluacion y correos de seguimiento.
          </p>
        </div>
        <div className="card">
          <div className="kpi-label">Estado API</div>
          <div className="kpi-value">{health?.ok ? 'Activa' : 'Sin conexion'}</div>
        </div>
      </header>

      <section className="grid">
        <article className="card">
          <div className="kpi-label">Periodos</div>
          <div className="kpi-value">{stats?.periods ?? 0}</div>
        </article>
        <article className="card">
          <div className="kpi-label">Docentes</div>
          <div className="kpi-value">{stats?.teachers ?? 0}</div>
        </article>
        <article className="card">
          <div className="kpi-label">Coordinadores</div>
          <div className="kpi-value">{stats?.coordinators ?? 0}</div>
        </article>
        <article className="card">
          <div className="kpi-label">Cursos</div>
          <div className="kpi-value">{stats?.courses ?? 0}</div>
        </article>
        <article className="card">
          <div className="kpi-label">Pendientes clasificar</div>
          <div className="kpi-value">{stats?.pendingClassify ?? 0}</div>
        </article>
        <article className="card">
          <div className="kpi-label">Muestreos creados</div>
          <div className="kpi-value">{stats?.sampleGroups ?? 0}</div>
        </article>
        <article className="card">
          <div className="kpi-label">Mensajes outbox</div>
          <div className="kpi-value">{outbox?.total ?? 0}</div>
        </article>
      </section>

      <section className="section">
        <article className="panel">
          <h2>Ultimas aulas</h2>
          <table>
            <thead>
              <tr>
                <th>NRC</th>
                <th>Docente</th>
                <th>Programa</th>
                <th>Momento</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {(courses?.items ?? []).map((course) => (
                <tr key={course.id}>
                  <td>{course.nrc}</td>
                  <td>{course.teacher?.fullName ?? 'Sin docente'}</td>
                  <td>{course.programName ?? '-'}</td>
                  <td>{course.moment ?? '-'}</td>
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
          <h2>Estado de cola y clasificacion</h2>
          <div className="badges">
            {Object.entries(queueStats?.queue ?? {}).map(([key, value]) => (
              <span className="badge" key={key}>
                {key}: {value}
              </span>
            ))}
          </div>
          <div className="badges" style={{ marginTop: 10 }}>
            {Object.entries(stats?.moodleByStatus ?? {}).map(([key, value]) => (
              <span className="badge" key={key}>
                {key}: {value}
              </span>
            ))}
          </div>
          <div className="actions">
            Endpoint encolar: <span className="code">POST {API_BASE}/queue/enqueue-classify</span>
            <br />
            Endpoint reintentos: <span className="code">POST {API_BASE}/queue/retry</span>
            <br />
            Endpoint muestreo: <span className="code">POST {API_BASE}/sampling/generate</span>
          </div>
        </article>
      </section>

      <section className="section">
        <SidecarIntegrationPanel apiBase={CLIENT_API_BASE} />

        <article className="panel">
          <h2>Integracion Sidecar (flujo)</h2>
          <div className="actions">
            1. Inicia <span className="code">classify</span> o <span className="code">revalidate</span> desde este panel.
            <br />
            2. Revisa el log en vivo y valida salida en <span className="code">storage/outputs/validation</span>.
            <br />
            3. Ejecuta <span className="code">Importar</span> para pasar URL final y tipo de aula a la base del sistema.
          </div>
        </article>
      </section>

      <section className="section">
        <ReviewLauncherPanel />

        <article className="panel">
          <h2>Ruta operativa recomendada</h2>
          <div className="actions">
            1. Importa CSV en <span className="code">POST /import/csv</span>.
            <br />
            2. Genera muestreo con <span className="code">POST /sampling/generate</span>.
            <br />
            3. En esta pantalla revisa NRC seleccionados y usa <span className="code">Guardar y replicar al grupo</span>.
            <br />
            4. Genera outbox y exporta EML con <span className="code">POST /outbox/generate</span> y{' '}
            <span className="code">POST /outbox/export-eml</span>.
          </div>
        </article>
      </section>

      <section className="section">
        <article className="panel">
          <h2>Outbox en borrador</h2>
          <table>
            <thead>
              <tr>
                <th>Destinatario</th>
                <th>Asunto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {(outbox?.items ?? []).slice(0, 12).map((message, idx) => (
                <tr key={`${message.subject}-${idx}`}>
                  <td>
                    {message.teacher?.fullName ??
                      message.coordinator?.fullName ??
                      message.recipientName ??
                      'N/A'}
                  </td>
                  <td>{message.subject}</td>
                  <td>{message.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <OutboxEmailPanel apiBase={CLIENT_API_BASE} />
      </section>
    </main>
  );
}
