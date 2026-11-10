# ADR 0010 · Registro rápido con teclado propio y hojas opacas

- **Estado:** propuesta el 10-nov-2026, al construir la fase 4. Se confirma con los ojos en la parada de la fase 4.
- La investigación (`docs/01-investigacion.md`) había dejado «teclado numérico propio» como idea a evaluar aquí.

## Contexto

La especificación §5.3 pide que el botón + abra una hoja «con el monto en grande y el teclado numérico ya activo», que
el formulario siga siendo usable con el teclado abierto a 320 × 568, y que registrar un gasto habitual tome menos de
diez segundos y no más de tres toques después del monto.

Con el teclado del sistema, lo que queda visible depende de cada teléfono, no se puede comprobar con capturas, y en
iPhone abrirlo solo al mostrar una hoja no siempre funciona.

## Decisión

1. **Teclado numérico propio**, dentro de la hoja: diez dígitos, «000» y borrar. Sin tecla de decimales, porque la
   contabilidad no tiene decimales.
   - Está siempre a la vista al abrir, nunca tapa el formulario y lo que muestran las capturas es lo que ve la
     persona.
   - Con un teclado físico (computador) también se puede escribir.
2. **Dos toques después del monto:** categoría y «Guardar». Cuenta (la última usada) y fecha (hoy) vienen puestas.
3. **Categorías ordenadas por uso**, en una fila que se desliza.
4. **La fecha se escribe en palabras** («Hoy», «Ayer», «9 nov») y abre el selector del teléfono. No se muestra con el
   formato del dispositivo.
5. **Las hojas son opacas.** La especificación menciona las hojas entre los candidatos a vidrio, pero también pide
   fondos opacos en formularios: las hojas contienen formularios, y gana la legibilidad.
6. **El texto libre (la nota) sí usa el teclado del sistema**, y queda plegado.

## Consecuencias

- El teclado propio no ofrece pegar ni dictar un monto. Si llega a hacer falta, se agrega un campo alternativo.
- Hay que mantener un componente más, con sus pruebas (`amount-entry.test.ts`).

## Se revisa si

Al usarlo en un teléfono real el teclado propio resulta más lento que el del sistema, o el propietario prefiere las
hojas con vidrio.
