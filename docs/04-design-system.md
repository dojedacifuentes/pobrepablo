# Sistema de diseño

Primera versión, de la fase 4. Vive en `src/ui/`. Dirección: **«Neo-Noir Financial Editorial»** (especificación §7):
fondo oscuro, una cifra protagonista, tipografía editorial solo en los títulos, y nada que distraiga de los números.

## Principios

1. **La legibilidad manda.** Si un efecto compite con un número, se va el efecto.
2. **Un monto nunca se corta ni salta.** Cifras tabulares siempre; las cifras grandes se achican solas hasta caber.
3. **El pulgar primero.** Lo principal está abajo. Nada que se toque mide menos de 44 px.
4. **El color nunca dice algo solo.** Todo estado lleva además una palabra.
5. **La interfaz no calcula.** Muestra lo que entrega `domain/`, con el formato que entrega `domain/`.

## Colores

Definidos en `src/ui/styles.css` y reflejados en `src/ui/tokens.ts`, donde una prueba verifica el contraste.

| Token | Valor | Uso |
|---|---|---|
| `obsidian` | `#080B12` | Fondo de la app |
| `night` | `#101827` | Fondo elevado: hojas y barras |
| `surface` | `#192130` | Tarjetas y filas |
| `raised` | `#232D40` | Un paso sobre la superficie: teclas, filas pulsadas |
| `ink` | `#F4F3F0` | Texto principal |
| `muted` | `#9FA8B8` | Texto secundario |
| `positive` | `#46D3A5` | Ingresos, «vas bien» |
| `accent` | `#8779DA` | La acción principal |
| `amber` | `#D9AD67` | Atención, narrativa, lo pendiente de pago |
| `danger` | `#ED7779` | Vencido, excedido, saldo que no alcanza |
| `line` / `line-strong` | blanco al 8 % / 16 % | Bordes |

**Contraste (WCAG AA), comprobado por prueba** en los 25 pares de texto y fondo que usa la interfaz
(`src/ui/tokens.test.ts`). Consecuencia que conviene recordar: **el texto sobre un botón de color es oscuro**
(`obsidian`), porque texto claro sobre violeta o verde no alcanza AA.

## Tipografía (ADR 0002)

Dos familias y ninguna más, autoalojadas (la app no pide nada a terceros):

- **Inter Variable:** toda la interfaz y **todos los montos**, con cifras tabulares (clase `money`).
- **Instrument Serif:** solo títulos narrativos grandes («NEXO», el nombre del mes, los estados vacíos). Nunca en
  montos ni en texto chico.

| Uso | Tamaño |
|---|---|
| Cifra protagonista | hasta 52 px; se achica sola si no cabe |
| Título de pantalla (serif) | 28 px |
| Texto de fila | 15 px |
| Texto secundario | 13 px |
| Rótulo de sección (`eyebrow`) | 11 px, mayúsculas espaciadas |

**Confirmado con capturas** a 320 y 390 px con montos de hasta doce dígitos (`capturas/15-montos-grandes`,
`capturas/16-registro-monto-grande`): no se cortan.

## Montos

- `Amount`: un monto en línea. Formato del dominio (`$1.250.000`, `−$35.990`), cifras tabulares, nunca se parte.
- `FitAmount`: un monto grande. Toma el tamaño que se le pide mientras cabe y se achica lo justo cuando la cifra es
  larga o la pantalla angosta. Se mide contra su propio contenedor, así que se comporta igual en el inicio y dentro de
  una hoja.
- **Ocultar montos** (el ojo del encabezado): reemplaza todos los montos por puntos. Se guarda con el perfil.

## Superficies

- **Opaco por defecto.** Tarjetas, listas y **hojas** son opacas: contienen formularios y cifras.
- **Vidrio en un solo lugar:** el recuadro de «Disponible para gastar», donde nada se desplaza por detrás. Es casi
  opaco (92 %): un navegador sin `backdrop-filter` no pierde nada.
- **Las dos barras son opacas.** Con cualquier transparencia, las filas que pasan por detrás se leían mezcladas con
  sus rótulos (lo detectó la auditoría de capturas).
- Esquinas: 14 px en tarjetas, 22 px arriba en las hojas, píldora en botones redondos y etiquetas.
- Espaciado en pasos de 4 y 8 px; 16 px de margen lateral; 24 px entre secciones.

## Componentes base (`src/ui/`)

| Componente | Para qué |
|---|---|
| `Button`, `IconButton` | Acciones. Tres alturas: 56, 48 y 44 px. Un botón de ícono siempre lleva nombre para lectores de pantalla |
| `Sheet` | Hoja inferior: sube desde abajo, no tapa toda la pantalla, se cierra con la cruz, tocando fuera o con Escape. Mantiene el foco dentro |
| `BottomNav` | Barra inferior de cinco posiciones, con «Añadir» al centro y más grande |
| `AppHeader` | Encabezado: perfil, mes y ocultar montos. Si es la Demo, una franja fija lo dice |
| `Toast` | Confirmación breve sobre la barra inferior, con «Deshacer». Nunca bloquea, y queda por debajo de las hojas para no tapar su teclado |
| `Section`, `Card`, `EmptyState` | Estructura de las pantallas |
| `Segmented`, `Chip`, `DateField` | Elecciones: tipo de movimiento, categoría, fecha |
| `ProgressBar` | Adorno: su cifra está siempre escrita al lado |

**Fechas.** `DateField` escribe «Hoy», «Ayer» o «9 nov», y abre el selector de fecha del teléfono. No se muestra una
fecha con el formato del dispositivo, para que «11/10» nunca pueda leerse como dos días distintos.

## Movimiento

Transiciones cortas y con propósito: la hoja sube (320 ms) y baja (180 ms), el aviso aparece. Nada bloquea una
operación. Con «reducir movimiento» activado en el teléfono, todas quedan instantáneas.

## Accesibilidad

- Zonas táctiles de 44 px o más; controles principales de 48 a 56 px.
- Foco visible en todo lo interactivo.
- Las hojas son diálogos de verdad: atrapan el foco, se cierran con Escape y devuelven el foco al cerrarse.
- Cada ícono sin texto tiene nombre; los adornos están ocultos a los lectores de pantalla.
- Áreas seguras del teléfono (`env(safe-area-inset-*)`) en el encabezado, la barra inferior y las hojas.

## Pendiente

- **Escritorio y tableta:** hoy es la columna del teléfono centrada. La especificación pide navegación lateral y más
  densidad; se hará derivándola de este diseño.
- Auditoría de accesibilidad completa (fase 9).
- Motion como biblioteca: por ahora bastan las transiciones de CSS.
- Identidad gráfica (los tres conceptos de logotipo) e ilustración: fase 6.
- Nada de esto se vio en un teléfono real: solo en Chromium y WebKit emulados.
