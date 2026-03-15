/* ============================================================
   lang.js — Language switcher.
   Same pattern as portfolio: .t class + data-ru/data-en attrs.
   ============================================================ */

let currentLang = localStorage.getItem('cl-lang') || 'ru';

/* ── Initial button state ── */
document.addEventListener('DOMContentLoaded', () => {
  syncButtons(currentLang);
});

function setLang(lang) {
  if (lang === currentLang) return;
  currentLang = lang;
  localStorage.setItem('cl-lang', lang);
  syncButtons(lang);

  /* Fade all .t elements out, swap text, fade back in */
  const els = document.querySelectorAll('.t');
  els.forEach(el => el.classList.add('fading'));

  setTimeout(() => {
    els.forEach(el => {
      const val = el.getAttribute('data-' + lang);
      if (val !== null) el.innerHTML = val;
      el.classList.remove('fading');
    });
  }, 180);

  /* Re-render the current release in new language */
  if (typeof rerenderCurrentLang === 'function') rerenderCurrentLang(lang);
}

function syncButtons(lang) {
  const ruBtn = document.getElementById('btn-ru');
  const enBtn = document.getElementById('btn-en');
  if (ruBtn) ruBtn.classList.toggle('active', lang === 'ru');
  if (enBtn) enBtn.classList.toggle('active', lang === 'en');
}

/* Expose for app.js */
window.getCurrentLang = () => currentLang;
