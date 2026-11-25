import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// Seals secrets the API stores in the database (the AI endpoint's API key) with
// AES-256-GCM. The key is derived from BETTER_AUTH_SECRET with HKDF-SHA256, so a database
// dump alone does not reveal them. A sealed value is `v1.<iv>.<tag>.<ciphertext>`, each
// part base64url. Rotating BETTER_AUTH_SECRET makes stored values unreadable: they must
// be entered again.

const VERSION = 'v1';

function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set');
  return Buffer.from(hkdfSync('sha256', secret, '', 'ai-settings', 32));
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ct]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

// Throws on a value that was not sealed with this key or was changed.
export function open(sealed: string): string {
  const [version, iv, tag, ct] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error('Not a sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}
