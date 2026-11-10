# Estado del proyecto

**Última actualización:** 9 de noviembre de 2026 (PC 1).

## Dónde estamos

**Fases 0 y 1 terminadas. PARADA: se espera la aprobación del propietario antes de empezar la fase 2.**

Todavía no hay código ni `package.json`: el proyecto se inicializa en la fase 2. Por eso `npm run verify` aún no
existe y no se ejecutó.

## Hecho

### Fase 0 · Arranque

- Carpeta `Desktop\nexo` creada con Git (rama `main`, sin remoto).
- Entorno inspeccionado e inventario en `docs/00-inventario-herramientas.md`.
- Memoria del proyecto: `CLAUDE.md`, `docs/PLAN.md`, este archivo, `docs/adr/`.
- La especificación completa quedó guardada tal cual en `docs/ESPECIFICACION.md`.
- Subagentes del proyecto en `.claude/agents/`: `investigador`, `revisor-financiero`, `guionista`, `auditor-movil`.
- Skills del proyecto en `.claude/skills/`: `verificar`, `capturas`, `cerrar-sesion`. Los scripts que invocan
  (`verify`, `e2e`, `capturas`) se crean en las fases 2 y 4.

### Fase 1 · Investigación y decisiones

- `docs/01-investigacion.md`: los nueve repositorios pedidos, dos proyectos más con Dexie + PWA, las cuatro
  referencias funcionales, trece patrones que adoptamos y los datos que respaldan cada decisión.
- Siete ADR en `docs/adr/`, todos en estado **propuesta**: gráficos, tipografía, estado, respaldo cifrado, service
  worker, versiones del stack y almacenamiento en iPhone.

## Lo que el propietario debe decidir en esta parada

1. **¿Se aprueban las siete propuestas?** Al aprobarlas se marcan como aceptadas en `docs/adr/README.md` y en cada
   archivo.
2. **Respaldo cifrado en V1** (ADR 0004), con «cifrado» como opción preseleccionada al exportar. Si se olvida la
   frase, ese respaldo no se recupera; la exportación sin cifrar sigue disponible.
3. **TypeScript 6 en vez de 7** (ADR 0006). Es el único punto donde el stack cerrado tuvo un impedimento real.
4. **El peso sobrante de un reparto impar** le toca siempre a la misma persona (es lo que fija la especificación).
   La alternativa es alternarlo. Hasta un peso por gasto.

## Qué sigue

Con el «sí»: marcar los ADR como aceptados y empezar la **fase 2 · Dominio financiero** (`docs/PLAN.md`): inicializar
el proyecto con las versiones del ADR 0006, crear `npm run verify` y `npm run e2e`, y construir `src/domain/` con la
prueba primero. Al inicializar, volver a consultar las versiones en npm.

## Lo que no está verificado

- Nada de los repositorios de referencia se ejecutó: el número de toques para registrar un movimiento se infirió del
  código.
- En un iPhone real: que los datos creados en Safari no pasan a la app instalada, qué ocurre al quitar el ícono y cómo
  se comporta `persist()` (ADR 0007).
- Cómo se ve la tipografía elegida sobre el fondo oscuro (se comprueba en la fase 4).
- El peso real de los gráficos en nuestro build (se mide en la fase 8).
- Que la CLI de shadcn acepte un `tsconfig` sin `baseUrl` (se comprueba al instalar).
- La gamificación de Habitica se revisó solo en su wiki comunitaria.

## Problemas conocidos y bloqueos

- **GitHub CLI y CLI de Vercel no están instalados**, y el conector de GitHub de Claude falló al conectar (error de
  autorización). No bloquea nada hasta la fase 10.
- **Playwright solo tiene Chromium descargado.** WebKit se instala en la fase 4.
- **No hay teléfonos reales** disponibles desde este entorno: las pruebas en dispositivo quedan para el propietario.
- La sesión de arranque se abrió en la carpeta de `eva.academy`. **Las próximas sesiones deben abrirse en
  `Desktop\nexo`**, para que carguen este `CLAUDE.md`, los subagentes y las skills del proyecto.
