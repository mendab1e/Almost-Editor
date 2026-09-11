import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdownPreview } from '../renderer/preview-rendering.mjs';

test('preview omits front matter and anchors blocks to original source lines', () => {
  for (const frontMatter of ['+++\ntitle = "Hidden"\n+++\n', '---\ntitle: Hidden\n---\n']) {
    const html = renderMarkdownPreview(`${frontMatter}# Heading\n\nFirst\nsecond\n`);
    assert.doesNotMatch(html, /Hidden|<br/);
    assert.match(html, /data-source-line="4"/);
    assert.match(html, /data-source-line="6"/);
    assert.match(html, /<p>First\nsecond<\/p>/);
  }
});

test('preview expands lightboxes, escapes captions, and supports thumbnail fallback', () => {
  const html = renderMarkdownPreview('{{< lightbox src="images/full.jpg" thumb="images/thumb.jpg" alt="A &quot;view&quot; &amp; sky" >}}');
  assert.match(html, /href="images\/full.jpg" data-editor-lightbox/);
  assert.match(html, /src="images\/thumb.jpg"/);
  assert.match(html, /<figcaption>A &quot;view&quot; &amp; sky<\/figcaption>/);
  assert.doesNotMatch(html, /EDITOR_LIGHTBOX/);
  const fallback = renderMarkdownPreview('{{< lightbox src="images/full.jpg" >}}');
  assert.match(fallback, /src="images\/full.jpg" alt="Image"/);
  assert.doesNotMatch(fallback, /figcaption/);
});

test('preview retains Hugo ref links and ordinary Markdown formatting', () => {
  const html = renderMarkdownPreview('[Post]({{< ref "other/index.md" >}})\n\n**Bold** and `code`');
  assert.match(html, /href="hugo-ref:/);
  assert.match(html, /<strong>Bold<\/strong> and <code>code<\/code>/);
});


test('preview renders independent galleries and keeps following source anchors accurate', () => {
  const html = renderMarkdownPreview(`+++
title = "Post"
+++
{{< gallery title="A &quot;trip&quot;" >}}
{{< lightbox src="one.jpg" >}}
{{< lightbox src="two.jpg" >}}
{{< lightbox src="three.jpg" >}}
{{< /gallery >}}

Between

{{< gallery >}}
{{< lightbox src="four.jpg" >}}
{{< lightbox src="five.jpg" >}}
{{< /gallery >}}

After

{{< lightbox src="standalone.jpg" >}}`);
  const groups = [...html.matchAll(/<figure class="lightbox-gallery"[^>]*>([\s\S]*?)<\/figure>(?=\s*<span class="preview-scroll-anchor")/g)];
  assert.equal(groups.length, 2);
  assert.equal((groups[0][1].match(/data-editor-lightbox/g) || []).length, 3);
  assert.equal((groups[1][1].match(/data-editor-lightbox/g) || []).length, 2);
  assert.match(html, /aria-label="A &quot;trip&quot;"/);
  assert.match(html, /data-source-line="17"[^>]*><\/span><p>After/);
  assert.doesNotMatch(html, /EDITOR_LIGHTBOX|<p>\s*<figure|\{\{&lt;/);
});

test('gallery wrappers in fenced code remain literal and incomplete wrappers remain editable', () => {
  const code = renderMarkdownPreview('```markdown\n{{< gallery >}}\n{{< /gallery >}}\n```');
  assert.doesNotMatch(code, /class="lightbox-gallery"/);
  assert.match(code, /&lt; gallery/);
  assert.doesNotMatch(renderMarkdownPreview('{{< gallery >}}\nUnfinished'), /class="lightbox-gallery"/);
  assert.match(renderMarkdownPreview('{{< gallery >}}\n{{< /gallery >}}'), /class="lightbox-gallery"/);
});
