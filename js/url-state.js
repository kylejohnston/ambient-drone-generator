/**
 * URL state encoding/decoding for preset sharing
 *
 * v2: encodes state as BIP39 words joined by hyphens.
 * Backwards compatible: base64 legacy URLs are still decoded.
 *
 * Detection: encoded.includes('-') → word format; otherwise → base64.
 * Base64 never contains hyphens; word format is always lowercase+hyphens.
 */

// ── BitWriter ──────────────────────────────────────────────────────────────
// Accumulates bits into a Uint8Array. Call flush() to get the final bytes.

class BitWriter {
  constructor() {
    this._buf = [];   // bytes (0-255)
    this._byte = 0;   // current byte being built
    this._bit = 7;    // next bit position within current byte (7=MSB)
  }

  /** Write the low `n` bits of `value` (MSB first) */
  write(value, n) {
    for (let i = n - 1; i >= 0; i--) {
      const bit = (value >>> i) & 1;
      this._byte |= (bit << this._bit);
      this._bit--;
      if (this._bit < 0) {
        this._buf.push(this._byte);
        this._byte = 0;
        this._bit = 7;
      }
    }
  }

  /** Flush any partial byte (zero-padded) and return the full Uint8Array */
  flush() {
    if (this._bit < 7) this._buf.push(this._byte);
    return new Uint8Array(this._buf);
  }
}

// ── BitReader ──────────────────────────────────────────────────────────────
// Reads bits sequentially from a Uint8Array.

class BitReader {
  constructor(bytes) {
    this._bytes = bytes;
    this._byteIdx = 0;
    this._bit = 7;  // next bit position within current byte (7=MSB)
  }

  /** Read the next `n` bits as an unsigned integer */
  read(n) {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (this._byteIdx >= this._bytes.length) return result << (n - 1 - i);
      const bit = (this._bytes[this._byteIdx] >>> this._bit) & 1;
      result = (result << 1) | bit;
      this._bit--;
      if (this._bit < 0) {
        this._byteIdx++;
        this._bit = 7;
      }
    }
    return result;
  }
}

// ── Wordlist placeholder (will be replaced in Task 2) ─────────────────────
const BIP39 = ['abandon', 'ability', 'able']; // temporary — 3 words for smoke test

// ── Key orderings (fixed — never reorder these) ───────────────────────────
const CHORD_KEYS = ['Cmaj7','Am7','Fmaj7','Dm7','G7','Em7','Bbmaj7','Csus2','Fsus2','Asus2'];
const NOTE_KEYS  = ['C3','C#3','D3','D#3','E3','F3','F#3','G3','G#3','A3','A#3','B3','C4'];

// ── Public API ─────────────────────────────────────────────────────────────

export function encodeState(state) {
  return btoa(JSON.stringify({ _placeholder: true })); // temporary
}

export function decodeState(encoded) {
  try {
    if (encoded.includes('-')) return null; // word decode not yet implemented
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}

export function getUrlParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get('p') || null;
}
