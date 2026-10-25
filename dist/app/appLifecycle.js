import { StateMachine, APP_STATE } from '../state/stateMachine.js';
export async function enterAppLoading(loader) {
    StateMachine.transition(APP_STATE.LOADING, { scope: 'app' });
    try {
        await loader();
        StateMachine.transition(APP_STATE.MENU, {});
    }
    catch (error) {
        console.error('[AppLifecycle] fatal', error);
        StateMachine.transition(APP_STATE.ERROR_FATAL, { error });
    }
}
