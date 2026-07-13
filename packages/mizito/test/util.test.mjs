import test from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, slug } from '@mohsp-99/mizito';

test('stripHtml: block tags become newlines, inline tags vanish', () => {
  const html = '<div>سلام<br>دنیا</div><p>پاراگراف <b>بولد</b></p>';
  assert.equal(stripHtml(html), 'سلام\nدنیا\n\nپاراگراف بولد');
});

test('stripHtml: decodes the entities the app emits', () => {
  assert.equal(stripHtml('a&nbsp;b &amp; c &lt;d&gt; &quot;e&quot; &#039;'), 'a b & c <d> "e" \'');
  assert.equal(stripHtml('&#1740;'), 'ی'); // numeric code point
});

test('stripHtml: collapses whitespace and trims', () => {
  assert.equal(stripHtml('<p>a</p>\n\n\n<p>b</p>   c'), 'a\n\nb\n c');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
});

test('slug: filesystem-unsafe characters and spaces become underscores', () => {
  assert.equal(slug('my: file/name?'), 'my__file_name_');
  assert.equal(slug('  کارون  ورک‌اسپیس  '), 'کارون_ورک‌اسپیس');
  assert.equal(slug('x'.repeat(200)).length, 80);
});
