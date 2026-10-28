const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for innerHTML templates; song titles and saved data may contain quotes or markup. */
export function escapeHTML(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ENTITIES[char]);
}
export const pad2 = (n: number) => String(n).padStart(2, '0');
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}
