import assert from 'node:assert/strict';
import test from 'node:test';
import {
  draftFromFrontMatter,
  expandHugoRefLinks,
  titleFromFrontMatter,
  withoutHugoFrontMatter
} from '../renderer/markdown-tools.mjs';

test('removes YAML and TOML front matter before preview parsing', () => {
  assert.equal(withoutHugoFrontMatter('---\ntitle: Post\n---\n# Body'), '# Body');
  assert.equal(withoutHugoFrontMatter('+++\ntitle = "Post"\n+++\n# Body'), '# Body');
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
