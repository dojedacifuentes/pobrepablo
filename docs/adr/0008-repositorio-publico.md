# ADR 0008 · El repositorio es público

- **Estado:** aceptada por el propietario el 10-nov-2026.
- Cambia una decisión cerrada de origen: la especificación §1 pedía un repositorio de GitHub privado.

## Contexto

El propietario indicó como repositorio `github.com/dojedacifuentes/pobrepablo`, que es público. Se le advirtió que
el código, la especificación y los documentos quedarían a la vista de cualquiera, y eligió subirlo público.

## Decisión

El repositorio es público. Se mantiene, con más razón, todo lo demás:

- Nunca entra un respaldo, un paquete Hogar ni un dato financiero real (`.gitignore` los excluye).
- Los datos de ejemplo son ficticios y viven solo en el perfil Demo y en las pruebas.
- No hay secretos que proteger: la app no tiene backend ni claves.
- Los documentos no llevan datos personales más allá de los nombres de pila que ya trae la especificación.

## Consecuencias

- Cualquiera puede leer el código y las ideas del producto. Sin archivo de licencia, nadie tiene permiso de reutilizarlo;
  si se quiere permitir, se agrega una licencia en la fase 10.
- Un despliegue en Vercel desde este repositorio también es público: la dirección no debe compartirse con datos reales
  cargados en pantalla (los datos igual viven solo en el teléfono de cada uno).

## Se revisa si

El propietario prefiere volver a privado: se cambia en GitHub (Settings → Change repository visibility) sin tocar el
código.
