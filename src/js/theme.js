/* ============================================================
   theme.js — Light/Dark toggle, identical to portfolio
   ============================================================ */

function initTheme() {
  const saved  = localStorage.getItem('theme');
  const system = window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.setAttribute(
    'data-theme',
    (saved === 'light' || (!saved && system)) ? 'light' : 'dark'
  );
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next    = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
  if (!localStorage.getItem('theme')) {
    document.documentElement.setAttribute('data-theme', e.matches ? 'light' : 'dark');
  }
});

initTheme();
