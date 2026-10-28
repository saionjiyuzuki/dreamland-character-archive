/** One audio file per song; every chart of the song (EZ / HD / EX / SP) shares it. */
const SONG_FILES = {
    last_dance: './public/audio/last-dance.flac',
};
export const AUDIO_SOURCES_TEST = {};
for (const [song, url] of Object.entries(SONG_FILES)) {
    for (const slot of ['test', 'ez', 'hd', 'ex', 'sp'])
        AUDIO_SOURCES_TEST[`song_${slot}_${song}`] = url;
}
