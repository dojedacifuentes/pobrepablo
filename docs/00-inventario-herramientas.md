# Inventario de herramientas

Comprobado el 9 de noviembre de 2026 en el PC 1 (Windows 11, PowerShell y Git Bash). Solo aparece lo que se verificó:
con un comando, o porque la sesión de Claude Code lo listó como disponible. La sesión de arranque se abrió en otra
carpeta (`eva.academy`); lo que depende de esa carpeta está marcado.

## Entorno

| Herramienta | Estado | Cómo se comprobó |
|---|---|---|
| Node.js | v24.20.0 | `node --version` |
| npm | 11.19.0 (es el gestor del proyecto) | `npm --version` |
| pnpm, yarn, bun | No instalados | `command -v` |
| Git | 2.55.0 (usuario y correo globales configurados) | `git --version`, `git config` |
| Python | 3.12.10 | `python --version` |
| GitHub CLI (`gh`) | **No instalado** | `command -v gh` |
| Vercel CLI | **No instalado** | `command -v vercel` |
| Google Chrome | Instalado | existe `chrome.exe` en Archivos de programa |
| Navegadores de Playwright | Solo Chromium (compilaciones 1243 y 1248) y su versión sin interfaz. **WebKit no está.** | carpeta `AppData\Local\ms-playwright` |
| Paquetes npm globales | `@openai/codex` 0.160.1, `@21st-dev/cli` 1.18.0 | `npm ls -g --depth=0` |

Consecuencias:

- **WebKit móvil** (exigido en la especificación §10) hay que descargarlo con `npx playwright install webkit` al llegar
  a la fase 4. La versión de Chromium que use el proyecto también se descargará si no coincide con las ya guardadas.
- **Publicación (fase 10):** sin `gh` ni CLI de Vercel, el repositorio y el despliegue se harán desde el navegador o
  instalando esas herramientas. Se decide en la parada de la fase 10.
- No hay teléfonos reales conectados a este entorno: las pruebas en dispositivo real quedan a cargo del propietario.

## Integración con navegadores (para verificar la interfaz)

| Herramienta | Para qué sirve aquí |
|---|---|
| Navegador integrado de la app de Claude | Abrir el servidor de desarrollo, emular tamaños de pantalla, leer consola y red, capturas. Ojo: con el panel oculto se congelan las animaciones; para capturas fiables se usa Playwright. |
| Claude en Chrome (extensión) | El Chrome real del propietario, con sus sesiones. Útil en la fase 10 (GitHub, Vercel), siempre con su permiso. |
| Control del escritorio | Disponible; no se prevé usarlo. |

## Skills

No hay ninguna skill instalada específica de React, de pruebas ni de PWA. Las pertinentes que sí existen:

| Skill | Origen | Cuándo se cargará |
|---|---|---|
| `design:design-system` | plugin `design` | Fase 4 (tokens y componentes) |
| `design:design-critique` | plugin `design` | Fases 4 y 5 (revisión de pantallas) |
| `design:accessibility-review` | plugin `design` | Fases 4 y 9 (WCAG) |
| `design:ux-copy` | plugin `design` | Fase 6 (microcopy, estados vacíos, errores) |
| `dataviz` | integrada | Fase 8 (gráficos) |
| `code-review`, `simplify`, `security-review` | integradas | Al cerrar fases con código |
| `run` | integrada | Para levantar y ver la app |
| `anthropic-skills:skill-creator` | integrada | Si hay que afinar las skills del proyecto |
| `verificar`, `capturas`, `cerrar-sesion` | **este proyecto** (`.claude/skills/`) | En cada fase |

En las fases 0 y 1 no se cargó ninguna: no hubo diseño ni código. No se activó nada sin relación con el trabajo.

Instaladas pero **sin relación** con NEXO (no se usan): las skills científicas y de redacción académica del usuario
(`scientific-*`, `literature-review`, `statistical-analysis`, `matplotlib`, etc.), las de marca EVA
(`eva-identidad-visual`, `eva-voz-y-avatar`, `eva-video-bienvenida`), las de los plugins jurídicos (`legal`,
`ip-legal`, `privacy-legal`, `litigation-legal`, etc.), `spritecook`, `motion-reel` y las de documentos de oficina.
Las skills `leccion-nueva`, `laboratorio`, `actividad-h5p`, `caso-twine`, `juego-phaser`, `animacion-remotion` y
`animacion-manim` pertenecen al proyecto `eva.academy` y no estarán en una sesión abierta en esta carpeta.

## Servidores MCP y conectores

Conectados en la sesión de arranque. Ninguno es necesario para construir NEXO; se listan para no confundirlos:

| Conector | ¿Sirve a NEXO? |
|---|---|
| Navegador integrado, Claude en Chrome, control del escritorio | Sí (verificación; ver arriba) |
| Figma (solo ilustración vectorial) | Opcional. La especificación pide ilustración original en SVG hecha a mano. |
| Canva, Adobe Express/Firefly/Acrobat | No |
| HeyGen, HyperFrames, vidIQ | No |
| Gmail, Google Drive, Claude Docs | No (y nunca para datos financieros) |
| Descrybe, verificación de referencias académicas | No |
| Tareas programadas, terminal, registro de conectores | No previsto |

**Falló al conectar:** el plugin de GitHub (`plugin:github:github`, error 400 por la cabecera de autorización). Habría
servido en la fase 10; habrá que reconectarlo, instalar `gh` o usar el navegador. También fallaron tres conectores
jurídicos sin relación con el proyecto.

**Requieren autorización y no se usarán:** Figma (plugin de diseño), Notion, Asana, Slack, Linear y otros conectores
jurídicos y de gestión.

## Subagentes

Definidos en este proyecto (`.claude/agents/`):

| Subagente | Puede editar | Función |
|---|---|---|
| `investigador` | No | Repositorios, licencias, documentación, versiones |
| `revisor-financiero` | No | Audita `src/domain/` contra la especificación §4 |
| `guionista` | Solo el catálogo de textos | Escribe y revisa el microcopy (§6) |
| `auditor-movil` | No | Revisa capturas y flujos en los viewports |

Regla: un solo escritor por carpeta a la vez. Los revisores reportan; no editan.

Tipos genéricos disponibles en la sesión: `general-purpose`, `Explore` (búsqueda de solo lectura), `Plan`,
`claude-code-guide`, `web-fetch` y `codex:codex-rescue` (segunda opinión con Codex, cuyo CLI está instalado). Los
agentes de los plugins jurídicos no tienen relación con el proyecto.

En la fase 1 la investigación se repartió entre cuatro agentes genéricos de solo lectura, porque las definiciones del
proyecto se cargan al abrir una sesión en esta carpeta.
