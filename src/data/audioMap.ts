/** One audio file per song; every chart of the song (EZ / HD / EX / DZ) shares it. */
const SONG_FILES: Record<string, string> = {
  last_dance: './public/audio/last-dance.flac',
  moonfall: './public/audio/moonfall.flac',
  lanterns: './public/audio/lanterns.flac',
  iron_princess: './public/audio/iron-princess.mp3',
};
export const AUDIO_SOURCES_TEST: Record<string, string> = {};
for (const [song, url] of Object.entries(SONG_FILES)) {
  for (const slot of ['ez', 'hd', 'ex', 'dz']) AUDIO_SOURCES_TEST[`song_${slot}_${song}`] = url;
}
