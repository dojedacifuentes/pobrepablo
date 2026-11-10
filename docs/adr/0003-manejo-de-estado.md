# ADR 0003 · Manejo de estado

- **Estado:** aceptada por el propietario el 10-nov-2026 (propuesta el 9-nov-2026).
- **Decisión abierta n.º 3** de la especificación §1.

## Contexto

Casi todo lo que la app muestra es dinero guardado en IndexedDB. Si además se copia a un almacén en memoria, hay dos
versiones de la verdad que pueden diferir, y en una app financiera eso es un defecto. `dexie-react-hooks` 4.4.0 es
compatible con React 19 (comprobado en el registro de npm).

## Decisión

1. **La base de datos es el estado.** Las pantallas leen con consultas reactivas de Dexie (`liveQuery`): al guardar un
   movimiento, todo lo que depende de él se vuelve a calcular solo.
2. **Las consultas reactivas se exponen desde `src/data/` como hooks** (por ejemplo `useAccounts`, `useMonthActivity`).
   `features/` y `ui/` nunca importan `dexie` ni `dexie-react-hooks`; una regla de lint lo impide. Así una futura capa
   de sincronización puede reemplazar la implementación sin tocar las pantallas.
3. **Los montos derivados se calculan en `domain/`** a partir de lo que entregan esos hooks. Ningún componente suma.
4. **Estado efímero de interfaz** (hoja abierta, borrador del formulario, filtros): `useState` y `useReducer` locales.
   Lo poco que cruza la app (perfil activo, espacio Personal u Hogar, montos ocultos, modo de humor) va en un contexto
   de React pequeño, y lo que debe sobrevivir a un cierre se guarda en una tabla de ajustes de Dexie para que viaje en
   los respaldos.
5. **Zustand no se instala.** `localStorage` queda solo para preferencias triviales del dispositivo.

## Se revisa si

Aparece estado en memoria compartido por tres o más pantallas distantes que no pertenece a la base y cuyo contexto
provoca renders medibles (el simulador de la fase 8 es el candidato). En ese caso se agrega Zustand con un ADR nuevo.
