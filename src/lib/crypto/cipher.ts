import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppDatabase } from '@/lib/db';
import { FieldCipher } from '@/lib/crypto/field-cipher';

/**
 * Where the data key comes from for the current unit of work.
 *
 * In the app that is the request's own credential — the session cookie or the
 * API token — so nothing is readable without one. The CLI opens the key with
 * the password it prompted for, and tests with a fixed one.
 */
export type DataKeySource = (database: AppDatabase) => Promise<Buffer>;

// Imported lazily: it reads cookies and headers through next/headers, which
// the CLI never loads.
const requestDataKeySource: DataKeySource = async (database) =>
  (await import('@/lib/auth/request-key')).requestDataKey(database);

let source: DataKeySource = requestDataKeySource;

/** Returns the source it replaced, so a caller can put it back. */
export function setDataKeySource(next: DataKeySource) {
  const previous = source;
  source = next;
  return previous;
}

// Background work has no request to read a credential from. It carries the
// data key it was queued with, and everything it awaits sees that key here.
const dataKeyContext = new AsyncLocalStorage<Buffer>();

/** Runs `work` with `dataKey` as the key for getFieldCipher and getDataKey. */
export function withDataKey<T>(dataKey: Buffer, work: () => Promise<T>) {
  return dataKeyContext.run(dataKey, work);
}

/**
 * The data key for the current unit of work: the one a background job was
 * queued with, otherwise whatever the key source finds for this request.
 */
export async function getDataKey(database: AppDatabase): Promise<Buffer> {
  return dataKeyContext.getStore() ?? (await source(database));
}

// Keyed by the key buffer, which the credential cache hands back unchanged,
// so the HKDF subkeys are derived once per credential rather than per call.
const ciphers = new WeakMap<Buffer, FieldCipher>();

/**
 * The cipher for the current request. Every read or write of entry text,
 * titles, summaries or tag names awaits this once and then encrypts and
 * decrypts synchronously. Throws UnauthorizedError without a valid credential.
 *
 * Work queued on the AI worker runs under withDataKey, so it gets the key of
 * the request that queued it without needing that request's cookies.
 */
export async function getFieldCipher(
  database: AppDatabase,
): Promise<FieldCipher> {
  const dataKey = await getDataKey(database);
  let cipher = ciphers.get(dataKey);
  if (!cipher) {
    cipher = new FieldCipher(dataKey);
    ciphers.set(dataKey, cipher);
  }
  return cipher;
}
