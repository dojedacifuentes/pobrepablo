---
name: cerrar-sesion
description: Cierra una sesión o una fase de NEXO: verifica, actualiza docs/ESTADO.md y hace commit local. Úsala cuando pidan «cierra la sesión», «cierra la fase» o al terminar el trabajo del día.
---

# Cerrar sesión o fase

1. **Verifica.** Skill `verificar` (y `capturas` si hubo cambios visibles). Si queda algo en rojo, no se cierra la
   fase: se cierra la sesión dejando el fallo exacto escrito en `docs/ESTADO.md`.
2. **Actualiza `docs/ESTADO.md`:** qué quedó hecho, qué está en curso, qué sigue (el próximo paso concreto), problemas
   conocidos y bloqueos con su causa exacta. Fechas absolutas. Sin adornos: lo que no se probó se dice.
3. **Revisa `CLAUDE.md`:** si la sesión dejó una regla o una trampa nueva que toda sesión futura deba conocer, agrégala
   en una línea. Si se tomó una decisión de arquitectura, un ADR corto en `docs/adr/`.
4. **Commit local** con mensaje descriptivo en español (qué cambió y por qué). Antes: `git status` y `git diff --stat`,
   y comprobar que no entra ningún respaldo, paquete Hogar ni dato financiero real.
5. **No hagas push.** Crear el repositorio remoto, subir o desplegar exige el «sí» explícito del propietario.

Informe final al propietario: tres o cuatro líneas en español claro, con lo hecho, lo pendiente y lo no verificado.
