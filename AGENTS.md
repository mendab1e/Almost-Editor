# AGENTS.md

## Scope

These instructions apply to the entire repository.

Almost Editor is an Electron Markdown editor tailored for Hugo page bundles. It provides a CodeMirror editor, a local Markdown preview, Hugo shortcode handling, a project sidebar, persisted editor/image settings, and ImageMagick-powered image conversion.

## Repository map

- `main.js` — Electron main process, application menu, windows, config persistence, filesystem access, Hugo project operations, and ImageMagick execution.
- `preload.js` — the context-isolated bridge exposed to the renderer as `window.api`.
- `renderer/index.html` — application markup and dialogs.
- `renderer/style.css` — all application styling and theme variables.
- `renderer/renderer.js` — renderer UI state, file/project navigation, preview rendering, unsaved buffers, and drag/drop behavior.
- `renderer/editor-source.js` — CodeMirror setup, themes, typography, line numbers, and Hugo shortcode highlighting.
- `renderer/editor.bundle.js` — tracked generated bundle. Do not edit it by hand; regenerate it with `npm run build`.
- `renderer/markdown-tools.mjs` — pure Hugo/Markdown preprocessing helpers.
- `lib/hugo-project.js` — pure/testable Hugo project discovery, post-name validation, and new-post front matter generation.
- `lib/image-processing.js` — pure/testable ImageMagick argument and shortcode-template helpers.
- `test/` — Node test runner specs.
- `build/icon-modern-bright.png` — the only tracked build asset and the icon referenced by `package.json`.
- `dist/` — generated packages; never commit this directory.

## Commands

```bash
npm install          # install dependencies
npm start            # bundle CodeMirror and launch Electron
npm test             # run all Node specs
npm run build        # regenerate renderer/editor.bundle.js
npm run pack:mac     # create an unpacked Apple Silicon macOS app
npm run dist:mac     # create the Apple Silicon DMG
```

Image conversion also requires the `magick` executable from ImageMagick. On macOS, install it with `brew install imagemagick`.

## Architecture and security

- Keep `contextIsolation: true` and `nodeIntegration: false`.
- Renderer code must not import Node or Electron privileged APIs directly. Add narrowly scoped IPC methods in `preload.js` and handlers in `main.js`.
- Validate IPC payload types and filesystem paths in the main process. Project-relative paths must not escape `content/posts`.
- Use `execFile` with argument arrays for ImageMagick. Do not construct shell command strings from filenames or user input.
- Keep logic that does not require Electron in `lib/` or `renderer/markdown-tools.mjs` so it can be covered by fast unit tests.

## Behavioral contracts

### Hugo projects and posts

- A project root must contain `content/posts`.
- A post is a directory below `content/posts` containing `index.md`; nested post directories are supported.
- A newly created post contains `index.md` and an adjacent empty `images/` directory.
- New-post front matter uses TOML syntax: `+++` delimiters, `key = value` assignments, a quoted `yyyy-mm-dd` date, and `tags = []`.
- When a project post is open, the header displays its front-matter title rather than `index.md` or the directory name.

### Editor state

- Dirty buffers are held in memory per file. Switching sidebar posts must not discard unsaved edits.
- Unsaved state is shown both in the bottom status area and beside the corresponding sidebar post.
- Opening a single file closes the project sidebar. Opening a project restores the post tree.
- Preserve user-resized pane widths after a post is selected; the first sidebar selection starts with an even editor/preview split.

### Markdown and preview

- Support both YAML (`---`) and TOML (`+++`) front matter when reading existing posts.
- Front matter is omitted from preview output.
- Keep ordinary Markdown newlines as normal whitespace (`breaks: false`).
- The focused preview supports the Lightbox shortcode and Hugo `ref` links. It is not intended to emulate arbitrary Hugo layouts or shortcodes.
- Resolve relative image paths from the directory containing the current Markdown file.
- Hugo shortcode syntax should remain highlighted in both light and dark editor themes.

### Image processing and settings

- Default full image: `1500x1500`, JPEG quality `70`.
- Default thumbnail: `500x500`, JPEG quality `60`, with `_thumb` before `.jpg`.
- Generated Markdown paths use POSIX separators and are relative to the post bundle, normally under `images/`.
- The default inserted template is `{{< lightbox src="{src}" thumb="{thumb}" alt="{alt}" >}}`.
- A custom template must contain `{src}`; `{thumb}` and `{alt}` are optional.
- Resize/quality defaults and shortcode-template defaults have independent reset actions.
- When adding a persisted option, update `DEFAULT_CONFIG`, renderer load/save/reset behavior, and relevant documentation/tests. Config loading must continue to merge defaults so older config files remain valid.

## UI conventions

- Use the existing plain HTML/CSS/JavaScript approach; do not introduce a UI framework for a small change.
- Light and dark themes should differ only in color, not typography or geometry.
- Use CSS variables for shared theme colors.
- Status messages remain fixed at the bottom and must not move toolbar controls.
- Preserve keyboard accessibility, button semantics, dialog labels, and Escape-to-close behavior.
- Keep editor and preview panes even by default and retain mouse-resizable splitters.

## Testing and verification

- Add or update a focused spec for pure logic changes.
- Run `npm test` for every code change.
- Run `npm run build` whenever `renderer/editor-source.js` changes, and include the regenerated tracked bundle.
- For renderer-only JavaScript, HTML, or CSS changes, run `npm run build` as a smoke check and manually exercise the affected flow with `npm start` when practical.
- For packaging, version, icon, or release changes, run `npm run dist:mac` and verify the produced app/DMG version.
- Run `git diff --check` before handoff.

## Git and releases

- Do not commit `node_modules/`, `dist/`, or intermediate icon/chroma/iconset files.
- Keep `package-lock.json` synchronized with `package.json`.
- A version bump must update both top-level version entries in `package-lock.json` as well as `package.json`.
- Use tags in the form `v<version>` and attach the matching `dist/Almost Editor-<version>-arm64.dmg` to GitHub releases.
- Do not commit, push, tag, or publish a release unless the user explicitly requests it.
- Preserve unrelated worktree changes and stage only files in the requested scope.

## Documentation

Update `README.md` when user-visible workflows, dependencies, defaults, shortcode placeholders, or packaging instructions change. Keep it oriented toward users; keep implementation and contributor guidance here.
