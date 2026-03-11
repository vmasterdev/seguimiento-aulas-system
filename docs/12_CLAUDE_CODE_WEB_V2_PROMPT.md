# Prompt para Claude Code: rediseño de `web-v2` con paridad funcional

Pega este prompt en Claude Code desde la raiz del repositorio:

```text
Analiza este monorepo y mejora de forma fuerte la interfaz grafica de `web-v2`, pero sin perder ninguna funcion operativa que hoy existe en `apps/web`.

Contexto del repo:
- `apps/web` es el frontend actual.
- `web-v2` es el frontend paralelo donde debes trabajar.
- La API principal vive fuera del frontend y se consume via rutas del propio proyecto.
- `web-v2` ya tiene una base funcional, pero quiero que la experiencia visual y de uso quede claramente mejor.

Objetivo principal:
- Redisenar y perfeccionar la UI de `web-v2`.
- Mantener paridad funcional con `apps/web` en todos los modulos operativos.
- No romper rutas, integraciones ni flujos existentes.

Antes de editar:
1. Compara `apps/web/app` contra `web-v2/app`.
2. Toma `apps/web` como fuente canonica de funciones.
3. Haz una checklist de paridad funcional entre ambas versiones.
4. Si detectas algo presente en `apps/web` y ausente o incompleto en `web-v2`, corrige eso primero.

Rutas y modulos que deben seguir funcionando en `web-v2`:
- `/rpaca`
- `/docentes`
- `/review`
- `/nrc-globales`
- `/nrc-trazabilidad`
- `/correos`
- `/automatizacion-banner`
- `/automatizacion-moodle`

Reglas de trabajo:
- Trabaja principalmente dentro de `web-v2`.
- No modifiques `apps/web` salvo que sea estrictamente necesario para inspeccion o referencia.
- Conserva la integracion con las rutas API y el backend ya existente.
- Mantén operativos los flujos de Banner, Moodle sidecar, review, correos, NRC y RPACA.
- No agregues dependencias innecesarias.
- Si refactorizas, prioriza claridad, consistencia visual y mantenibilidad.
- Haz cambios reales en codigo, no solo sugerencias.

Direccion de diseno:
- Evita que se vea como una plantilla generica.
- Mejora jerarquia visual, espaciado, composicion, densidad de informacion y responsive.
- La portada y los modulos deben sentirse parte del mismo sistema.
- Mantén una experiencia fuerte en desktop y usable en mobile.
- Si hace falta, reorganiza componentes, estilos y layout dentro de `web-v2`.

Requisitos funcionales:
- `web-v2` debe seguir exponiendo y usando los modulos equivalentes a `apps/web`.
- Si la home de `web-v2` cambia, debe seguir sirviendo como punto de entrada claro hacia todos los modulos.
- No elimines accesos a modulos existentes.
- Mantén compatibilidad con las rutas internas y con las acciones ya implementadas en `web-v2/app/api/*`.

Validaciones obligatorias al final:
- Ejecuta `pnpm -C web-v2 exec tsc --noEmit`
- Ejecuta `pnpm -C web-v2 build`
- Si algo falla, corrigelo antes de terminar.

Entrega final:
- Resume que cambios hiciste.
- Lista archivos tocados.
- Confirma explicitamente si `web-v2` quedo con paridad funcional respecto a `apps/web`.
- Si encontraste diferencias que no pudiste cerrar, listalas de forma concreta.
```

## Nota

Si quieres una variante mas agresiva, puedes anadir esta linea al prompt:

```text
Tienes libertad para replantear por completo la experiencia visual de `web-v2`, siempre que conserves la paridad funcional con `apps/web`.
```
