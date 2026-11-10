# ADR 0004 · Respaldo cifrado

- **Estado:** propuesta (9-nov-2026); se confirma en la parada de la fase 1.
- **Decisión abierta n.º 4** de la especificación §1: ¿en V1 o en V1.1?

## Contexto

- El archivo de respaldo contiene todas las finanzas de una persona y lo esperable es que viaje por WhatsApp o correo,
  donde queda copiado en servidores y en otros dispositivos.
- Sin backend, el respaldo es la única defensa contra la pérdida de datos (ver ADR 0007), así que se usará a menudo.
- Web Crypto trae de forma nativa en todos los navegadores lo necesario: AES-GCM y PBKDF2. Argon2 no existe de forma
  nativa en ningún navegador (noviembre de 2026) y exigiría una dependencia WASM.
- OWASP recomienda hoy 600.000 iteraciones para PBKDF2-HMAC-SHA-256 (Password Storage Cheat Sheet).
- El investigador ejecutó el formato propuesto en Node 24: ida y vuelta correcta; contraseña errónea, cabecera
  manipulada y un bit alterado se rechazan; 600.000 iteraciones tardan unos 170 ms en este computador (en un teléfono
  se estima entre 0,3 y 1,5 s, sin medir).

## Decisión

**En V1.** El núcleo se construye en la fase 3, junto con la exportación e importación; la interfaz, con Ajustes.

- AES-256-GCM con clave derivada por PBKDF2-HMAC-SHA-256, 600.000 iteraciones, sal de 16 bytes e IV de 12 bytes
  aleatorios por archivo. Sin dependencias.
- Formato binario con cabecera versionada, autenticada como datos adicionales:
  `"NEXOBAK1"` (8) · versión (1) · algoritmo (1) · iteraciones (4) · sal (16) · IV (12), y después el texto cifrado.
  El byte de algoritmo deja lugar para Argon2id cuando sea nativo.
- Lo que se cifra es el mismo JSON del respaldo sin cifrar, y al importar se valida con el mismo esquema Zod.
- Al exportar, **cifrado es la opción preseleccionada**. La exportación sin cifrar sigue disponible, con advertencia.
- Tras exportar, la app descifra el archivo en memoria para confirmar que sirve antes de darlo por bueno.
- Frase de 12 caracteres o más, escrita dos veces, con aviso claro: **si se olvida, el respaldo no se puede
  recuperar**. La app no guarda la frase.
- Al importar: límites para las iteraciones leídas de la cabecera y normalización de la frase (NFKC).

**El paquete Hogar no se cifra en V1.** Contiene solo los gastos comunes, se intercambia con frecuencia y una frase
compartida añadiría fricción a un flujo que debe ser fácil. Se reevalúa en V1.1.

## Consecuencias

- Una frase olvidada deja ese respaldo inservible. Se mitiga con la verificación al exportar, con la opción sin cifrar
  y con el texto de advertencia. Es el costo de proteger el archivo.
- Entre uno y un día y medio de trabajo (estimación), casi todo en interfaz y pruebas.

## Se revisa si

El propietario prefiere que la opción preseleccionada sea «sin cifrar», o si Argon2id llega a Web Crypto.

Fuentes: OWASP Password Storage Cheat Sheet; MDN `SubtleCrypto.deriveKey` y `AesGcmParams`; borrador WICG «Modern
Algorithms in the Web Cryptography API». Detalle en `docs/01-investigacion.md` §5.
