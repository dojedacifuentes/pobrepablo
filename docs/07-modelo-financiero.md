# Modelo financiero

Cómo calcula NEXO cada cifra. Todo lo que aquí se describe vive en `src/domain/` y está cubierto por pruebas; la
interfaz no calcula nada, solo muestra lo que estas funciones devuelven.

## Principios

- **Pesos enteros.** El tipo `Money` rechaza cualquier número que no sea un entero. Los repartos y proporciones se
  calculan con aritmética exacta (`BigInt`) y un redondeo siempre explícito.
- **Días de calendario.** Las fechas son `YYYY-MM-DD` en hora de Chile. El dominio no lee el reloj: recibe «hoy».
- **Todo se deriva del historial.** Ningún saldo, deuda ni reserva es un dato guardado: se recalcula desde los
  movimientos. Así no hay dos versiones de la verdad.
- **Anular no borra.** Un movimiento anulado queda en el historial y deja de contar en todas las cifras.
- **Un movimiento es algo que ya pasó.** No se aceptan movimientos con fecha futura: lo que todavía no ocurre se
  programa. Si aun así existiera uno (un archivo importado, un reloj mal puesto), no cuenta hasta que llega su día y
  **no esconde** la obligación que dice pagar.
- **No se adivina un monto.** El lector de montos acepta el punto solo como separador de miles bien formado
  (`1.250.000`). «1500.50» o «1.5» se rechazan, en vez de leerse como 150.050 o 15.

## Cuentas

| Tipo | Clase | Qué es |
|---|---|---|
| Efectivo, cuenta corriente o vista | **Líquida** | Dinero que se puede gastar hoy. |
| Cuenta de ahorro | **Ahorro** | Es patrimonio, pero no cuenta como saldo para gastar. |
| Tarjeta de crédito | **Pasivo** | Su saldo es cero o negativo: lo que se debe. |

Cada cuenta parte de un saldo inicial en una fecha. Un movimiento anterior a esa fecha se rechaza, y un recurrente no
genera obligaciones anteriores a ella: el saldo inicial ya incluye todo lo que pasó antes.

Una cuenta archivada se oculta de las listas, pero su saldo sigue contando: archivar no hace desaparecer plata.

Una tarjeta puede tener **día de pago** y **día de facturación** (cierre). Con ambos, lo comprado después del cierre
pasa a la cuenta siguiente. Sin día de facturación, se asume que toda compra entra en la próxima cuenta, que es la
lectura prudente.

## Movimientos

| Tipo | Efecto en las cuentas | ¿Es gasto? | ¿Es ingreso? |
|---|---|---|---|
| Gasto | Baja la cuenta. En una tarjeta, aumenta la deuda. | Sí, en la fecha de la compra | No |
| Ingreso | Sube la cuenta por el monto **líquido** recibido | No | Sí |
| Transferencia | Baja una cuenta propia y sube otra | No | No |
| Pago de un gasto compartido | Baja la cuenta de quien pagó por el hogar | No (ver Hogar) | No |
| Reembolso del hogar | Baja o sube la cuenta | No | No |
| Ajuste de saldo | Corrige la cuenta, con signo | No | No |

- **Pagar la tarjeta es una transferencia** hacia la tarjeta: baja la deuda y no es un segundo gasto.
- **Intereses y comisiones** de la tarjeta se registran como gastos en la tarjeta: sí son gasto y aumentan la deuda.
  El interés de una compra en cuotas no se calcula: se registra cuando el banco lo cobra.
- **Honorarios:** se pueden anotar el bruto y la retención, pero el monto del ingreso es el líquido, y debe cumplirse
  bruto − retención = líquido. No se calcula ningún impuesto.
- Una devolución abonada a la tarjeta se registra como ingreso en la tarjeta y baja la deuda.

## Las ocho magnitudes

| # | Magnitud | Definición | Función |
|---|---|---|---|
| 1 | Saldo de cada cuenta | Saldo inicial más el efecto de cada movimiento no anulado hasta hoy. | `accountBalance` |
| 2 | Saldo total registrado | Suma de las cuentas líquidas y de ahorro. Las tarjetas no son saldo: son deuda. | `totalRegisteredBalance` |
| 3 | Obligaciones pendientes del período | Lo que debe salir de una cuenta líquida y aún no sale. | `pendingObligations` |
| 4 | Dinero reservado | Reservas de metas más lo que apartan los presupuestos con fondo. | `reservedMoney` |
| 5 | **Disponible para gastar** | Saldo líquido confirmado − obligaciones pendientes − reservas. | `availableToSpend` |
| 6 | Patrimonio neto | Activos − pasivos. | `netWorth` |
| 7 | Ahorro acumulado | Saldo de las cuentas de ahorro más las reservas de metas. | `accumulatedSavings` |
| 8 | Flujo de caja proyectado | Saldo líquido día a día hasta un horizonte, por escenario. | `projectFinances` |

`financialSnapshot` calcula las siete primeras de una vez. El período es el mes calendario de «hoy».

### Disponible para gastar, paso a paso

`availableToSpend` devuelve cuatro líneas, y las tres primeras suman la cuarta:

1. Saldo líquido confirmado (efectivo y cuentas corrientes, hasta hoy).
2. Menos las obligaciones pendientes del período.
3. Menos el dinero reservado.
4. Igual a lo disponible. **Puede ser negativo**: el saldo no alcanza para lo que se debe y se apartó.

### Qué es una obligación pendiente

1. **Gastos programados** que siguen esperando (pendientes, estimados o vencidos) y ocurren hasta fin de mes:
   - Desde una cuenta líquida o con cargo a una tarjeta: cuentan igual, desde el primer día. El cargo a la tarjeta
     sale de la cuenta más tarde, con la cuenta de la tarjeta, pero la plata ya está comprometida.
   - Desde una cuenta de ahorro: no cuentan, porque no tocan el saldo para gastar.
2. **Cuotas de tarjeta** sin pagar dentro del horizonte de la tarjeta, incluidas las atrasadas.
3. **Lo que se debe al hogar**, si el saldo interno es negativo.

No son obligaciones: las transferencias programadas (mueven dinero entre cuentas propias) ni los ingresos esperados.
Un pago de tarjeta programado no se cuenta: la deuda ya está representada por las cuotas.

**Horizonte de la tarjeta:** el fin del mes o la cuenta que incluiría una compra hecha hoy, lo que sea más tarde. Por
eso **comprar con tarjeta baja lo disponible de inmediato, igual que pagar con débito**. De una compra en cuotas solo
se descuenta la cuota de la próxima cuenta; las siguientes entran cuando se acercan.

### Patrimonio neto

Activos: saldos positivos de todas las cuentas y lo que el hogar le debe a la persona. Pasivos: deuda de tarjetas,
cuentas en negativo y lo que la persona le debe al hogar. Siempre es la suma de todos los saldos más el saldo interno.

## Tarjeta de crédito

- Cada cargo se convierte en una o más **cuotas** con fecha de vencimiento. Una compra en N cuotas se divide en
  partes iguales; si no divide exacto, los pesos sobrantes van en las primeras cuotas. No puede haber más cuotas que
  pesos.
- La primera cuota vence en la cuenta que incluye la compra; las siguientes, cada mes en el día de pago de la tarjeta
  (una tarjeta que se paga el 31 sigue venciendo a fin de mes después de febrero).
- Un cargo sin plan explícito (un interés, una comisión) va entero a la cuenta que lo incluye.
- La deuda con que la tarjeta parte vence completa en su primer día de pago.
- Todo lo que entra a la tarjeta (un pago, una devolución) se aplica **a las cuotas más antiguas primero**.
- Deuda = suma de lo que queda sin pagar de todas las cuotas = saldo negativo de la tarjeta.

## Recurrentes

Una regla (semanal, mensual o anual, cada N períodos) programa movimientos. Las reglas mensuales conservan su día: una
regla del día 31 cae el 28 o 29 de febrero y vuelve al 31 en marzo.

| Estado | Significado |
|---|---|
| Pendiente | Fecha futura, monto conocido. |
| Estimado | Fecha futura, monto variable (la cuenta de la luz). |
| Vencido | La fecha pasó y no se registró nada. |
| Confirmado | Un movimiento real, fechado hoy o antes, tomó su lugar; o lo cubrió un gasto compartido. |
| Cancelado | La persona decidió saltárselo. |

- **Confirmar** crea un movimiento que recuerda qué ocurrencia confirma: deja de ser obligación y pasa a ser gasto.
  Confirmado en un solo pago y por el monto programado, **lo disponible no cambia**. Un cargo a la tarjeta nace con
  su cuota en la cuenta que lo incluye. Cambia, y es correcto que cambie, en tres casos: si el monto real es otro; si
  se confirma en varias cuotas (solo pesa la próxima cuota); y si se paga hoy un atrasado de otro mes en una categoría
  con presupuesto con fondo (ese pago consume el presupuesto de este mes; registrado con su fecha original, no).
- Las cuotas solo existen para un gasto con cargo a una tarjeta: pedirlas en otra cuenta se rechaza.
- **No se puede confirmar dos veces.** La segunda confirmación se rechaza aunque la pantalla siga mostrando la
  ocurrencia vieja. (En la fase 3 se suma un índice único en la base, para el caso de dos escrituras simultáneas.)
- **No se confirma con fecha futura.** Pagar por adelantado se registra con la fecha de hoy.
- Si se anula el movimiento, la ocurrencia vuelve a quedar pendiente.
- **El calendario de una regla no se edita en el lugar**, porque sus ocurrencias se identifican por fecha y los pagos
  ya confirmados quedarían huérfanos. Para cambiarlo, `rescheduleRule` cierra la regla y crea otra desde la fecha
  nueva. No alarga una regla que ya había terminado, y no deja cortar antes de un pago que ya se hizo por adelantado.
  (El dominio no puede impedir que alguien edite la fecha de inicio directamente: la capa de datos de la fase 3 solo
  ofrecerá `rescheduleRule`.)
- Si existe un movimiento guardado con fecha futura que apunta a una ocurrencia, esta sigue pendiente y no se puede
  confirmar de nuevo hasta anular ese movimiento.
- Una regla pausada no muestra nada pendiente ni vencido; lo confirmado sigue en el historial.

## Presupuestos

Por categoría y por mes: planificado, usado, disponible, porcentaje y ritmo de gasto frente a un uso parejo del mes.
Estados: bien, cerca del límite (90 % o más) y excedido.

Un presupuesto **con fondo** aparta lo que todavía no se gasta: reservado = planificado − gastado − lo programado de
esa categoría en el mes que **ya cuenta como obligación** (nunca menos que cero). Se calcula desde las mismas
obligaciones, así que nada queda contado dos veces ni sin contar: lo que es obligación sale de la reserva y lo que no
lo es (un gasto programado desde la cuenta de ahorro) sigue dentro. Un gasto atrasado de un mes anterior no le quita
reserva al presupuesto de este mes. Un presupuesto sin fondo es solo una referencia.

El presupuesto mide el **gasto propio**. En un gasto compartido cuenta la parte de cada uno, no lo que pagó por el
hogar: quien paga un arriendo de $400.000 a medias gasta $200.000 de su presupuesto de arriendo.

## Metas de ahorro

Dos formas de ahorrar, que el modelo no confunde:

- **Reserva:** el dinero sigue en la misma cuenta, pero se aparta. No cambia ningún saldo; baja lo disponible.
- **Transferencia efectiva:** una transferencia a una cuenta de ahorro, marcada con la meta. Cambia los saldos.

Acumulado de la meta = reservado + transferido. Ninguna de las dos es gasto.

- **Convertir una reserva en transferencia** se hace en un solo paso (`fulfilReservation`): se libera la reserva y se
  crea la transferencia juntas. Reservar y además transferir por separado suma las dos cosas: es correcto si son dos
  ahorros distintos, y cuenta doble si era la misma plata; por eso la interfaz ofrecerá la conversión.
- La reserva se sigue día a día y nunca baja de cero. Dentro de un mismo día, lo reservado cuenta antes que lo
  liberado, sin depender de los identificadores.
- **Archivar una meta libera lo que tenía reservado.**
- El aporte mensual sugerido es lo que falta dividido por los meses que quedan, redondeado hacia arriba.

## Hogar

Un gasto compartido guarda por separado el gasto original, quién pagó, quiénes participan y en qué proporción. Todo lo
demás se deriva:

- **Parte de cada uno:** reparto por mayor resto. La suma de las partes es siempre el total exacto; si sobra un peso
  en un empate, le toca al identificador menor (orden estable, igual en los dos teléfonos).
- **Saldo interno:** lo pagado menos la parte propia, más los reembolsos entregados y menos los recibidos. Positivo:
  le deben. Negativo: debe. Los saldos de todos suman siempre cero.
- **Reembolso:** baja la deuda. No es gasto ni ingreso.
- **Estado de cada deuda** (pendiente, parcial, saldada): lo que uno debe se compensa con lo que le deben y con los
  reembolsos, y lo cubierto se aplica a las deudas más antiguas primero.
- **Pago sugerido:** uno por cada par de personas con saldo entre ellas. No se «simplifican» deudas entre pares, para
  que pagar lo sugerido deje todas las deudas saldadas. Con dos personas es un solo pago.

Caso de referencia: Diego paga $200.000 de un gasto 50/50. Diego pagó $200.000; su parte es $100.000; la de Pablo,
$100.000; saldo interno de $100.000 a favor de Diego hasta el reembolso.

En las finanzas de cada uno: el gasto del mes es **la parte propia**, no lo pagado. A quien pagó le baja la cuenta por
el total y el hogar le debe la diferencia. A quien no pagó no se le mueve ninguna cuenta, pero su parte ya es gasto y
lo que debe es una obligación pendiente.

### Registros que viajan juntos

Un gasto compartido y la salida de dinero de quien lo pagó son dos registros, y también un reembolso y su movimiento.
Crear o anular un lado sin el otro haría aparecer o desaparecer plata. Por eso `household-ledger.ts` produce los dos
lados (`recordSharedExpense`, `voidSharedExpense`, `recordSettlement`, `voidSettlement`) y `householdLedgerIssues`
lista cualquier par que se haya descuadrado: es lo que se le mostrará a la persona si un paquete importado trae una
contradicción.

- La única excepción es confirmar un recurrente como pago de gasto compartido: `confirmOccurrence` crea solo la
  salida de dinero, y el gasto compartido se registra en la misma operación. Si faltara, la revisión lo detecta.
- Lo anterior al día en que la persona empezó a registrar no exige movimiento: su saldo inicial ya lo incluye.
- Un mismo gasto o reembolso listado dos veces se rechaza, en vez de contarse doble.

### Un gasto compartido que además es recurrente (el arriendo)

- **Quien paga** confirma su regla indicando el gasto compartido: el movimiento es un pago de gasto compartido, su
  gasto es solo su parte y el hogar le debe el resto.
- **Quien no paga** marca que el gasto compartido cubre su ocurrencia programada. Deja de ser obligación; lo que debe
  ahora es la deuda con el hogar. Si ese gasto compartido se anula, la ocurrencia vuelve a estar pendiente.

Una cobertura solo vale si tiene sentido: la regla es un gasto, el gasto compartido existe, es de la misma categoría,
lo pagó otra persona y quien cubre participa en él. Si no, se ignora y el gasto programado sigue pendiente.

**Mientras la cobertura no esté marcada, el arriendo sí aparece dos veces** en el teléfono de quien no pagó (como
programado y como deuda con el hogar). El dominio no lo adivina: `coverageCandidates` detecta el caso (misma
categoría, mismo mes, pagado por otro) para que la app pregunte «¿es el mismo gasto?». En la proyección, las partes
de un gasto compartido ligado a una regla no entran en el gasto cotidiano: la regla ya las proyecta.

## Proyección

Determinista: los mismos datos y el mismo escenario dan siempre la misma línea. Horizontes: 7 días, fin de mes, 30, 60
y 90 días. `projectFinances` la arma desde los datos guardados; el simulador la llama con una copia modificada y nunca
toca los movimientos reales.

- **Línea confirmada:** saldo líquido de hoy más los compromisos de monto conocido.
- **Línea proyectada:** la confirmada más lo estimado.
- Lo vencido se cobra hoy. El gasto cotidiano estimado empieza mañana.

| Escenario | Ingresos estimados | Gasto cotidiano |
|---|---|---|
| Conservador | No se cuentan | El mes más caro del historial |
| Central | Se cuentan | La mediana |
| Optimista | Se cuentan | El mes más barato |

El **gasto cotidiano** es el que no viene de un recurrente. Se estima con los meses completos del historial (hasta
seis), contados desde el **primer movimiento registrado** (no desde la apertura de la cuenta) y sin el mes en que se
empezó.

- Los tres escenarios usan totales reales de la persona: su mes más barato, la mediana y su mes más caro.
- Cada total se reparte **por forma de pago** en la proporción de todo el historial, porque cómo se paga cambia de un
  mes a otro. El reparto redondea hacia abajo: puede quedar unos pesos bajo el total.
- Lo pagado con débito o efectivo sale de la cuenta ese mismo día.
- Lo pagado con tarjeta sale cuando se paga la cuenta de la tarjeta. Las compras ya hechas no se estiman: sus cuotas
  son obligaciones conocidas.

**Con menos de tres meses completos no se estima**: se proyecta solo con compromisos y la proyección lo declara.

Cada proyección trae su desglose (saldo inicial, entradas y salidas confirmadas, entradas y salidas estimadas, gasto
cotidiano), y el saldo final es exactamente la suma de esas líneas. No hay intervalos de confianza. En cada día de
la proyección, conservador ≤ central ≤ optimista.

## Decisiones de interpretación

Puntos donde la especificación admite más de una lectura y el modelo eligió una:

1. **Saldo total registrado** excluye las tarjetas. Por eso pagar la tarjeta sí lo baja; lo que no cambia con ese
   pago es el patrimonio neto ni el gasto del mes. La invariante «una transferencia no altera el saldo total» vale
   entre cuentas propias de activo.
2. **Las cuentas de ahorro no son saldo líquido.** Pasar plata al ahorro baja lo disponible, igual que reservarla.
3. **El período es el mes calendario.** Lo que vence el día 1 del mes siguiente no se descuenta el último día de este
   mes, salvo la tarjeta, que siempre incluye su próxima cuenta. Una alternativa sería una ventana hasta el próximo
   ingreso; queda para decidir con el propietario.
4. **La deuda con el hogar es una obligación pendiente** desde que existe, sin esperar una fecha.
5. **Un ingreso programado no aumenta lo disponible** hasta que se recibe. En la proyección, uno de monto fijo va en
   la línea confirmada (también en el escenario conservador) y uno vencido o de monto variable es estimado.
6. **Los vencidos no caducan.** Un recurrente que nunca se confirmó sigue contando hasta confirmarlo o saltárselo.
7. **Los montos estimados cuentan completos** como obligación.
8. **Los totales del mes son «a la fecha».**
9. **El peso sobrante de un reparto empatado** va siempre al identificador menor.
10. **Con poco historial, los recurrentes de monto estimado igual entran en la línea proyectada**; lo que no se estima
    es el gasto cotidiano.
11. **La mediana de un número par de meses** promedia los dos del medio y redondea hacia abajo.
12. **Un pago programado de la tarjeta desde una cuenta de ahorro** no se modela: la cuota se proyecta saliendo del
    saldo líquido.
13. **Pausar una regla oculta también sus vencidos.** Para dejar de pagar algo conservando lo atrasado, se cierra la
    regla con fecha de término en vez de pausarla.
14. **La tarjeta tiene un salto por ciclo, y es real:** al pasar el cierre o el día de pago entra en el horizonte la
    cuota siguiente de una compra en cuotas, y lo disponible baja ese día.
15. **La categoría de un movimiento se valida** cuando la capa de datos entrega la lista de categorías (siempre, desde
    la fase 3); las funciones puras aceptan no recibirla para poder probarse aisladas.

## Invariantes y dónde se prueban

Con fast-check, 200 casos aleatorios por propiedad (`NEXO_PROPERTY_RUNS=4000` para una búsqueda profunda). Las
situaciones aleatorias incluyen cuentas abiertas en distintas fechas, tarjetas con y sin día de facturación y días de
pago 29 a 31, movimientos fechados antes y después de «hoy», ocurrencias confirmadas y saltadas y metas archivadas.
Las situaciones completas tienen un hogar de dos personas; las reglas del hogar se prueban además con tres a cinco.

Lo que los generadores aún no cubren: pagos compartidos y reembolsos enlazados con los eventos del hogar dentro de
una situación completa (se prueban aparte, en `household-ledger.test.ts`).

| Invariante (especificación §4.3) | Prueba |
|---|---|
| La suma de las partes de un reparto es el total | `split.test.ts` |
| Una transferencia no altera el saldo total ni el gasto del período | `balances.test.ts`, `invariants.property.test.ts` |
| Compra con tarjeta más pago posterior suman un solo gasto | `invariants.property.test.ts` |
| Anular devuelve todas las magnitudes al valor previo (movimientos, gastos compartidos, reembolsos, reservas) | `invariants.property.test.ts`, `household-ledger.test.ts` |
| Los saldos internos del hogar suman cero | `household.test.ts` |
| Recalcular desde el historial da lo mismo que los saldos incrementales, y ambos coinciden con un cálculo independiente | `balances.test.ts` |
| Importar dos veces el mismo respaldo o paquete deja la base idéntica | **Pendiente**: fases 3 y 7, donde existe la importación |

Además: lo disponible siempre es saldo líquido − obligaciones − reservas; el patrimonio neto es la suma de todos los
saldos más el saldo interno; confirmar en un pago un gasto programado no cambia lo disponible; con tarjeta en un pago
queda lo mismo disponible que con débito, y en cuotas solo pesa la próxima cuota; marcar una cobertura quita
exactamente esa obligación; pagar lo sugerido en el hogar deja todo saldado; el saldo final de una proyección es la
suma de su desglose.

**Comprobación de mutaciones:** el dominio se rompe a propósito, un punto a la vez, y las pruebas deben detectar
cada rotura. El resultado de la última pasada está en `docs/ESTADO.md`.

**Revisión independiente (10-nov-2026):** dos pasadas del subagente `revisor-financiero`.

- Primera: 16 hallazgos, ninguno de aritmética.
- Segunda: ninguno crítico; tres importantes introducidos por las correcciones (un cargo programado a la tarjeta
  que quedaba unos días sin contar, la proyección que descontaba dos veces un arriendo compartido y programado, y
  reservar y liberar el mismo día según el identificador) y seis menores.
- Los importantes y los menores con corrección posible están corregidos y con pruebas. Lo que quedó como decisión o
  como tarea de otra fase está en «Decisiones de interpretación» y en `docs/ESTADO.md`.
