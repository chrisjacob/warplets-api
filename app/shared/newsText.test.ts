import { expect, it } from 'vitest';
import { newsText } from './newsText';
it('decodes once without recursively interpreting nested entities', () => {
  expect(newsText('A &amp; B &quot;launch&quot; &#39;today&#39;')).toBe('A & B "launch" \'today\'');
  expect(newsText('&amp;quot; &amp;#60;')).toBe('&quot; &#60;');
});
it('extracts plain text without script/style content or markup delimiters', () => {
  expect(newsText('<p>Launch</p><script>secret()</script><style>body{}</style> today')).toBe('Launch today');
  for (const value of ['<scr<script>x</script>ipt>alert(1)', '&lt;img src=x onerror=alert(1)&gt;', '&#60;script&#62;']) {
    expect(newsText(value)).not.toMatch(/[<>]/);
  }
});
