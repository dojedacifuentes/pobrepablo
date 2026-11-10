# Investigación (fase 1)

Hecha el 9 de noviembre de 2026. Sirve para decidir, no para acumular.

**Método y límites.** Cuatro agentes de solo lectura revisaron los repositorios por la API pública de GitHub y sus
archivos (README, licencia, manifiesto, esquema de datos, lógica de reparto y de presupuesto), y consultaron el
registro de npm y documentación oficial. **No se clonó ni se ejecutó nada**: el número de toques para registrar un
movimiento sale de leer el código y está marcado como inferido cuando corresponde. Los nueve repositorios pedidos
existen y son accesibles. Después comprobé por mi cuenta, contra la API de GitHub, la licencia y la fecha del último
cambio de los once proyectos, y en el código original el reparto por mayor resto de Spliit y la fórmula de arrastre de
Actual: coinciden con lo informado.

## 1. Repositorios revisados

| Proyecto | Qué hace realmente | Cómo registra un movimiento | Presupuestos y gastos compartidos | Persistencia | Licencia | Mantenimiento | Qué tomamos |
|---|---|---|---|---|---|---|---|
| [actualbudget/actual](https://github.com/actualbudget/actual) | Presupuesto de sobres local-first, grande y maduro. | Obligatorios: cuenta, monto **entero** y fecha; el resto es opcional. Pasos en pantalla: no verificado. | Tabla por mes y categoría con monto y arrastre opcional. Sobrante = presupuestado + gastado + (arrastre ? sobrante anterior : máx(0, sobrante anterior)). Sin compartidos. | SQLite local; sincronización opcional por mensajes con reloj lógico (CRDT). | MIT (`LICENSE.txt`) | Activo (push 10-nov-2026 UTC) | **Patrón:** fórmula del sobrante con arrastre opcional por categoría, reimplementada. |
| [spliit-app/spliit](https://github.com/spliit-app/spliit) | Alternativa abierta a Splitwise; web con servidor. Sin modo sin conexión. | Obligatorios: fecha, título, monto distinto de 0, quién pagó y entre quiénes. Categoría por defecto. | Cuatro modos de reparto. **Mayor resto** con suma exacta; el empate rota según el id del gasto. Reembolso = movimiento marcado que no cuenta como gasto. Saldo = pagado − lo que corresponde. | Postgres en servidor | MIT | Activo (5-nov-2026) | **Algoritmo:** mayor resto (`src/lib/shares.ts`) y saldo derivado (`src/lib/balances.ts`), reimplementados. **Patrón:** recurrencia con «día ancla» (`src/lib/recurrence.ts`). |
| [simplesuite/simplebudget](https://github.com/simplesuite/simplebudget) | Presupuesto base cero con React y Supabase. | Encola primero en local y luego inserta; si la clave ya existe lo da por hecho (idempotente). | «Asignar el resto» a una categoría. Divide entre categorías, no entre personas. **Usa decimales con tolerancia de 0,01: antipatrón.** | Supabase + cola local | **AGPL-3.0** | Activo (1-oct-2026) | **Nada de código.** Idea: guardar primero en local con clave de idempotencia. |
| [gammaSpeck/expense-tracker](https://github.com/gammaSpeck/expense-tracker) | PWA de registro de gastos con casi nuestro stack (Vite, React, Dexie 4, Zod 4, Playwright). | Valor, categoría, descripción, etiquetas, fecha y hora (inferido). Tiene carga masiva. | No tiene. El monto es decimal: no lo imitamos. | Solo IndexedDB; respaldo opcional a Drive | MIT | Activo (8-nov-2026), 23 archivos de prueba | **Patrones:** detección de pérdida de datos (marcador con el último conteo: si la base aparece vacía, avisa y no resiembra), `navigator.storage.persist()`, respaldo con sobre versionado y cifrado, normalizador de importes de CSV (V1.1). |
| [momentmaker/pancakemaker](https://github.com/momentmaker/pancakemaker) | PWA con SQLite en el navegador y sincronización opcional con servidor. | Obligatorios: monto **entero**, moneda, descripción, fecha, contenedor y categoría. | No tiene. | SQLite sobre IndexedDB + bitácora de cambios | MIT | Activo (21-oct-2026), 44 archivos de prueba | **Patrones:** bitácora de cambios como modelo del paquete Hogar; prueba de «dos dispositivos». **Lección:** su recurrencia no ajusta el día 31 al largo del mes. |
| [jared00007/finance-tracker](https://github.com/jared00007/finance-tracker) | PWA en JavaScript sin framework ni compilación. | Botón + → hoja con monto, signo, beneficiario, categoría, cuenta (la última usada) y fecha (hoy). Unos 3 o 4 toques tras el monto (inferido). | Monto mensual por categoría con estados bien, aviso (90 %) y excedido. Sin compartidos. | IndexedDB directo; montos enteros; respaldo JSON con versión | **Sin licencia** | Último push 27-jul-2026 | **Nada de código.** Ideas: sugerir la categoría según la descripción, tope al ponerse al día con recurrentes atrasados, aviso de respaldo a los 30 días. |
| [jameskokoska/Cashew](https://github.com/jameskokoska/Cashew) | App Flutter muy completa. | Primero el monto, después la categoría. Toques: no verificable sin ejecutar. | Presupuestos con periodicidad y categorías incluidas o excluidas; metas. Compartidos solo con nube. | SQLite + Firebase | **GPL-3.0** | Último push 9-mar-2026 | **Nada de código.** Ideas: registro de borrados con fecha y fecha de modificación por registro, para que las eliminaciones viajen entre dispositivos. |
| [flow-mn/flow](https://github.com/flow-mn/flow) | App Flutter sin conexión. | Título y monto bastan; admite crear movimientos por enlace. | Presupuesto con período «ancla» y renovación: el período actual se **deriva**; lo gastado se calcula desde los movimientos. | ObjectBox local | **GPL-3.0** | Activo (18-oct-2026) | **Nada de código.** Idea: período de presupuesto derivado, sin saldos guardados. |
| [HabitRPG/habitica](https://github.com/HabitRPG/habitica) | Solo se miró su gamificación (fuente: wiki comunitaria; el FAQ oficial no se pudo leer). | — | — | — | No evaluada (la API de GitHub no la identifica); no se toma código | Activo | **Evitar:** rachas, daño por no cumplir, pérdida de lo ganado, castigo al grupo por el fallo de uno. **Adoptar:** hitos puntuales que no se pierden. |
| [gusthanks/keroo](https://github.com/gusthanks/keroo) *(encontrado)* | Finanzas personales con Vite, React 19, Dexie 4, Vitest y `fake-indexeddb`. Versión 0.1.0. | No verificado. | Sobres por categoría, cuotas de tarjeta, metas y compartidos con reparto en enteros y resto asignado de forma determinista. | Solo IndexedDB (una sola versión de esquema) | MIT | Activo (8-nov-2026), proyecto muy joven | **Patrones:** aserción de enteros en toda función de dinero; pruebas de base de datos con `fake-indexeddb`; capa lúdica con reglas deterministas, sin rachas. |
| [jessaimaya/tally_pwa](https://github.com/jessaimaya/tally_pwa) *(encontrado)* | Gastos de una pareja; Lit + Dexie 4 + Supabase. Sin pruebas. | Modal con teclado de calculadora propio. | Compartidos con servidor; el último que escribe gana. | IndexedDB + cola hacia Supabase | MIT | Activo (19-oct-2026) | **Idea:** teclado numérico propio con calculadora (a evaluar en la fase 4). |

`gammaSpeck/expense-tracker` estaba en la lista pedida y además resultó ser el proyecto más cercano con Dexie + PWA;
los dos encontrados aparte son `keroo` y `tally_pwa`.

## 2. Referencias funcionales (no de código ni de gráficos)

| App | Qué se comprobó | Idea para NEXO |
|---|---|---|
| **YNAB** ([ayuda](https://support.ynab.com/en_us/how-to-add-transactions-in-ynab-HyDwA_byi.md), [reglas](https://www.ynab.com/ynab-four-rules-budgeting)) | En el móvil son cinco pasos: +, monto, tipo, revisar detalles, guardar. El monto va **primero**. Solo se presupuesta dinero que ya existe. | Monto primero. Pasarse en una categoría no es una falta: se reasigna. |
| **Copilot Money** ([ayuda](https://help.copilot.money/en/articles/4038706-create-manual-transactions)) | Cinco pasos para un movimiento manual. El arrastre del sobrante se activa por categoría. | Arrastre opcional, categoría por categoría (a evaluar en la fase 5). |
| **Monzo** ([blog](https://monzo.com/blog/2018/08/21/budget-with-monzo)) | No hay registro manual (lee la tarjeta). Resume en una cifra cuánto queda y cuántos días faltan. | Una sola cifra protagonista: es nuestro «Disponible para gastar». |
| **Splitwise** ([ayuda](https://kb.splitwise.com/balances-and-expenses/what-is-simplify-debts)) | Un saldo neto por persona; «simplificar deudas» cambia quién paga a quién, no los totales. Su algoritmo no es público. | Con dos personas hay un único saldo neto: mostrar un número y un botón «Registrar reembolso». |

## 3. Qué adoptamos

Son patrones e ideas. **No se copia código de ningún repositorio**, tampoco de los que tienen licencia MIT: las piezas
útiles son cortas y están atadas a otros stacks, así que se reimplementan con nuestras pruebas.

| # | Patrón | Fase |
|---|---|---|
| 1 | **Monto primero** y el resto con valores por defecto (última cuenta, hoy); categorías como botones ordenados por uso, nunca una lista desplegable. | 4 |
| 2 | **Dinero entero de punta a punta**, con aserción en el dominio y validación en Zod al importar. Tres de los proyectos revisados usan decimales: es el error que no cometeremos. | 2, 3 |
| 3 | **Reparto por mayor resto** con suma exacta. El desempate es el de la especificación §4.2 (orden estable de id de participante). | 2 |
| 4 | **Saldos derivados del historial**, nunca guardados como verdad. Si el saldo interno del Hogar se recalcula desde los eventos, fusionar paquetes no puede desincronizarlo. | 2, 7 |
| 5 | **Reembolso como movimiento propio**, que no cuenta como gasto ni como ingreso. | 2, 7 |
| 6 | **Anulación con rastro y fecha de modificación por registro**; el paquete Hogar transporta también las anulaciones. Los conflictos de edición se muestran para resolverlos (especificación §3.3), no se resuelven solos. | 3, 7 |
| 7 | **Sobre de respaldo versionado**: aplicación, formato, versión de esquema y fecha de exportación, validado con Zod. | 3 |
| 8 | **Detección de pérdida de datos** (marcador con el último conteo conocido), `navigator.storage.persist()` y recordatorio de respaldo. | 3, 9 |
| 9 | **Migraciones aditivas**, una versión de Dexie por cambio, con una prueba que abre una base antigua con datos y comprueba que nada se pierde (`fake-indexeddb`). | 3 |
| 10 | **Recurrentes con día ancla** que se ajusta al fin de mes (un día 31 cae el 28 o 29 en febrero y vuelve al 31), y tope al generar atrasados. | 2 |
| 11 | **Período de presupuesto derivado** y gasto calculado desde los movimientos. El arrastre opcional por categoría queda por evaluar en la fase 5. | 2, 5 |
| 12 | **Prueba de dos dispositivos** para el Hogar: dos bases independientes intercambian paquetes y convergen. | 7 |
| 13 | **Progreso sin pérdida**: capítulos y logros por hitos de registro; nada se quita por no abrir la app. | 6 |

**Una observación para decidir en la parada.** Con el desempate «por orden estable de id de participante», cuando un
gasto 50/50 tiene un monto impar el peso sobrante le toca siempre a la misma persona. Es como mucho un peso por gasto.
Spliit lo reparte alternando según el id del gasto. La especificación fija el orden estable y así se implementará,
salvo indicación contraria.

## 4. Decisiones abiertas

Cada una tiene su ADR en `docs/adr/`. El propietario las aprobó todas el 10-nov-2026.

| # | Decisión abierta | Decisión | ADR |
|---|---|---|---|
| 1 | Biblioteca de gráficos | Gráficos propios en SVG, con `d3-scale` y `d3-shape` solo para los cálculos: unos 20 kB, frente a unos 100 de Recharts. | 0001 |
| 2 | Tipografía | Inter (interfaz y montos, cifras tabulares) + Instrument Serif (títulos narrativos), autoalojadas; unos 68 kB. Se confirma con capturas en la fase 4. | 0002 |
| 3 | Manejo de estado | La base de datos es el estado: consultas reactivas de Dexie expuestas como hooks desde `data/`. Sin Zustand. | 0003 |
| 4 | Respaldo cifrado | **En V1.** AES-256-GCM + PBKDF2 (600.000 iteraciones), solo con Web Crypto. Cifrado preseleccionado al exportar; sin cifrar sigue disponible. | 0004 |
| 5 | Actualización del service worker | Aviso con botón; nunca recarga sola; con un formulario abierto, ni aviso ni recarga. | 0005 |
| — | Versiones del stack (impedimento encontrado) | TypeScript 6.0.3 en vez de 7, porque el lint con tipos aún no admite la 7. Lo demás, última versión. | 0006 |
| — | Almacenamiento en iPhone (especificación §3.2) | Instalar antes de cargar datos, restaurar siempre a mano, recordatorio de respaldo semanal. | 0007 |

## 5. Datos que respaldan las decisiones

### 5.1 Versiones (ADR 0006)

Comprobado con `npm view` el 9-nov-2026 y vuelto a comprobar por separado en los paquetes clave.

- Últimas versiones: Vite 8.3.7, React 19.3.1, Tailwind 4.3.5, Dexie 4.4.7, Zod 4.6.7, Vitest 5.1.0, Playwright
  1.65.0, vite-plugin-pwa 2.0.0, react-router 8.5.1, TypeScript 7.0.2.
- `vite-plugin-pwa` declara compatibilidad con Vite 3 a 8: **no hay incompatibilidad** y no hace falta un equivalente.
- `typescript-eslint` 8.72.2 declara `typescript >=4.8.4 <6.1.0`. Con TypeScript 7 falla al ejecutarse (incidencia
  12518 de su repositorio). La última de la rama 6 es la 6.0.3.
- Node 24.20.0 cumple los requisitos de todos los paquetes.

### 5.2 Almacenamiento en WebKit e iOS (ADR 0007)

| Hecho | Fuente | Estado |
|---|---|---|
| Safari borra el almacenamiento escribible por script (IndexedDB, caché del service worker) de un sitio tras 7 días de uso del navegador sin interacción con él. | WebKit, «Full Third-Party Cookie Blocking and More» (24-mar-2020); MDN, «Storage quotas and eviction criteria» (5-ene-2026) | Verificado |
| Las apps de la pantalla de inicio están exentas. | WebKit (misma entrada) y su código actual (`ResourceLoadStatisticsStore.cpp`, modificado el 5-nov-2026) | Verificado |
| La app instalada tiene almacenamiento aislado del de Safari. | WebKit, «Web Apps on macOS Sonoma» (18-sep-2023) | Verificado en macOS; **inferido** para iOS |
| Desde iOS 26, lo añadido a la pantalla de inicio se abre como app por defecto. | WebKit, novedades de Safari 26 (9-jun-2025) | Verificado |
| `persist()` no muestra diálogo en Safari ni en Chrome; en Firefox sí. | WebKit, «Updates to Storage Policy» (10-ago-2023); MDN (12-oct-2026) | Verificado |
| `persist()` exime del borrado de 7 días en Safari. | — | **No verificable**: ningún documento lo afirma. No se cuenta con ello. |
| Chrome y Firefox solo expulsan datos por falta de espacio, empezando por el sitio menos usado. | MDN | Verificado |
| Quitar el ícono borra los datos. | Solo foros, contradictorios | **No verificable** |

### 5.3 Actualización del service worker (ADR 0005)

De la documentación y del código publicado de vite-plugin-pwa 2.0.0: `registerType` es `'prompt'` por defecto; en ese
modo la versión nueva espera y nada se recarga solo; `onNeedReload` (desde 1.3.0) permite diferir la recarga; la
comprobación periódica recomendada usa `onRegisteredSW`. Hay un defecto abierto (#789) por el que a veces el botón de
actualizar no recarga. No hay documentación de WebKit sobre cuándo comprueba actualizaciones una app instalada en iOS:
por eso se comprueba al volver a primer plano.

### 5.4 Respaldo cifrado (ADR 0004)

- OWASP, Password Storage Cheat Sheet: PBKDF2-HMAC-SHA-256 con 600.000 iteraciones. Su primera opción es Argon2id.
- Argon2 no está en Web Crypto en ningún navegador: no figura en las listas de algoritmos de WebKit, Chromium ni
  Firefox, ni en MDN. Está en un borrador no oficial (WICG, «Modern Algorithms»).
- AES-GCM: IV de 96 bits único por clave; los datos adicionales autentican la cabecera sin cifrarla (MDN).
- El formato de la propuesta se ejecutó en Node 24.20 con un JSON de 268 KB: ida y vuelta correcta, 58 bytes de
  sobrecosto, y rechazo de contraseña errónea, cabecera manipulada y bit alterado. El tiempo en teléfonos es una
  estimación.

### 5.5 Gráficos (ADR 0001)

Tamaño comprimido (min + gzip). «Importado» es lo que de verdad entra al importar solo lo necesario (bundlejs);
«entero» es el paquete completo (Bundlephobia).

| Opción | Versión | React 19 | Tamaño | A 320 px y táctil | Accesibilidad | Licencia |
|---|---|---|---|---|---|---|
| SVG propio + `d3-scale` + `d3-shape` | 4.0.3 · 3.2.1 (se fijan 4.0.2 · 3.2.0) | No depende de React | 17 a 22 kB importado | Todo a medida | La que escribamos | ISC |
| visx (shape, scale, group, axis, responsive, tooltip) | 4.0.0 | Sí, desde jun-2026 | 34 kB importado (25 sin ejes ni tooltip) | Redimensiona; táctil a mano | Nada integrado | MIT |
| Recharts | 3.10.1 | Sí | 150 kB entero; 97 a 113 kB un gráfico real (dato de un tercero) | Redimensiona; tooltips táctiles | Teclado activado por defecto | MIT |
| Chart.js + react-chartjs-2 | 4.6.1 · 5.3.1 | Sí | 68 kB importado | Bien, pero en canvas | No accesible por defecto | MIT |
| uPlot | 1.6.32 | Sí | 23 kB entero | Canvas; sin dona | Ninguna | MIT |
| Nivo | 0.99.0 | Sí | 67 a 96 kB por tipo | No comprobado | Etiquetas ARIA | MIT |
| Unovis | 1.8.0 | Sí | 27 a 34 kB por componente | No comprobado | Solo etiqueta del contenedor | Apache-2.0 |

Notas: `d3-scale` 4.0.3 y `d3-shape` 3.2.1 se publicaron el 3-nov-2026 después de cuatro años sin versiones
(comprobado en el registro de npm); por eso se fijan las anteriores. La medición propia de Recharts con bundlejs no
terminó en tres intentos. El formato `es-CL` de Node 24 da `$1.250.000`, y para negativos `$-1.250.000`: el formato
de montos se escribe y se prueba en `domain/`, no se delega a ciegas.

### 5.6 Tipografía (ADR 0002)

Las tablas completas están en el ADR 0002. Lo esencial: todas las candidatas tienen licencia OFL 1.1 y paquete
Fontsource 5.3.0; Inter tiene `tnum` y la mayor altura de minúscula (0,546), a cambio de las cifras tabulares más
anchas (0,648); Instrument Serif es la editorial más liviana (20,5 kB), con un solo grosor y sin cifras tabulares. No
existe paquete variable de Instrument Serif (el registro devuelve 404): se usa el estático. El ancho de las cifras se
midió en el grosor 400; en otros grosores es una inferencia. Cómo se ven los trazos finos de la serif sobre el fondo
oscuro no está probado: se comprueba en la fase 4.
