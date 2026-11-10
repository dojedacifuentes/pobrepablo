# ADR 0001 · Biblioteca de gráficos

- **Estado:** aceptada por el propietario el 10-nov-2026 (propuesta el 9-nov-2026).
- **Decisión abierta n.º 1** de la especificación §1: la que rinda mejor en pantallas estrechas y pese menos.

## Contexto

La pantalla de Análisis necesita cinco gráficos simples: gasto por categoría, comparación mensual, ingresos contra
egresos, evolución de saldo y proyección con tres escenarios (con un tramo confirmado y otro estimado). Deben leerse a
320 px de ancho, cargarse de forma diferida y tener todos un equivalente en texto.

Medido el 9-nov-2026 (tamaño comprimido de lo que realmente se importa; herramientas bundlejs y Bundlephobia):

| Opción | Peso aproximado | Observaciones |
|---|---|---|
| **SVG propio + `d3-scale` + `d3-shape`** | **17 a 22 kB** | Solo las matemáticas (escalas, líneas, áreas, arcos); el dibujo es nuestro. No depende de la versión de React. |
| visx (los paquetes necesarios) | 25 a 34 kB | Tardó 18 meses en admitir React 19. Táctil y accesibilidad, a mano igualmente. |
| Recharts 3 | unos 100 kB para un gráfico real | Lo más rápido de montar; trae teclado y tooltips táctiles. Núcleo fijo de unos 60 kB. La cifra de 100 kB viene de un tercero: nuestra medición no terminó. |
| Chart.js | unos 68 kB | Dibuja en canvas: no es accesible por defecto y el tema se maneja aparte. |
| uPlot | unos 23 kB | Canvas, sin dona ni animaciones, sin accesibilidad. |
| Nivo | 67 a 96 kB por tipo de gráfico | Pesado. |

## Decisión

**Gráficos propios en SVG, con `d3-scale` y `d3-shape` solo para los cálculos.** Sin biblioteca de gráficos.

- Componentes pequeños en `src/ui/charts/`, cargados de forma diferida solo en Análisis.
- Cada gráfico recibe datos ya calculados por `domain/` y se entrega junto con su equivalente en texto (lista o
  tabla): no hay gráfico sin texto.
- En pantalla táctil se selecciona un dato tocándolo; nada depende de pasar el cursor por encima. Los datos se pueden
  recorrer con el teclado.
- Colores y tipografía, desde los tokens del sistema de diseño. Animación con Motion, respetando «reducir movimiento».
- **Versiones fijas `d3-scale` 4.0.2 y `d3-shape` 3.2.0.** Las versiones 4.0.3 y 3.2.1 se publicaron el 3-nov-2026,
  tras cuatro años sin cambios; por prudencia se usan las anteriores, con años de uso, y se reevalúa en la fase 8.

## Consecuencias

- Hay que escribir y probar ejes, marcas, selección táctil y redimensionado. Con cinco gráficos simples es un costo
  acotado, y a cambio el control a 320 px es total y la pantalla pesa cinco veces menos que con Recharts.
- No se usa el componente de gráficos de shadcn (se apoya en Recharts).
- Los pesos son de una herramienta externa: el tamaño real se mide en nuestro build en la fase 8.

## Plan B y cuándo se revisa

Si los ejes y el tooltip se vuelven una carga, se agregan `@visx/axis` y `@visx/tooltip` sueltos (unos 12 a 16 kB).
Recharts solo si importara más la rapidez de montaje que el peso y el control visual.

Fuentes: registro de npm, Bundlephobia, bundlejs, documentación de accesibilidad de Recharts y de Chart.js, notas de
versión de visx 4.0.0. Detalle en `docs/01-investigacion.md` §5.5.
