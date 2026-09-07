# Almost Editor

Almost Editor is a desktop Markdown editor tailored to [Hugo](https://gohugo.io) blogs that use page bundles and a Lightbox for rendering images.

This project is vibecoded. I built it to write posts for my blog, https://blog.almostinfocus.com.
While Markdown files can be edited anywhere, manually converting images and inserting shortcodes was always cumbersome.

![UI](https://github.com/user-attachments/assets/97b29e15-0b35-44e5-97b1-948cc2ef64b9)


## Requirements

- Node.js and npm
- [ImageMagick](https://imagemagick.org/) with the `magick` command available on your `PATH`

On macOS, install ImageMagick with:

```bash
brew install imagemagick
```

## Run the editor

```bash
npm install
npm start
```

`npm start` builds the bundled code editor before launching Electron.

## Tests

Run the focused unit/spec suite with:

```bash
npm test
```

The suite covers Hugo project discovery, generated post front matter, image-processing command construction, and Hugo Markdown preprocessing.

## Hugo project workflow

Open the root of a Hugo project with **Open project**. Almost Editor scans `content/posts` for directories containing `index.md` and shows those post bundles in the sidebar.

Select a post to open its `index.md`. The editor keeps unsaved buffers in memory while you move between posts, and marks changed posts with a yellow dot in both the sidebar and bottom status area. Save to write the changes to disk.

Use the formatting toolbar above the editor for headings, bold, italic, strikethrough, inline and fenced code, block quotes, bulleted, numbered, and task lists, links, and horizontal rules. Bold, italic, and link insertion are also available with <kbd>Cmd/Ctrl+B</kbd>, <kbd>Cmd/Ctrl+I</kbd>, and <kbd>Cmd/Ctrl+K</kbd>.

To link text, select it and choose the link button. Enter a URL directly, or choose **Blog article** and select a page bundle from the current Hugo project. Article links are inserted with Hugo's `ref` convention, for example `[Film scanning]({{< ref "/posts/film_scanning" >}})`.

Use **New post** to create a new page bundle. It prompts for the bundle name and creates:

```text
content/posts/<post-name>/
├── images/
└── index.md
```

The generated `index.md` uses Hugo TOML front matter:

```toml
+++
author = ""
title = "Post name"
date = "yyyy-mm-dd"
description = ""
tags = []
+++
```

## Custom lightbox shortcode

The preview recognizes this custom Hugo lightbox macro:

```go
{{< lightbox src="images/image_1.jpg" thumb="images/image_1_thumb.jpg" alt="Image 1" >}}
```

It renders the thumbnail in the preview. Clicking it opens the full image in the editor's built-in lightbox overlay. Both paths are resolved relative to the current post bundle, so images in the adjacent `images/` directory work without extra configuration.

The preview also understands Hugo references in Markdown links, for example:

```md
[Film scanning]({{< ref "/posts/film_scanning" >}})
```

Clicking a previewed reference opens the target post in the project sidebar.

## Image workflow

Drag an image into the editor to create two JPEG files in the current post's `images/` directory using `magick mogrify`:

| Output | Default resize | Default quality |
| --- | --- | --- |
| `images/image_name.jpg` | `1500x1500` | `70` |
| `images/image_name_thumb.jpg` | `500x500` | `60` |

GIF files are copied into `images/` unchanged so animation is preserved. Their inserted shortcode uses the same GIF path for both `{src}` and `{thumb}`.

Almost Editor then inserts this default shortcode:

```go
{{< lightbox src="images/image_name.jpg" thumb="images/image_name_thumb.jpg" alt="" >}}
```

Use **Image options** to change the full-size and thumbnail resize dimensions, JPEG quality, and the text inserted after processing an image. The shortcode template supports these placeholders:

- `{src}` — generated full-size image path
- `{thumb}` — generated thumbnail path
- `{alt}` — alternative text, initially empty

For example, the default template is:

```go
{{< lightbox src="{src}" thumb="{thumb}" alt="{alt}" >}}
```

The template must contain `{src}`; `{thumb}` and `{alt}` are optional, so standard Markdown such as `![{alt}]({src})` also works. All image options are saved and restored when the app reopens. Resize/quality settings and the shortcode template each have their own reset-to-default button.

## Features

- Markdown syntax highlighting, Hugo shortcode highlighting, line numbers, and configurable editor text size (9–20px)
- Markdown formatting toolbar with standard text, list, code, quote, rule, and link controls
- Live Hugo-oriented Markdown preview with YAML and TOML front matter removed
- Lightbox and Hugo `ref` shortcode preview support
- Resizable project sidebar, editor, and preview panes
- Light and dark themes, plus a system-theme option
- Persistent theme, text size, image settings, last file directory, and last Hugo project
- Project sidebar for Hugo post bundles and in-app post creation
- Unsaved-change indicators and in-memory drafts while switching posts
- Image conversion and configurable shortcode insertion powered by ImageMagick

## Notes

The editor preview is a focused local preview rather than a full Hugo site build. Hugo templates, layouts, and arbitrary shortcodes outside the supported lightbox and `ref` forms are rendered by Hugo itself when you build your site.
