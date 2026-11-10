# Estado del proyecto

**Última actualización:** 10 de noviembre de 2026 (PC 1).

## Dónde estamos

**Fase 2 (dominio financiero) terminada.** Sigue la **fase 3 · Datos locales**.

- Repositorio: `github.com/dojedacifuentes/pobrepablo`, **público** por decisión del propietario (ADR 0008).
- Vercel: el proyecto quedó preparado para importarse, pero **no está publicado**. Al pulsar «Deploy», Vercel pidió
  verificar la identidad con un código enviado al correo del propietario; ese paso lo hace él.

## Hecho

- **Fases 0 y 1:** memoria del proyecto, inventario, investigación y ocho ADR aceptados.
- **Fase 2:**
  - Proyecto inicializado con las versiones del ADR 0006. `npm run verify` y `npm run e2e` existen.
  - `src/domain/`: dinero, fechas, reparto, cuentas, movimientos, saldos, reportes, tarjeta, recurrentes, presupuestos,
    metas, Hogar (con la coherencia de sus registros pareados y la cobertura de gastos programados), obligaciones,
    magnitudes, proyección y pronóstico. Cómo calcula cada cifra: `docs/07-modelo-financiero.md`.
  - **210 pruebas** unitarias y de propiedades en verde, también con 2.000 a 4.000 casos aleatorios por propiedad.
  - **Comprobación de mutaciones:** se rompió el dominio a propósito en 53 puntos, uno a la vez, y las pruebas
    detectaron los 53.
  - **Revisión independiente**, dos pasadas del `revisor-financiero`:
    - Primera: 16 hallazgos (ninguno de aritmética). Corregidos.
    - Segunda: ninguno crítico; 3 importantes y 6 menores, nacidos de las correcciones. Corregidos los 3 importantes y
      los menores que tenían corrección; el resto quedó documentado como decisión (ver abajo).
  - `vercel.json` listo (sitio estático con rewrite a `index.html`).

## Qué sigue: fase 3 · Datos locales

Ver `docs/PLAN.md`. Tareas que la revisión dejó expresamente para esta fase:

1. **Índice único por (regla, fecha)** en los movimientos que confirman una ocurrencia, para que dos confirmaciones
   simultáneas no pasen. El dominio ya rechaza la segunda cuando ve la primera.
2. **Los dos lados de un registro del Hogar en la misma transacción**, y ejecutar `householdLedgerIssues` (con la fecha
   en que la persona empezó a registrar) antes de guardar y después de importar un paquete.
3. **Solo ofrecer `rescheduleRule`** para cambiar el calendario de una regla; nunca editar su fecha de inicio.
4. **Pasar siempre las categorías** a `validateTransaction`.
5. Repetir la prueba «recalcular = incremental» contra los saldos guardados, y la de «importar dos veces».
6. Al confirmar un recurrente como pago de gasto compartido, registrar el gasto compartido en la misma operación.

Para la interfaz (fases 5 y 7): preguntar «¿es el mismo gasto?» con `coverageCandidates`; ofrecer la conversión de una
reserva en transferencia (`fulfilReservation`); permitir saltarse en bloque los vencidos antiguos.

## Lo que no está verificado

- Nada se ha probado en un teléfono real ni en WebKit (se instala en la fase 4).
- En un iPhone: el traspaso de datos de Safari a la app instalada y el comportamiento de `persist()` (ADR 0007).
- El despliegue en Vercel: la configuración está escrita, pero no se ha desplegado.
- La app todavía no tiene pantallas: solo un aviso de «en construcción».
- Las correcciones de la segunda pasada no las revisó un tercero: las cubren las pruebas y las mutaciones, pero no
  hubo tercera pasada del revisor.
- Los generadores aleatorios no enlazan pagos compartidos con los eventos del hogar dentro de una situación completa
  (se prueba aparte).

## Decisiones para revisar con el propietario

- **El período es el mes calendario.** Lo que vence el día 1 no se descuenta el día 30 (salvo la tarjeta, que siempre
  incluye su próxima cuenta). Alternativa: una ventana hasta el próximo ingreso.
- **Los vencidos no caducan.** Un recurrente que nunca se confirmó sigue contando como deuda hasta confirmarlo o
  saltárselo. Pausar una regla oculta también sus vencidos.
- **El peso sobrante de un reparto empatado** le toca siempre a la misma persona (lo fija la especificación).
- **Un arriendo compartido y además programado** aparece dos veces en el teléfono de quien no pagó hasta que confirma
  «es el mismo gasto». El dominio no lo adivina solo.
- **Subir cada fase a GitHub al cerrarla:** se hizo con la fase 2 porque el propietario lo pidió; para las siguientes
  falta su indicación.

## Problemas conocidos y bloqueos

- GitHub CLI y CLI de Vercel no están instalados. El push funciona con las credenciales de Git de este equipo.
- Playwright solo tiene Chromium. WebKit se instala en la fase 4.
- Las próximas sesiones deben abrirse en `Desktop\nexo`.
