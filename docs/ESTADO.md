# Estado del proyecto

**Última actualización:** 10 de noviembre de 2026 (PC 1).

## Dónde estamos

**Fase 2 (dominio financiero) en cierre.** El código y sus pruebas están escritos y en verde. Falta la segunda pasada
del revisor independiente y poner al día `docs/07-modelo-financiero.md` con las correcciones.

Repositorio: `github.com/dojedacifuentes/pobrepablo`, **público** por decisión del propietario (ADR 0008).

## Hecho

- **Fases 0 y 1:** memoria del proyecto, inventario, investigación y ocho ADR aceptados.
- **Fase 2:**
  - Proyecto inicializado con las versiones del ADR 0006. `npm run verify` y `npm run e2e` existen.
  - `src/domain/`: dinero, fechas, reparto, cuentas, movimientos, saldos, reportes, tarjeta, recurrentes, presupuestos,
    metas, Hogar (y la coherencia de sus registros pareados), obligaciones, magnitudes, proyección y pronóstico.
  - 195 pruebas (unitarias y de propiedades) en verde, también con 4.000 casos aleatorios por propiedad.
  - Comprobación de mutaciones: se rompió el dominio en 39 puntos y las pruebas detectaron los 39.
  - Revisión independiente del `revisor-financiero`: 16 hallazgos, todos corregidos en el código y con pruebas.
  - `vercel.json` listo (sitio estático con rewrite a `index.html`).

## Qué corrigió la revisión (resumen)

1. Un movimiento no puede tener fecha futura; uno que la tenga no esconde la obligación que dice pagar.
2. Lo comprado con tarjeta baja lo disponible de inmediato, igual que con débito; la tarjeta admite día de facturación.
3. Un gasto compartido que además es recurrente ya no se cuenta dos veces.
4. Los dos lados de un registro del Hogar se crean y anulan juntos, y hay una revisión que detecta pares descuadrados.
5. No se puede confirmar dos veces la misma ocurrencia.
6. No se arrastran obligaciones anteriores al saldo inicial de una cuenta.
7. Cambiar el calendario de una regla conserva lo ya confirmado.
8. El lector de montos rechaza «1500.50» en vez de leerlo como 150.050.
9. Convertir una reserva de meta en transferencia no cuenta el ahorro dos veces.
10. La proyección descuenta el gasto con tarjeta cuando se paga la tarjeta, no el día de la compra.

## Qué sigue

1. Segunda pasada del revisor sobre las correcciones. La fase 2 se cierra sin hallazgos abiertos.
2. Actualizar `docs/07-modelo-financiero.md`.
3. **Fase 3 · Datos locales** (`docs/PLAN.md`). Tareas que la revisión dejó para esa fase:
   - Índice único por (regla, fecha) para que dos confirmaciones simultáneas no pasen.
   - Guardar los dos lados de un registro del Hogar en la misma transacción y ejecutar `householdLedgerIssues`.
   - Repetir la prueba «recalcular = incremental» contra los saldos guardados.

## Lo que no está verificado

- Nada se ha probado en un teléfono real ni en WebKit (se instala en la fase 4).
- En un iPhone: el traspaso de datos de Safari a la app instalada y el comportamiento de `persist()` (ADR 0007).
- El despliegue en Vercel: la configuración está escrita, pero no se ha desplegado.
- La app todavía no tiene pantallas: solo un aviso de «en construcción».

## Decisiones para revisar con el propietario

- **El período es el mes calendario.** Lo que vence el día 1 no se descuenta el día 30 (salvo la tarjeta, que siempre
  incluye su próxima cuenta). Alternativa: una ventana hasta el próximo ingreso.
- **Los vencidos no caducan.** Un recurrente que nunca se confirmó sigue contando como deuda hasta confirmarlo o
  saltárselo. Pausar una regla oculta también sus vencidos.
- **El peso sobrante de un reparto empatado** le toca siempre a la misma persona (lo fija la especificación).

## Problemas conocidos y bloqueos

- GitHub CLI y CLI de Vercel no están instalados. El push funciona con las credenciales de Git de este equipo.
- Playwright solo tiene Chromium. WebKit se instala en la fase 4.
- Las próximas sesiones deben abrirse en `Desktop\nexo`.
