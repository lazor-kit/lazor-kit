/**
 * Decode fixture spending actions using the Protocol session account layout.
 * The header and field widths follow program/src/state/action.rs.
 */
function parseActions(bytes) {
  const data = Buffer.from(bytes);
  const actions = [];
  for (let offset = 0; offset < data.length;) {
    const type = data.readUInt8(offset);
    const length = data.readUInt16LE(offset + 1);
    const expiresAt = data.readBigUInt64LE(offset + 3);
    const start = offset + 11;
    const recurring = type === 2 || type === 5;
    const token = type >= 4 && type <= 6;
    if (type < 1 || type > 6 || length !== (token ? 32 : 0) + (recurring ? 32 : 8) || start + length > data.length) {
      throw new Error(`Invalid Protocol spending action ${type} of length ${length}`);
    }

    const values = start + (token ? 32 : 0);
    actions.push({
      type,
      limit: data.readBigUInt64LE(values),
      mint: token ? data.subarray(start, values) : undefined,
      expiresAt,
      spent: recurring ? data.readBigUInt64LE(values + 8) : undefined,
      window: recurring ? data.readBigUInt64LE(values + 16) : undefined,
      lastReset: recurring ? data.readBigUInt64LE(values + 24) : undefined,
    });
    offset = start + length;
  }
  return actions;
}

module.exports = { parseActions };
