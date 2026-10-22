export function hasResponseValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function csvCell(value: unknown): string {
  const raw = Array.isArray(value) || (value && typeof value === "object")
    ? JSON.stringify(value)
    : String(value ?? "");
  const safeValue = /^[\u0000-\u0020]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safeValue.replaceAll('"', '""')}"`;
}
