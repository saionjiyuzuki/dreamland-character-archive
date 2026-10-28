const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for innerHTML templates; song titles and saved data may contain quotes or markup. */
export function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ENTITIES[char]);
}
export const pad2 = (n) => String(n).padStart(2, '0');
export function formatDuration(sec) {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}
