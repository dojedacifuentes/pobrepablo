/**
 * One and only one text for the same data: object keys in alphabetical order, arrays in their own
 * order, no spaces. Two exports of the same database are equal byte for byte, and a checksum of
 * this text does not depend on how a browser happened to order the fields.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${fields.join(',')}}`
  }
  const text = JSON.stringify(value)
  if (typeof text !== 'string') {
    throw new Error('Este valor no se puede escribir en un respaldo')
  }
  return text
}

/** SHA-256 of a text, in hexadecimal. It detects a damaged or cut file; it is not a secret. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
