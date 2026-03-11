# Prompt release candidate para Claude Code: `web-v2` como reemplazo de `apps/web`

Pega este prompt en Claude Code desde la raiz del repositorio:

```text
Analiza este monorepo y convierte `web-v2` en un release candidate real para reemplazar `apps/web`.

No quiero un rediseño superficial. Quiero una version de `web-v2` que pueda evaluarse seriamente como nuevo frontend principal del sistema.

Objetivo central:
- Llevar `web-v2` a nivel de frontend principal.
- Mantener paridad funcional completa con `apps/web`.
- Mejorar de forma fuerte la experiencia visual, la navegacion, la legibilidad, la organizacion y la consistencia del producto.
- Dejar la base de codigo suficientemente limpia y coherente para evolucionar desde ahi.

Contexto del repo:
- `apps/web` es el frontend actual en produccion o referencia operativa.
- `web-v2` es el frontend paralelo donde debes trabajar.
- La referencia funcional canonica es `apps/web`.
- La intervencion debe concentrarse en `web-v2`.

Mandato principal:
- Trata `apps/web` como contrato funcional.
- Trata `web-v2` como candidato a reemplazo.
- Si `web-v2` no cubre algo que `apps/web` si cubre, debes cerrarlo.
- Si detectas friccion de uso, inconsistencias visuales o arquitectura floja en `web-v2`, debes corregirlas.

Fase 1: auditoria funcional obligatoria
1. Compara `apps/web/app` y `web-v2/app`.
2. Haz una checklist de paridad modulo por modulo.
3. Verifica paneles, rutas, accesos y puntos de integracion.
4. Detecta faltantes, diferencias o riesgos de regresion.

Fase 2: correccion de paridad
1. Corrige cualquier hueco funcional de `web-v2` frente a `apps/web`.
2. No avances al rediseño final mientras exista una diferencia funcional importante sin resolver.

Fase 3: rediseño fuerte orientado a reemplazo
1. Replantea la experiencia de `web-v2` para que se sienta como el frontend principal del sistema.
2. Puedes rehacer home, navegacion, layout, componentes, secciones y estilos.
3. Puedes reorganizar estructura interna de `web-v2` si mejora claridad y mantenibilidad.
4. Debes dejar una experiencia consistente entre portada y modulos operativos.

Rutas que deben seguir funcionando en `web-v2`:
- `/rpaca`
- `/docentes`
- `/review`
- `/nrc-globales`
- `/nrc-trazabilidad`
- `/correos`
- `/automatizacion-banner`
- `/automatizacion-moodle`

Integraciones que no puedes romper:
- `web-v2/app/api/backend/[...path]/route.ts`
- `web-v2/app/api/banner/*`
- `web-v2/app/api/actions/route.ts`
- `web-v2/app/api/ops/route.ts`
- integracion con backend actual
- integracion con Banner
- integracion con Moodle sidecar

Criterio de producto:
- La app debe sentirse como una consola operativa seria, no como prototipo.
- La informacion debe escanearse rapido.
- Las acciones importantes deben ser obvias.
- La navegacion debe reducir friccion.
- La home debe servir como centro real de operaciones.
- Los modulos deben sentirse cohesionados visualmente con la portada.

Criterio visual:
- Evita el look de dashboard generico.
- Define una direccion visual fuerte y coherente.
- Mejora ritmo, espaciado, densidad, contraste, estados y jerarquia.
- Haz que desktop se sienta solido y que mobile siga siendo usable.

Criterio tecnico:
- No agregues dependencias innecesarias.
- No hagas refactors inutiles.
- Si refactorizas, que quede mas claro y mantenible.
- No toques `apps/web` salvo referencia puntual.
- Haz cambios reales en codigo, no una lista de recomendaciones.

Criterio de aceptacion:
- `web-v2` debe quedar visualmente mejor que `apps/web`.
- `web-v2` debe conservar la funcionalidad operativa de `apps/web`.
- `web-v2` debe quedar en estado razonable para ser evaluado como reemplazo del frontend actual.

Validaciones obligatorias:
- Ejecuta `pnpm -C web-v2 exec tsc --noEmit`
- Ejecuta `pnpm -C web-v2 build`
- Corrige cualquier error antes de terminar.

Entrega final:
- Resume los cambios principales.
- Lista archivos tocados.
- Explica la direccion visual y estructural aplicada.
- Confirma explicitamente si `web-v2` ya puede evaluarse como reemplazo de `apps/web`.
- Confirma explicitamente si mantiene paridad funcional con `apps/web`.
- Lista cualquier diferencia pendiente o riesgo residual con precision.

Importante:
- No te limites a embellecer.
- No borres capacidades existentes.
- No respondas con teoria.
- Implementa los cambios directamente en `web-v2`.
```
