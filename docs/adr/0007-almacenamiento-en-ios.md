# ADR 0007 · Almacenamiento en iPhone: instalar primero y respaldar seguido

- **Estado:** propuesta (9-nov-2026); se confirma en la parada de la fase 1.
- Responde a la especificación §3.2: verificar la política de WebKit y diseñar en consecuencia.

## Contexto (verificado en documentación vigente de WebKit y MDN)

- **Safari borra los datos de un sitio no instalado** (IndexedDB incluido, y también la copia de la app sin conexión)
  tras **7 días de uso del navegador sin interactuar con ese sitio**. Quien use Safari a diario y no abra NEXO en una
  semana lo pierde todo.
- **Una app añadida a la pantalla de inicio está exenta** de ese borrado.
- **La app instalada tiene su propio almacenamiento, separado del de Safari.** Lo registrado en Safari antes de
  instalar no aparece en la app instalada (inferido de la documentación; no probado en un iPhone).
- `navigator.storage.persist()`: Safari y Chrome deciden sin preguntar; Firefox pregunta. Protege contra la expulsión
  por falta de espacio. Ningún documento dice que en Safari exima del borrado de 7 días: no se cuenta con ello.
- Chrome en Android y Firefox solo expulsan datos cuando falta espacio en el dispositivo.

## Decisión

1. **En iPhone, instalar antes de cargar datos.** Si la app detecta iOS sin instalar, el onboarding empieza con un
   paso que explica cómo añadirla a la pantalla de inicio y por qué. Se puede omitir; si se omite, queda un aviso
   permanente y visible hasta que se instale.
2. **«Restaurar desde un respaldo» está siempre en la primera pantalla**, porque un almacenamiento borrado se ve igual
   que una instalación nueva.
3. **`persist()` se pide** tras la primera acción con datos, dentro de un gesto del usuario. Ajustes muestra el
   resultado y el espacio usado, explicados sin jerga.
4. **Recordatorio de respaldo:** semanal mientras haya cambios sin respaldar; más insistente a los 14 días o tras unos
   20 movimientos nuevos; en Safari sin instalar, en cada sesión. **Nunca bloquea el registro de un gasto.**
5. **Detección de pérdida:** la app guarda cuántos registros tenía la última vez. Si la base aparece vacía y no
   debería, lo dice y ofrece restaurar, en vez de mostrar una app en blanco.
6. La interfaz dice con claridad dónde viven los datos: solo en este teléfono y en esta app; el respaldo es la única
   copia.

## Pendiente de comprobar en un iPhone real

- Que los datos creados en Safari no pasan a la app instalada.
- Qué ocurre con los datos al quitar el ícono de la pantalla de inicio (los reportes son contradictorios).
- El comportamiento real de `persist()` en la app instalada.

Fuentes: WebKit «Full Third-Party Cookie Blocking and More» (2020), «Updates to Storage Policy» (2023), «Tracking
Prevention in WebKit», novedades de Safari 26 (2025); MDN «Storage quotas and eviction criteria» (enero de 2026) y
`StorageManager.persist()` (octubre de 2026). Detalle en `docs/01-investigacion.md` §5.
