/* theme.js — day/night theme shared across pages */
(function () {
  const KEY = 'lammahTheme';

  function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'light' ? '#f4f7f5' : '#071a12');
    return next;
  }

  function getTheme() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) { /* ignore */ }
    return 'dark';
  }

  function toggleTheme() {
    return applyTheme(getTheme() === 'light' ? 'dark' : 'light');
  }

  window.LammahTheme = { applyTheme, getTheme, toggleTheme };
  applyTheme(getTheme());
})();
