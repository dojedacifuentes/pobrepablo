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
- **Confirmado es hasta hoy.** Un movimiento con fecha futura todavía no forma parte del saldo ni de los totales.

## Cuentas

| Tipo | Clase | Qué es |
|---|---|---|
| Efectivo, cuenta corriente o vista | **Líquida** | Dinero que se puede gastar hoy. |
| Cuenta de ahorro | **Ahorro** | Es patrimonio, pero no cuenta como saldo para gastar. |
| Tarjeta de crédito | **Pasivo** | Su saldo es cero o negativo: lo que se debe. |

Cada cuenta parte de un saldo inicial en una fecha. Un movimiento anterior a esa fecha se rechaza, porque el saldo
inicial ya lo incluye.

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
- **Honorarios:** se pueden anotar el bruto y la retención, pero el monto del ingreso es el líquido, y debe cumplirse
  bruto − retención = líquido. No se calcula ningún impuesto.

## Las ocho magnitudes

| # | Magnitud | Definición | Función |
|---|---|---|---|
| 1 | Saldo de cada cuenta | Saldo inicial más el efecto de cada movimiento no anulado hasta hoy. | `accountBalance` |
| 2 | Saldo total registrado | Suma de las cuentas líquidas y de ahorro. Las tarjetas no son saldo: son deuda. | `totalRegisteredBalance` |
| 3 | Obligaciones pendientes del período | Lo que debe salir de una cuenta líquida hasta fin de mes y aún no sale. | `pendingObligations` |
| 4 | Dinero reservado | Reservas de metas más lo que apartan los presupuestos con fondo. | `reservedMoney` |
| 5 | **Disponible para gastar** | Saldo líquido confirmado − obligaciones pendientes − reservas. | `availableToSpend` |
| 6 | Patrimonio neto | Activos − pasivos. | `netWorth` |
| 7 | Ahorro acumulado | Saldo de las cuentas de ahorro más las reservas de metas. | `accumulatedSavings` |
| 8 | Flujo de caja proyectado | Saldo líquido día a día hasta un horizonte, por escenario. | `projectCashFlow` |

`financialSnapshot` calcula las siete primeras de una vez, para el mes en curso. El período es el mes calendario de
«hoy».

### Disponible para gastar, paso a paso

`availableToSpend` devuelve cuatro líneas, y las tres primeras suman la cuarta:

1. Saldo líquido confirmado (efectivo y cuentas corrientes, hasta hoy).
2. Menos las obligaciones pendientes del período.
3. Menos el dinero reservado.
4. Igual a lo disponible. **Puede ser negativo**: significa que el saldo no alcanza para lo que se debe y se apartó.

### Qué es una obligación pendiente

1. **Gastos programados** (recurrentes) que siguen esperando: pendientes, estimados o vencidos.
2. **Cuotas de tarjeta** que vencen hasta fin de mes y no están pagadas, incluidas las atrasadas.
3. **Lo que se debe al hogar**, si el saldo interno es negativo.

No son obligaciones: las transferencias programadas (mueven dinero entre cuentas propias) ni los ingresos esperados.
Un pago de tarjeta programado no se cuenta: la deuda ya está representada por las cuotas.

Un gasto programado **con cargo a una tarjeta** pasa a ser obligación en la fecha en que toca pagar la tarjeta, no en
la fecha del cargo.

### Patrimonio neto

Activos: saldos positivos de todas las cuentas y lo que el hogar le debe a la persona. Pasivos: deuda de tarjetas,
cuentas en negativo y lo que la persona le debe al hogar.

## Tarjeta de crédito

- Cada cargo se convierte en una o más **cuotas** con fecha de vencimiento. Una compra en N cuotas se divide en
  partes iguales; si no divide exacto, los pesos sobrantes van en las primeras cuotas.
- La primera cuota vence, por defecto, en el próximo día de pago de la tarjeta; las siguientes, cada mes.
- Todo lo que entra a la tarjeta (un pago, una devolución) se aplica **a las cuotas más antiguas primero**.
- Deuda = suma de lo que queda sin pagar de todas las cuotas = saldo negativo de la tarjeta.
- La deuda con que la tarjeta parte se considera vencida desde su primer día.

## Recurrentes

Una regla (semanal, mensual o anual, cada N períodos) programa movimientos. Las reglas mensuales conservan su día: una
regla del día 31 cae el 28 o 29 de febrero y vuelve al 31 en marzo.

| Estado | Significado |
|---|---|
| Pendiente | Fecha futura, monto conocido. |
| Estimado | Fecha futura, monto variable (la cuenta de la luz). |
| Vencido | La fecha pasó y no se registró nada. |
| Confirmado | Se convirtió en un movimiento real, con su monto real. |
| Cancelado | La persona decidió saltárselo. |

Confirmar crea un movimiento que recuerda qué ocurrencia confirma: deja de ser obligación y pasa a ser gasto, de modo
que **lo disponible no cambia** al confirmar por el monto programado. Si se anula ese movimiento, la ocurrencia
vuelve a quedar pendiente.

## Presupuestos

Por categoría y por mes: planificado, usado, disponible, porcentaje y ritmo de gasto frente a un uso parejo del mes.
Estados: bien, cerca del límite (90 % o más) y excedido.

Un presupuesto **con fondo** aparta lo que todavía no se gasta: reservado = planificado − gastado − lo que ya es una
obligación pendiente de esa categoría (nunca menos que cero). Esa resta evita contar dos veces un arriendo que ya
figura como obligación. Un presupuesto sin fondo es solo una referencia.

## Metas de ahorro

Dos formas de ahorrar, que el modelo no confunde:

- **Reserva:** el dinero sigue en la misma cuenta, pero se aparta. No cambia ningún saldo; baja lo disponible.
- **Transferencia efectiva:** una transferencia a una cuenta de ahorro, marcada con la meta. Cambia los saldos.

Acumulado de la meta = reservado + transferido. Ninguna de las dos es gasto. El aporte mensual sugerido es lo que
falta dividido por los meses que quedan, redondeado hacia arriba.

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

Caso de referencia: Diego paga $200.000 de un gasto 50/50. Diego pagó $200.000; su parte es $100.000; la de Pablo,
$100.000; saldo interno de $100.000 a favor de Diego hasta el reembolso.

En las finanzas de cada uno: el gasto del mes es **la parte propia**, no lo pagado. A quien pagó le baja la cuenta por
el total y el hogar le debe la diferencia. A quien no pagó no se le mueve ninguna cuenta, pero su parte ya es gasto y
lo que debe es una obligación pendiente.

## Proyección

Determinista: los mismos datos y el mismo escenario dan siempre la misma línea. Horizontes: 7 días, fin de mes, 30, 60
y 90 días.

- **Línea confirmada:** saldo líquido de hoy más los compromisos de monto conocido.
- **Línea proyectada:** la confirmada más lo estimado.
- Lo vencido se cobra hoy. El gasto cotidiano estimado empieza mañana.

| Escenario | Ingresos estimados | Gasto cotidiano |
|---|---|---|
| Conservador | No se cuentan | El mes más caro del historial |
| Central | Se cuentan | La mediana |
| Optimista | Se cuentan | El mes más barato |

El **gasto cotidiano** es el que no viene de un recurrente. Se estima con los meses completos del historial (hasta
seis), sin contar el mes en que se empezó a registrar. **Con menos de tres meses completos no se estima**: se proyecta
solo con compromisos y la proyección lo declara.

Cada proyección trae su desglose (saldo inicial, entradas y salidas confirmadas, entradas y salidas estimadas, gasto
cotidiano), y el saldo final es exactamente la suma de esas líneas. No hay intervalos de confianza.

## Decisiones de interpretación

Puntos donde la especificación admite más de una lectura y el modelo eligió una:

1. **Saldo total registrado** excluye las tarjetas. Por eso pagar la tarjeta sí lo baja; lo que no cambia con ese
   pago es el patrimonio neto ni el gasto del mes.
2. **Las cuentas de ahorro no son saldo líquido.** Pasar plata al ahorro baja lo disponible, igual que reservarla.
3. **La deuda con el hogar es una obligación pendiente** desde que existe, sin esperar una fecha.
4. **Un ingreso programado no aumenta lo disponible** hasta que se recibe. Solo aparece en la proyección.
5. **Un ingreso programado y vencido** (se esperaba y no se registró) se trata como estimado en la proyección.
6. **Los totales del mes son «a la fecha»**: no incluyen movimientos fechados después de hoy.
7. **El peso sobrante de un reparto empatado** va siempre al identificador menor (ver `docs/01-investigacion.md` §3).

## Invariantes y dónde se prueban

Con fast-check, 200 casos aleatorios por propiedad:

| Invariante (especificación §4.3) | Prueba |
|---|---|
| La suma de las partes de un reparto es el total | `split.test.ts` |
| Una transferencia no altera el saldo total ni el gasto del período | `balances.test.ts`, `invariants.property.test.ts` |
| Compra con tarjeta más pago posterior suman un solo gasto | `invariants.property.test.ts` |
| Anular un movimiento devuelve todas las magnitudes al valor previo | `invariants.property.test.ts` |
| Los saldos internos del hogar suman cero | `household.test.ts` |
| Recalcular desde el historial da lo mismo que los saldos incrementales | `balances.test.ts` |
| Importar dos veces el mismo respaldo o paquete deja la base idéntica | **Pendiente**: fases 3 (respaldo) y 7 (paquete Hogar), donde existe la importación |

Además: lo disponible siempre es saldo líquido − obligaciones − reservas; el patrimonio neto es la suma de todos los
saldos más el saldo interno del hogar; confirmar un gasto programado no cambia lo disponible; el saldo final de una
proyección es la suma de su desglose; conservador ≤ central ≤ optimista.

Comprobación adicional del 10-nov-2026: se rompió el dominio a propósito en 16 puntos (reparto, anulación, pago de
tarjeta, reservas, suma cero del hogar, fechas, doble conteo de recurrentes y otros) y las pruebas detectaron los 16.
