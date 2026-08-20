export function normalizeEmail(value: string): string {
  const normalized = value.trim();
  return normalized.toLocaleLowerCase("en-US");
}
