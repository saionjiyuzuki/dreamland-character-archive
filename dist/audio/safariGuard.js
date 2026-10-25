export async function resumeAudioContext(ctx) {
    if (ctx.state === 'suspended')
        await ctx.resume();
}
export async function guardedPlay(media) {
    try {
        await media.play();
        return true;
    }
    catch (e) {
        console.warn('[Audio] blocked', e);
        return false;
    }
}
