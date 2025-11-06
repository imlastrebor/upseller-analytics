export function getEnv(name: string, options: { required?: boolean } = {}): string | undefined {
  const value = process.env[name];

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (options.required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return undefined;
}
