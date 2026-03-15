/* ============================================================
   config-loader.js — Loads config.json, then articles/index.json,
   applies accent colours / noise / font, and bootstraps the wiki.

   Folder structure expected:
     config.json
     articles/
       index.json          ← { "groups": [...] }
       Architecture-EN.md
       Architecture-RU.md
       ...

   To add a new article:
     1. Create articles/MyArticle-EN.md and articles/MyArticle-RU.md
     2. Add an entry in articles/index.json under the right group
   ============================================================ */

(async function bootstrap() {

  /* ── 1. Load config.json ── */
  let cfg;
  try {
    const res = await fetch('config.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cfg = await res.json();
  } catch (err) {
    console.error('[config-loader] Failed to load config.json:', err);
    return;
  }

  applyAccentColors(cfg.theme);
  applyNoise(cfg.noise);
  if (cfg.font?.files?.length) injectFont(cfg.font);
  patchMeta(cfg.site);

  /* ── 2. Load articles/index.json ── */
  const articlesDir = cfg.articlesDir || 'articles';
  let wikiGroups = [];

  try {
    const res = await fetch(`${articlesDir}/index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    wikiGroups = data.groups || [];
  } catch (err) {
    console.error('[config-loader] Failed to load articles/index.json:', err);
  }

  cfg.wikiGroups   = wikiGroups;
  cfg.articlesDir  = articlesDir;
  window.__cfg     = cfg;

  /* ── 3. Signal wiki.js that config is ready ── */
  document.dispatchEvent(new CustomEvent('wiki:ready'));

}());


/* ════════════════════════════════════════════════════════════
   ACCENT COLORS — same as ZenjexSite
   ════════════════════════════════════════════════════════════ */
function applyAccentColors({ accentDark, accentLight } = {}) {
  const root = document.documentElement.style;
  if (accentDark)  root.setProperty('--accent-dark',  accentDark);
  if (accentLight) root.setProperty('--accent-light', accentLight);

  const dark  = accentDark  || '#e8774a';
  const light = accentLight || '#c4542a';

  root.setProperty('--border-dark',        hexToRgba(dark, 0.18));
  root.setProperty('--glow-dark',          hexToRgba(dark, 0.10));
  root.setProperty('--gradient-top-dark',  hexToRgba(dark, 0.12));
  root.setProperty('--gradient-bot-dark',  hexToRgba(dark, 0.06));

  root.setProperty('--border-light',       hexToRgba(light, 0.22));
  root.setProperty('--glow-light',         hexToRgba(light, 0.10));
  root.setProperty('--gradient-top-light', hexToRgba(light, 0.14));
  root.setProperty('--gradient-bot-light', hexToRgba(light, 0.07));
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


/* ════════════════════════════════════════════════════════════
   NOISE — SVG turbulence as body background
   ════════════════════════════════════════════════════════════ */
function applyNoise({ frequency = 0.65, octaves = 1 } = {}) {
  const svg = [
    `<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>`,
    `<filter id='n' color-interpolation-filters='linearRGB'>`,
    `<feTurbulence type='turbulence' baseFrequency='${frequency}' numOctaves='${octaves}' stitchTiles='stitch'/>`,
    `<feColorMatrix type='saturate' values='0'/>`,
    `</filter>`,
    `<rect width='100%' height='100%' filter='url(#n)' opacity='0.06'/>`,
    `</svg>`,
  ].join('');
  const encoded = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  document.documentElement.style.setProperty('--noise-svg', encoded);
}


/* ════════════════════════════════════════════════════════════
   FONT — inject @font-face if config provides font files
   ════════════════════════════════════════════════════════════ */
function injectFont(fontCfg) {
  const { family, fallback } = fontCfg;
  if (!family || family === 'system-ui') return;
  const files = Array.isArray(fontCfg.files) ? fontCfg.files : [];
  if (!files.length) return;

  const rules = files.map(f => buildFontFace(family, f)).join('\n');
  const style = document.createElement('style');
  style.textContent = rules;
  document.head.appendChild(style);
  document.body.style.fontFamily = `'${family}', ${fallback || 'sans-serif'}`;
}

function buildFontFace(family, { path, weight, variable }) {
  const NAMES = {
    thin:100, hairline:100, extralight:200, light:300,
    regular:400, normal:400, medium:500,
    semibold:600, bold:700, extrabold:800, black:900,
  };
  const isVar = variable !== undefined
    ? Boolean(variable)
    : /variable|-vf|[\s_\-]var[\s_.\\-]|VF\./i.test(path || '');
  let fw;
  if (weight !== undefined) {
    const raw = String(weight).trim().toLowerCase();
    fw = NAMES[raw] ?? (/^\d+$/.test(raw) ? raw : 'normal');
  } else {
    fw = isVar ? '100 900' : 'normal';
  }
  const fmt = isVar ? 'woff2-variations' : 'woff2';
  return `@font-face {\n  font-family: '${family}';\n  src: url('${path}') format('${fmt}');\n  font-weight: ${fw};\n  font-style: normal;\n  font-display: swap;\n}`;
}


/* ════════════════════════════════════════════════════════════
   META — patch topbar project name, GitHub link
   ════════════════════════════════════════════════════════════ */
function patchMeta(site = {}) {
  const nameEl = document.getElementById('topbar-project');
  if (nameEl && site.project && nameEl.tagName !== 'IMG') {
    nameEl.textContent = site.project;
  }
  const repoEl = document.getElementById('repo-link');
  if (repoEl) {
    if (site.repoUrl) repoEl.href = site.repoUrl;
    else repoEl.style.display = 'none';
  }
}
