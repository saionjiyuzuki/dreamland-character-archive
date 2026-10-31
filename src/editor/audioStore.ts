/**
 * Editor <-> game hand-off: the local audio file lives in IndexedDB (too large for localStorage) and the playtest chart
 * in localStorage. Both the editor and the game (playtest tab) use these helpers.
 */
const DB = 'dreamland-editor', STORE = 'files', AUDIO_KEY = 'audio';
export const PLAYTEST_KEY = 'dreamland.editor.playtest';
export const AUTOSAVE_KEY = 'dreamland.editor.autosave';

/** `savedAt` pairs the playtest audio with the playtest chart written at the same time. */
export interface StoredAudio { name: string; type: string; data: ArrayBuffer; savedAt?: number }
export interface PlaytestPayload { chart: unknown; audioUrl?: string; savedAt: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
/** Resolves once the transaction has committed, so write failures such as quota errors (which abort it) reject. */
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode), req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result as T);
      t.onerror = () => reject(t.error || req.error);
      t.onabort = () => reject(t.error || req.error || new Error('IndexedDB transaction aborted'));
    });
  } finally { db.close(); }
}
export const saveAudio = (a: StoredAudio) => tx<void>('readwrite', s => s.put(a, AUDIO_KEY));
export const loadAudio = () => tx<StoredAudio | undefined>('readonly', s => s.get(AUDIO_KEY)).catch(() => undefined);
export const clearAudio = () => tx<void>('readwrite', s => s.delete(AUDIO_KEY)).catch(() => undefined);

/** Playtest chart written by the editor; null when missing or unreadable. */
export function readPlaytest(): PlaytestPayload | null {
  try {
    const v = JSON.parse(localStorage.getItem(PLAYTEST_KEY) || 'null') as PlaytestPayload | null;
    return v && v.chart && typeof v.chart === 'object' ? v : null;
  } catch { return null; }
}

export const PLAYTEST_AUDIO_KEY = 'playtest-audio';
export const savePlaytestAudio = (a: StoredAudio) => tx<void>('readwrite', s => s.put(a, PLAYTEST_AUDIO_KEY));
export const loadPlaytestAudio = () => tx<StoredAudio | undefined>('readonly', s => s.get(PLAYTEST_AUDIO_KEY)).catch(() => undefined);

/** 16-bit PCM WAV of an AudioBuffer from `fromSec` on (used to start a playtest in the middle of the song). */
export function encodeWav(buffer: AudioBuffer, fromSec: number): ArrayBuffer {
  const ch = Math.min(2, buffer.numberOfChannels), rate = buffer.sampleRate, start = Math.max(0, Math.floor(fromSec * rate));
  const frames = Math.max(0, buffer.length - start), out = new ArrayBuffer(44 + frames * ch * 2), v = new DataView(out);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + frames * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, frames * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = start; i < buffer.length; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c]![i]!)); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return out;
}
