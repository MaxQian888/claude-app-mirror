import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./public/assets/theme.js', import.meta.url), 'utf8');

function setup({ reduced = false, supported = true, saved = null, storageBlocked = false, startThrows = false, readyRejects = false } = {}) {
  const listeners = new Map();
  const animations = [];
  const starts = [];
  const storage = new Map([['theme', saved]]);
  const styles = new Map();
  let finish;
  const document = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    activeElement: null,
    documentElement: {
      dataset: {},
      style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) },
      animate: (frames, options) => animations.push({ frames, options }),
    },
  };
  function element(mode) {
    const handlers = new Map();
    const attributes = new Map();
    return {
      dataset: { mode }, hidden: true, attributes,
      addEventListener: (name, handler) => handlers.set(name, handler),
      emit: (name, event = {}) => handlers.get(name)?.({ preventDefault() {}, ...event }),
      setAttribute: (key, value) => attributes.set(key, value),
      focus() { document.activeElement = this; },
      getBoundingClientRect: () => ({ left: 800, top: 100, width: 160, height: 40 }),
    };
  }
  const trigger = element();
  const menu = element();
  const options = ['light', 'dark', 'system'].map(element);
  const picker = element();
  picker.contains = target => [trigger, menu, ...options].includes(target);
  menu.querySelectorAll = () => options;
  document.querySelector = () => picker;
  document.getElementById = id => id === 'theme-trigger' ? trigger : menu;
  const system = { matches: false, addEventListener: (_, handler) => { system.change = handler; } };
  if (supported) document.startViewTransition = update => {
    starts.push(true);
    if (startThrows) throw new Error('transition unavailable');
    update();
    return {
      ready: readyRejects ? Promise.reject(new Error('snapshot skipped')) : Promise.resolve(),
      finished: new Promise(resolve => { finish = resolve; }),
      skipTransition: () => finish(),
    };
  };
  vm.runInNewContext(source, {
    document,
    window: { innerWidth: 1000, innerHeight: 800,
      matchMedia: query => query.includes('reduced-motion') ? { matches: reduced } : system },
    localStorage: {
      getItem: key => { if (storageBlocked) throw new Error('blocked'); return storage.get(key); },
      setItem: (key, value) => { if (storageBlocked) throw new Error('blocked'); storage.set(key, value); },
    },
  });
  listeners.get('DOMContentLoaded')();
  return { root: document.documentElement, document, trigger, menu, options, picker, system, styles,
    animations, starts, storage, choose: mode => options.find(option => option.dataset.mode === mode).emit('click'),
    finish: () => finish?.(), emit: (name, event) => listeners.get(name)(event),
  };
}

test('manual theme change matches Cognia circular reveal timing and percentage origin', async () => {
  const app = setup();
  app.choose('dark');
  await Promise.resolve();
  assert.equal(app.root.dataset.theme, 'dark');
  assert.equal(app.storage.get('theme'), 'dark');
  assert.equal(app.root.dataset.themeTransition, 'active');
  assert.equal(app.animations.length, 1);
  const { frames, options } = app.animations[0];
  assert.equal(frames.clipPath[0], 'circle(0% at 88% 15%)');
  const expected = Math.hypot(880, 680) / (Math.hypot(1000, 800) / Math.SQRT2) * 100;
  assert.equal(frames.clipPath[1], `circle(${expected}% at 88% 15%)`);
  assert.equal(options.duration, 400);
  assert.equal(options.easing, 'ease-in-out');
  assert.equal(options.pseudoElement, '::view-transition-new(root)');
  assert.equal(options.fill, 'forwards');
  assert.equal(app.styles.get('--theme-clip-from'), frames.clipPath[0]);
  app.finish();
  await Promise.resolve();
  assert.equal(app.root.dataset.themeTransition, undefined);
  assert.equal(app.styles.size, 0);
});

test('reduced motion and unsupported browsers apply theme without animation', () => {
  for (const settings of [{ reduced: true }, { supported: false }]) {
    const app = setup(settings);
    app.choose('dark');
    assert.equal(app.root.dataset.theme, 'dark');
    assert.equal(app.starts.length, 0);
    assert.equal(app.storage.get('theme'), 'dark');
  }
});

test('same visual theme and automatic system changes do not animate', () => {
  const app = setup({ saved: 'light' });
  app.choose('system');
  assert.equal(app.starts.length, 0);
  assert.equal(app.storage.get('theme'), 'system');
  app.system.matches = true;
  app.system.change();
  assert.equal(app.root.dataset.theme, 'dark');
  assert.equal(app.starts.length, 0);
});

test('rapid selections cannot overlap transitions and can switch again after completion', async () => {
  const app = setup();
  app.choose('dark');
  app.choose('light');
  assert.equal(app.starts.length, 1);
  assert.equal(app.root.dataset.theme, 'dark');
  await Promise.resolve();
  app.finish();
  await Promise.resolve();
  app.choose('light');
  assert.equal(app.starts.length, 2);
  assert.equal(app.root.dataset.theme, 'light');
});

test('failed transitions release the guard and keep the chosen theme', async () => {
  for (const settings of [{ startThrows: true }, { readyRejects: true }]) {
    const app = setup(settings);
    app.choose('dark');
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    assert.equal(app.root.dataset.theme, 'dark');
    assert.equal(app.root.dataset.themeTransition, undefined);
    app.choose('light');
    assert.equal(app.root.dataset.theme, 'light');
  }
});

test('menu supports keyboard navigation, Escape, outside clicks and focus return', () => {
  const app = setup({ supported: false });
  app.trigger.emit('keydown', { key: 'ArrowDown' });
  assert.equal(app.menu.hidden, false);
  assert.equal(app.document.activeElement.dataset.mode, 'system');
  app.menu.emit('keydown', { key: 'Home' });
  assert.equal(app.document.activeElement.dataset.mode, 'light');
  app.menu.emit('keydown', { key: 'ArrowDown' });
  assert.equal(app.document.activeElement.dataset.mode, 'dark');
  app.choose('dark');
  assert.equal(app.menu.hidden, true);
  assert.equal(app.options[1].attributes.get('aria-checked'), 'true');
  assert.equal(app.document.activeElement, app.trigger);
  app.trigger.emit('click');
  app.emit('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(app.menu.hidden, true);
  assert.equal(app.trigger.attributes.get('aria-expanded'), 'false');
  app.trigger.emit('click');
  app.emit('pointerdown', { target: {} });
  assert.equal(app.menu.hidden, true);
});

test('blocked storage does not break theme switching', () => {
  const app = setup({ storageBlocked: true, supported: false });
  app.choose('dark');
  assert.equal(app.root.dataset.theme, 'dark');
  assert.equal(app.picker.hidden, false);
});
