# Word-Based URL Encoding Design

**Date:** 2026-02-22
**Status:** Approved

## Overview

Replace the base64 `?p=` URL parameter with a human-readable, word-based format inspired by GitHub's repository name generator. A preset URL looks like:

```
?p=hollow-amber-echo-drift-canyon-river-marble
```

The encoding is lossless, backwards-compatible with the existing base64 format, and uses the BIP39 English wordlist.

---

## Architecture

Self-contained rewrite of `js/url-state.js`. Public API is unchanged:

```js
export function encodeState(state) { ... }  // → word string or base64
export function decodeState(encoded) { ... } // → preset object or null
export function getUrlParam() { ... }        // → reads ?p= from URL
```

`main.js` requires no changes.

---

## Wordlist

**BIP39 English wordlist** — 2048 words, 11 bits per word, embedded as a const array (~14KB). This is a widely-used standard chosen for its properties: all words are 3–8 characters, unambiguous, and memorable.

Detection: word format is all lowercase with hyphens (`encoded.includes('-')`). Base64 always contains uppercase letters, so the two formats cannot collide.

---

## Binary Format

State is packed into a bit stream, then encoded as BIP39 words (11 bits each).

### Version header

| Field | Bits | Range | Notes |
|-------|------|-------|-------|
| version | 3 | 0–7 | Always `1` for this format |

### Effects controls

| Field | Bits | Range | Mapping |
|-------|------|-------|---------|
| movement | 7 | 0–100 | Direct integer |
| grit | 7 | 0–100 | Direct integer |
| depth | 7 | 0–100 | Direct integer |
| space | 6 | 0–60 | Direct integer (step=1) |

### Bypass flags

| Field | Bits | Notes |
|-------|------|-------|
| bypass[modulation] | 1 | 1 = bypassed |
| bypass[grit] | 1 | |
| bypass[delay] | 1 | |
| bypass[reverb] | 1 | |

### Chord layers (L0 and L1, repeated)

| Field | Bits | Range | Notes |
|-------|------|-------|-------|
| present | 1 | 0/1 | 0 = empty layer, skip remaining fields |
| chord | 4 | 0–9 | Index into CHORD_KEYS |
| vol | 7 | 0–100 | |
| filter | 7 | 0–100 | |
| pitch | 6 | 0–48 | Stored as `pitch + 24` (range -24 to +24) |
| length | 4 | 0–8 | Stored as `length - 2` (range 2–10) |
| fade | 5 | 0–20 | Stored as `Math.round(fade * 10)` (range 0.0–2.0) |

### Sequencer layer (L2, always present)

| Field | Bits | Range | Notes |
|-------|------|-------|-------|
| vol | 7 | 0–100 | |
| filter | 7 | 0–100 | |
| pitch | 6 | 0–48 | Stored as `pitch + 24` |

### Sequencer data

| Field | Bits | Range | Notes |
|-------|------|-------|-------|
| snap | 1 | 0/1 | |
| note_count | 4 | 0–15 | Max 15 notes serialized |
| per note × N: | | | |
| &nbsp;&nbsp;note_idx | 4 | 0–12 | Index into NOTE_KEYS |
| &nbsp;&nbsp;time | 6 | 0–63 | `Math.min(63, Math.round(time * 16))` → decode: `index / 16` |

### Key orderings (fixed, stable)

```js
const CHORD_KEYS = ['Cmaj7','Am7','Fmaj7','Dm7','G7','Em7','Bbmaj7','Csus2','Fsus2','Asus2'];
const NOTE_KEYS  = ['C3','C#3','D3','D#3','E3','F3','F#3','G3','G#3','A3','A#3','B3','C4'];
```

---

## Word Count Estimate

For a typical preset (both chord layers present, ~5 sequencer notes):

| Component | Bits |
|-----------|------|
| Version + controls + bypass | 3+27+4 = 34 |
| L0 present + data | 1+33 = 34 |
| L1 present + data | 1+33 = 34 |
| L2 | 20 |
| Snap + note_count | 5 |
| 5 notes × 10 bits | 50 |
| **Total** | **~147 bits** |

147 ÷ 11 = ~14 words. Range across typical presets: **9–19 words**.

---

## Backwards Compatibility

`decodeState` detects the format automatically:

```js
if (encoded.includes('-')) {
  return decodeWords(encoded);  // word format
} else {
  return decodeBase64(encoded); // legacy base64
}
```

Existing shared URLs continue to work. New shares use word format.

---

## Implementation Notes

- **BitWriter**: accumulates bits; `flush()` returns `Uint8Array`
- **BitReader**: wraps `Uint8Array`; `read(n)` returns next n bits as integer
- Padding: final word may use fewer than 11 significant bits — decoder ignores trailing bits
- Error handling: any exception in `decodeWords` returns `null` (same as legacy)
- The BIP39 wordlist is embedded as a JS const array (not fetched) to keep the module self-contained and avoid async loading
