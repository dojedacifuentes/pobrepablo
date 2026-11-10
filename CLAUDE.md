# NEXO: La ruina de Pablo

App real de finanzas personales para dos personas (Pablo y Diego), de uso diario en el celular. PWA local-first, sin
backend. Su personalidad es una ficción humorística («el 9 de noviembre de 2026, Pablo se hizo pobre»); su producto es
la contabilidad. **Si chocan, gana la contabilidad.**

## Al iniciar una sesión

1. Lee este archivo y `docs/ESTADO.md`. Retoma desde ahí.
2. El plan está en `docs/PLAN.md`. La especificación completa está en `docs/ESPECIFICACION.md`: lee las secciones que
   el plan indica para la fase en curso, no hace falta leerla entera.
3. Una fase a la vez. No se empieza la siguiente con la anterior en rojo. Para cerrar: skill `cerrar-sesion`.

El propietario no es programador: los informes van en español claro, sin jerga.

## Prioridades, en este orden

Exactitud financiera → privacidad y seguridad de los datos → experiencia móvil → uso cotidiano sin esfuerzo →
rendimiento → calidad visual y narrativa → funciones avanzadas.

## Honestidad

- No afirmar que se ejecutó una herramienta, una prueba o un despliegue que no se ejecutó.
- Una pantalla no vista a 390 px de ancho no está terminada. Un módulo que solo existe como interfaz, tampoco.
- Ninguna cifra ficticia aparece como dinero real. Los datos de ejemplo viven solo en el perfil Demo.
- Si algo queda bloqueado: se documenta el bloqueo exacto en `docs/ESTADO.md` y se sigue con lo que no depende de él.

## Paradas obligatorias (esperar el «sí» del propietario)

Fin de la fase 1 · fin de la fase 4, con capturas reales · antes de instalar skills, plugins o servidores MCP de
terceros · antes de crear el repositorio remoto, hacer push o desplegar · ante cualquier gasto, contratación u
operación destructiva. Entre paradas se trabaja con autonomía.

## Decisiones cerradas

No se reabren salvo impedimento técnico concreto y verificable; en ese caso, detenerse y explicarlo.

- **Sin backend.** Ni Supabase, ni Firebase, ni base remota, ni autenticación, ni funciones de servidor, ni secretos.
- SPA estática + PWA instalable. Vite · React · TypeScript estricto · Tailwind CSS · Radix (vía shadcn/ui donde
  convenga) · Lucide · Motion · Zod.
- Persistencia: IndexedDB con Dexie. `localStorage` solo para preferencias triviales de interfaz, nunca para finanzas.
- PWA con vite-plugin-pwa (Workbox). Pruebas: Vitest, fast-check, Playwright.
- Moneda: CLP en enteros, formato es-CL (`$1.250.000`).
- Fechas: fecha de calendario local `YYYY-MM-DD` (America/Santiago), no instantes UTC. El dominio recibe un reloj
  inyectado; nunca llama a `Date.now()`.
- Interfaz, microcopy y documentación en español de Chile. Código e identificadores en inglés.
- Mobile-first absoluto. Referencia 390 × 844; también 320 × 568, 360 × 800, 375 × 667, 412 × 915 y 430 × 932.
- Repositorio de GitHub **privado**; nunca se suben datos financieros reales. Despliegue estático en Vercel.

## Decisiones de la fase 1

Detalle en `docs/adr/`. Son **propuestas** hasta que el propietario las apruebe en la parada de la fase 1
(el estado real de cada una está en `docs/adr/README.md`).

- **0001 Gráficos:** SVG propio; `d3-scale` y `d3-shape` solo para los cálculos. Sin biblioteca de gráficos. Carga
  diferida, y todo gráfico con su equivalente en texto.
- **0002 Tipografía:** Inter Variable (interfaz y todos los montos, `tabular-nums`) + Instrument Serif (solo títulos
  narrativos grandes). Autoalojadas con Fontsource, subconjunto latino. Dos familias y ninguna más.
- **0003 Estado:** la base de datos es el estado. Consultas reactivas de Dexie expuestas como hooks desde `data/`;
  `features/` y `ui/` no importan Dexie. Sin Zustand.
- **0004 Respaldo cifrado, en V1:** AES-256-GCM + PBKDF2 (600.000 iteraciones) con Web Crypto, sin dependencias.
  El paquete Hogar no se cifra en V1.
- **0005 Service worker:** `registerType: 'prompt'`. Nunca recarga sola; con un formulario abierto, ni aviso ni
  recarga.
- **0006 Versiones:** TypeScript **6.0.3**, no 7 (`typescript-eslint` aún no la admite). Versiones exactas.
  `react-router` 8 (no existe `react-router-dom`).
- **0007 iPhone:** Safari borra los datos de un sitio no instalado tras 7 días sin uso. Por eso: instalar antes de
  cargar datos, «restaurar respaldo» siempre a la vista y recordatorio de respaldo semanal.

## Arquitectura

```
src/
  domain/     Lógica financiera pura. Sin React, sin Dexie, sin fechas del sistema.
  data/       Interfaces de repositorio + implementación Dexie + migraciones + respaldo.
  narrative/  NarrativeEngine puro + catálogo de textos tipado.
  features/   Pantallas y flujos por dominio.
  ui/         Sistema de diseño: tokens, componentes base, navegación, bottom sheets.
  app/        Rutas, proveedores, registro de la PWA.
```

- **La interfaz nunca calcula dinero.** Todo monto que se muestra sale de una función de `domain/`.
- `domain/` y `narrative/` son puros y deterministas: se prueban sin navegador.
- `narrative/` lee eventos; jamás escribe datos financieros ni bloquea una operación.
- `features/` habla con interfaces de repositorio, no con Dexie: una capa de sincronización futura debe poder
  sustituir la implementación sin tocar `domain/` ni `features/`.
- Archivos pequeños, organizados por dominio.

## Reglas financieras críticas

- `Money` es un entero. Ningún decimal participa en la contabilidad.
- Ocho magnitudes que no se mezclan, cada una con su función y sus pruebas: saldo por cuenta, saldo total,
  obligaciones pendientes del período, dinero reservado, **disponible para gastar** (= saldo líquido confirmado −
  obligaciones pendientes − reservas), patrimonio neto, ahorro acumulado, flujo proyectado.
- Una transferencia entre cuentas propias no es ingreso ni gasto.
- Tarjeta de crédito: la compra es el gasto y crea un pasivo; pagar la tarjeta baja el pasivo y **no** es otro gasto.
  Intereses y comisiones sí son gasto. Las cuotas son obligaciones futuras.
- Meta de ahorro: reservar (el dinero sigue en la cuenta) no es lo mismo que transferir a una cuenta de ahorro.
- Honorarios: bruto, retención y líquido; solo el líquido recibido cuenta como disponible. No se calculan impuestos.
- Gasto compartido: gasto original, pagador, participantes, distribución, obligación interna, reembolso y estado.
  Caso canónico: Diego paga $200.000 de un gasto 50/50 → saldo interno de $100.000 a favor de Diego.
- Reparto por mayor resto; empates por orden estable de id de participante; la suma de las partes es el total exacto.
- Recurrentes: confirmar un programado lo convierte en movimiento real; nunca se contabiliza dos veces.
- Los movimientos no se borran: se anulan y queda rastro. Auditoría solo de agregado.
- Saldos y saldos internos se pueden recalcular desde el historial y deben coincidir con los incrementales.
- Invariantes con fast-check: `docs/ESPECIFICACION.md` §4.3.

## Datos y privacidad

- Todo vive en el dispositivo. La app lo dice con claridad y no simula autenticación, sincronización ni colaboración
  en tiempo real. Los perfiles (Pablo, Diego, Demo) no están protegidos entre sí, y la interfaz lo informa.
- El Hogar se comparte con paquetes JSON validados con Zod; la fusión es determinista por UUID e idempotente.
- Ninguna petición a terceros en tiempo de ejecución: fuentes autoalojadas, sin analítica.
- Nunca entra al repositorio un respaldo, un paquete Hogar ni un dato financiero real (ver `.gitignore`).

## Narrativa

- Tres modos: narrativo, discreto y serio. La app es plenamente útil en modo serio.
- Nunca se bromea con salud, medicamentos, alimentación básica, vivienda en riesgo, emergencias veterinarias ni
  vulnerabilidad. En situación crítica el tono es claro y respetuoso.
- La mayoría de los registros no produce comentario. El texto vive en el catálogo de `narrative/`, no en los
  componentes.

## Convenciones de código

- TypeScript estricto, sin `any`. Validación con Zod en todo borde (formularios, importación).
- Tipos propios para lo que no debe confundirse: `Money`, `LocalDate`, identificadores.
- Reloj y generador de identificadores inyectados: nada de `new Date()` ni `crypto.randomUUID()` dentro de `domain/`.
- Pruebas junto al código (`*.test.ts`; propiedades en `*.property.test.ts`). El dominio se escribe con la prueba
  primero.
- Textos de interfaz en español de Chile; identificadores, nombres de archivo y comentarios técnicos en inglés.
- Mensajes de commit en español, descriptivos. Commit local al cerrar sesión o fase; push solo con el «sí».

## Comandos

Existen desde la fase 2:

```bash
npm run dev        # servidor de desarrollo
npm run verify     # typecheck → lint → pruebas unitarias y de propiedades → build
npm run e2e        # Playwright en los viewports móviles
npm run capturas   # capturas de cada pantalla en todos los viewports (desde la fase 4)
```

## Entorno

Windows 11, Node 24, npm. No están instalados `gh` ni la CLI de Vercel. Playwright tiene solo Chromium en caché: WebKit
se descarga en la fase 4. Detalle en `docs/00-inventario-herramientas.md`.

## Subagentes y skills del proyecto

`.claude/agents/`: `investigador`, `revisor-financiero`, `guionista`, `auditor-movil`. Un solo escritor por carpeta a
la vez; los revisores reportan, no editan. `.claude/skills/`: `verificar`, `capturas`, `cerrar-sesion`.
