/**
 * Byte length of a string in UTF-8 (the size of a WebSocket text frame payload), without
 * allocating an encoded copy. `string.length` counts UTF-16 code units, not bytes.
 */
export function utf8Length(text: string): number {
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) bytes += 1;
    else if (c >= 0xd800 && c <= 0xdbff && isLowSurrogate(text.charCodeAt(i + 1))) {
      // Surrogate pair: 2 code units, 4 bytes.
      bytes += 2;
      i++;
    } else bytes += 2; // other BMP characters and lone surrogates (encoded as U+FFFD): 3 bytes
  }
  return bytes;
}

const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;
