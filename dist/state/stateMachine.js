export const APP_STATE = Object.freeze({ BOOT: 'BOOT', LOADING: 'LOADING', MENU: 'MENU', SELECT: 'SELECT', PLAYING: 'PLAYING', PAUSED: 'PAUSED', RESULT: 'RESULT', ERROR_FATAL: 'ERROR_FATAL' });
export const PAUSE_REASON = { USER: 'user', VISIBILITY: 'visibility', SYSTEM: 'system' };
const fallbackHooks = { enter() { }, restore() { } };
let hooks = fallbackHooks;
export function setStateHooks(next) { hooks = next; }
export const ALLOWED_TRANSITIONS = {
    BOOT: ['LOADING'], LOADING: [], MENU: ['SELECT'], SELECT: ['MENU', 'LOADING', 'PLAYING'], PLAYING: ['PAUSED', 'RESULT', 'SELECT', 'MENU'], PAUSED: ['PLAYING', 'SELECT', 'MENU'], RESULT: ['LOADING', 'SELECT', 'MENU'], ERROR_FATAL: []
};
export const StateMachine = {
    state: 'BOOT', context: null,
    transition(next, context = {}) {
        const prev = this.state;
        if (next === prev) {
            this.context = context;
            return true;
        }
        let candidates = ALLOWED_TRANSITIONS[prev] || [];
        if (prev === 'LOADING') {
            const scope = this.context?.scope;
            candidates = scope === 'app' ? ['MENU', 'ERROR_FATAL'] : ['SELECT', 'PLAYING'];
        }
        if (!candidates.includes(next))
            return false;
        const prevContext = this.context;
        this.state = next;
        this.context = context;
        try {
            hooks.enter(next, context, prev);
            return true;
        }
        catch (error) {
            console.error('[StateMachine] hook failed; rolling back', prev, '←', next, error);
            this.state = prev;
            this.context = prevContext;
            try {
                hooks.restore(prev, prevContext);
            }
            catch (restoreError) {
                console.error('[StateMachine] restore failed', restoreError);
            }
            return false;
        }
    },
    resetToBoot() { this.state = 'BOOT'; this.context = null; }
};
// V12.4.1 legacy compatibility bridge
if (typeof window !== 'undefined') {
    window.ALLOWED_TRANSITIONS = ALLOWED_TRANSITIONS;
}
