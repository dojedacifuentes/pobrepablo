# ADR 0009 · Datos locales: una base por perfil y un respaldo que reemplaza

- **Estado:** propuesta el 10-nov-2026, al construir la fase 3. Pendiente de aprobación del propietario.
- Detalla lo que la especificación §3.2 y §3.3 dejaban abierto. No reabre ninguna decisión cerrada.

## Contexto

La especificación pide perfiles «con registros separados en la base», una Demo que se pueda reiniciar o eliminar sin
tocar los demás, auditoría de solo agregado que registre también las importaciones, y que importar dos veces el mismo
respaldo deje la base idéntica. Varias de esas frases admiten más de una lectura.

## Decisión

1. **Una base de datos por perfil** (`nexo-pablo`, `nexo-diego`, `nexo-demo`), no una sola base con una columna de
   perfil. Así ningún filtro olvidado puede mezclar datos, y eliminar la Demo es eliminar su base. La tienda de cada
   perfil rechaza además cualquier dato que no sea suyo.
2. **Restaurar un respaldo reemplaza todo el perfil**, todo o nada. No fusiona. Lo registrado después del respaldo se
   pierde, y la interfaz debe advertirlo. (La fusión por identificador es para el paquete Hogar, en la fase 7.)
3. **La restauración queda en la auditoría** con una entrada que lleva la fecha del respaldo, no la del momento de
   restaurar. Por eso restaurar dos veces el mismo respaldo deja la base idéntica. La hora real de cada restauración
   se anota aparte, en los datos del teléfono.
   - Consecuencia: «exportar → borrar → importar» deja la base idéntica **más esa entrada**. Es la única diferencia, y
     es deliberada: la especificación pide que la importación quede auditada.
4. **No se guarda ningún saldo.** Se recalculan desde los movimientos (ya era un principio del modelo financiero).
5. **«Desde cuándo se registra» se deduce** de la apertura de la primera cuenta. No es una fecha editable.
6. **El marcador de pérdida de datos vive en `localStorage`** y guarda solo dos conteos y una fecha. No cubre el
   borrado de siete días de Safari, que se lleva también el marcador (ver `docs/06-privacidad-y-respaldos.md`).
7. **Exportar nunca se bloquea** por el contenido: si lo guardado tiene un problema, el archivo se entrega con la lista
   de problemas.

## Alternativas descartadas

- *Una sola base con columna de perfil:* menos bases, pero toda consulta dependería de no olvidar un filtro.
- *Guardar la restauración solo en el teléfono, sin entrada de auditoría:* dejaría la ida y vuelta exactamente
  idéntica, pero la auditoría no diría que hubo una importación, que es lo que la especificación pide.
- *Fusionar al restaurar:* más cómodo si se registró algo después del respaldo, pero abre conflictos que un respaldo
  personal no necesita.

## Se revisa si

El propietario prefiere que restaurar no deje entrada en la auditoría, o que restaurar sobre un perfil con datos
ofrezca conservar lo registrado después del respaldo.
