---
name: verificar
description: Ejecuta la puerta de verificación de NEXO (typecheck, lint, pruebas unitarias y de propiedades, build). Úsala antes de cerrar una fase, antes de un commit y cuando pidan «verifica» o «¿está en verde?».
---

# Verificar

1. Ejecuta `npm run verify` en la raíz del proyecto. Encadena: typecheck → lint → pruebas unitarias y de propiedades →
   build de producción.
2. Si la fase tocó interfaz, ejecuta además `npm run e2e` (Playwright en los viewports móviles).
3. Si algo falla, corrige la causa. No se saltan pruebas, no se comentan, no se aflojan reglas de lint para pasar.
   Un fallo de una prueba de propiedades trae un contraejemplo: reprodúcelo y arregla el dominio, no la prueba.
4. Informa con el resultado real: cuántas pruebas, cuántas fallaron y la salida del fallo. No digas «en verde» sin
   haberlo ejecutado en esta sesión.

Un build exitoso no prueba calidad visual: las pantallas se revisan con la skill `capturas`.

> Los scripts `verify` y `e2e` se crean al inicializar el proyecto en la fase 2. Antes de eso esta skill no aplica.
