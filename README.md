# Lone Brawler - Wiki

Static wiki site for the Lone Brawler Unity project. Two pages: a project landing page (`index.html`) and a wiki with a sidebar and article renderer (`wiki.html`). Built to match the style and architecture of the [Zenjex site](https://github.com/antonprv/Zenjex).

---

## Structure

```
src/
  index.html              - Project landing page
  wiki.html               - Wiki with sidebar and article renderer
  config.json             - Site config: accent colour, project name, stats
  css/
    variables.css         - Design tokens, dark/light themes
    animations.css        - Keyframes and transition helpers
    layout.css            - Topbar, sidebar, content area
    home.css              - Landing page styles
    wiki.css              - Article body, home cards, prev/next nav
  js/
    theme.js              - Dark/light toggle, persisted in localStorage
    lang.js               - RU/EN switcher, .t + data-ru/data-en pattern
    marked.min.js         - Markdown parser (headings, tables, code, lists)
    config-loader.js      - Loads config.json and articles/index.json
    wiki.js               - Builds sidebar, fetches and renders articles
    scroll.js             - IntersectionObserver scroll-reveal
  articles/
    index.json            - Wiki structure: groups and article metadata
    Architecture-EN.md
    Architecture-RU.md
    Audio-EN.md
    Audio-RU.md
    Buff-System-EN.md
    Buff-System-RU.md
    Custom-Libraries-EN.md
    Custom-Libraries-RU.md
    Editor-Tooling-EN.md
    Editor-Tooling-RU.md
    Gameplay-EN.md
    Gameplay-RU.md
    Inventory-EN.md
    Inventory-RU.md
    Platform-and-SDKs-EN.md
    Platform-and-SDKs-RU.md
    Save-System-EN.md
    Save-System-RU.md
    Testing-EN.md
    Testing-RU.md
    UI-EN.md
    UI-RU.md
    Zenjex-EN.md
    Zenjex-RU.md
```

---

## Adding a new article

1. Create `articles/MyArticle-EN.md` and `articles/MyArticle-RU.md`.
2. Add an entry in `articles/index.json` under the appropriate group:

```json
{
  "id":      "MyArticle",
  "titleRu": "Моя статья",
  "titleEn": "My Article",
  "descRu":  "Краткое описание на русском",
  "descEn":  "Short description in English",
  "icon":    "box"
}
```

Available icon names: `box`, `code`, `monitor`, `play`, `zap`, `grid`, `save`, `volume`, `layout`, `tool`, `book`, `check`.

That's it. The sidebar and home cards update automatically.

---

## Configuration

Everything site-specific lives in `config.json`:

```json
{
  "site": {
    "project":  "Lone Brawler",
    "repoUrl":  "https://github.com/yourname/yourrepo",
    "stats": {
      "csFiles":   442,
      "articles":  13,
      "testFiles": 53
    }
  },
  "theme": {
    "accentDark":  "#e8774a",
    "accentLight": "#c4542a"
  },
  "noise": {
    "frequency": 0.65,
    "octaves":   1
  }
}
```

- `accentDark` / `accentLight` - primary accent colour for each theme. All borders, glows, and gradients are derived from these values at runtime.
- `repoUrl` - if set, a GitHub link appears in the topbar. Leave empty to hide it.
- `stats` - numbers shown in the wiki home hero section.
- `noise` - SVG turbulence grain overlaid on the background. Set `frequency: 0` to disable.

---

## Running locally

The site fetches `config.json` and article files via `fetch()`, so it needs to be served over HTTP - opening `index.html` directly from the filesystem will not work.

Any local server works:

```bash
# Python
python3 -m http.server 8080 --directory src

# Node (npx)
npx serve src
```

Then open `http://localhost:8080`.

---

## Theming

The theme toggle button is in the top-left corner. The language switcher (RU / EN) is in the top-right corner. Both preferences are saved in `localStorage` and restored on the next visit.

To change the colour scheme, edit `accentDark` and `accentLight` in `config.json`. The config loader applies the colours and computes all derived values (border opacity, glow, gradient stops) automatically.

---

## Custom fonts

To use a custom font, add it to `src/` and update `config.json`:

```json
"font": {
  "family":   "MyFont",
  "fallback": "system-ui, sans-serif",
  "files": [
    { "path": "fonts/MyFont.woff2", "variable": true }
  ]
}
```

Set `"variable": true` for variable fonts (`font-weight: 100 900`), `false` for static ones.

---

## Article format

Articles are standard Markdown. Supported elements: headings (h1-h4), paragraphs, bold, italic, inline code, fenced code blocks, blockquotes, unordered and ordered lists, tables, and horizontal rules.

Code blocks with a language tag get the class `language-{lang}` on the `<code>` element, which you can target with a syntax highlighter if needed.

Comments in the form `<!-- screenshot -->` are ignored by the parser and can be used as placeholders inside article source files.
