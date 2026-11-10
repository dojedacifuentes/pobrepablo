# Estado del proyecto

**Última actualización:** 10 de noviembre de 2026 (PC 1).

## Dónde estamos

**Fases 3 (datos locales) y 4 (primeras pantallas) terminadas, subidas y publicadas** el 10 de noviembre de 2026, con
el «sí, publícala» del propietario. La app que está en línea ya es la de verdad, no el aviso «en construcción».

- Repositorio: `github.com/dojedacifuentes/pobrepablo`, **público** (ADR 0008).
- Vercel: **publicado** en `https://pobrepablo.vercel.app`, conectado al repositorio: cada push a `main` se publica.
- En GitHub están la fase 3 (`69a8e46`) y la fase 4 (`6bd0459`).
- **Comprobado sobre el sitio publicado** (no sobre este computador), en Chromium a 390 × 844 y 320 × 568 y en WebKit
  emulado a 390 × 844: abre, entra al perfil Demo, registra un gasto de $1.500 en «Compras», «Disponible para gastar»
  baja de $2.522.399 a $2.520.899, el gasto aparece en Movimientos, un enlace directo a `/movimientos` funciona, todo
  sigue ahí al recargar, no hay desborde horizontal, la tipografía Inter carga, y no hubo ningún error de consola ni
  archivo faltante.
- Una aclaración que salió de esa prueba: un gasto en una categoría **con presupuesto ya apartado** (en la Demo,
  «Transporte» o «Supermercado») no baja «Disponible para gastar», porque esa plata ya estaba descontada. Es lo
  correcto, y conviene que la interfaz lo explique en el momento (queda anotado para la fase 5).

## Hecho

- **Fases 0, 1 y 2:** memoria del proyecto, investigación, ocho ADR aceptados y el dominio financiero con 210 pruebas.
- **Fase 3 · Datos locales** (`src/data/`, `docs/05-arquitectura-local-first.md`, `docs/06-privacidad-y-respaldos.md`,
  ADR 0009):
  - Una base de datos por perfil (Pablo, Diego, Demo). Esquema versionado, con la maquinaria de migraciones probada.
  - Operaciones todo o nada, claves de idempotencia, anulación con rastro, auditoría de solo agregado.
  - Perfil Demo con datos inventados y aislados.
  - Respaldo: exportar e importar con validación, cifrado AES-256-GCM (ADR 0004), verificación al exportar.
  - `persist()`, marcador de pérdida de datos (ADR 0007), hooks de lectura reactiva (ADR 0003).
  - Las seis tareas que dejó la revisión de la fase 2, todas hechas (ver `docs/05`).
  - **170 pruebas** de la capa de datos (391 en todo el proyecto).
  - **Comprobación de mutaciones**, dos pasadas: el código se rompió a propósito, un punto a la vez. La segunda, ya
    con las correcciones de la revisión, fueron 111 roturas y las pruebas detectan las 111 (5 de ellas obligaron
    antes a reforzar pruebas; en la primera pasada habían sido 7 de 82).
  - **Revisión independiente:** 18 hallazgos (1 crítico, 7 importantes, 10 menores). Todos corregidos, cada uno con
    su prueba en `src/data/review.test.ts`.
  - **Una prueba de la fase 2 fallaba por azar** cerca de una de cada tres corridas (necesitaba un caso que el
    generador aleatorio producía 1 de cada 100 veces). Se corrigió su generador; la lógica del dominio no se tocó.
- **Fase 4 · Rebanada vertical** (`src/ui/`, `src/features/`, `src/app/`, `docs/03-storyboard-mobile.md`,
  `docs/04-design-system.md`, ADR 0010):
  - Sistema de diseño: paleta con contraste AA comprobado por prueba, dos tipografías autoalojadas, componentes base,
    hoja inferior.
  - Barra inferior de cinco posiciones, elección de perfil, inicio con «Disponible para gastar» y su explicación,
    registro rápido con teclado propio y «Deshacer», lista de movimientos del mes, primera cuenta.
  - Todo conectado a la base de datos del teléfono: ninguna cifra de ejemplo fuera del perfil Demo.
  - `npm run capturas`: 17 pantallas en 8 tamaños, en `capturas/`. Las que muestran cifras usan siempre la Demo.
  - Un defecto encontrado midiendo tiempos y ya corregido: el aviso «Gasto registrado» quedaba encima de la hoja
    siguiente y tapaba la fila inferior del teclado durante seis segundos.
  - **Auditoría independiente de las capturas** (subagente `auditor-movil`): nada bloqueante entre 360 y 430 px de
    ancho; 4 mejoras importantes y 12 menores. Corregidas las 4 importantes (barras opacas, el botón dice qué falta,
    nombres de cuenta menos cortados, teclas más altas donde caben) y 8 menores. El auditor no alcanzó a respaldar
    los tamaños 320 × 568 y 390 × 844: esos los miré yo en las pantallas principales, no en las 17.
  - Flujo de punta a punta: **56 pruebas en verde** (7 recorridos en los seis tamaños de teléfono con Chromium y en
    dos tamaños con WebKit emulado): abrir → crear cuenta → registrar un gasto → saldo y lista actualizados → recargar
    → los datos siguen ahí; deshacer; doble toque; ingreso y «¿cómo se calcula?»; Demo aislada; y que un aviso en
    pantalla no tape el teclado.

## Qué sigue

1. **Que el propietario pruebe la app publicada en su teléfono** (con el perfil Demo) y diga qué le parece.
2. **Su decisión sobre los ADR 0009 y 0010**, que siguen como «propuesta».
3. **Fase 5 · Finanzas completas** (ver `docs/PLAN.md`). Lo primero, porque hoy falta: **exportar y restaurar
   respaldos desde la app**, y el onboarding. No se empieza sin que el propietario lo pida.

Tareas que las fases 3 y 4 dejaron para más adelante:

- Fase 5: cuando un gasto cae en una categoría con presupuesto ya apartado, decir en el aviso que «Disponible para
  gastar» no cambia y por qué (hoy solo lo explica «¿Cómo se calcula?»).
- Fase 5: eliminación definitiva de un movimiento, como acción explícita con advertencia. «Deshacer anular».
- Fase 5: pedir `persist()` y mostrar su resultado y el espacio usado en Ajustes (hoy se pide al primer guardado y
  se guarda la respuesta, pero no se muestra).
- Fase 5: en el registro rápido, escribir montos con el teclado del computador solo funciona con el foco dentro del
  formulario.
- Fase 5, de la auditoría de capturas: dos cuotas de la misma tarjeta con la misma fecha se ven iguales salvo por el
  monto (convendría agruparlas en «la cuenta de la tarjeta», calculada por el dominio); «y 2 compromisos más» no
  lleva a ninguna parte; en el estado vacío el botón queda arriba, lejos del pulgar; el aviso de «guardado» tapa
  unos segundos el final de la pantalla en teléfonos bajos.
- Fase 9: política del recordatorio de respaldo (ya existe la cuenta de cambios sin respaldar).
- Fase 9: dividir el JavaScript (hoy es un solo archivo de unos 190 kB comprimido) y precargar solo el subconjunto
  latino de las fuentes.
- Escritorio y tableta: hoy es la columna del teléfono centrada.
- Para la interfaz (fases 5 y 7): preguntar «¿es el mismo gasto?» con `coverageCandidates`; ofrecer la conversión de
  una reserva en transferencia (`fulfilReservation`); permitir saltarse en bloque los vencidos antiguos.

## Lo que no está verificado

- **Nada se ha probado en un teléfono real.** Chromium y WebKit se emulan en este computador, también en la prueba
  del sitio publicado.
- **La app publicada todavía necesita internet para abrir** y no se instala en la pantalla de inicio: eso es la fase 9.
  Los datos sí quedan guardados en el teléfono entre una visita y otra.
- En un iPhone: el traspaso de datos de Safari a la app instalada y el comportamiento de `persist()` (ADR 0007).
- La capa de datos contra navegadores reales: los nombres de los errores de «sin espacio» y de modo privado, y varias
  pestañas abiertas a la vez.
- El rendimiento con miles de movimientos. Cada escritura revisa el libro del hogar completo.
- Los hooks de React no tienen prueba propia: los ejercita el flujo de punta a punta.
- En WebKit emulado cada operación tarda entre tres y cinco veces más que en Chromium (alrededor de un segundo al
  guardar). No se sabe cuánto tarda en un iPhone de verdad.
- Las correcciones de la revisión de la fase 3 no las revisó un tercero: las cubren sus pruebas y las mutaciones.
- La accesibilidad no se auditó (fase 9). Se cuidó el contraste, el tamaño de las zonas táctiles y el foco.

## Avisos importantes para usar la app hoy

- **Todavía no se pueden exportar respaldos desde la app.** Conviene probarla con el perfil Demo y no cargar finanzas
  reales hasta la fase 5. La app lo dice en la primera pantalla.
- **En un iPhone sin instalar, la detección de pérdida de datos no sirve** para el borrado de siete días de Safari:
  ese borrado se lleva también la nota que la app deja (ver `docs/06`). La defensa es instalar y respaldar.

## Decisiones para revisar con el propietario

- **ADR 0009:** restaurar un respaldo deja una entrada en la auditoría. Por eso «exportar → borrar → importar» deja
  la base idéntica **más esa entrada**, y no exactamente idéntica como decía el plan. Importar dos veces sí deja la
  base idéntica. La alternativa (no dejar entrada) incumple que la importación quede auditada.
- **ADR 0010:** teclado numérico propio en el registro rápido y hojas opacas.
- **El período es el mes calendario.** Lo que vence el día 1 no se descuenta el día 30 (salvo la tarjeta, que siempre
  incluye su próxima cuenta). Alternativa: una ventana hasta el próximo ingreso.
- **Los vencidos no caducan.** Un recurrente que nunca se confirmó sigue contando como deuda hasta confirmarlo o
  saltárselo. Pausar una regla oculta también sus vencidos.
- **El peso sobrante de un reparto empatado** le toca siempre a la misma persona (lo fija la especificación).
- **Un arriendo compartido y además programado** aparece dos veces en el teléfono de quien no pagó hasta que confirma
  «es el mismo gasto». El dominio no lo adivina solo.
- **Subir cada fase a GitHub al cerrarla:** las fases 3 y 4 se subieron el 10-nov-2026 con su «sí». Ese permiso fue
  para esas dos fases: la fase 5 vuelve a necesitar el suyo.

## Problemas conocidos y bloqueos

- GitHub CLI y CLI de Vercel no están instalados. El push funciona con las credenciales de Git de este equipo.
- `npm audit` avisa de `minimatch` dentro de ESLint (herramienta de desarrollo, no llega al sitio).
  `npm audit --omit=dev` da cero. No se usa `npm audit fix --force`: bajaría ESLint de versión.
- Las próximas sesiones deben abrirse en `Desktop\nexo`.
