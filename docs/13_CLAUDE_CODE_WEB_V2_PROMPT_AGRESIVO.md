# Prompt agresivo para Claude Code: rehacer `web-v2` sin perder funciones

Pega este prompt en Claude Code desde la raiz del repositorio:

```text
Analiza este monorepo y rehace de forma agresiva la interfaz de `web-v2`.

Quiero un rediseño real, no un ajuste cosmetico. Puedes replantear layout, navegacion, estructura visual, componentes, jerarquia de informacion y flujo de uso, siempre que `web-v2` conserve la paridad funcional con `apps/web`.

Contexto:
- `apps/web` es el frontend actual y es la referencia funcional.
- `web-v2` es el frontend paralelo donde debes trabajar.
- No quiero romper `apps/web`.
- `web-v2` ya tiene base funcional, pero quiero que deje de sentirse como una version intermedia y pase a verse como el frontend serio del sistema.

Objetivo:
- Convertir `web-v2` en la mejor interfaz del proyecto.
- Mantener todas las funciones operativas que hoy existen en `apps/web`.
- Mejorar con fuerza la UX, la legibilidad, la navegacion y la consistencia visual.
- Entregar una interfaz que pueda reemplazar al frontend actual cuando quede validada.

Instrucciones obligatorias antes de editar:
1. Inspecciona `apps/web/app` y `web-v2/app`.
2. Usa `apps/web` como fuente canonica de funcionalidades.
3. Haz una checklist de paridad funcional modulo por modulo.
4. Detecta cualquier hueco funcional en `web-v2` y cierralo antes o durante el rediseño.

Modulos que deben seguir existiendo y funcionar en `web-v2`:
- `/rpaca`
- `/docentes`
- `/review`
- `/nrc-globales`
- `/nrc-trazabilidad`
- `/correos`
- `/automatizacion-banner`
- `/automatizacion-moodle`

Tambien debes respetar:
- las rutas API existentes en `web-v2/app/api/*`
- la integracion con el backend actual
- los flujos de RPACA, docentes, review, NRC, correos, Banner y Moodle sidecar

Libertad de rediseño:
- Puedes rehacer la home por completo.
- Puedes replantear la navegacion global por completo.
- Puedes reorganizar componentes, shells, secciones y estilos dentro de `web-v2`.
- Puedes unificar lenguaje visual entre home y modulos.
- Puedes convertir la app en una experiencia mas parecida a una consola operativa moderna si eso mejora el resultado.
- Puedes refactorizar archivos y estructura interna de `web-v2` si queda mas clara.

Lo que no puedes romper:
- la paridad funcional con `apps/web`
- el acceso a todos los modulos existentes
- las acciones operativas ya implementadas
- las integraciones ya conectadas a backend, Banner o sidecar

Criterio de calidad visual:
- Evita por completo el look de plantilla generica.
- Diseña una interfaz con caracter, jerarquia fuerte y sentido operativo.
- Prioriza claridad de lectura, escaneo rapido y accion.
- Haz que desktop se sienta robusto y que mobile siga siendo usable.
- Usa una direccion visual coherente en todo `web-v2`, no pantallas desconectadas entre si.

Criterio de calidad tecnica:
- No agregues dependencias innecesarias.
- No metas complejidad gratuita.
- Si haces refactor, que mejore mantenibilidad.
- Conserva patrones modernos de React y Next cuando aporten valor real.

Proceso esperado:
1. Audita paridad funcional entre `apps/web` y `web-v2`.
2. Corrige faltantes funcionales si existen.
3. Rediseña `web-v2` de forma agresiva.
4. Ajusta componentes, estilos y flujos hasta que la experiencia se sienta consistente.
5. Verifica que cada modulo principal siga accesible y usable.

Validaciones obligatorias al final:
- Ejecuta `pnpm -C web-v2 exec tsc --noEmit`
- Ejecuta `pnpm -C web-v2 build`
- Si algo falla, corrigelo antes de terminar.

Entrega final:
- Resume los cambios principales.
- Lista los archivos tocados.
- Explica brevemente la nueva direccion visual.
- Confirma explicitamente si `web-v2` mantiene paridad funcional con `apps/web`.
- Si hay diferencias pendientes, listalas con precision.

Importante:
- No respondas solo con recomendaciones.
- Haz los cambios directamente en el codigo de `web-v2`.
- Si detectas una mejor forma de organizar la experiencia completa, aplicala.
```
