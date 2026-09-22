import crypto from 'crypto';

/**
 * RFC 6238 TOTP, implemented on node's crypto rather than a dependency.
 *
 * Authenticator apps (Google Authenticator, Authy, 1Password) all speak the
 * same defaults - SHA-1, 6 digits, a 30 second step - so those are fixed here
 * instead of being configurable.
 */

const DIGITS = 6;
const PERIOD = 30;
const ALGORITHM = 'sha1';

/**
 * Codes are accepted one step either side of now. Clocks on phones drift, and
 * a user can easily start typing in the last second of a window; one step is
 * the usual compromise between that and leaving a code valid for too long.
 */
const DRIFT_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const toBase32 = (buffer: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
};

export const fromBase32 = (input: string): Buffer => {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in secret');

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
};

/** 20 random bytes is the secret length RFC 4226 recommends for SHA-1. */
export const generateTotpSecret = (): string => toBase32(crypto.randomBytes(20));

const codeForCounter = (secret: Buffer, counter: number): string => {
  const counterBuffer = Buffer.alloc(8);
  // Counters stay well inside 2^32 for any realistic date, so only the low
  // word needs writing; the high word remains zero.
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const digest = crypto.createHmac(ALGORITHM, secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
};

export const generateTotp = (secretBase32: string, at: Date = new Date()): string =>
  codeForCounter(fromBase32(secretBase32), Math.floor(at.getTime() / 1000 / PERIOD));

/**
 * Verifies a user-supplied code against the secret.
 *
 * Comparison is constant-time so the response time cannot be used to narrow
 * down a code digit by digit.
 */
export const verifyTotp = (
  secretBase32: string,
  token: string,
  at: Date = new Date()
): boolean => {
  const candidate = String(token ?? '').replace(/\D/g, '');
  if (candidate.length !== DIGITS) return false;

  let secret: Buffer;
  try {
    secret = fromBase32(secretBase32);
  } catch {
    return false;
  }

  const counter = Math.floor(at.getTime() / 1000 / PERIOD);
  const expectedBuffer = Buffer.from(candidate);

  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const expected = Buffer.from(codeForCounter(secret, counter + drift));
    if (
      expected.length === expectedBuffer.length &&
      crypto.timingSafeEqual(expected, expectedBuffer)
    ) {
      return true;
    }
  }

  return false;
};

/** The URI an authenticator app scans; `issuer` is what it labels the entry. */
export const buildOtpAuthUrl = (options: {
  secret: string;
  accountName: string;
  issuer: string;
}): string => {
  const label = `${options.issuer}:${options.accountName}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD)
  });

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
};

/** Recovery codes are shown once and stored only as hashes. */
export const generateRecoveryCodes = (count = 10): string[] =>
  Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-')
  );

export const hashRecoveryCode = (code: string): string =>
  crypto.createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex');
