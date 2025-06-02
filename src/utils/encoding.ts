// src/utils/encoding.ts
export function generateId(): string {
  return "1";
}

export function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}

export function stringToBase64(str: string): string {
  return Buffer.from(str).toString('base64');
}

export function base64ToString(base64: string): string {
  return Buffer.from(base64, 'base64').toString();
}