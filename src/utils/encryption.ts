import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

/**
 * Derives a 32-byte key from the configured encryption secret or JWT secret fallback.
 */
function getEncryptionKey(): Buffer {
  const secret = config.encryptionKey || config.jwt.accessSecret || 'invoice-maker-fallback-secret-key-32b';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Stored format: enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) {
    return null;
  }

  const str = String(plaintext).trim();
  if (!str) return str;

  // Avoid double-encryption
  if (str.startsWith(PREFIX)) {
    return str;
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // 12-byte IV recommended for GCM
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(str, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Field encryption failed:', error);
    return str;
  }
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Gracefully passes through unencrypted legacy values.
 */
export function decryptField(ciphertext: string | null | undefined): string | null {
  if (ciphertext === null || ciphertext === undefined) {
    return null;
  }

  const str = String(ciphertext);
  if (!str || !str.startsWith(PREFIX)) {
    return str;
  }

  try {
    const parts = str.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
      return str;
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.warn('Field decryption failed or invalid auth tag, returning original payload');
    return str;
  }
}

/**
 * Encrypts designated fields of an object in-place or into a cloned object.
 */
export function encryptObject<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
  if (!obj || typeof obj !== 'object') return obj;
  const result: any = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = encryptField(result[field]);
    }
  }

  return result as T;
}

/**
 * Decrypts designated fields of an object in-place or into a cloned object.
 */
export function decryptObject<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
  if (!obj || typeof obj !== 'object') return obj;
  const result: any = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = decryptField(result[field]);
    }
  }

  return result as T;
}

/**
 * Masks sensitive values for safe logging or partial display (e.g. ••••••••5678).
 */
export function maskSensitive(value: string | null | undefined, visibleTrailingChars = 4): string {
  if (!value) return '';
  const decrypted = decryptField(value) || '';
  if (decrypted.length <= visibleTrailingChars) {
    return '•'.repeat(decrypted.length);
  }
  const maskedLength = decrypted.length - visibleTrailingChars;
  return '•'.repeat(Math.min(maskedLength, 8)) + decrypted.slice(-visibleTrailingChars);
}
