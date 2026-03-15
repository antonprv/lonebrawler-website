/* ============================================================
   scroll.js — Intersection Observer scroll-reveal
   Identical to portfolio's scroll.js
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.1 }
  );

  /* Observe .reveal elements, including dynamically added ones */
  const observe = () => {
    document.querySelectorAll('.reveal').forEach(el => {
      if (!el._observed) {
        observer.observe(el);
        el._observed = true;
      }
    });
  };

  observe();

  /* Re-scan when new release is rendered */
  const content = document.getElementById('release-content');
  if (content) {
    new MutationObserver(observe).observe(content, { childList: true, subtree: true });
  }
});
