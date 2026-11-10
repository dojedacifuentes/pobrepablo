---
name: capturas
description: Genera y revisa capturas de cada pantalla de NEXO en todos los viewports. Úsala al terminar cualquier cambio visible, antes de declarar terminada una pantalla y en las paradas con capturas.
---

# Capturas en todos los viewports

1. Ejecuta `npm run capturas`. Usa Playwright con el perfil Demo (datos ficticios) y guarda en `capturas/<pantalla>/`
   un PNG por viewport: 320×568, 360×800, 375×667, 390×844, 412×915, 430×932, 768×1024 y 1440×900.
2. **Abre cada imagen y mírala.** Empieza por 390×844 (referencia) y 320×568 (el más exigente).
3. Para una revisión independiente, delega en el subagente `auditor-movil` y dale solo la carpeta de capturas.
4. Corrige lo que aparezca y repite hasta que no queden hallazgos bloqueantes ni importantes.
5. Informa qué pantallas y qué viewports revisaste. Lo que no miraste no está revisado.

Reglas:

- Nunca aparece dinero real en una captura: siempre el perfil Demo.
- La carpeta `capturas/` sí se sube al repositorio (son datos ficticios) cuando sirve de evidencia de una parada.

> El script `capturas` se crea en la fase 4, junto con el sistema de diseño. Antes de eso esta skill no aplica.
