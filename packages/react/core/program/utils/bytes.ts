/**
 * Concatenates a list of byte arrays into a single Uint8Array.
 * Single allocation; avoids the chained `Buffer.concat` cost.
 */
export function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}
