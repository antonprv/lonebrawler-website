/* ============================================================
   wiki.js — Builds the wiki sidebar from articles/index.json
   and renders articles by fetching articles/{id}-{LANG}.md.

   Public functions:
     loadArticle(articleId)    — navigate to an article
     rerenderCurrentLang(lang) — called by lang.js on language switch
   ============================================================ */

let _currentArticle = null;

/* ── Wait for config-loader to finish ── */
document.addEventListener('wiki:ready', initWiki);

/* Fallback: also poll in case the event fires before this script runs */
(function poll() {
  if (window.__cfg) { initWiki(); return; }
  setTimeout(poll, 40);
}());

let _inited = false;
function initWiki() {
  if (_inited) return;
  _inited = true;

  const cfg  = window.__cfg;
  const lang = window.getCurrentLang?.() || 'ru';

  syncLangButtons(lang);
  buildSidebar(cfg.wikiGroups || []);

  /* Navigate to article from URL hash, or show home */
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) {
    const found = findArticle(hash, cfg.wikiGroups);
    if (found) { loadArticle(hash); return; }
  }
  showWikiHome();
}

/* ════════════════════════════════════════════════════════════
   SIDEBAR BUILD
   ════════════════════════════════════════════════════════════ */
function buildSidebar(groups) {
  const list = document.getElementById('wiki-sidebar-list');
  if (!list) return;
  list.innerHTML = '';

  const lang = window.getCurrentLang?.() || 'ru';

  groups.forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'version-group';

    const label = document.createElement('div');
    label.className = 'version-group-label t';
    label.dataset.ru = group.titleRu;
    label.dataset.en = group.titleEn;
    label.textContent = lang === 'ru' ? group.titleRu : group.titleEn;
    groupEl.appendChild(label);

    const subList = document.createElement('ul');
    subList.className = 'version-sublist';

    group.articles.forEach(article => {
      const li = document.createElement('li');
      li.className = 'version-item wiki-article-item';
      li.dataset.article = article.id;

      const btn = document.createElement('button');
      btn.className = 'version-btn';
      btn.innerHTML = `
        <span class="version-btn-tag">
          <span class="wiki-article-icon">
            ${getIcon(article.icon)}
          </span>
          <span class="t" data-ru="${escHtml(article.titleRu)}" data-en="${escHtml(article.titleEn)}">
            ${escHtml(lang === 'ru' ? article.titleRu : article.titleEn)}
          </span>
        </span>`;

      btn.addEventListener('click', () => loadArticle(article.id));
      li.appendChild(btn);
      subList.appendChild(li);
    });

    groupEl.appendChild(subList);
    list.appendChild(groupEl);
  });
}


/* ════════════════════════════════════════════════════════════
   NAVIGATION
   ════════════════════════════════════════════════════════════ */
function loadArticle(articleId) {
  _currentArticle = articleId;

  activateSidebarItem(articleId);
  closeSidebar();

  const lang    = window.getCurrentLang?.() || 'ru';
  const encoded = encodeURIComponent(articleId);
  if (location.hash !== '#' + encoded) history.pushState(null, '', '#' + encoded);

  const cfg = window.__cfg;
  const meta = findArticle(articleId, cfg?.wikiGroups);
  if (meta) {
    document.title = (lang === 'ru' ? meta.titleRu : meta.titleEn) + ' — ' + (cfg?.site?.project || 'Wiki');
  }

  renderArticle(articleId, lang);
}

function showWikiHome() {
  _currentArticle = null;
  activateSidebarItem(null);
  document.getElementById('sidebar-home-btn')?.classList.add('active');

  history.replaceState(null, '', location.pathname);

  const cfg  = window.__cfg;
  const lang = window.getCurrentLang?.() || 'ru';
  document.title = (cfg?.site?.project || 'Lone Brawler') + ' Wiki';

  renderWikiHome(lang);
}

function activateSidebarItem(articleId) {
  document.querySelectorAll('.version-item').forEach(el => el.classList.remove('active'));
  document.getElementById('sidebar-home-btn')?.classList.remove('active');

  if (articleId) {
    const el = document.querySelector(`[data-article="${articleId}"]`);
    if (el) el.classList.add('active');
  }
}


/* ════════════════════════════════════════════════════════════
   RENDER WIKI HOME
   ════════════════════════════════════════════════════════════ */
function renderWikiHome(lang) {
  const content = document.getElementById('wiki-content');
  if (!content) return;

  const cfg    = window.__cfg;
  const groups = cfg?.wikiGroups || [];
  const site   = cfg?.site || {};
  const isRu   = lang === 'ru';

  let cardsHtml = '';
  groups.forEach(g => {
    const groupTitle = isRu ? g.titleRu : g.titleEn;
    cardsHtml += `<p class="wiki-home-section-title">${escHtml(groupTitle)}</p><div class="wiki-home-cards">`;
    g.articles.forEach(a => {
      const title = isRu ? a.titleRu : a.titleEn;
      const desc  = isRu ? a.descRu  : a.descEn;
      cardsHtml += `
        <button class="wiki-home-card" onclick="loadArticle('${a.id}')">
          <div class="wiki-home-card-icon">${getIcon(a.icon, 22)}</div>
          <div class="wiki-home-card-title">${escHtml(title)}</div>
          <div class="wiki-home-card-desc">${escHtml(desc)}</div>
        </button>`;
    });
    cardsHtml += '</div>';
  });

  const stats   = site.stats || {};
  const heroSub = isRu
    ? '3D экшн на Unity — полный производственный цикл. Документация охватывает геймплей, инфраструктуру, UI, данные и инструментарий.'
    : 'A 3D action game built in Unity — full production pipeline. Documentation covering gameplay, infrastructure, UI, data management, and tooling.';

  content.innerHTML = `
    <div class="wiki-content">
      <div class="wiki-home-hero">
        <h1 class="wiki-home-title">
          ${escHtml(site.project || 'Lone Brawler')} <span>${isRu ? 'Вики' : 'Wiki'}</span>
        </h1>
        <p class="wiki-home-sub">${heroSub}</p>
        ${stats.csFiles || stats.articles ? `
        <div class="wiki-home-stats">
          ${stats.csFiles  ? `<div class="wiki-home-stat"><div class="wiki-home-stat-num">${stats.csFiles}</div><div class="wiki-home-stat-label">C# files</div></div>` : ''}
          ${stats.articles ? `<div class="wiki-home-stat"><div class="wiki-home-stat-num">${stats.articles}</div><div class="wiki-home-stat-label">${isRu ? 'статей' : 'articles'}</div></div>` : ''}
          ${stats.testFiles? `<div class="wiki-home-stat"><div class="wiki-home-stat-num">${stats.testFiles}</div><div class="wiki-home-stat-label">${isRu ? 'тест-файлов' : 'test files'}</div></div>` : ''}
        </div>` : ''}
      </div>
      ${cardsHtml}
    </div>`;
}


/* ════════════════════════════════════════════════════════════
   RENDER ARTICLE — fetch .md, parse with marked, inject
   ════════════════════════════════════════════════════════════ */
async function renderArticle(articleId, lang) {
  const content = document.getElementById('wiki-content');
  if (!content) return;

  content.innerHTML = `
    <div class="wiki-content">
      <div class="wiki-loading">
        <div class="wiki-loading-dot"></div>
        <div class="wiki-loading-dot"></div>
        <div class="wiki-loading-dot"></div>
      </div>
    </div>`;

  const cfg        = window.__cfg;
  const articlesDir = cfg?.articlesDir || 'articles';
  const langUpper  = lang.toUpperCase();
  const url        = `${articlesDir}/${articleId}-${langUpper}.md`;
  const fallback   = `${articlesDir}/${articleId}-EN.md`;

  let md = '';
  try {
    let res = await fetch(url);
    if (!res.ok && url !== fallback) res = await fetch(fallback);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    md = await res.text();
  } catch (err) {
    content.innerHTML = `<div class="wiki-content"><div class="wiki-error">Could not load article: ${articleId}</div></div>`;
    console.error('[wiki.js] fetch article:', err);
    return;
  }

  const html = typeof marked !== 'undefined' ? marked.parse(md) : `<pre>${escHtml(md)}</pre>`;
  const wrap = document.createElement('div');
  wrap.className = 'wiki-content';
  const body = document.createElement('div');
  body.className = 'wiki-body';
  body.innerHTML = html;
  wrap.appendChild(body);

  /* Prev / Next navigation */
  const nav = buildArticleNav(articleId, lang);
  if (nav) wrap.appendChild(nav);

  content.innerHTML = '';
  content.appendChild(wrap);

  /* Apply C# syntax highlighting */
  applyCodeHighlighting(wrap);

  /* Scroll to top */
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ════════════════════════════════════════════════════════════
   PREV / NEXT NAV
   ════════════════════════════════════════════════════════════ */
function buildArticleNav(articleId, lang) {
  const cfg = window.__cfg;
  const flat = flatArticles(cfg?.wikiGroups || []);
  const idx  = flat.findIndex(a => a.id === articleId);
  if (idx < 0) return null;

  const prev = flat[idx - 1];
  const next = flat[idx + 1];
  const isRu = lang === 'ru';

  const nav = document.createElement('div');
  nav.className = 'wiki-article-nav';

  if (prev) {
    const btn = document.createElement('button');
    btn.className = 'wiki-nav-btn wiki-nav-btn--prev';
    btn.innerHTML = `<span class="wiki-nav-label">${isRu ? '← Назад' : '← Previous'}</span><span class="wiki-nav-title">${escHtml(isRu ? prev.titleRu : prev.titleEn)}</span>`;
    btn.addEventListener('click', () => loadArticle(prev.id));
    nav.appendChild(btn);
  }

  if (next) {
    const btn = document.createElement('button');
    btn.className = 'wiki-nav-btn wiki-nav-btn--next';
    btn.innerHTML = `<span class="wiki-nav-label">${isRu ? 'Далее →' : 'Next →'}</span><span class="wiki-nav-title">${escHtml(isRu ? next.titleRu : next.titleEn)}</span>`;
    btn.addEventListener('click', () => loadArticle(next.id));
    nav.appendChild(btn);
  }

  return nav;
}


/* ════════════════════════════════════════════════════════════
   LANGUAGE SWITCH — called by lang.js
   ════════════════════════════════════════════════════════════ */
function rerenderCurrentLang(lang) {
  syncLangButtons(lang);

  /* Update sidebar text */
  document.querySelectorAll('#wiki-sidebar-list .t').forEach(el => {
    const v = el.getAttribute('data-' + lang);
    if (v !== null) el.textContent = v;
  });

  const homeBtn = document.getElementById('sidebar-home-btn');
  if (homeBtn) {
    const v = homeBtn.getAttribute('data-' + lang);
    if (v !== null) homeBtn.textContent = homeBtn.textContent; /* handled by .t fade */
  }

  if (_currentArticle) {
    renderArticle(_currentArticle, lang);
  } else {
    renderWikiHome(lang);
  }
}


/* ════════════════════════════════════════════════════════════
   SIDEBAR MOBILE TOGGLE
   ════════════════════════════════════════════════════════════ */
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const btn      = document.getElementById('sidebar-toggle');
  const open     = sidebar.classList.toggle('open');
  backdrop.classList.toggle('open', open);
  btn.classList.toggle('open', open);
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('open');
  document.getElementById('sidebar-toggle')?.classList.remove('open');
}


/* ── Browser back/forward ── */
window.addEventListener('popstate', () => {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (!hash) { showWikiHome(); return; }
  const found = findArticle(hash, window.__cfg?.wikiGroups);
  if (found) loadArticle(hash);
  else showWikiHome();
});


/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */
function syncLangButtons(lang) {
  const ruBtn = document.getElementById('btn-ru');
  const enBtn = document.getElementById('btn-en');
  if (ruBtn) ruBtn.classList.toggle('active', lang === 'ru');
  if (enBtn) enBtn.classList.toggle('active', lang === 'en');
}

function findArticle(id, groups = []) {
  for (const g of groups)
    for (const a of g.articles)
      if (a.id === id) return a;
  return null;
}

function flatArticles(groups = []) {
  return groups.flatMap(g => g.articles);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Icon name → SVG string */
function getIcon(name, size = 12) {
  const s = size;
  const icons = {
    box:     `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>`,
    code:    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    monitor: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
    play:    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    zap:     `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
    grid:    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    save:    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
    volume:  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>`,
    layout:  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`,
    tool:    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>`,
    book:    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>`,
    check:   `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
    home:    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  };
  return icons[name] || icons.box;
}


/* ════════════════════════════════════════════════════════════
   C# SYNTAX HIGHLIGHTING
   Called after article HTML is injected into the DOM.
   ════════════════════════════════════════════════════════════ */
function highlightCsharp(block) {
  var raw   = block.innerHTML;
  var lines = raw.split('\n');
  var out   = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var commentStart = -1;
    for (var ci = 0; ci < line.length - 1; ci++) {
      if (line[ci] === '/' && line[ci + 1] === '/' && (ci === 0 || line[ci - 1] !== ':')) {
        commentStart = ci;
        break;
      }
    }
    var codePart    = commentStart >= 0 ? line.slice(0, commentStart) : line;
    var commentPart = commentStart >= 0 ? line.slice(commentStart)    : '';

    codePart = highlightCodeLine(codePart);
    if (commentPart) commentPart = '<span class="hl-c">' + commentPart + '</span>';
    out.push(codePart + commentPart);
  }
  block.innerHTML = out.join('\n');
}

function highlightCodeLine(s) {
  var strings = [];
  s = s.replace(/(&quot;(?:[^&]|&(?!quot;))*&quot;)/g, function(m) {
    strings.push(m);
    return '\x00S' + (strings.length - 1) + '\x00';
  });

  var attrs = [];
  s = s.replace(/\[([A-Za-z][A-Za-z0-9_., ]*)\]/g, function(m) {
    attrs.push(m);
    return '\x00A' + (attrs.length - 1) + '\x00';
  });

  var KW = 'public|private|protected|internal|static|abstract|override|virtual|sealed|readonly|const|new|class|interface|namespace|using|return|void|bool|int|float|double|string|var|null|true|false|this|base|typeof|if|else|for|foreach|while|yield|async|await|get|set|in|out|ref|params|where|event|delegate|partial|struct|enum|operator|is|as|try|catch|finally|throw|switch|case|break|continue';
  s = s.replace(new RegExp('\\b(' + KW + ')\\b', 'g'), '<span class="hl-k">$1</span>');

  s = s.replace(/\x00S(\d+)\x00/g, function(_, i) {
    return '<span class="hl-s">' + strings[+i] + '</span>';
  });

  s = s.replace(/\b([A-Z][A-Za-z0-9_]*)\b(?![^<]*>)/g, '<span class="hl-t">$1</span>');

  s = s.replace(/\x00A(\d+)\x00/g, function(_, i) {
    return '<span class="hl-a">' + attrs[+i] + '</span>';
  });

  return s;
}

/* Run highlighting on all csharp blocks after render */
function applyCodeHighlighting(container) {
  container.querySelectorAll('code.language-csharp, code.language-cs').forEach(highlightCsharp);
}
