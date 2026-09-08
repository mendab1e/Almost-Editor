import assert from 'node:assert/strict';
import test from 'node:test';
import {
  draftFromFrontMatter,
  draftEdit,
  expandHugoRefLinks,
  featuredImageEdit,
  featuredImageFromFrontMatter,
  hugoContent,
  imagesFromMarkdown,
  titleFromFrontMatter,
  withoutHugoFrontMatter
} from '../renderer/markdown-tools.mjs';

test('removes YAML and TOML front matter before preview parsing', () => {
  assert.equal(withoutHugoFrontMatter('---\ntitle: Post\n---\n# Body'), '# Body');
  assert.equal(withoutHugoFrontMatter('+++\ntitle = "Post"\n+++\n# Body'), '# Body');
  assert.deepEqual(hugoContent('+++\r\ntitle = "Post"\r\n+++\r\n# Body'), { content: '# Body', startLine: 4 });
  assert.deepEqual(hugoContent('# Body'), { content: '# Body', startLine: 1 });
});

test('extracts quoted Hugo front-matter titles', () => {
  assert.equal(titleFromFrontMatter('---\ntitle: "A YAML post"\n---\n'), 'A YAML post');
  assert.equal(titleFromFrontMatter("+++\ntitle = 'A TOML post'\n+++\n"), 'A TOML post');
  assert.equal(titleFromFrontMatter('# No front matter'), '');
});

test('detects draft state in TOML and YAML front matter', () => {
  assert.equal(draftFromFrontMatter('+++\ndraft = true\n+++\n'), true);
  assert.equal(draftFromFrontMatter('---\ndraft: true # not published\n---\n'), true);
  assert.equal(draftFromFrontMatter('+++\ndraft = false\n+++\n'), false);
  assert.equal(draftFromFrontMatter('---\ntitle: draft\n---\n'), false);
});

test('reads featured images from TOML and YAML front matter', () => {
  assert.equal(featuredImageFromFrontMatter('+++\nfeatured_image = "images/scan.jpg"\n+++\n'), 'images/scan.jpg');
  assert.equal(featuredImageFromFrontMatter("---\nfeatured_image: 'images/scan.jpg' # comment\n---\n"), 'images/scan.jpg');
  assert.equal(featuredImageFromFrontMatter('+++\nfeatured_image = ""\n+++\n'), '');
  assert.equal(featuredImageFromFrontMatter('# No front matter'), '');
});

test('converts Hugo ref shortcodes into preview links', () => {
  assert.equal(
    expandHugoRefLinks('[Film scanning]({{< ref "/posts/film_scanning" >}})'),
    '[Film scanning](hugo-ref:/posts/film_scanning)'
  );
});

test('preserves hashes and escaped quotes inside front matter titles', () => {
  assert.equal(titleFromFrontMatter('+++\ntitle = "A #1 choice" # comment\n+++\n'), 'A #1 choice');
  assert.equal(titleFromFrontMatter("---\ntitle: 'It''s #1' # comment\n---\n"), "It's #1");
  assert.equal(titleFromFrontMatter('+++\ntitle = "A \\"quoted\\" title"\n+++\n'), 'A "quoted" title');
});

test('finds unique images inserted in post content in source order', () => {
  const markdown = `+++\nfeatured_image = "images/not-in-body.jpg"\n+++\n
{{< lightbox src="images/scan.jpg" thumb="images/scan_thumb.jpg" alt="Scan" >}}
![Second](images/second.jpg "Title")
<img src="images/third.png" alt="Third">
![Duplicate](images/scan.jpg)`;
  assert.deepEqual(imagesFromMarkdown(markdown), [
    { src: 'images/scan.jpg', previewSrc: 'images/scan_thumb.jpg', alt: 'Scan' },
    { src: 'images/second.jpg', previewSrc: 'images/second.jpg', alt: 'Second' },
    { src: 'images/third.png', previewSrc: 'images/third.png', alt: 'Third' }
  ]);
  assert.deepEqual(imagesFromMarkdown('+++\ntitle = "Empty"\n+++\n'), []);
});

test('inserts and updates featured_image in TOML and YAML front matter', () => {
  const toml = '+++\ntitle = "Post"\n+++\nBody';
  const tomlEdit = featuredImageEdit(toml, 'images/scan.jpg');
  assert.equal(toml.slice(0, tomlEdit.from) + tomlEdit.insert + toml.slice(tomlEdit.to),
    '+++\ntitle = "Post"\nfeatured_image = "images/scan.jpg"\n+++\nBody');

  const yaml = '---\ntitle: Post\nfeatured_image: "images/old.jpg"\n---\nBody';
  const yamlEdit = featuredImageEdit(yaml, 'images/new.jpg');
  assert.equal(yaml.slice(0, yamlEdit.from) + yamlEdit.insert + yaml.slice(yamlEdit.to),
    '---\ntitle: Post\nfeatured_image: "images/new.jpg"\n---\nBody');

  const missingEdit = featuredImageEdit('# Body', 'images/new.jpg');
  assert.equal(missingEdit.insert, '+++\nfeatured_image = "images/new.jpg"\n+++\n\n');

  const emptyEdit = featuredImageEdit('+++\r\nfeatured_image =\r\n+++\r\nBody', 'images/new.jpg');
  assert.equal(emptyEdit.insert, 'featured_image = "images/new.jpg"');
});

test('toggles draft in TOML, YAML, and documents without front matter', () => {
  const toml = '+++\ntitle = "Post"\ndraft = false\n+++\nBody';
  const tomlEdit = draftEdit(toml, true);
  assert.equal(toml.slice(0, tomlEdit.from) + tomlEdit.insert + toml.slice(tomlEdit.to),
    '+++\ntitle = "Post"\ndraft = true\n+++\nBody');

  const yaml = '---\ntitle: Post\n---\nBody';
  const yamlEdit = draftEdit(yaml, false);
  assert.equal(yaml.slice(0, yamlEdit.from) + yamlEdit.insert + yaml.slice(yamlEdit.to),
    '---\ntitle: Post\ndraft: false\n---\nBody');

  const missingEdit = draftEdit('# Body', true);
  assert.equal(missingEdit.insert, '+++\ndraft = true\n+++\n\n');
});
