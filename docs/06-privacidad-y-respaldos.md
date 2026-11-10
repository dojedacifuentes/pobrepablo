# Privacidad y respaldos

## Dónde están los datos

- **Solo en este teléfono y en esta app.** En la base de datos del navegador (IndexedDB). No hay servidor, cuenta ni
  nube. La app no envía nada a ninguna parte y no usa analítica ni servicios de terceros.
- **No hay copia automática.** Si el teléfono se pierde o el navegador borra los datos, lo único que los recupera es
  un respaldo exportado antes. La interfaz debe decirlo sin rodeos.
- **Los perfiles no están protegidos entre sí.** Pablo, Diego y Demo son bases separadas, pero cualquiera con el
  teléfono en la mano puede abrir cualquiera. No hay contraseña y la app no finge tener una.
- **El repositorio es público** (ADR 0008). Nunca entra en él un respaldo ni un dato financiero real: `.gitignore`
  excluye `*.nexo.json` y `*.nexo.enc`.

## El perfil Demo

Trae unos cuatro meses de finanzas inventadas para probar la app sin registrar nada propio.

- Sus cuentas, movimientos, recurrentes, metas y gastos compartidos llevan «(demo)» o «de ejemplo» en el nombre, y sus
  identificadores empiezan con `demo-`. Las categorías son las mismas de cualquier perfil (Arriendo, Supermercado…).
- La pantalla muestra en todo momento una franja «Demo · todas las cifras son inventadas».
- Vive en su propia base de datos. Se reinicia o se elimina sin tocar las otras.
- **Sus cifras no pueden llegar a un perfil real:** la tienda de cada perfil rechaza datos que no sean suyos, vengan
  de un respaldo o de cualquier otra parte. Tampoco entra un dato real a la Demo.
- Las personas de su hogar son «Persona A (demo)» y «Persona B (demo)», no Pablo ni Diego.

## El respaldo

Un archivo con **todo** lo de un perfil: cuentas, movimientos (también los anulados), recurrentes, presupuestos,
metas, hogar, preferencias y el registro de auditoría completo.

No incluye lo que es de este teléfono y no de la persona: cuándo se respaldó por última vez, en qué momento se
restauró cada respaldo aquí y la respuesta del navegador sobre conservar los datos.

### Dos formas

| | Archivo | Quién puede leerlo |
|---|---|---|
| **Cifrado** (opción que la interfaz debe preseleccionar) | `nexo-pablo-2026-11-10.nexo.enc` | Solo quien tenga la frase |
| Sin cifrar | `nexo-pablo-2026-11-10.nexo.json` | Cualquiera que tenga el archivo |

El respaldo suele viajar por WhatsApp o correo, donde queda copiado en servidores y otros teléfonos. Por eso el
cifrado va primero. Sin cifrar sigue disponible, con advertencia.

### El cifrado (ADR 0004)

- AES-256-GCM. La clave se deriva de la frase con PBKDF2-HMAC-SHA-256, 600.000 iteraciones, con una sal y un vector
  de inicio nuevos y aleatorios en cada archivo. Solo se usa el cifrado que ya trae el navegador.
- La frase debe tener **12 caracteres o más** y escribirse dos veces.
- **La app no guarda la frase. Si se olvida, ese respaldo no lo puede recuperar nadie.** No hay puerta trasera.
- Cambiar un solo bit del archivo hace que no abra. La app no distingue entre «frase equivocada» y «archivo
  alterado»: informa las dos posibilidades.
- Una cabecera falsificada no puede poner al teléfono a calcular durante minutos: las iteraciones leídas del archivo
  tienen un máximo.
- La misma frase escrita en otro teclado, con otra forma de los mismos caracteres, abre el respaldo.

Formato del archivo cifrado: `NEXOBAK1` (8 bytes) · versión (1) · algoritmo (1) · iteraciones (4) · sal (16) ·
vector de inicio (12) · contenido cifrado. Los 42 bytes de cabecera están autenticados.

### Al exportar, se comprueba que el archivo está entero

Antes de entregar el archivo, la app lo vuelve a abrir (lo descifra, si está cifrado), verifica su sello y compara su
contenido con lo guardado. Un respaldo que no se puede abrir es peor que no tener ninguno, porque se confía en él.

**Los datos de la persona nunca quedan retenidos.** Si lo guardado tiene algún problema (una fila que la app no
aceptaría de vuelta, o una regla contable rota), el archivo se entrega igual, con la lista de problemas. Ese archivo
no se puede restaurar por la vía normal, y la interfaz debe decirlo; pero los datos están en él, completos.

Exportar no marca nada como respaldado. Eso ocurre cuando la interfaz confirma que la persona ya tiene el archivo
fuera del teléfono, y solo si el archivo no trae problemas.

### Al importar, se desconfía del archivo

Restaurar **reemplaza todo** lo que el perfil tenía por lo que trae el archivo, todo o nada. Lo registrado después
del respaldo se pierde: eso es restaurar. La interfaz debe advertirlo antes si el perfil ya tiene datos.

El archivo pasa, en orden:

1. Que sea un respaldo de NEXO, que esté entero y que sea de una versión que esta app entienda. Un archivo cortado se
   informa como respaldo dañado; uno de una versión más nueva, con el aviso de actualizar la app.
2. Un sello (suma de verificación) del contenido: detecta un archivo dañado.
3. La forma de cada dato: un monto con decimales, una fecha imposible o un campo desconocido lo rechazan.
4. Que los datos no se contradigan: una cuenta, categoría o meta que no existe, un programado confirmado dos veces, un
   reparto imposible. Y, al final, que todas las cifras de la app se puedan calcular con esos datos.
5. Que sea del mismo perfil que se está restaurando.

Si falla cualquiera, no se importa nada y se dice por qué.

**Se avisa, sin rechazar:** un registro del hogar sin su contraparte (un gasto compartido que la persona pagó, sin la
salida de dinero). No rompe ningún cálculo, pero se le muestra a la persona.

**Se acepta:** un movimiento con fecha futura (un reloj mal puesto). No cuenta hasta que llega su día.

Existe una opción de rescate, que la interfaz solo debe ofrecer a propósito: restaurar un respaldo aunque sus datos se
contradigan (paso 4). El sello, la forma y el perfil se revisan igual, y los registros del hogar desparejados se
informan igual.

**El sello no es una firma.** Detecta un archivo dañado, no uno modificado a propósito: quien edite un respaldo sin
cifrar puede recalcularlo. Un respaldo cifrado sí detecta cualquier cambio.

### Qué queda en la auditoría

Restaurar deja una entrada en el registro de auditoría: qué respaldo se restauró y de qué fecha era. La entrada es la
misma cada vez que se restaura el mismo respaldo. En qué momento se restauró en este teléfono queda anotado aparte,
en los datos del teléfono.

### Lo que garantizan las pruebas

- Exportar → borrar todo → importar deja la base **idéntica, más la entrada de auditoría de la restauración**, con y
  sin cifrado.
- Importar dos veces el mismo respaldo deja la base **idéntica**, también si entremedio se registró otra cosa.
- Ambas se prueban con ejemplos y con 100 perfiles aleatorios por propiedad (25 en la que cifra).

«Idéntica» significa: todas las tablas del perfil, fila por fila y campo por campo, incluida la auditoría. Queda
fuera solo la tabla de datos del teléfono.

## Que el navegador no borre los datos

### `persist()`

La app le pide al navegador que conserve los datos, después de la primera vez que la persona guarda algo. Qué
significa cada respuesta:

| Respuesta | En palabras |
|---|---|
| Concedido | El navegador no borrará los datos por su cuenta si falta espacio. |
| No concedido | El navegador podría borrarlos si necesita espacio. Conviene respaldar seguido. |
| No disponible | Este navegador no permite pedirlo. Hay que suponer que podría borrarlos. |
| Falló | No se pudo preguntar. La misma cautela. |

Ninguna de las cuatro es un respaldo. La app también puede informar el espacio usado y avisar cuando queda poco (90 %
o más); si el teléfono se queda sin espacio al guardar, el cambio no se guarda y se explica.

### iPhone (ADR 0007)

Safari borra los datos de un sitio **no instalado** tras siete días sin usarlo. Una respuesta «concedido» no garantiza
que eso no ocurra. Por eso: instalar la app en la pantalla de inicio antes de cargar datos, y respaldar seguido.

### Detección de pérdida de datos: qué cubre y qué no

Una base borrada se ve igual que una instalación nueva, y lo peor sería recibir a la persona con una app en blanco.

Cada vez que se guarda algo, la app deja una nota **fuera** de la base de datos (en `localStorage`): cuántos registros
y cuántas operaciones tiene el perfil, y cuándo. La nota no contiene montos ni nombres. Si al abrir la base está vacía
y la nota dice que había algo (aunque fuera solo una preferencia), la app **no prepara nada encima**: lo informa.

**No cubre el caso principal del iPhone.** Cuando Safari borra un sitio no instalado, borra todo su almacenamiento,
la nota incluida, y la app no tiene cómo saberlo: vería una instalación nueva. Nada que una página pueda escribir
sobrevive a ese borrado. La nota sirve cuando se pierde la base y `localStorage` no (una base dañada, una limpieza
parcial). Contra el borrado de los siete días las defensas son otras: instalar la app, respaldar seguido y tener
«restaurar desde un respaldo» siempre en la primera pantalla.

Borrar los datos a propósito no cuenta como pérdida.

### Recordatorio de respaldo

La app sabe cuántas operaciones hay después de la última que el respaldo guardado contiene, y cuándo fue ese
respaldo. Con eso la interfaz decidirá cuándo recordar (ADR 0007: semanal, y más insistente a los 14 días o con unos
20 cambios). La política del recordatorio se construye en la fase 9; hoy existe solo la cuenta.

## Lo que no está comprobado ni construido

- **La interfaz de exportar e importar todavía no existe** (fase 5). Hasta entonces la app no puede sacar un respaldo
  ni restaurarlo, y por eso avisa que conviene probarla con la Demo.
- Nada de esto se probó en un teléfono real, ni en Safari.
- En un iPhone: si los datos creados en Safari pasan a la app instalada, y qué responde `persist()` (ADR 0007).
- El tiempo que tarda el cifrado en un teléfono (en este computador, una fracción de segundo).
