import { describe, expect, it } from 'vitest';
import { utf8Length } from './utf8';

describe('utf8Length', () => {
  it('matches TextEncoder for ASCII, 2-, 3- and 4-byte characters', () => {
    const lone = String.fromCharCode(0xd83c) + 'x';
    for (const text of ['', '{"t":"delta"}', 'Zürich', '€ 10 → 12', 'Göztepe ⚽ 🏆 v 東京', lone]) {
      expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
    }
  });
});
