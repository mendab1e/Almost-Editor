# Markdown Blog Editor

A minimal macOS Electron app for writing Markdown blog posts. Drag or paste an
image into the editor and it's automatically resized/converted with
ImageMagick and inserted as a Markdown tag at your cursor.

## Setup

```bash
# 1. Install ImageMagick (if you don't have it)
brew install imagemagick

# 2. Install app dependencies
cd markdown-blog-editor
npm install

# 3. Run it
npm start
```

## How it works

1. **File > Open** an existing `.md` post, or **File > New**, then **Save**
   it once so the app knows which folder to put processed images in.
2. Drag an image file onto the editor (or paste one from the clipboard).
3. You'll be asked for alt text, then the app runs ImageMagick to resize
   (max width, never upscales) and convert the image, saving it into an
   `images/` subfolder next to your `.md` file.
4. The configured tag template is inserted at your cursor with the new
   image path filled in.

## Customizing the inserted tag

Settings live in Electron's per-user config file (not in the repo), loaded
via `main.js`'s `DEFAULT_CONFIG`. Easiest way to change them for now: edit
`DEFAULT_CONFIG` in `main.js`, e.g.:

```js
const DEFAULT_CONFIG = {
  tagTemplate: '{% image "{src}" "{alt}" %}',  // e.g. Hugo shortcode style
  imagesSubdir: 'images',
  maxWidth: 1600,
  outputFormat: 'webp',
  quality: 82
};
```

`{src}` and `{alt}` are replaced automatically. A future version could
expose this in a Preferences window instead of requiring a code edit —
happy to add that next if useful.

## Packaging as a real .app

Once you're happy with it, use [electron-builder](https://www.electron.build/)
to produce a signed `.app` / `.dmg`:

```bash
npm install --save-dev electron-builder
npx electron-builder --mac
```

## Live preview

The right-hand pane renders the Markdown body as HTML as you type (debounced
~150ms so it doesn't fight you on every keystroke), using the `marked`
library. Hugo YAML (`---`) and TOML (`+++`) front matter is removed before
rendering, matching Hugo's treatment of it. Image paths are automatically
rewritten to `file://` URLs so images you've just inserted show up
immediately. Click "Hide Preview" in the toolbar to go full-width on the
editor.

## Known limitations / next steps

- The editor is a plain `<textarea>` — no Markdown syntax highlighting yet.
  Swapping in CodeMirror 6 would be the natural upgrade.
- Preview styling is generic; if your blog has custom CSS classes (like
  the `.post-image` in the default tag template), the preview won't apply
  that specific styling unless you add matching rules to `renderer/style.css`.
- Config is edited by hand in `main.js` for now, not through a UI.
- Only local files are supported (no direct upload to a remote blog host);
  that could be added as a separate "Publish" step calling `scp`/`rsync`
  or your static site generator's CLI.
