# ADR 0006 · Versiones del stack

- **Estado:** aceptada por el propietario el 10-nov-2026 (propuesta el 9-nov-2026).
- No es una de las cinco decisiones abiertas: registra un impedimento técnico encontrado al verificar el stack cerrado.

## Contexto

Versiones comprobadas en el registro de npm el 9 de noviembre de 2026, con Node 24.20.0 y npm 11.19.0.

- **El stack cerrado se puede instalar tal como está**, con una sola excepción.
- **TypeScript 7.0.2** (la versión `latest`) es una reescritura que todavía no ofrece la interfaz de programación que
  usa `typescript-eslint`. Este declara `typescript >=4.8.4 <6.1.0` y falla al ejecutarse con TypeScript 7; no es
  solo una advertencia.
- `vite-plugin-pwa` 2.0.0 admite Vite 8. `dexie-react-hooks` 4.4.0 admite React 19. No hace falta ningún sustituto.
- `react-router` 8 ya no tiene paquete `react-router-dom`: todo se importa desde `react-router`.

## Decisión

1. **TypeScript 6.0.3**, la última de la rama 6, con ESLint 10 y `typescript-eslint`. Se prefiere conservar las reglas
   de lint con información de tipos (promesas sin esperar, `any` implícito, fronteras entre capas) antes que tener la
   última versión del compilador: en un dominio financiero esas reglas valen más.
2. El `tsconfig` se escribe ya compatible con TypeScript 7 (sin `baseUrl`, `moduleResolution: "bundler"`, `types`
   explícitos) para que subir de versión sea cambiar un número.
3. **Versiones exactas** en `package.json` (`save-exact`) y `"engines": { "node": "24.x" }`, también para Vercel.
4. **Enrutador:** `react-router` 8 en modo SPA.
5. Conjunto inicial:

| Paquete | Versión |
|---|---|
| vite · @vitejs/plugin-react | 8.3.7 · 6.3.0 |
| react · react-dom | 19.3.1 |
| typescript | **6.0.3** |
| eslint · typescript-eslint · @eslint/js | 10.14.0 · 8.72.2 · 10.0.1 |
| tailwindcss · @tailwindcss/vite | 4.3.5 |
| radix-ui · lucide-react · motion | 1.8.1 · 1.70.0 · 14.11.1 |
| dexie · dexie-react-hooks | 4.4.7 · 4.4.0 |
| zod | 4.6.7 |
| react-router | 8.5.1 |
| vite-plugin-pwa · workbox-window | 2.0.0 · 7.4.1 |
| vitest · @vitest/coverage-v8 | 5.1.0 |
| fast-check · fake-indexeddb | 4.10.2 · 6.2.8 |
| @playwright/test | 1.65.0 |
| @types/node · @types/react · @types/react-dom | 24.19.2 · 19.3.0 · 19.3.0 |

Al inicializar el proyecto (fase 2) se vuelve a consultar el registro: si salió un parche, se usa el parche.

## Pendiente de comprobar al instalar

- Que la CLI de shadcn (4.23.0) acepte un `tsconfig` sin `baseUrl`. Si no, los componentes se copian a mano.

## Se revisa si

`typescript-eslint` publica compatibilidad con TypeScript 7 (hay un cambio abierto en su repositorio). Entonces se
sube TypeScript y se actualiza esta tabla.

Fuentes: registro de npm (`npm view`), anuncio de TypeScript 7.0 en el blog de Microsoft, incidencias 12518 y 10940
de `typescript-eslint`, notas de versión de `vite-plugin-pwa`.
