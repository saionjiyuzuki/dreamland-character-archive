/** Owns page visibility/navigation, lightweight story/character views, and toast UI. */
export class UIController {
    d;
    toastStyleReady = false;
    constructor(d) {
        this.d = d;
    }
    visiblePage(id) {
        this.d.PAGES.concat(['Loading', 'Fatal']).forEach(name => {
            const el = document.getElementById('page' + name);
            if (!el)
                return;
            const visible = !!id && ('page' + name) === id;
            el.classList.toggle('hidden', !visible);
        });
    }
    navigateMenuPage(page) {
        const target = String(page || 'main').toLowerCase();
        ['Main', 'Character', 'Story', 'Settings'].forEach(name => {
            const el = document.getElementById('page' + name);
            if (el)
                el.classList.toggle('hidden', name.toLowerCase() !== target);
        });
        this.d.G.menuPage = target;
        this.d.G.page = target;
        if (target === 'character')
            this.renderCharacters();
        if (target === 'story')
            this.renderStory();
    }
    navigate(page) {
        if (this.d.G.waitingKey !== null)
            this.d.clearWaitingKey();
        if (page === 'songSelect') {
            if (this.d.StateMachine.state === this.d.APP_STATE.MENU ||
                this.d.StateMachine.state === this.d.APP_STATE.RESULT ||
                this.d.StateMachine.state === this.d.APP_STATE.PAUSED) {
                this.d.StateMachine.transition(this.d.APP_STATE.SELECT);
            }
            return;
        }
        if (page === 'main' && (this.d.StateMachine.state === this.d.APP_STATE.SELECT || this.d.StateMachine.state === this.d.APP_STATE.PAUSED)) {
            this.d.StateMachine.transition(this.d.APP_STATE.MENU, { page: 'main' });
            return;
        }
        if (this.d.StateMachine.state !== this.d.APP_STATE.MENU)
            return;
        this.navigateMenuPage(page);
    }
    renderCharacters() {
        const G = this.d.G;
        const grid = this.d.D.charGrid;
        if (!grid)
            return;
        grid.innerHTML = this.d.CHARACTERS.map((c) => `
      <div class="char-card ${G.char.id === c.id ? 'selected' : ''} ${c.unlocked ? '' : 'locked'}"
           data-char="${c.unlocked ? c.id : ''}">
        <div class="char-avatar">${c.emoji}</div>
        <div class="char-name">${c.name}</div>
        <div class="char-level">LV.${c.level} ${c.unlocked ? '' : '🔒'}</div>
        <div class="char-skill">${c.skill}</div>
      </div>`).join('');
    }
    renderStory() {
        const story = this.d.STORY;
        const ch = story[this.d.G.storyIdx] || story[0];
        if (!ch)
            return;
        this.d.D.storyTitle.textContent = ch.title;
        this.d.D.storyContent.innerHTML = ch.content;
    }
    toast(msg) {
        if (!this.toastStyleReady) {
            const st = document.createElement('style');
            st.textContent = '@keyframes toastAnim{0%{opacity:0;transform:translate(-50%,-8px)}15%{opacity:1;transform:translate(-50%,0)}85%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-6px)}}';
            document.head.appendChild(st);
            this.toastStyleReady = true;
        }
        const el = document.createElement('div');
        el.style.cssText = `position:absolute;top:56px;left:50%;transform:translate(-50%,0);
      background:rgba(4,4,10,.92);border:1px solid rgba(125,211,252,.25);color:#eef0f6;
      padding:9px 26px;border-radius:0;font-size:10px;letter-spacing:3px;
      z-index:50;pointer-events:none;white-space:nowrap;text-transform:uppercase;
      animation:toastAnim 1.8s cubic-bezier(.4,0,.2,1) forwards;
      backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);`;
        el.textContent = msg;
        this.d.D.screen.appendChild(el);
        window.setTimeout(() => el.remove(), 1850);
    }
    bindEvents() {
        document.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target)
                return;
            const navEl = target.closest('[data-nav]');
            if (navEl) {
                this.navigate(navEl.dataset.nav || 'main');
                return;
            }
            const placeholderEl = target.closest('[data-menu-placeholder]');
            if (placeholderEl) {
                const feature = placeholderEl.dataset.menuPlaceholder || '该功能';
                this.toast(`${feature}即将开放`);
                return;
            }
            const charEl = target.closest('.char-card');
            if (charEl?.dataset.char) {
                const c = this.d.CHARACTERS.find((item) => item.id === charEl.dataset.char);
                if (c) {
                    this.d.G.char = c;
                    this.renderCharacters();
                    this.toast('已选择 ' + c.name);
                }
            }
        });
        document.getElementById('storyPrevBtn')?.addEventListener('click', () => {
            if (this.d.G.storyIdx > 0) {
                this.d.G.storyIdx--;
                this.renderStory();
            }
        });
        document.getElementById('storyNextBtn')?.addEventListener('click', () => {
            if (this.d.G.storyIdx < this.d.STORY.length - 1) {
                this.d.G.storyIdx++;
                this.renderStory();
            }
        });
    }
}
