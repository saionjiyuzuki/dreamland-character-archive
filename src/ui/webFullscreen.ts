/**
 * 网页全屏: lets the game fill the whole browser window instead of the default 1440px-wide centred column.
 * This is not the browser Fullscreen API; the browser UI stays visible. The choice is remembered in localStorage.
 */
const STORAGE_KEY = 'dreamland_web_fullscreen';
const CLASS_NAME = 'web-fullscreen';

function stored(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

export function isWebFullscreen(): boolean { return document.body.classList.contains(CLASS_NAME); }

export function setWebFullscreen(on: boolean): void {
  document.body.classList.toggle(CLASS_NAME, on);
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* storage unavailable: keep the in-memory state */ }
  document.querySelectorAll<HTMLElement>('[data-web-fullscreen]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? '退出网页全屏' : '网页全屏';
    btn.setAttribute('aria-label', btn.title);
  });
  // The game canvas and lane geometry re-measure on window resize; the window size itself does not change here.
  window.dispatchEvent(new Event('resize'));
}

export function bindWebFullscreen(): void {
  setWebFullscreen(stored());
  document.addEventListener('click', (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-web-fullscreen]')) setWebFullscreen(!isWebFullscreen());
  });
}
