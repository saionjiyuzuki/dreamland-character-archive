import { LAST_DANCE_DZ } from './lastDanceChart.js';
import { SONG_CHARTS } from './songCharts.js';
/**
 * Every built-in chart, keyed song_{ez,hd,ex,dz}_<song>. The EZ / HD / EX / DZ charts are generated from the audio
 * by scripts/charts/generate.mjs; Last Dance DZ is the hand-designed chart from scripts/charts/last-dance.mjs.
 */
export const CHARTS = {
    ...SONG_CHARTS,
    song_dz_last_dance: LAST_DANCE_DZ,
};
