/**
 * Audio analysis for the chart generator (generate.mjs). Works on a mono 16-bit WAV, which macOS can make from
 * FLAC / MP3 without extra tools:
 *   afconvert -f WAVE -d LEI16@22050 -c 1 song.flac /tmp/song.wav
 *   [BMIN=100 BMAX=120] node scripts/charts/analyze-audio.mjs /tmp/song.wav [bpm] [firstBeatMs] > scripts/charts/analysis/<song>.json
 * Output: grid BPM, time of bar 0 (a downbeat), duration, per bar three 16-character strings (low / mid / air band)
 * with the onset strength of every 16th as a digit 0-9, and the relative loudness of every bar.
 * Tempo is searched in BMIN..BMAX (default 120..210); check the result, e.g. a 220 BPM track may read as 110 or 165.
 */
import fs from 'node:fs';
const [file, bpmArg, fbArg] = process.argv.slice(2);
const buf = fs.readFileSync(file);
let p = 12, sr = 22050, data = null;
while (p < buf.length) { const id = buf.toString('ascii', p, p + 4), sz = buf.readUInt32LE(p + 4); if (id === 'fmt ') sr = buf.readUInt32LE(p + 12); if (id === 'data') { data = new Int16Array(buf.buffer.slice(buf.byteOffset + p + 8, buf.byteOffset + p + 8 + sz)); break; } p += 8 + sz + (sz & 1); }
const x = Float32Array.from(data, v => v / 32768), N = 1024, HOP = 128, hopMs = HOP / sr * 1000;
const frames = Math.floor((x.length - N) / HOP);
const win = Float32Array.from({ length: N }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / N));
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
const bin = hz => Math.round(hz / sr * N), B = [[bin(30), bin(200)], [bin(200), bin(4000)], [bin(4000), N / 2]];
const flux = B.map(() => new Float32Array(frames)), rms = new Float32Array(frames);
let prev = new Float32Array(N / 2);
const re = new Float32Array(N), im = new Float32Array(N);
for (let f = 0; f < frames; f++) {
  let e = 0; for (let i = 0; i < N; i++) { const v = x[f * HOP + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; } rms[f] = Math.sqrt(e / N);
  fft(re, im);
  const mag = new Float32Array(N / 2); for (let k = 0; k < N / 2; k++) mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
  B.forEach(([a, b], bi) => { let s = 0; for (let k = a; k < b; k++) { const d = mag[k] - prev[k]; if (d > 0) s += d; } flux[bi][f] = s / (b - a); });
  prev = mag;
}
// normalize each band by its 99th percentile; subtract local mean (adaptive threshold)
const pct = (arr, q) => { const s = Float32Array.from(arr).sort(); return s[Math.floor(q * (s.length - 1))]; };
const odf = flux.map(fl => { const out = new Float32Array(frames), W = 20; let acc = 0; const pre = new Float64Array(frames + 1); for (let i = 0; i < frames; i++) pre[i + 1] = pre[i] + fl[i];
  for (let i = 0; i < frames; i++) { const a = Math.max(0, i - W), b = Math.min(frames, i + W + 1); out[i] = Math.max(0, fl[i] - (pre[b] - pre[a]) / (b - a)); } const q = pct(out, .995) || 1; return out.map(v => Math.min(1.5, v / q)); });
const total = odf[0].map((v, i) => v + odf[1][i] + odf[2][i] * .6);
const at = (arr, ms) => { const c = (ms - N / 2 / sr * 1000) / hopMs; let m = 0; for (let i = Math.floor(c - 2); i <= Math.ceil(c + 2); i++) if (i >= 0 && i < arr.length) m = Math.max(m, arr[i]); return m; };
const durMs = x.length / sr * 1000;
// tempo search: score = mean onset strength on 8th grid with best phase
function score(bpm, phaseMs) { const step = 60000 / bpm / 2; let s = 0, n = 0; for (let t = phaseMs; t < durMs - 50; t += step) { s += at(total, t) * ((n % 2) ? .6 : 1); n++; } return s / n; }
function bestPhase(bpm, res = 2) { const beat = 60000 / bpm; let bp = 0, bs = -1; for (let ph = 0; ph < beat; ph += res) { const s = score(bpm, ph); if (s > bs) { bs = s; bp = ph; } } return [bp, bs]; }
let bpm = Number(bpmArg), fb = Number(fbArg);
if (!bpm) {
  let cands = [];
  for (let b = Number(process.env.BMIN || 120); b <= Number(process.env.BMAX || 210); b += .5) cands.push([b, bestPhase(b, 4)[1]]);
  cands.sort((a, c) => c[1] - a[1]);
  const top = cands.slice(0, 5); let best = [0, -1];
  for (const [c] of top) for (let b = c - .5; b <= c + .5; b += .02) { const s = bestPhase(b, 2)[1]; if (s > best[1]) best = [b, s]; }
  bpm = best[0]; process.stderr.write(`tempo candidates ${top.map(c => c[0] + ':' + c[1].toFixed(3)).join(' ')} -> ${bpm.toFixed(2)}\n`);
  // snap to near-integer / half-integer when equally good
  const r = Math.round(bpm * 2) / 2; if (Math.abs(r - bpm) < .1 && bestPhase(r, 2)[1] > .97 * best[1]) bpm = r;
}
const beat = 60000 / bpm;
if (!Number.isFinite(fb)) {
  const [ph] = bestPhase(bpm, 1);
  // Joint search over the 8 eighth-note rotations of a bar: kick (low) on beats 1 and 3, snare (mid) on 2 and 4.
  const e8 = beat / 2;
  const rot = Array.from({ length: 8 }, (_, r) => { let s = 0; for (let t = ph + r * e8; t < durMs; t += 4 * beat) s += at(odf[0], t) + at(odf[0], t + 2 * beat) + at(odf[1], t + beat) + at(odf[1], t + 3 * beat) - .5 * (at(odf[1], t) + at(odf[1], t + 2 * beat)); return s; });
  const r = [0, 2, 4, 6].reduce((a, b) => (rot[b] > rot[a] ? b : a));
  fb = (ph + r * e8) % (4 * beat);
  const beatPh = fb % beat;
  process.stderr.write(`phase ${beatPh.toFixed(1)} rot ${rot.map(v => v.toFixed(0))} firstDownbeat ${fb.toFixed(1)}\n`);
}
const S16 = beat / 4, BAR = beat * 4, chars = '0123456789';
const q = v => Math.max(0, Math.min(9, Math.floor(v / 1.2 * 10)));
const bars = [], energy = [];
for (let t0 = fb; t0 < durMs - 1; t0 += BAR) {
  bars.push([0, 1, 2].map(b => Array.from({ length: 16 }, (_, s) => chars[q(at(odf[b], t0 + s * S16))]).join('')));
  let e = 0, n = 0; for (let f = Math.max(0, Math.floor(t0 / hopMs)); f < Math.min(frames, (t0 + BAR) / hopMs); f++) { e += rms[f]; n++; } energy.push(+(e / Math.max(1, n)).toFixed(4));
}
const maxE = Math.max(...energy);
console.log(JSON.stringify({ bpm: +bpm.toFixed(3), firstBeatMs: Math.round(fb), duration: +(durMs / 1000).toFixed(3), bars, energy: energy.map(e => +(e / maxE).toFixed(3)) }));
