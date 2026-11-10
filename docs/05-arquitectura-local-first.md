# Arquitectura local

Cómo guarda NEXO los datos. Todo lo que aquí se describe vive en `src/data/` y está cubierto por pruebas que corren
contra una base de datos real en memoria (`fake-indexeddb`) y, desde la fase 4, por un flujo en un navegador real.

## La idea en una frase

Todo vive en el teléfono, en la base de datos del navegador (IndexedDB). No hay servidor, ni cuentas, ni
sincronización. Lo único que sale del teléfono es el archivo de respaldo que la persona exporta.

## Las capas y quién puede hablar con quién

```
features/, ui/, app/   →   @/data (hooks y operaciones)   →   domain/
                                   │
                                   └── Dexie sobre IndexedDB (un detalle interno)
```

- **Las pantallas no tocan la base.** Importan solo desde `@/data`. Una regla de lint les prohíbe importar `dexie`,
  `dexie-react-hooks` o cualquier archivo interno de `data/`.
- **`data/` no calcula dinero.** Guarda hechos y, antes de guardar, pregunta a `domain/` si son válidos.
- **`domain/` no conoce la base.** Sigue siendo puro: sin Dexie, sin React, sin reloj.
- **El contrato está en `src/data/ports.ts`:** `ProfileReader` (leer), `ProfileWriter` (operaciones) y `ProfileStore`
  (los dos, más observar, exportar y restaurar). La única implementación hoy es `DexieProfileStore`. Una futura capa
  de sincronización implementaría ese mismo contrato sin tocar el dominio ni las pantallas.

## Un perfil, una base de datos

| Perfil | Base | Qué contiene |
|---|---|---|
| Pablo | `nexo-pablo` | Sus finanzas |
| Diego | `nexo-diego` | Sus finanzas |
| Demo | `nexo-demo` | Datos inventados |

Cada perfil tiene su propia base, y **la tienda de un perfil se niega a guardar datos de otro**: ni por un respaldo ni
por ninguna otra vía entran a Pablo los datos de Diego o las cifras inventadas de la Demo. La Demo se puede reiniciar
(`resetDemo`) o eliminar entera (`deleteDemo`) sin tocar las otras dos.

**Los perfiles no están protegidos entre sí:** cualquiera que tenga el teléfono puede abrir cualquiera. No hay
contraseña ni se simula una. La interfaz lo dice.

Un perfil personal nace con las categorías y el hogar, y sin un solo peso: toda cifra la registra la persona.

## Qué se guarda

**Solo hechos, nunca resultados.** No se guarda ningún saldo, deuda ni reserva: `domain/` los recalcula desde los
movimientos cada vez. Así no pueden existir dos versiones de la verdad.

| Tabla | Contenido |
|---|---|
| `meta` | A quién pertenece el perfil y qué día se creó |
| `accounts`, `categories` | Cuentas y categorías |
| `transactions` | Movimientos (incluidos los anulados) |
| `rules`, `cancelledOccurrences`, `coverages` | Recurrentes, programados que se saltaron y gastos compartidos que cubren un programado |
| `budgets`, `goals`, `reservations` | Presupuestos, metas y reservas |
| `members`, `sharedExpenses`, `settlements` | El hogar: miembros, gastos comunes y reembolsos |
| `settings` | Preferencias que deben sobrevivir a un cierre |
| `audit` | Registro de auditoría |
| `local` | Datos de **este teléfono** (último respaldo, restauraciones). No viaja en los respaldos |

Cada fila lleva además cuándo se creó y cuándo se modificó por última vez. Lo que se guarda es exactamente lo que un
respaldo puede llevar: nada que se pierda al escribirlo en un archivo.

## Cada operación es todo o nada

Una operación (registrar un gasto, confirmar un programado, anular un gasto compartido) escribe todas sus filas y su
entrada de auditoría dentro de **una sola transacción** de IndexedDB. Si algo falla, no queda nada a medias. Una
prueba de propiedades lo comprueba con siete formas de fallar, tres de ellas después de que la primera fila ya se
había escrito: la base queda idéntica.

Antes de guardar, cada operación:

1. Revisa la forma de los datos con Zod (campos desconocidos, decimales o fechas imposibles se rechazan).
2. Pasa las reglas contables de `domain/`, **siempre con la lista de categorías** (una categoría de ingreso no sirve
   para un gasto).
3. Si toca el hogar o las cuentas, vuelve a revisar todo el libro del hogar (ver más abajo).

## Doble toque: claves de idempotencia

Cada formulario manda una clave propia. Si la misma clave llega dos veces con el mismo contenido (un doble toque, un
reintento), la segunda no escribe nada y responde exactamente lo mismo que la primera.

- La clave se guarda en la entrada de auditoría, con un índice único: ni dos envíos simultáneos duplican.
- Junto a la clave se guarda una huella de lo que mandó el formulario. La misma clave con **otro contenido** se rechaza,
  en vez de responder «listo» sin haber guardado nada.
- Una clave vacía o demasiado larga se rechaza antes de guardar.

## Anular deja rastro

Los movimientos no se borran. Anular marca el movimiento, que sigue en el historial y deja de contar en todas las
cifras. El contrato no ofrece ninguna operación para borrar un movimiento.

Lo único que se puede quitar de verdad son cosas que no son movimientos (un presupuesto, un «me lo salto»), y borrar
todos los datos de un perfil (`erase`), que es una acción explícita y destructiva: la interfaz debe advertir.

> Pendiente para la fase 5: la «eliminación definitiva» de un movimiento como acción explícita con advertencia, que la
> especificación permite. Hoy no existe.

## Auditoría de solo agregado

Cada operación deja una entrada: qué operación fue, cuándo, y por cada fila tocada cómo era y cómo quedó, con la lista
de campos que cambiaron (monto, categoría, reparto…). Restaurar un respaldo también deja la suya.

Dentro de la app, la tabla solo crece: una pieza en la conexión a la base rechaza cualquier intento de modificar o
borrar una entrada. Las únicas excepciones son reemplazar el perfil completo al restaurar un respaldo (entra la
auditoría del respaldo, más la constancia de la restauración) y borrar todos los datos.

**Lo que esto no es:** una protección contra quien abra la base con las herramientas del navegador o edite a mano un
respaldo sin cifrar. Sirve para que la app no pierda rastro por error, no como prueba ante terceros.

## El hogar: registros que viajan juntos

Un gasto compartido y la salida de dinero de quien lo pagó son dos filas; un reembolso y su movimiento, también. Las
operaciones del hogar escriben los dos lados en la misma transacción.

Además, toda operación que toque el hogar **o una cuenta** ejecuta `householdLedgerIssues` antes y después, y **se
rechaza si crea una contradicción nueva**. Por eso anular solo la salida de dinero de un gasto compartido no se puede:
hay que anular el gasto compartido, que anula los dos lados.

Confirmar un recurrente como pago de un gasto compartido registra el gasto compartido en esa misma operación.

**Desde cuándo se exige el movimiento.** Lo que la persona pagó antes de abrir su primera cuenta no exige salida de
dinero: su saldo inicial ya lo incluye. Ese día se **deduce** de las cuentas (la apertura más antigua) y no se puede
editar a mano; una fecha editable era una forma de despegar un gasto de su pago sin que nada lo notara. Por lo mismo,
abrir una cuenta más antigua o mover una apertura también pasa por la revisión del hogar.

## Otras parejas que se deshacen juntas

Convertir una reserva de una meta en transferencia escribe dos filas: la liberación de la reserva y la transferencia.
La liberación recuerda su transferencia, y anular cualquiera de las dos anula la otra. Anular una sola contaría el
mismo ahorro dos veces. Esa transferencia tampoco se edita por separado.

## Un programado no se confirma dos veces

El dominio ya rechaza la segunda confirmación cuando ve la primera. La base agrega un seguro para el caso de dos
escrituras simultáneas: un índice único por regla y fecha sobre los movimientos vivos que confirman un programado.
Al anular el movimiento, el programado queda libre para confirmarse de nuevo. Editar un movimiento no puede
convertirlo en la confirmación de un programado.

## El calendario de un recurrente no se edita

Lo que se puede cambiar en el lugar: nombre, monto, categoría, pausa. La fecha de inicio, la frecuencia y las cuentas
no: el contrato no las ofrece y la validación las rechaza. Para cambiar el calendario existe solo `rescheduleRule`, que
cierra la regla y abre otra desde la fecha nueva.

Un corte (al reprogramar o al cerrar) se rechaza si deja huérfano algo posterior a él: un pago ya confirmado, o un
gasto compartido marcado como cobertura de una fecha que dejaría de existir. Los «me lo salto» posteriores al corte se
eliminan en la misma operación.

## Lecturas que se actualizan solas

«La base de datos es el estado» (ADR 0003). Las pantallas leen con hooks (`useFinancialSnapshot`, `useAccounts`,
`useMonthActivity`…) que vuelven a entregar el resultado cada vez que cambia lo que leyeron, y solo entonces. No hay
una copia de los datos en memoria que pueda quedar desactualizada.

Mientras llega la primera lectura, el hook entrega `undefined`. Un error de lectura se lanza al límite de errores más
cercano.

## Versiones del esquema y migraciones

El esquema está versionado en `src/data/dexie/database.ts`. Reglas:

- **Una versión publicada no se edita nunca.** Cada cambio es una versión nueva, con el número siguiente. Una prueba
  fija el texto de la versión 1 para que una edición accidental falle. (La versión 1 todavía no llegó a ningún
  teléfono: quedará congelada cuando se publique la primera pantalla que guarda datos.)
- Cambios aditivos siempre que se pueda.
- Cada migración lleva una prueba que abre una base de la versión anterior con datos y comprueba que nada se pierde.
- Si la migración falla, la base queda como estaba.
- Si la base la escribió una versión **más nueva** de la app, la app se niega a abrirla y lo explica. La versión se
  mira antes de que Dexie abra la base, porque Dexie «repararía» una base más nueva volviendo a crear lo que la
  versión nueva quitó.
- La forma de los respaldos tiene la misma versión que el esquema. Un cambio que altere una fila agrega también su
  paso de conversión de respaldos antiguos.

Hoy existe solo la versión 1. La maquinaria de migración está probada con versiones de mentira; todavía no hubo una
migración real.

## Errores que la interfaz puede explicar

`DataError` trae un código y un mensaje en español: no encontrado, datos inválidos, conflicto, programado ya
confirmado, registro del hogar sin contraparte, registro que es la mitad de un par, **teléfono sin espacio**, base de
una versión más nueva, y navegador que no deja guardar (modo privado).

## Dónde está cada cosa

| Qué | Archivo |
|---|---|
| Contrato (lo que ven las pantallas) | `src/data/ports.ts`, `src/data/index.ts` |
| Hooks | `src/data/react.tsx` |
| Abrir un perfil, Demo | `src/data/session.ts`, `src/data/demo/dataset.ts` |
| Esquema y migraciones | `src/data/dexie/database.ts` |
| Transacción, idempotencia, auditoría | `src/data/dexie/unit-of-work.ts` |
| Operaciones | `src/data/dexie/commands/` |
| Validación de forma (Zod) | `src/data/schemas.ts`, `src/data/validation.ts` |
| Respaldos | `src/data/backup/` (ver `docs/06-privacidad-y-respaldos.md`) |
| Pérdida de datos y `persist()` | `src/data/storage/` |
| Una prueba por cada hallazgo de la revisión | `src/data/review.test.ts` |

## Cómo se comprobó

- 170 pruebas de la capa de datos, entre ejemplos y propiedades (100 casos aleatorios por propiedad contra la base;
  25 las que cifran).
- **Comprobación de mutaciones**, dos pasadas. El código se rompe a propósito en un punto a la vez y las pruebas
  deben notarlo.
  - Primera (82 roturas): 75 detectadas a la primera; las otras 7 mostraron pruebas blandas, que se reforzaron hasta
    detectarlas.
  - Segunda, sobre el código ya corregido por la revisión (111 roturas): 106 detectadas a la primera; las otras 5
    obligaron a reforzar pruebas. Al final, las 111 detectadas.
- **Revisión independiente** (10-nov-2026): 18 hallazgos, uno crítico. Todos corregidos, cada uno con su prueba.

## Lo que no está probado todavía

- Los nombres exactos de los errores de cada navegador (sin espacio, modo privado), varias pestañas abiertas a la vez
  y Safari real. El flujo de la fase 4 corre en Chromium y en WebKit emulado.
- Los hooks de React no tienen prueba propia; los ejercita el flujo de punta a punta.
- El comportamiento con miles de movimientos (varios años de uso) no se midió. Cada escritura revisa el libro del hogar
  completo.
