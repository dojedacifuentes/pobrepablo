# ADR 0005 · Actualización del service worker

- **Estado:** aceptada por el propietario el 10-nov-2026 (propuesta el 9-nov-2026).
- **Decisión abierta n.º 5** de la especificación §1.

## Contexto

Una PWA guarda en el teléfono una copia de la app. Cuando se publica una versión nueva, el navegador la descarga en
segundo plano y hay que decidir cuándo reemplaza a la anterior. Reemplazarla recargando la página mientras alguien
escribe un gasto le haría perder lo escrito. Comprobado en la documentación y en el código de vite-plugin-pwa 2.0.0:

- Con `registerType: 'prompt'` (el valor por defecto) la versión nueva queda en espera indefinidamente y nada se
  recarga solo.
- `useRegisterSW` entrega `needRefresh` y `updateServiceWorker()`. Desde la versión 1.3.0 existe `onNeedReload`, que
  permite reemplazar la recarga inmediata por una función propia.
- Si hay dos pestañas y una acepta la actualización, la otra también se recargaría: `onNeedReload` cubre ese caso.
- Hay un defecto abierto (#789): a veces el botón de actualizar no recarga.
- En iOS instalado la app suele reanudarse sin navegar, así que no basta con esperar a que el navegador compruebe.

## Decisión

1. `registerType: 'prompt'`. Nunca `autoUpdate`, `skipWaiting` ni `clientsClaim` automáticos.
2. **Aviso discreto** «Hay una versión nueva» con el botón **Actualizar**. No bloquea ni tapa la barra inferior.
3. **Con el registro rápido o cualquier formulario abierto, el aviso no se muestra.** Aparece al cerrarlo.
4. La recarga pasa siempre por una función propia (`onNeedReload`): si hay un formulario abierto, queda pendiente y se
   ejecuta al cerrarlo. Un escuchador propio de `controllerchange` usa la misma función, por el defecto #789.
5. **Comprobación de versión:** al volver la app a primer plano (`visibilitychange`) y cada hora mientras esté
   abierta, solo con conexión.
6. Precaché de todo el shell (JS, CSS, HTML, fuentes `woff2`, íconos) y `navigateFallback` a `index.html`: la app
   funciona completa sin conexión tras la primera carga.
7. En Vercel: `sw.js` y los `.html` sin caché (`max-age=0, must-revalidate`), `/assets/*` inmutables, y el rewrite de
   todas las rutas a `index.html`.

## Consecuencias

- Quien nunca toque «Actualizar» seguirá con la versión anterior hasta cerrar del todo la app. Es aceptable: la
  versión anterior está completa y sus datos no cambian.
- Las migraciones de la base (fase 3) deben tolerar que dos pestañas tengan versiones distintas por un momento: Dexie
  avisa con `versionchange`, y ahí se cierra la conexión antigua y se pide recargar.

## Se revisa si

Se corrige el defecto #789 (se quita el escuchador propio) o cambia el comportamiento de iOS al reanudar.

Fuentes: documentación de vite-plugin-pwa («Prompt for update», «Periodic SW updates», «React», «Vercel»), código
publicado de la 2.0.0, web.dev «Service worker lifecycle». Detalle en `docs/01-investigacion.md` §5.
