> **Nota de archivo.** Este es el prompt maestro v2 del propietario, guardado tal cual el 9 de noviembre de 2026.
> Es la fuente de verdad del alcance. Las secciones 2.1 y 14 (arranque) ya se ejecutaron: el estado real está en
> `docs/ESTADO.md` y las decisiones abiertas de la sección 1 quedaron resueltas en `docs/adr/`.

# NEXO: La ruina de Pablo
## Prompt maestro v2 para Claude Code
### App de finanzas personales · mobile-first · PWA local-first · sin backend · GitHub + Vercel

---

# 0. Qué vas a construir

Una aplicación real de finanzas personales para dos personas, Pablo y Diego, pensada para usarse todos los días desde el celular.

Su identidad es una ficción humorística: **el 9 de noviembre de 2026, Pablo se hizo pobre. Ahora deberá aprender a ahorrar.** Subtítulo: *Una tragedia financiera en capítulos.*

El humor (negro, culto, burocrático) es la personalidad del producto. La contabilidad es el producto. Si alguna vez chocan, gana la contabilidad.

**Orden de prioridades, innegociable:**

Exactitud financiera → Privacidad y seguridad de los datos → Experiencia móvil → Uso cotidiano sin esfuerzo → Rendimiento → Calidad visual y narrativa → Funciones avanzadas.

**Reglas de honestidad, válidas en todo el proyecto:**

- No afirmes haber ejecutado una herramienta, una prueba o un despliegue que no ejecutaste.
- No declares terminada una pantalla que no inspeccionaste visualmente a 390 px de ancho.
- No declares terminado un módulo que solo existe como interfaz.
- Ninguna cifra ficticia puede aparecer como dinero real.
- Si algo queda bloqueado, documenta el bloqueo exacto y continúa con lo que no depende de él.

---

# 1. Decisiones cerradas

Estas decisiones ya están tomadas. No las reinvestigues ni propongas alternativas salvo que encuentres un impedimento técnico concreto y verificable; en ese caso, detente y explícalo.

| Tema | Decisión |
|---|---|
| Backend | **Ninguno.** Sin Supabase, sin Firebase, sin base de datos remota, sin servicio de autenticación, sin funciones de servidor, sin variables de entorno secretas. |
| Tipo de app | SPA estática + PWA instalable. Todo corre en el navegador. |
| Stack | Vite · React · TypeScript estricto · Tailwind CSS · componentes Radix (vía shadcn/ui donde convenga) · Lucide · Motion · Zod |
| Persistencia | IndexedDB mediante Dexie.js. Prohibido usar localStorage para datos financieros (solo preferencias triviales de interfaz). |
| PWA | vite-plugin-pwa (Workbox), o equivalente verificado si hay incompatibilidad de versiones. |
| Pruebas | Vitest (unitarias y de dominio) · fast-check (propiedades) · Playwright (E2E y capturas móviles). |
| Moneda | CLP, siempre en enteros. Formato es-CL: `$1.250.000`. |
| Fechas | Los movimientos guardan fecha de calendario local (`YYYY-MM-DD`, zona America/Santiago), no instantes UTC. El dominio nunca llama a `Date.now()`: recibe un reloj inyectado. |
| Idioma | Interfaz, microcopy y documentación en español de Chile. Código e identificadores en inglés. |
| Diseño | Mobile-first absoluto. Referencia: 390 × 844 px CSS. |
| Repositorio | GitHub, **privado**. Nunca se suben datos financieros reales. |
| Despliegue | Vercel, como sitio estático (`vite build` → `dist/`), con rewrite de rutas a `index.html`. Vercel publica archivos; no almacena datos. |

**Decisiones abiertas** (investiga, decide y registra un ADR breve por cada una):

1. Biblioteca de gráficos (Recharts, Visx u otra): la que rinda mejor en pantallas estrechas y pese menos.
2. Tipografía: una familia para interfaz con cifras tabulares y, opcionalmente, una de carácter editorial para títulos narrativos. Deben poder autoalojarse (sin peticiones a terceros en tiempo de ejecución).
3. Manejo de estado: empieza con hooks y consultas reactivas de Dexie; agrega Zustand solo si hay una necesidad demostrada.
4. Respaldo cifrado con Web Crypto (AES-GCM + derivación de clave estándar): implementarlo en V1 o dejarlo para V1.1.
5. Estrategia de actualización del service worker (aviso de nueva versión, nunca recarga forzada durante un registro).

---

# 2. Protocolo de trabajo en Claude Code

Este proyecto no cabe en una sola sesión. Trabaja por fases, con memoria en archivos y puertas de verificación.

## 2.1. Fase 0: arranque (hazla ahora)

1. Inspecciona el entorno: directorio actual, Git, Node, gestor de paquetes, GitHub CLI, Playwright, integración con Chrome.
2. Haz un inventario verificable de skills, plugins, servidores MCP, conectores y subagentes disponibles. No inventes nombres: lista solo lo que compruebes. Guárdalo en `docs/00-inventario-herramientas.md`.
3. Si el directorio ya contiene un proyecto ajeno, detente y pregunta.
4. Crea los archivos de memoria del proyecto:
   - `CLAUDE.md`: contexto permanente, decisiones cerradas de la sección 1, reglas financieras críticas de la sección 4, convenciones de código, comandos de verificación. Breve: es lo que se carga en cada sesión.
   - `docs/PLAN.md`: las fases de la sección 9 con sus criterios de salida.
   - `docs/ESTADO.md`: qué está hecho, qué está en curso, qué sigue, problemas conocidos.
   - `docs/adr/`: un archivo corto por decisión de arquitectura.
5. Carga las skills instaladas que sean pertinentes (diseño frontend, React, testing, accesibilidad, PWA, escritura creativa). No actives herramientas sin relación con el trabajo.

## 2.2. Ritmo de sesiones

- **Al iniciar una sesión:** lee `CLAUDE.md` y `docs/ESTADO.md`. Retoma desde ahí.
- **Durante la sesión:** una fase a la vez. No empieces la siguiente con la anterior en rojo.
- **Al cerrar una sesión o una fase:** ejecuta la verificación completa, actualiza `docs/ESTADO.md`, haz commit con mensaje descriptivo.

Las sesiones futuras se abrirán con un mensaje tan corto como: *«Continúa con la fase N según docs/PLAN.md»*. Todo lo necesario debe estar en los archivos, no en la conversación.

## 2.3. Puerta de verificación

Crea un script único `npm run verify` que ejecute: typecheck → lint → pruebas unitarias y de propiedades → build de producción. Agrega `npm run e2e` para Playwright en viewports móviles.

Ninguna fase se cierra sin `verify` en verde. Un build exitoso no es prueba suficiente de calidad: las fases con interfaz exigen además capturas revisadas.

Crea comandos o skills de proyecto para lo repetitivo: verificar, generar capturas en todos los viewports, cerrar sesión (verificar + actualizar estado + commit).

## 2.4. Subagentes

Usa subagentes cuando el trabajo sea realmente paralelizable o cuando convenga una revisión independiente. Define en el proyecto, como mínimo:

- **Investigador** (solo lectura): repositorios, licencias, documentación. Devuelve conclusiones, no volcados.
- **Revisor financiero** (solo lectura): audita el dominio contra las reglas e invariantes de la sección 4, sin haber visto cómo se escribió el código.
- **Guionista**: escribe y revisa microcopy según la sección 6. Solo edita el catálogo de textos.
- **Auditor móvil**: revisa capturas y flujos en los viewports definidos; reporta overflow, recortes, contraste, zonas táctiles.

Regla de coordinación: **un solo escritor por carpeta a la vez.** Los revisores no editan; reportan.

## 2.5. Puntos de parada obligatorios

Entre paradas, trabaja con autonomía y no pidas permiso para cada paso. Detente y espera aprobación únicamente en estos casos:

1. Al terminar la fase 1 (investigación y decisiones abiertas).
2. Al terminar la fase 4 (primera rebanada vertical), mostrando capturas reales.
3. Antes de instalar skills, plugins o servidores MCP de terceros.
4. Antes de crear el repositorio remoto, hacer push o desplegar.
5. Ante cualquier gasto, contratación de servicio u operación destructiva sobre datos o archivos existentes.

---

# 3. Arquitectura

## 3.1. Capas

```
src/
  domain/        Lógica financiera pura. Sin React, sin Dexie, sin fechas del sistema.
  data/          Interfaces de repositorio + implementación Dexie + migraciones + respaldo.
  narrative/     NarrativeEngine puro + catálogo de textos tipado.
  features/      Pantallas y flujos por dominio (dashboard, quick-add, activity, goals, ...).
  ui/            Sistema de diseño: tokens, componentes base, navegación, bottom sheets.
  app/           Rutas, proveedores, registro de PWA.
```

Reglas:

- **La interfaz nunca calcula dinero.** Todo monto mostrado sale de una función de `domain/`.
- `domain/` y `narrative/` son funciones puras, deterministas y testeables sin navegador.
- `narrative/` lee eventos y contexto derivado; jamás escribe datos financieros ni bloquea una operación.
- `data/` expone interfaces de repositorio. La implementación Dexie es una de las posibles: una futura capa de sincronización debe poder sustituirla sin tocar `domain/` ni `features/`.
- Nada de archivos gigantes: componentes y servicios pequeños, organizados por dominio.

## 3.2. Persistencia local

- Base Dexie versionada, con migraciones probadas.
- Operaciones financieras relacionadas dentro de una misma transacción de IndexedDB.
- Identificadores UUID generados en el cliente. Cada registro creado desde un formulario lleva una clave de idempotencia para impedir duplicados por doble toque.
- Los movimientos no se borran físicamente: se anulan, y queda rastro. La eliminación definitiva existe solo como acción explícita con advertencia.
- Registro de auditoría append-only: creación, edición, anulación, cambio de monto, de categoría o de distribución, reembolso, importación.
- Solicita `navigator.storage.persist()` y explica al usuario qué significa el resultado. Maneja errores de cuota.
- Verifica en la documentación vigente de WebKit la política de expulsión de almacenamiento en iOS para sitios no instalados, y diseña en consecuencia: instalación recomendada, recordatorios de respaldo.
- La app advierte con claridad que los datos viven en el dispositivo y que no hay respaldo remoto automático.

## 3.3. Perfiles y el problema de los dos teléfonos

- Perfiles locales para Pablo y Diego, con registros separados en la base. Existe también un perfil **Demo** con datos claramente ficticios, que se puede reiniciar o eliminar sin tocar los demás.
- No simules autenticación. No afirmes que los perfiles están protegidos entre sí: cualquiera con acceso al dispositivo puede ver ambos. Dilo en la interfaz.
- Lo esperable es que cada uno use la app en su propio celular. Sin backend no hay sincronización, así que el espacio compartido **Hogar** funciona así:
  - Cada gasto común es un evento inmutable con UUID, autor y fecha.
  - Cualquiera puede exportar un **paquete Hogar** (archivo JSON validado con Zod, con versión de esquema) y enviárselo al otro por el medio que quiera.
  - Al importarlo, la fusión es determinista por UUID: los eventos nuevos se agregan, los repetidos se ignoran, las ediciones en conflicto se muestran para resolver explícitamente. Importar dos veces el mismo paquete no cambia nada.
  - La interfaz muestra la fecha del último intercambio y nunca sugiere que los datos del otro estén al día.
- Prohibido simular colaboración en tiempo real, notificaciones remotas o sincronización que no existen.

---

# 4. Dominio financiero

## 4.1. Magnitudes que no se mezclan

1. Saldo de cada cuenta.
2. Saldo total registrado.
3. Obligaciones pendientes del período.
4. Dinero reservado (presupuestos con fondo, metas).
5. **Disponible para gastar** = saldo líquido confirmado − obligaciones pendientes del período − reservas. Es la cifra protagonista del dashboard y debe poder explicarse paso a paso con un toque.
6. Patrimonio neto (activos − pasivos).
7. Ahorro acumulado.
8. Flujo de caja proyectado.

Cada una tiene su propia función en `domain/`, su definición en `docs/07-modelo-financiero.md` y sus pruebas.

## 4.2. Reglas contables

- **Dinero:** un tipo `Money` basado en enteros. Ningún `float` participa en la contabilidad.
- **Transferencias:** mover dinero entre cuentas propias no es ingreso ni gasto. Transferir a una cuenta de ahorro no infla el gasto del mes.
- **Tarjeta de crédito:** la compra es el gasto y genera un pasivo; el pago de la tarjeta reduce el pasivo y no es un segundo gasto. Intereses y comisiones sí son gastos. Las cuotas son obligaciones futuras.
- **Metas de ahorro:** distinguir reserva presupuestaria (el dinero sigue en la cuenta) de transferencia efectiva a una cuenta de ahorro (el saldo de las cuentas cambia).
- **Ingresos:** variables, previstos o confirmados. En honorarios, permitir registrar bruto, retención y líquido; solo el líquido recibido cuenta como disponible. No calcular obligaciones tributarias automáticamente.
- **Gastos compartidos:** distinguir gasto original, pagador efectivo, participantes, distribución, obligación interna, reembolso y estado de conciliación. Ejemplo canónico: Diego paga $200.000 de un gasto común 50/50 → Diego pagó $200.000, su parte es $100.000, la parte de Pablo es $100.000, saldo interno de $100.000 a favor de Diego hasta que se reembolse.
- **Reparto con resto:** método del mayor resto; los empates se resuelven por orden estable de identificador de participante. La suma de las partes siempre es exactamente el total.
- **Recurrentes:** una regla genera movimientos programados (pendiente, confirmado, vencido, estimado, cancelado). Confirmar uno lo convierte en movimiento real; nunca se contabiliza dos veces.

## 4.3. Invariantes (pruebas de propiedades con fast-check)

- La suma de las partes de cualquier reparto es igual al total, para cualquier monto y cualquier combinación de porcentajes válidos.
- Una transferencia no altera el saldo total ni el gasto del período.
- Compra con tarjeta más pago posterior de la tarjeta suman un solo gasto en los reportes.
- Anular un movimiento devuelve todas las magnitudes al valor previo.
- Los saldos internos del Hogar suman cero entre los miembros.
- Importar el mismo respaldo o paquete dos veces deja la base idéntica.
- Recalcular saldos desde el historial completo da el mismo resultado que los saldos incrementales.

## 4.4. Proyecciones

Motor determinista, sin IA externa.

- Entradas: saldo confirmado, ingresos programados, obligaciones conocidas, gasto variable histórico, supuestos del usuario.
- Horizontes: 7 días, fin de mes, 30, 60 y 90 días.
- Tres escenarios (conservador, central, optimista) definidos por supuestos explícitos y visibles.
- Gasto variable estimado con un método robusto ante valores atípicos (por ejemplo, mediana de los meses disponibles). Con menos de tres meses de historial, se informa la limitación y se proyecta solo con compromisos confirmados.
- Sin intervalos de confianza inventados. Toda proyección separa lo confirmado de lo estimado y permite inspeccionar el cálculo.
- El simulador modifica hipótesis en memoria; jamás toca movimientos reales.

---

# 5. Experiencia móvil

## 5.1. Reglas

- Diseña, programa y prueba primero en 390 × 844. Prueba también 320 × 568, 360 × 800, 375 × 667, 412 × 915 y 430 × 932. Después adapta a 768 × 1024 y 1440 × 900.
- Nunca asumas la altura completa: barras del navegador, teclado virtual, notch, safe areas. Usa unidades de viewport dinámicas y `env(safe-area-inset-*)`.
- Uso a una mano: acciones principales en la zona del pulgar.
- Zonas táctiles de 44 px como mínimo; controles principales de 48 a 56 px.
- Cero desplazamiento horizontal accidental. Cero tablas de escritorio comprimidas.
- Bottom sheets en lugar de modales cuando corresponda.
- Montos con cifras tabulares, sin saltos al actualizarse y sin recortes con cifras grandes.
- Respeta `prefers-reduced-motion` y el texto ampliado. Objetivo: WCAG 2.2 AA.
- El color nunca es el único portador de significado. Todo gráfico tiene un equivalente textual.
- Escritorio: no es un teléfono agrandado al centro. Navegación lateral y mayor densidad, derivadas del diseño móvil.

## 5.2. Navegación

Barra inferior fija con cinco posiciones: **Inicio · Movimientos · Añadir (+, central y dominante) · Metas · Análisis.**

Perfil, ajustes y selector Personal/Hogar van en el encabezado. Ninguna posición principal se gasta en configuración.

## 5.3. Registro rápido (la pantalla más importante)

Meta medible: **registrar un gasto habitual en menos de 10 segundos y con no más de tres toques después de escribir el monto.**

- El botón + abre un bottom sheet con el monto en grande y el teclado numérico ya activo.
- Tipo (gasto, ingreso, transferencia), categorías frecuentes ordenadas por uso, cuenta y fecha con valores por defecto sensatos (última cuenta usada, hoy).
- Detalles opcionales plegados: descripción, gasto compartido (pagador, participantes, porcentajes), recurrencia, etiquetas, notas.
- Al guardar: se actualizan saldo, presupuesto, actividad y proyección; aparece una confirmación con opción de deshacer.
- El formulario sigue siendo usable con el teclado abierto en 320 × 568.
- Protección contra doble toque.

## 5.4. Dashboard

Una columna, en este orden, sin convertirse en un muro de tarjetas:

1. Encabezado: mes, selector Personal/Hogar, avatar, ocultar montos.
2. **Disponible para gastar**, con acceso a «¿cómo se calcula?».
3. Resumen compacto: ingresos, gastos, obligaciones pendientes, ahorro reservado.
4. Próximos compromisos.
5. Presupuestos del mes.
6. Últimos movimientos.
7. Un insight contextual, derivado de datos reales.
8. Progreso narrativo, compacto y al final.

Estados vacíos útiles: un perfil nuevo sin datos debe verse bien e invitar a registrar el primer movimiento.

## 5.5. Resto de pantallas

- **Onboarding:** perfil, cuentas y saldos iniciales, ingresos habituales, arriendo y recurrentes, categorías, primera meta. Todo lo no esencial se puede omitir. Nunca obliga a inventar valores.
- **Movimientos:** lista agrupada por fecha, búsqueda, filtros (fecha, tipo, categoría, cuenta, personal o compartido), edición, anulación, historial de cambios.
- **Hogar:** total del período, aporte de cada uno, saldos internos, reembolsos, exportar e importar paquete.
- **Presupuestos:** por categoría; planificado, usado, disponible, porcentaje y tendencia. Sin imponer reglas financieras universales.
- **Metas:** objetivo, acumulado, fecha opcional, aporte mensual sugerido, historial.
- **Calendario:** agenda cronológica de compromisos, no una grilla mensual comprimida.
- **Análisis:** gasto por categoría, comparación mensual, ingresos contra egresos, evolución de saldo, proyección y simulador. Los gráficos se cargan de forma diferida.
- **Ajustes:** perfiles, cuentas, categorías, modo de humor, sonido, respaldos, reproducir la intro, privacidad, borrar datos.

Categorías iniciales de gasto: arriendo, luz, agua, internet, supermercado, mascotas, veterinario, transporte, suscripciones, salud, ocio, compras, deudas, emergencias, otros. De ingreso: sueldo, honorarios, proyecto, ocasional, reembolso, otros.

## 5.6. PWA

Manifest, iconos (incluido maskable), modo standalone, service worker con precaché del shell, pantalla sin conexión, aviso controlado de nueva versión. La app funciona completa sin conexión después de la primera carga. No prometas capacidades que el navegador no ofrece (sincronización en segundo plano en iOS, notificaciones sin infraestructura).

---

# 6. Identidad narrativa

## 6.1. Premisa

El 9 de noviembre de 2026 Pablo sufre una catástrofe financiera **metafórica**. No se inventa deuda, despido ni hecho biográfico alguno. El humor nace de la distancia entre la grandiosidad de la narración y la banalidad de aprender a presupuestar: ahorrar tratado como una empresa heroica, filosófica y absurdamente burocrática. La historia empieza en el desastre y avanza hacia una recuperación posible. Debe resultar graciosa, inesperada y extrañamente motivadora.

Pablo es el protagonista. En su perfil, el narrador habla de él. En el perfil de Diego, el narrador lo trata como **perito asociado** del caso, y sus finanzas son un «expediente anexo» con el mismo tono. (Propuesta inicial; ajustable.)

## 6.2. La voz

Un interventor financiero demasiado culto para su propio bien. Ingredientes: humor absurdo británico, ironía burocrática, comedia negra, narración detectivesca, filosofía existencial, sátira económica, lenguaje técnico aplicado a situaciones ridículas.

El mecanismo es el contraste: narración épica frente a problema cotidiano; formalidad institucional frente a hecho insignificante; desesperación metafísica frente a la necesidad de ahorrar $2.000.

Prohibido: chistes vulgares o fáciles, frases de autoayuda empresarial, repetir la misma estructura hasta gastarla.

Referencias de tono (úsalas como vara, no como límite):

- Primer ingreso: «Una buena noticia: el sistema ha detectado actividad económica.»
- Primer gasto: «Primer sospechoso identificado. La investigación continúa.»
- Presupuesto configurado: «Por primera vez, tus expectativas y tus ingresos han sido presentados formalmente.»
- Gasto elevado: «Una decisión de notable confianza en el futuro.»
- Compra impulsiva: «El capitalismo agradece tu colaboración.»
- Ahorro conseguido: «Contra todo pronóstico, parte del dinero sigue aquí.»
- Meta alcanzada: «La estadística solicita revisar sus prejuicios.»
- Suscripción: «Un pequeño tributo mensual a algo que quizá recuerdes haber contratado.»
- Mascotas: «Los verdaderos propietarios de esta casa han presentado sus necesidades.»
- Arriendo pagado: «Un mes más de techo. La civilización conserva sus fundamentos.»
- Gastos pequeños repetidos: «Ninguno parecía importante. Juntos han organizado una conspiración.»
- Días sin registrar: «No hemos recibido noticias de tus movimientos. La contabilidad, por desgracia, tampoco.»
- Nuevo mes: «Un nuevo capítulo. Los gastos anteriores no han solicitado permiso para regresar.»
- Primera meta: «Existe ahora un plan. Que nadie entre en pánico.»
- Supermercado: «La civilización ha sobrevivido a imperios, guerras y pandemias. Ahora veremos si Pablo sobrevive al supermercado.»

## 6.3. Humor responsable

- Nunca se bromea con salud, medicamentos, alimentación básica, problemas graves de vivienda, emergencias veterinarias ni situaciones de vulnerabilidad.
- Nunca se castiga ni se ridiculiza un gasto esencial.
- En situaciones financieramente críticas (saldo insuficiente para una obligación próxima), el tono pasa a ser claro y respetuoso, sin ironía. Ejemplo: «Es momento de revisar los compromisos próximos.»
- El humor se ríe de la situación y de la solemnidad del narrador, no de la persona. No equipara riqueza con mérito ni pobreza con culpa.
- Tres modos, elegibles en ajustes: **narrativo** (humor completo), **discreto** (ocasional), **serio** (solo información). La app es plenamente útil en modo serio.

## 6.4. Apertura cinematográfica

Entre 20 y 35 segundos, vertical, con CSS, SVG y Motion (sin video). Se puede saltar desde el primer instante, se muestra una sola vez y se puede reproducir desde ajustes. No bloquea la inicialización de la base de datos. Con movimiento reducido, se presenta como secuencia estática. Estética: expediente secreto, cine noir, interfaz financiera futurista.

1. **Pantalla negra.** Aparece lentamente «9 DE NOVIEMBRE DE 2026». Debajo: «Una fecha que Pablo preferiría olvidar.»
2. **El diagnóstico.** Gráficos abstractos; una línea desciende. «Pablo tenía sueños.» Pausa. «También tenía gastos.» Pausa. «El problema era la diferencia.»
3. **La revelación.** `ANALIZANDO SITUACIÓN FINANCIERA...` `EVALUANDO EXPECTATIVAS...` `CONSULTANDO A LA REALIDAD...` Resultado: «Se recomienda prudencia.» Subtítulo: «Mucha prudencia.» Sin cifras que parezcan saldos reales.
4. **La decisión.** «Había llegado la hora de hacer algo extremo.» Pausa dramática. «Registrar sus gastos.»
5. **El renacimiento.** Una línea luminosa reorganiza los gráficos y aparece el logotipo de NEXO. «Tu dinero merece una segunda oportunidad.» Botón principal: **ACEPTAR MI REALIDAD FINANCIERA**. Acción secundaria: **OMITIR ESTA HUMILLACIÓN**. Ambas entran de inmediato.

## 6.5. Capítulos

Progresión simbólica ligada a acciones reales. Todas las funciones están disponibles aunque no se complete ningún capítulo.

| Capítulo | Título | Se desbloquea al |
|---|---|---|
| I. El diagnóstico | «Reconocer los hechos.» | Completar el onboarding: cuentas e ingresos y gastos iniciales. |
| II. El inventario de daños | «Todo tiene un precio.» | Configurar arriendo, servicios y recurrentes. |
| III. La resistencia | «El arte de conservar un peso.» | Definir un presupuesto y una meta de ahorro. |
| IV. La reconstrucción | «La lenta recuperación del patrimonio.» | Registrar movimientos de forma sostenida y avanzar en una meta. |
| V. La dignidad contable | «Un individuo razonablemente solvente.» | Mantener el registro y revisar el análisis mensual. |

Las condiciones dependen de hábitos de registro, nunca de cuánto dinero se tiene. La estructura admite capítulos futuros. Cada capítulo tiene una portada editorial.

## 6.6. Logros

Insignias de expediente, sobrias y originales en SVG. Sin rachas, sin castigos, sin mecánicas adictivas, sin recompensas monetarias ficticias.

- **Testigo de sus propios gastos:** registrar cinco movimientos.
- **El contable involuntario:** completar un presupuesto.
- **El sobreviviente del arriendo:** registrar una obligación de arriendo.
- **La conspiración de las suscripciones:** identificar varios servicios recurrentes.
- **Primer acto de resistencia:** registrar un aporte real de ahorro.
- **Enemigo del gasto invisible:** revisar los gastos pequeños recurrentes.
- **Patrimonio bajo investigación:** consultar el análisis mensual.

Propón otros diez en la misma línea.

## 6.7. NarrativeEngine

Módulo puro: recibe un evento y un contexto derivado, y devuelve un mensaje o nada.

- Eventos: primera apertura, gasto creado, ingreso creado, pago recurrente, meta creada, meta alcanzada, cambio de mes, gasto extraordinario, presupuesto definido, presupuesto excedido, consulta de análisis, días sin registrar, gasto de mascotas, arriendo pagado.
- Cada entrada del catálogo tiene: id, evento, condiciones, intensidad, variantes, prioridad, frecuencia máxima, condiciones de exclusión y alternativa seria.
- Exclusiones automáticas: categorías sensibles, situación crítica, modo serio, mensaje equivalente mostrado hace poco.
- Selección determinista dado un estado y una semilla, para poder probarla.
- La mayoría de los registros **no** produce comentario. El silencio es parte del ritmo: el humor no invade todas las pantallas.

## 6.8. Catálogo de microcopy

Al menos 100 mensajes originales, cada uno con variantes y alternativa seria, en un archivo de datos tipado y validado con Zod. Además: estados vacíos, errores, confirmaciones y textos de ajustes con la misma voz.

Pruebas automáticas del catálogo: ids únicos, toda entrada tiene alternativa seria, ninguna entrada humorística está asociada a una categoría sensible, ningún texto contiene cifras fijas que puedan confundirse con datos.

Revisión editorial: después de escribirlo, pásalo por el subagente guionista con una sola pregunta por frase: ¿esto es ingenioso o solo es una frase con forma de chiste? Reescribe lo segundo.

## 6.9. Informe forense de fin de mes (V1.1)

«Informe forense del patrimonio»: resumen real del mes presentado como expediente, con ingresos, gastos, ahorro, categorías principales, recurrentes, comparación con el mes anterior y compromisos futuros. Solo afirma lo que los datos confirman. Sin datos suficientes: «No hay pruebas suficientes para emitir una sentencia financiera.» Tarjeta compartible con montos ocultos por defecto; nada se comparte sin acción explícita.

---

# 7. Dirección de arte

**Concepto: Neo-Noir Financial Editorial.** Fintech premium, minimalismo oscuro, diseño editorial cinematográfico, motivos de expediente y glassmorphism controlado. Debe verse profesional incluso sin un solo elemento humorístico, y no debe parecer una plantilla genérica.

**Paleta inicial** (como tokens semánticos; verifica el contraste AA de cada par texto/fondo):

| Token | Valor |
|---|---|
| Obsidiana (fondo) | `#080B12` |
| Azul nocturno (fondo elevado) | `#101827` |
| Gris carbón (superficie) | `#192130` |
| Blanco suave (texto) | `#F4F3F0` |
| Gris texto (secundario) | `#9FA8B8` |
| Verde esmeralda (positivo) | `#46D3A5` |
| Violeta apagado (acento) | `#8779DA` |
| Ámbar editorial (narrativa, atención) | `#D9AD67` |
| Rojo advertencia | `#ED7779` |
| Borde translúcido | `rgba(255,255,255,0.08)` |

**Glassmorphism** solo donde aporta jerarquía: hero de saldo, barra inferior, bottom sheets, selector de período, paneles de proyección. Fondos opacos en formularios, listas densas y gráficos. La legibilidad manda. Cuida el costo de `backdrop-filter` en teléfonos modestos.

**Espaciado:** escala de 4 y 8 px. Padding horizontal de 16 a 20 px; separación entre secciones de 20 a 28 px. No todo lleva esquinas muy redondeadas.

**Identidad gráfica:** desarrolla en SVG tres conceptos de logotipo: (A) wordmark fintech minimalista; (B) «NEXO / Archivo 09.11», identidad de expediente; (C) monograma abstracto de continuidad y flujo. Recomienda uno para el icono de la PWA.

**Ilustración:** original, ligera, en SVG y CSS. Objetos cotidianos como evidencia: recibos, sobres, monedas, carpetas, sellos. Pablo se representa de forma simbólica, nunca como retrato. Nada de personas sonrientes con monedas.

**Motion:** transiciones entre vistas, apertura de sheets, aparición de un movimiento recién guardado, progreso de metas, cambio de mes, dibujo progresivo de gráficos, logros discretos. Rápidas, con propósito, y nunca bloquean una operación.

**Sonido (opcional, V1.1):** identidad discreta de aire noir, solo con recursos originales o de licencia apropiada. Desactivado por defecto; jamás se reproduce sin interacción.

---

# 8. Investigación (acotada)

La investigación sirve para decidir, no para acumular. Límite: un documento, `docs/01-investigacion.md`, y las decisiones abiertas de la sección 1 resueltas.

Repositorios a revisar directamente (README, licencia, `package.json`, estructura, pruebas, fecha del último mantenimiento):

- https://github.com/actualbudget/actual
- https://github.com/spliit-app/spliit
- https://github.com/simplesuite/simplebudget
- https://github.com/gammaSpeck/expense-tracker
- https://github.com/momentmaker/pancakemaker
- https://github.com/jared00007/finance-tracker
- https://github.com/jameskokoska/Cashew
- https://github.com/flow-mn/flow
- https://github.com/HabitRPG/habitica (solo principios de gamificación)

Busca dos o tres proyectos más que usen Dexie o IndexedDB con PWA. Como referencia funcional, no de código ni de gráficos: YNAB, Copilot Money, Monzo, Splitwise.

Para cada uno, en una tabla: qué hace realmente, cómo registra un movimiento y con cuántas interacciones, cómo modela presupuestos y gastos compartidos, cómo persiste, licencia, estado de mantenimiento, y qué tomamos (patrón, algoritmo o nada).

**Restricción de licencias:** no copies código GPL o AGPL. Sin licencia verificable, no hay reutilización. Lo previsible es tomar patrones e ideas, no código; si propones reutilizar código, justifícalo con la licencia a la vista.

Si un repositorio no existe o no es accesible, dilo y sigue.

---

# 9. Plan por fases

Cada fase termina con `npm run verify` en verde, `docs/ESTADO.md` actualizado y un commit.

| Fase | Contenido | Criterio de salida |
|---|---|---|
| **0. Arranque** | Sección 2.1. | Inventario y archivos de memoria creados. |
| **1. Investigación y decisiones** | Sección 8 y ADR de las decisiones abiertas. | `docs/01-investigacion.md` y ADR listos. **PARADA.** |
| **2. Dominio financiero** | Proyecto inicializado. `domain/` completo con desarrollo guiado por pruebas: Money, cuentas, movimientos, transferencias, tarjeta, repartos, reembolsos, recurrentes, presupuestos, metas, magnitudes de la sección 4.1. | Pruebas unitarias y de propiedades de la sección 4.3 en verde. Revisión del subagente financiero sin hallazgos abiertos. |
| **3. Datos locales** | Esquema Dexie, migraciones, repositorios, auditoría, perfiles, dataset Demo, exportación e importación JSON validadas. | Prueba de ida y vuelta: exportar → borrar → importar deja la base idéntica. |
| **4. Rebanada vertical** | Sistema de diseño, navegación, dashboard real y registro rápido, conectados a IndexedDB. | Flujo E2E en verde: abrir → registrar gasto → ver saldo y lista actualizados → recargar → los datos siguen ahí. Capturas en los seis viewports móviles, revisadas. **PARADA con capturas.** |
| **5. Finanzas completas** | Onboarding, movimientos con filtros y edición, recurrentes, calendario, presupuestos, metas. | Cada flujo con su E2E y sus capturas. |
| **6. Narrativa** | Intro, NarrativeEngine, catálogo de 100 mensajes o más, capítulos, logros, modos de humor, identidad gráfica. | Pruebas del motor y del catálogo en verde. La app completa es usable en modo serio. |
| **7. Hogar** | Gastos compartidos, saldos internos, reembolsos, paquete Hogar con fusión determinista. | Prueba: dos bases independientes intercambian paquetes y convergen al mismo estado. |
| **8. Análisis** | Gráficos, comparaciones, proyección por escenarios, simulador. | Proyecciones con detalle inspeccionable. Gráficos legibles a 320 px. |
| **9. Calidad y PWA** | Service worker, modo sin conexión, instalación, exportación CSV, recordatorios de respaldo, accesibilidad, rendimiento, revisión de dependencias. | Funciona sin conexión tras la primera carga. Auditoría de accesibilidad sin fallos críticos. |
| **10. Publicación** | README, documentación, CI en GitHub Actions (verify + e2e), configuración de Vercel. | **PARADA antes de crear el repositorio remoto, hacer push o desplegar.** |

V1.1, después: informe forense, importación de cartolas CSV con vista previa y detección de duplicados, sonido, respaldo cifrado si quedó pendiente, más eventos narrativos.

---

# 10. Pruebas

**Dominio (Vitest + fast-check):** ingreso, gasto, transferencia, reserva de ahorro, transferencia efectiva a ahorro, recurrentes, compra con tarjeta, pago de tarjeta, cuotas, gasto compartido 50/50 y 70/30, reembolso parcial y total, anulación, importación duplicada, ingresos variables, saldo proyectado, y todas las invariantes de la sección 4.3. Los cálculos cuadran al peso.

**Datos:** migraciones entre versiones, transaccionalidad, idempotencia, ida y vuelta de respaldos, fusión de paquetes Hogar, separación entre perfiles.

**Narrativa:** exclusiones por categoría sensible y situación crítica, límites de frecuencia, modo serio, integridad del catálogo.

**Móvil (Playwright, seis viewports):** sin overflow horizontal, navegación visible, sheets usables, montos sin recortes, formulario usable con teclado abierto, estados vacíos, de carga y de error, navegación por teclado. Emula además WebKit móvil; si hay dispositivos reales disponibles, úsalos, y si no, déjalo anotado como pendiente.

**Visual:** capturas de cada pantalla, revisadas una por una. Nunca afirmes que algo se ve bien sin haberlo mirado.

---

# 11. Documentación

Breve, útil y al día. Sin relleno.

- `README.md`: qué es, cómo correrlo, cómo probarlo, cómo desplegarlo, advertencia sobre datos locales.
- `CLAUDE.md` y `docs/ESTADO.md`: memoria viva del proyecto.
- `docs/00-inventario-herramientas.md`
- `docs/01-investigacion.md`
- `docs/02-identidad-narrativa.md` (incluye la biblia de humor)
- `docs/03-storyboard-mobile.md`
- `docs/04-design-system.md`
- `docs/05-arquitectura-local-first.md`
- `docs/06-privacidad-y-respaldos.md`
- `docs/07-modelo-financiero.md`
- `docs/08-testing.md`
- `docs/09-despliegue.md` (GitHub privado + Vercel estático, paso a paso)
- `docs/10-roadmap.md` (V1.1 y una V2 con sincronización, solo planificada)
- `docs/adr/`

El catálogo de microcopy vive en el código; no lo dupliques en un documento.

---

# 12. Criterios de aceptación de V1

1. La intro del 9 de noviembre funciona, se puede omitir y se puede reproducir.
2. Se registran ingresos, gastos y transferencias reales, y persisten al cerrar y abrir.
3. Saldos, presupuestos y «Disponible para gastar» son correctos y explicables.
4. Existen recurrentes, compromisos futuros, presupuestos y metas.
5. Hay categorías de arriendo y mascotas desde el inicio.
6. El dashboard solo usa datos de IndexedDB.
7. Los perfiles de Pablo y Diego están diferenciados, con sus limitaciones informadas.
8. El Hogar permite repartir gastos e intercambiar paquetes sin duplicar ni perder datos.
9. El humor es contextual, variado, configurable y desactivable.
10. La app es plenamente útil en modo serio.
11. Hay exportación, importación y recuperación de respaldos, probadas.
12. Funciona sin conexión tras la primera carga y se puede instalar como PWA.
13. Se ve y se usa bien en los seis viewports móviles, verificado con capturas.
14. Las operaciones financieras críticas tienen pruebas automatizadas en verde.
15. Compila y se despliega en Vercel como sitio estático, **sin Supabase ni ningún otro backend**.
16. El repositorio no contiene secretos ni datos financieros reales.
17. Los datos de demostración están identificados como ficticios y aislados.
18. Las proyecciones separan lo confirmado de lo estimado.

---

# 13. Fuera de alcance en V1

No lo implementes ni agregues dependencias pensando en ello: backend, autenticación real, sincronización automática, notificaciones push, OCR de comprobantes, clasificación con IA, conexión con bancos, multimoneda, publicidad, analítica de terceros.

---

# 14. Comienza

Ejecuta ahora la fase 0 y continúa con la fase 1 hasta su parada. No termines después de presentar un plan: desde la fase 2 en adelante, construye.

**La tragedia ya ocurrió. Ahora toca llevar las cuentas.**
