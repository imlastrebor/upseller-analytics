const ENCRYPTED_PREFIX = 'encrypted:';

/**
 * Temporary placeholder decryptor. Replace with proper encryption/KMS integration.
 */
export function decryptSecret(value: string): string {
  if (value.startsWith(ENCRYPTED_PREFIX)) {
    return value.slice(ENCRYPTED_PREFIX.length);
  }
  return value;
}
