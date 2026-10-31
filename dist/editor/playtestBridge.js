import { loadPlaytestAudio, readPlaytest } from './audioStore.js';
import { PLAYTEST_CHART_ID } from './chartModel.js';
export const isPlaytestRequest = (search = location.search) => new URLSearchParams(search).has('playtest');
/** Chart plus a blob: URL of its audio, or an error message for the player. */
export async function loadPlaytest() {
    const payload = readPlaytest();
    if (!payload)
        return { error: '没有找到编辑器的试玩谱面，请从谱面编辑器点击「试玩」' };
    const chart = payload.chart;
    if (chart.id !== PLAYTEST_CHART_ID || !Array.isArray(chart.notes))
        return { error: '试玩谱面格式错误' };
    const audio = await loadPlaytestAudio();
    if (!audio || audio.savedAt !== payload.savedAt)
        return { error: '没有找到试玩音频，请从谱面编辑器重新点击「试玩」' };
    return { chart, audioUrl: URL.createObjectURL(new Blob([audio.data], { type: audio.type || 'audio/wav' })) };
}
