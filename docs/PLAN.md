# Plan por fases

Fuente: `docs/ESPECIFICACION.md` §9. Antes de empezar una fase, lee las secciones de la especificación que se indican.

**Reglas del plan**

- Una fase a la vez. No se empieza la siguiente con la anterior en rojo.
- Toda fase se cierra con: `npm run verify` en verde (desde la fase 2, cuando ya existe el proyecto), `docs/ESTADO.md`
  actualizado y un commit local con mensaje descriptivo.
- Las fases con interfaz exigen además capturas en los seis viewports móviles, miradas una por una.
- Un módulo que solo existe como interfaz no está terminado. Una pantalla no vista a 390 px no está terminada.

**Paradas obligatorias** (esperar el «sí» del propietario; entre paradas se trabaja con autonomía)

1. Al terminar la fase 1.
2. Al terminar la fase 4, mostrando capturas reales.
3. Antes de instalar skills, plugins o servidores MCP de terceros.
4. Antes de crear el repositorio remoto, hacer push o desplegar.
5. Ante cualquier gasto, contratación de servicio u operación destructiva sobre datos o archivos existentes.

---

## Fase 0 · Arranque — hecha (9-nov-2026)

- Leer: §2.
- Contenido: inspección del entorno, inventario de herramientas, archivos de memoria, subagentes y skills del proyecto.
- **Salida:** `docs/00-inventario-herramientas.md`, `CLAUDE.md`, `docs/PLAN.md`, `docs/ESTADO.md`, `docs/adr/` creados.

## Fase 1 · Investigación y decisiones — hecha (9-nov-2026); aprobada el 10-nov-2026

- Leer: §1 (decisiones abiertas) y §8.
- Contenido: revisión de los repositorios de referencia y de dos o tres proyectos con Dexie/IndexedDB + PWA; referencias
  funcionales (YNAB, Copilot Money, Monzo, Splitwise); un ADR por cada decisión abierta.
- **Salida:** `docs/01-investigacion.md` y los ADR listos. **PARADA.**

## Fase 2 · Dominio financiero

- Leer: §3.1, §4 completa, §10 (Dominio).
- Contenido:
  - Inicializar el proyecto (Vite + React + TypeScript estricto) con las versiones fijadas en el ADR 0006.
  - Scripts `npm run verify` (typecheck → lint → pruebas → build) y `npm run e2e`.
  - `src/domain/` con desarrollo guiado por pruebas: `Money`, fechas de calendario y reloj inyectado, cuentas,
    movimientos, transferencias, tarjeta de crédito y cuotas, repartos (mayor resto), reembolsos, recurrentes,
    presupuestos, metas, y las ocho magnitudes de §4.1, cada una con su función y sus pruebas.
  - `docs/07-modelo-financiero.md` con la definición de cada magnitud.
- **Salida:** pruebas unitarias y de propiedades de §4.3 en verde. Revisión del subagente `revisor-financiero` sin
  hallazgos abiertos.

## Fase 3 · Datos locales

- Leer: §3.2, §3.3, §10 (Datos).
- Contenido: esquema Dexie versionado, migraciones probadas, interfaces de repositorio y su implementación Dexie,
  transacciones, claves de idempotencia, anulación con rastro, auditoría append-only, perfiles (Pablo, Diego, Demo),
  dataset Demo ficticio y aislado, exportación e importación JSON validadas con Zod, `navigator.storage.persist()`.
  Hooks de consulta reactiva expuestos desde `data/` (ADR 0003). Núcleo del respaldo cifrado (ADR 0004) y marcador de
  detección de pérdida de datos (ADR 0007). `docs/05-arquitectura-local-first.md` y
  `docs/06-privacidad-y-respaldos.md`.
- **Salida:** prueba de ida y vuelta: exportar → borrar → importar deja la base idéntica, con y sin cifrado. Prueba de
  propiedades: importar dos veces el mismo respaldo deja la base idéntica (invariante de §4.3 que quedó para esta
  fase).

## Fase 4 · Rebanada vertical

- Leer: §5.1–§5.4, §7, §10 (Móvil y Visual).
- Contenido: sistema de diseño (tokens, tipografía del ADR 0002, componentes base, bottom sheet), navegación inferior
  de cinco posiciones, dashboard real y registro rápido, todo conectado a IndexedDB. Script de capturas en todos los
  viewports. Instalar WebKit de Playwright (`npx playwright install webkit`). Confirmar la tipografía con capturas a
  320 y 390 px, con montos grandes.
  `docs/04-design-system.md` y `docs/03-storyboard-mobile.md` (primera versión).
- **Salida:** flujo E2E en verde: abrir → registrar gasto → ver saldo y lista actualizados → recargar → los datos siguen
  ahí. Capturas en los seis viewports móviles, revisadas. **PARADA con capturas.**

## Fase 5 · Finanzas completas

- Leer: §5.5.
- Contenido: onboarding (en iPhone sin instalar empieza por «instalar primero» y siempre ofrece restaurar un
  respaldo: ADR 0007), movimientos con búsqueda, filtros, edición, anulación e historial; recurrentes; calendario
  (agenda); presupuestos; metas; ajustes básicos, con exportar e importar respaldo cifrado o sin cifrar (ADR 0004).
- **Salida:** cada flujo con su E2E y sus capturas.

## Fase 6 · Narrativa

- Leer: §6 completa y §7 (identidad gráfica, ilustración, motion).
- Contenido: intro del 9 de noviembre, `NarrativeEngine`, catálogo de 100 mensajes o más (con variantes y alternativa
  seria), capítulos, logros (los siete dados + diez propuestos), modos de humor, tres conceptos de logotipo en SVG.
  Revisión editorial del subagente `guionista`. `docs/02-identidad-narrativa.md`.
- **Salida:** pruebas del motor y del catálogo en verde. La app completa es usable en modo serio.

## Fase 7 · Hogar

- Leer: §3.3, §4.2 (gastos compartidos y reparto), §5.5 (Hogar).
- Contenido: gastos compartidos, saldos internos, reembolsos, paquete Hogar con fusión determinista por UUID y
  resolución explícita de conflictos.
- **Salida:** prueba: dos bases independientes intercambian paquetes y convergen al mismo estado. Prueba de
  propiedades: importar dos veces el mismo paquete no cambia nada (invariante de §4.3).

## Fase 8 · Análisis

- Leer: §4.4, §5.5 (Análisis).
- Contenido: gráficos (biblioteca del ADR 0001, carga diferida), comparaciones, proyección por escenarios, simulador en
  memoria. Cada gráfico con su equivalente textual.
- **Salida:** proyecciones con detalle inspeccionable. Gráficos legibles a 320 px.

## Fase 9 · Calidad y PWA

- Leer: §5.6, §3.2, §10.
- Contenido: service worker con aviso de versión y recarga diferida (ADR 0005), modo sin conexión, instalación,
  exportación CSV, recordatorios de respaldo (ADR 0007), accesibilidad (WCAG 2.2 AA), rendimiento, revisión de
  dependencias. `docs/08-testing.md`. Pedir al propietario las comprobaciones en un iPhone real (ADR 0007).
- **Salida:** funciona sin conexión tras la primera carga. Auditoría de accesibilidad sin fallos críticos.

## Fase 10 · Publicación

- Leer: §11, §12.
- Contenido: README, documentación al día, CI en GitHub Actions (verify + e2e), `vercel.json` con rewrite a
  `index.html`, `docs/09-despliegue.md`, `docs/10-roadmap.md`. Repasar los 18 criterios de aceptación de §12.
- **Salida:** **PARADA antes de crear el repositorio remoto, hacer push o desplegar.**

---

## Después de V1 (V1.1)

Informe forense de fin de mes (§6.9), importación de cartolas CSV con vista previa y detección de duplicados, sonido,
respaldo cifrado si quedó pendiente (ADR 0004), más eventos narrativos. Una V2 con sincronización queda solo planificada.

## Fuera de alcance en V1 (§13)

Backend, autenticación real, sincronización automática, notificaciones push, OCR, clasificación con IA, conexión con
bancos, multimoneda, publicidad, analítica de terceros. No se agregan dependencias pensando en ello.
