// Match Cognia's theme menu and circular reveal without a framework dependency.
(() => {
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let preference = 'system';
  let transition = null;
  try {
    const saved = localStorage.getItem('theme');
    if (['system', 'light', 'dark'].includes(saved)) preference = saved;
  } catch { /* Storage can be disabled; the in-page control still works. */ }
  const resolveTheme = mode => mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
  const apply = () => {
    root.dataset.theme = resolveTheme(preference);
    root.dataset.themeMode = preference;
  };
  apply();
  system.addEventListener('change', () => {
    if (preference === 'system') {
      transition?.skipTransition();
      apply();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const picker = document.querySelector('.theme-picker');
    const trigger = document.getElementById('theme-trigger');
    const menu = document.getElementById('theme-menu');
    const options = Array.from(menu.querySelectorAll('[data-mode]'));
    const syncSelection = () => options.forEach(option => {
      option.setAttribute('aria-checked', String(option.dataset.mode === preference));
    });
    const close = (restoreFocus = false) => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    };
    const open = () => {
      if (transition) return;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      options.find(option => option.dataset.mode === preference).focus();
    };
    const cleanup = () => {
      transition = null;
      delete root.dataset.themeTransition;
      root.style.removeProperty('--theme-clip-from');
    };
    const choose = option => {
      if (transition) return;
      const mode = option.dataset.mode;
      const update = () => {
        preference = mode;
        apply();
        syncSelection();
        close(true);
        try { localStorage.setItem('theme', preference); } catch { /* Session only. */ }
      };
      if (reducedMotion.matches || resolveTheme(mode) === root.dataset.theme ||
          typeof document.startViewTransition !== 'function' || typeof root.animate !== 'function') {
        update();
        return;
      }

      const { left, top, width, height } = option.getBoundingClientRect();
      const x = left + width / 2;
      const y = top + height / 2;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const radius = Math.hypot(Math.max(x, viewportWidth - x), Math.max(y, viewportHeight - y));
      // Same percentage geometry as Cognia: pixel clip paths drift on fractional
      // display scales. circle() uses the normalized diagonal for its radius.
      const center = `${x / viewportWidth * 100}% ${y / viewportHeight * 100}%`;
      const clipPath = [
        `circle(0% at ${center})`,
        `circle(${radius / (Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2) * 100}% at ${center})`,
      ];
      root.dataset.themeTransition = 'active';
      root.style.setProperty('--theme-clip-from', clipPath[0]);
      try {
        transition = document.startViewTransition(update);
      } catch {
        cleanup();
        update();
        return;
      }
      const current = transition;
      current.finished.then(cleanup, cleanup);
      current.ready.then(() => {
        root.animate({ clipPath }, {
          duration: 400,
          easing: 'ease-in-out',
          fill: 'forwards',
          pseudoElement: '::view-transition-new(root)',
        });
      }).catch(() => current.skipTransition());
    };

    syncSelection();
    picker.hidden = false;
    trigger.addEventListener('click', () => menu.hidden ? open() : close());
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open();
      }
    });
    options.forEach(option => option.addEventListener('click', () => choose(option)));
    menu.addEventListener('keydown', event => {
      const index = options.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next].focus();
      } else if (event.key === 'Tab') {
        close(true);
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        close(true);
      }
    });
    document.addEventListener('pointerdown', event => {
      if (!picker.contains(event.target)) close();
    });
  });
})();
