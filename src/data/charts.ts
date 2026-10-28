import type { Chart } from '../core/types.js';
import { LAST_DANCE_SP20 } from './lastDanceChart.js';

/** Built-in SP charts. EZ / HD / EX charts are derived and registered by songs.ts. */
export const CHARTS: Record<string, Chart> = {
  song_sp_last_dance: LAST_DANCE_SP20,
};
