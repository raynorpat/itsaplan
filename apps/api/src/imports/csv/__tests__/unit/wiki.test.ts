import { describe, expect, it } from 'bun:test';
import { wikiToMarkdown } from '../../wiki';

describe('wikiToMarkdown', () => {
  it('converts headings', () => {
    expect(wikiToMarkdown('h1. Title\nh3. Part')).toBe('# Title\n### Part');
  });

  it('converts bold, italic and monospace', () => {
    expect(wikiToMarkdown('a *bold* and _italic_ and {{code()}} here')).toBe(
      'a **bold** and *italic* and `code()` here',
    );
  });

  it('converts code and noformat blocks and leaves their content alone', () => {
    expect(wikiToMarkdown('{code:java}\nint *x* = 1;\n{code}')).toBe('```java\nint *x* = 1;\n```');
    expect(wikiToMarkdown('{noformat}\nh1. raw\n{noformat}')).toBe('```\nh1. raw\n```');
  });

  it('converts quotes', () => {
    expect(wikiToMarkdown('{quote}\nfirst\nsecond\n{quote}')).toBe('> first\n> second');
    expect(wikiToMarkdown('bq. quoted')).toBe('> quoted');
  });

  it('converts links', () => {
    expect(wikiToMarkdown('see [the docs|https://example.com/a] and [https://x.io]')).toBe(
      'see [the docs](https://example.com/a) and <https://x.io>',
    );
  });

  it('keeps only http, https and mailto link targets', () => {
    expect(wikiToMarkdown('[click|javascript:alert(1)] [mail|mailto:a@b.c]')).toBe(
      'click [mail](mailto:a@b.c)',
    );
    expect(wikiToMarkdown('[x|data:text/html,hi] [y|HTTPS://ok.io]')).toBe('x [y](HTTPS://ok.io)');
  });

  it('converts bullet and numbered lists with nesting', () => {
    expect(wikiToMarkdown('* one\n** two\n# first\n## second')).toBe(
      '- one\n  - two\n1. first\n   1. second',
    );
  });

  it('turns images into their file name and tables into plain rows', () => {
    expect(wikiToMarkdown('!screen.png|thumbnail! and !a.gif!')).toBe('screen.png and a.gif');
    expect(wikiToMarkdown('||Name||Value||\n|a|b|')).toBe('Name | Value\na | b');
  });
});
