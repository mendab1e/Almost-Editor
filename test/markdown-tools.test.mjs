import assert from 'node:assert/strict';
import test from 'node:test';
import { expandHugoRefLinks, titleFromFrontMatter, withoutHugoFrontMatter } from '../renderer/markdown-tools.mjs';

test('removes YAML and TOML front matter before preview parsing', () => {
  assert.equal(withoutHugoFrontMatter('---\ntitle: Post\n---\n# Body'), '# Body');
  assert.equal(withoutHugoFrontMatter('+++\ntitle = "Post"\n+++\n# Body'), '# Body');
});

test('extracts quoted Hugo front-matter titles', () => {
  assert.equal(titleFromFrontMatter('---\ntitle: "A YAML post"\n---\n'), 'A YAML post');
  assert.equal(titleFromFrontMatter("+++\ntitle = 'A TOML post'\n+++\n"), 'A TOML post');
  assert.equal(titleFromFrontMatter('# No front matter'), '');
});

test('converts Hugo ref shortcodes into preview links', () => {
  assert.equal(
    expandHugoRefLinks('[Film scanning]({{< ref "/posts/film_scanning" >}})'),
    '[Film scanning](hugo-ref:/posts/film_scanning)'
  );
});
