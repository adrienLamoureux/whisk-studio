export function formatTimestamp(value?: string | number | null): string {
  if (!value) return "—";
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) return String(value);
  return new Date(parsed).toLocaleString();
}
