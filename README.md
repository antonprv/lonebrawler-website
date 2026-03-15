# Lone Brawler — Wiki & Project Site

Статический сайт для GitHub Pages. Состоит из главной страницы-визитки проекта и вики с документацией всех игровых систем. Поддерживает два языка (RU / EN) и тёмную / светлую тему.

---

## Деплой на GitHub Pages

1. Загрузи содержимое папки `src/` в репозиторий.
2. Перейди в **Settings → Pages**.
3. В поле **Source** выбери ветку (`main` / `master`) и папку **`/src`** (или корень, если выложил файлы напрямую).
4. Нажми **Save** — сайт будет доступен по адресу `https://<username>.github.io/<repo>/`.

> **Важно:** сайт полностью статический, никакого сервера не нужно. Все статьи загружаются через `fetch()`, поэтому открывать `index.html` напрямую из файловой системы (по `file://`) не получится — нужен любой локальный HTTP-сервер (см. ниже).

---

## Локальный запуск

```bash
# Python 3
cd src
python -m http.server 8080

# Node.js (npx)
cd src
npx serve .
```

Затем открой `http://localhost:8080`.

---

## Структура проекта

```
src/
├── index.html              # Главная страница — визитка проекта
├── wiki.html               # Страница вики со статьями
├── config.json             # ← Главный конфиг: цвет, название, ссылки
│
├── articles/
│   ├── index.json          # ← Структура вики: группы и список статей
│   ├── Architecture-EN.md
│   ├── Architecture-RU.md
│   └── ...                 # По паре *-EN.md / *-RU.md на каждую статью
│
├── css/
│   ├── variables.css       # Дизайн-токены, тёмная / светлая тема
│   ├── animations.css      # Keyframes, .reveal, .t fading
│   ├── layout.css          # Topbar, sidebar, контентная область
│   ├── home.css            # Стили главной страницы
│   └── wiki.css            # Стили статей, карточки, prev/next навигация
│
└── js/
    ├── theme.js            # Переключатель тёмной / светлой темы
    ├── lang.js             # Переключатель RU / EN, паттерн .t
    ├── config-loader.js    # Загружает config.json и articles/index.json
    ├── wiki.js             # Строит сайдбар, загружает и рендерит статьи
    ├── marked.min.js       # Кастомный Markdown-парсер
    └── scroll.js           # IntersectionObserver scroll-reveal
```

---

## Настройка проекта

Все глобальные параметры хранятся в одном файле — **`src/config.json`**.

```json
{
  "site": {
    "project":  "Lone Brawler",
    "repoUrl":  "https://github.com/username/repo",
    "stats": {
      "csFiles":   442,
      "articles":  13,
      "testFiles": 53
    }
  },
  "theme": {
    "accentDark":  "#e8774a",
    "accentLight": "#c4542a"
  }
}
```

| Параметр | Описание |
|---|---|
| `site.project` | Название проекта в topbar и заголовках |
| `site.repoUrl` | Ссылка на GitHub — появляется кнопкой в topbar; если пустая, кнопка скрыта |
| `site.stats.*` | Цифры в hero-блоке вики |
| `theme.accentDark` | Цвет акцента в тёмной теме |
| `theme.accentLight` | Цвет акцента в светлой теме |

---

## Добавить новую статью

**Шаг 1.** Создай два файла в `src/articles/`:

```
src/articles/MyFeature-EN.md
src/articles/MyFeature-RU.md
```

Файлы — обычный Markdown. Поддерживаются заголовки, код, таблицы, blockquote, списки.

**Шаг 2.** Добавь запись в **`src/articles/index.json`** в нужную группу:

```json
{
  "id":      "MyFeature",
  "titleRu": "Моя фича",
  "titleEn": "My Feature",
  "descRu":  "Краткое описание для карточки на главной вики",
  "descEn":  "Short description shown on the wiki home card",
  "icon":    "box"
}
```

Доступные значения `icon`: `box`, `code`, `monitor`, `play`, `zap`, `grid`, `save`, `volume`, `layout`, `tool`, `book`, `check`.

Всё — больше ничего менять не нужно. Сайдбар и карточки на главной вики обновятся автоматически.

---

## Добавить новую группу статей

В `src/articles/index.json` добавь новый объект в массив `groups`:

```json
{
  "id":       "networking",
  "titleRu":  "Сеть",
  "titleEn":  "Networking",
  "articles": [
    {
      "id":      "Multiplayer",
      "titleRu": "Мультиплеер",
      "titleEn": "Multiplayer",
      "descRu":  "...",
      "descEn":  "...",
      "icon":    "monitor"
    }
  ]
}
```

---

## Смена цвета акцента

Отредактируй `config.json`:

```json
"theme": {
  "accentDark":  "#4ccbad",
  "accentLight": "#4c3eaf"
}
```

Цвет применяется ко всем границам, кнопкам, ссылкам и элементам сайдбара — через CSS-переменную `--accent`. Изменение вступает в силу без пересборки.

---

## Как работает языковой переключатель

Переключатель RU / EN использует паттерн из `lang.js`:

- HTML-элементы с классом `.t` и атрибутами `data-ru="..."` / `data-en="..."` переключаются автоматически с плавным fade.
- Статьи загружаются по отдельному `.md`-файлу: при переключении языка просто фетчится `MyFeature-RU.md` или `MyFeature-EN.md`.
- Выбранный язык сохраняется в `localStorage` (`cl-lang`).

---

## Как работает переключатель темы

Тема управляется атрибутом `data-theme` на `<html>`:
- `data-theme="dark"` — тёмная (дефолт)
- `data-theme="light"` — светлая

Все цвета — CSS-переменные в `css/variables.css`. Выбранная тема сохраняется в `localStorage` (`theme`). Также учитывается `prefers-color-scheme` системы, если пользователь ещё не выбирал явно.
