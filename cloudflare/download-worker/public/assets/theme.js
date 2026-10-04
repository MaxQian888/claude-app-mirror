// Match Cognia's system/light/dark preference without a framework dependency.
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = localStorage.getItem('theme');
    if (['system', 'light', 'dark'].includes(saved)) preference = saved;
  } catch { /* Storage can be disabled; the in-page control still works. */ }
  const apply = () => {
    document.documentElement.dataset.theme = preference === 'system'
      ? (system.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.themeMode = preference;
  };
  apply();
  system.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('theme');
    select.value = preference;
    select.parentElement.hidden = false;
    select.addEventListener('change', () => {
      preference = select.value;
      apply();
      try { localStorage.setItem('theme', preference); } catch { /* Session only. */ }
    });
  });
})();
