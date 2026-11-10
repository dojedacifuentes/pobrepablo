# Recorrido en el teléfono

Primera versión, de la fase 4: lo que existe hoy, pantalla por pantalla. Las capturas están en `capturas/`, una
carpeta por pantalla y un archivo por tamaño (se regeneran con `npm run capturas`).

## Lo que ya funciona

### 1. Elegir perfil · `capturas/01-perfiles`

La primera pantalla. Tres perfiles: Pablo, Diego y Demo. Dice dónde viven los datos, que los perfiles no tienen
clave, y que la app está en construcción y todavía no exporta respaldos.

El perfil elegido se recuerda: al volver a abrir la app se entra directo.

### 2. Inicio · `capturas/02-inicio`, `03-inicio-completo`

Una columna, en este orden:

1. **Encabezado:** perfil, mes y el ojo que oculta los montos. En la Demo, una franja fija: «todas las cifras son
   inventadas».
2. **Disponible para gastar**, la cifra protagonista, con «¿Cómo se calcula?».
3. **Resumen:** ingresos del mes, gastos del mes, por pagar y apartado.
4. **Próximos compromisos:** lo que falta pagar este mes, del más cercano al más lejano. Dice si está vencido y si el
   monto es estimado.
5. **Presupuestos del mes:** cuánto va de cuánto, con una palabra (vas bien, cerca del límite, excedido).
6. **Últimos movimientos.**

Todas las cifras salen de lo guardado en el teléfono y se actualizan solas al registrar algo.

### 3. ¿Cómo se calcula? · `capturas/04-como-se-calcula`

Hoja con cuatro líneas: lo que tienes hoy, menos lo comprometido, menos lo apartado, igual a lo disponible.

### 4. Registro rápido · `capturas/05` a `08`, `16`

El botón **+** abre una hoja con el monto en grande y el teclado propio ya en pantalla.

- **Monto primero.** Teclado de la app, sin tecla de decimales: son pesos enteros.
- **Un toque para la categoría** (ordenadas por uso) **y otro para guardar.**
- Cuenta: la última usada. Fecha: hoy. Nota: opcional y plegada.
- Tipo: gasto, ingreso o transferencia (esta última pide las dos cuentas).
- Cabe completo a 320 × 568 sin desplazarse. Las teclas miden 44 px en ese teléfono y hasta 56 px en los más altos.
- Mientras falta algo, el botón lo dice («Escribe el monto», «Elige una categoría») en vez de solo apagarse.
- Un doble toque en «Guardar» registra una sola vez.

Al guardar, la hoja se cierra, aparece «Gasto registrado · $…» con **Deshacer** (`capturas/17`), y el inicio ya
muestra el saldo nuevo.

### 5. Movimientos · `capturas/09-movimientos`

Los movimientos del mes, agrupados por día, del más nuevo al más antiguo, con flechas para cambiar de mes. Un
movimiento anulado no desaparece: queda tachado.

### 6. Perfil nuevo · `capturas/13-inicio-vacio`, `14-nueva-cuenta`

Un perfil personal empieza vacío e invita a crear la primera cuenta con lo que tiene hoy. No inventa ninguna cifra.

### 7. Perfil · `capturas/12-perfil`

Tocando el nombre: cambiar de perfil y, en la Demo, reiniciarla.

### Si faltan los datos

Si la base aparece vacía y el teléfono recuerda que tenía datos, la app no muestra una pantalla en blanco: lo dice y
deja elegir entre volver sin tocar nada o empezar de cero.

## Lo que todavía no existe

| Posición o función | Fase |
|---|---|
| **Metas** y **Análisis** (hoy muestran «todavía no está construida») | 5 y 8 |
| Onboarding, con «instalar primero» en iPhone | 5 |
| Editar, anular desde la lista, buscar y filtrar movimientos | 5 |
| Recurrentes, calendario, presupuestos y metas como pantallas | 5 |
| **Exportar y restaurar respaldos** | 5 |
| Selector Personal / Hogar, gastos compartidos | 7 |
| Intro del 9 de noviembre, voz narrativa, logros | 6 |
| Insight contextual y progreso narrativo en el inicio | 6 |
| Escritorio con navegación lateral | pendiente |
| Instalable y sin conexión | 9 |

## Cómo se comprobó

- **Flujo de punta a punta** en los seis tamaños de teléfono (Chromium) y en WebKit emulado: abrir → crear cuenta →
  registrar un gasto → saldo y lista actualizados → recargar → los datos siguen ahí. Además: deshacer, doble toque,
  ingreso con «¿cómo se calcula?», Demo aislada del perfil de Pablo, y que un aviso todavía en pantalla no tape el
  teclado de la hoja siguiente. Son 56 pruebas.
- **Capturas** de 17 pantallas en 8 tamaños.
- Sin desplazamiento horizontal en ninguna pantalla probada.

No se probó en un teléfono real.
