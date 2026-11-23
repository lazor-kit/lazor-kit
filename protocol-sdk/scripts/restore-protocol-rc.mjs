import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const name = 'lazorkit-sdk-legacy-0.4.0-rc.3.tgz';
const expected = '589g34mhK7taYIRNRT7bjZwh9L61+Y5qDhh9zuqu4MRSa8cHo55wZpMdfbTc0aae8fg6x6z+eMb0dWVRCAGW7w==';
const chunks = [process.env.PROTOCOL_SDK_RC3_PART_1, process.env.PROTOCOL_SDK_RC3_PART_2];

if (chunks.some(chunk => !chunk)) {
  throw new Error('Both private Protocol SDK RC3 chunks are required');
}

const archive = Buffer.from(chunks.join(''), 'base64');
if (createHash('sha512').update(archive).digest('base64') !== expected) {
  throw new Error('The Protocol SDK RC3 archive did not match its pinned SHA-512');
}

const directory = new URL('../.ci/protocol-rc/', import.meta.url);
mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(new URL(name, directory), archive, { mode: 0o600, flag: 'wx' });
