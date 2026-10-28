/**
 * 真全屏 (browser Fullscreen API): hides the browser chrome (tab bar / address bar).
 * Uses the standard Fullscreen API with a Safari `webkit` prefix fallback.
 * Note: iOS Safari does not support the Fullscreen API for arbitrary elements,
 * so on iOS the button is a no-op (the web-fullscreen toggle still works there).
 */
function wdoc() {
    return document;
}
function requestFullscreen() {
    const el = document.documentElement;
    if (typeof el.requestFullscreen === 'function')
        return el.requestFullscreen();
    if (typeof el.webkitRequestFullscreen === 'function')
        return el.webkitRequestFullscreen();
    throw new Error('Fullscreen API unavailable');
}
function exitFullscreen() {
    const d = wdoc();
    if (typeof d.exitFullscreen === 'function')
        return d.exitFullscreen();
    if (typeof d.webkitExitFullscreen === 'function')
        return d.webkitExitFullscreen();
    throw new Error('Fullscreen API unavailable');
}
export function isFullscreen() {
    const d = wdoc();
    return !!(d.fullscreenElement ?? d.webkitFullscreenElement ?? null);
}
function updateButtons() {
    const on = isFullscreen();
    document.querySelectorAll('[data-fullscreen]').forEach(btn => {
        btn.setAttribute('aria-pressed', String(on));
        btn.title = on ? '退出全屏' : '全屏';
        btn.setAttribute('aria-label', btn.title);
    });
}
export function toggleFullscreen() {
    try {
        const pending = isFullscreen() ? exitFullscreen() : requestFullscreen();
        Promise.resolve(pending)
            .then(() => updateButtons())
            .catch(() => updateButtons());
    }
    catch {
        updateButtons();
    }
}
export function bindFullscreen() {
    updateButtons();
    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('[data-fullscreen]'))
            toggleFullscreen();
    });
    const d = wdoc();
    d.addEventListener('fullscreenchange', () => updateButtons());
    // Safari fires `webkitfullscreenchange` instead of `fullscreenchange`.
    d.addEventListener('webkitfullscreenchange', () => updateButtons());
}
