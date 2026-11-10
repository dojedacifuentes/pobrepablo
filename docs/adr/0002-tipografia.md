# ADR 0002 · Tipografía

- **Estado:** aceptada por el propietario el 10-nov-2026. La elección se confirma con los ojos en la parada de la
  fase 4, con capturas.
- **Decisión abierta n.º 2** de la especificación §1.

## Contexto

Se necesita una familia de interfaz con cifras tabulares, muy legible en pantallas pequeñas sobre fondo oscuro, y
opcionalmente una editorial para los títulos narrativos. Ambas autoalojadas: la app no pide nada a terceros.

Comprobado el 9-nov-2026 leyendo los archivos de cada fuente (subconjunto latino, que cubre el español y el signo $).
Todas tienen licencia OFL 1.1 y paquete en Fontsource.

| Interfaz | Cifras tabulares | Altura de la minúscula | Ancho de cifra | Peso del archivo |
|---|---|---|---|---|
| **Inter** | sí (`tnum`) | **0,546** (la mayor) | 0,648 (la más ancha) | 47,1 kB |
| Geist | sí | 0,530 | 0,600 | 28,7 kB |
| Manrope | sí | 0,540 | 0,620 | 24,3 kB |
| IBM Plex Sans | siempre tabulares | 0,516 | 0,600 | 44,6 kB |
| Hanken Grotesk | siempre tabulares | 0,493 | 0,560 | 33,9 kB |
| Figtree · Instrument Sans | sí | 0,500 · 0,510 | 0,620 · 0,600 | 19,7 · 29,4 kB |

| Editorial | Estilos | Peso del archivo |
|---|---|---|
| **Instrument Serif** | 400 y cursiva (un solo grosor) | 20,5 kB (+ 21,6 la cursiva) |
| Fraunces | 100 a 900 | 35,8 kB (65,7 con tamaño óptico) |
| Newsreader | 200 a 800 | 56,7 kB |
| Playfair Display · Bodoni Moda | 400 a 900 | 37,5 · 25,3 kB |

## Decisión

**Dos familias y ninguna más:**

- **Inter Variable** para toda la interfaz y **todos los montos**, con `font-variant-numeric: tabular-nums`. Es la de
  mayor altura de minúscula, que es lo que más ayuda a leer a 12 o 14 px.
- **Instrument Serif 400** solo para títulos narrativos grandes (intro, portadas de capítulo, encabezados de
  expediente). **Nunca para montos** (no tiene cifras tabulares) ni para texto pequeño (tiene un solo grosor y trazos
  finos).

Carga:

- Paquetes `@fontsource-variable/inter` y `@fontsource/instrument-serif`, servidos desde nuestro propio sitio.
- Solo el subconjunto latino: para Inter se escribe un `@font-face` propio que apunta a un único archivo; si no, se
  empaquetarían siete subconjuntos (más de 200 kB).
- Se precarga Inter; la serif no. Los archivos entran en la copia sin conexión del service worker.
- Peso total: **unos 68 kB**. La cursiva de la serif (22 kB más) solo se agrega si un diseño de la fase 6 la necesita.

## Consecuencias

- Las cifras de Inter son anchas: `$125.000.000` mide unas 7 veces el tamaño de letra. En 320 px el monto principal no
  puede pasar de unos 40 px, así que el tamaño se ajusta al ancho (`clamp`) y se prueba con cifras grandes.
- Con `font-display: swap` hay un cambio de letra visible en la primera visita; después responde la caché.
- Nombres con letras fuera del subconjunto latino (ł, š) caerían en la fuente del sistema.

## Se revisa en la fase 4

Con el dashboard real a 320 y 390 px sobre el fondo oscuro. Si el conjunto se ve genérico o los trazos finos de la
serif se leen mal, las alternativas ya medidas son: **Geist** (cifras más angostas, 18 kB menos), **IBM Plex Sans**
(más carácter de expediente, cifras tabulares de serie) y, como editorial, **Fraunces**. Cambiar es barato: la
tipografía vive en dos tokens.

Fuentes: registro de npm, API de Fontsource, archivos `woff2` y licencias de cada paquete. Detalle en
`docs/01-investigacion.md` §5.6.
