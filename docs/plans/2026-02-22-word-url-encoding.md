# Word URL Encoding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace base64 URL params with human-readable BIP39 word sequences (e.g. `?p=hollow-amber-echo-drift`) while keeping the public API identical and maintaining backwards compatibility with existing base64 URLs.

**Architecture:** Full rewrite of `js/url-state.js`. BitWriter/BitReader pack state into a compact binary bit stream; the stream is encoded as hyphen-joined BIP39 words (11 bits/word). `decodeState` detects format by checking for hyphens (base64 never contains them). `main.js` requires zero changes.

**Tech Stack:** Vanilla JS ES module, no libraries, no build tools. BIP39 wordlist (~14KB) embedded as a `const` array. Manual browser-console verification (no test framework in project).

---

### Task 1: Write BitWriter and BitReader

**Files:**
- Modify: `js/url-state.js`

These two classes are the foundation. Write and verify them before touching any encoding logic.

**Step 1: Replace the full contents of `js/url-state.js` with this skeleton + BitWriter + BitReader**

```js
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
```

**Step 2: Open browser console, paste and run this smoke test**

Open `index.html` in a browser, then run in the dev console:

```js
// Paste both classes directly into the console to test in isolation:

class BitWriter {
  constructor() { this._buf=[]; this._byte=0; this._bit=7; }
  write(value, n) {
    for (let i=n-1; i>=0; i--) {
      const bit=(value>>>i)&1;
      this._byte|=(bit<<this._bit);
      this._bit--;
      if(this._bit<0){this._buf.push(this._byte);this._byte=0;this._bit=7;}
    }
  }
  flush() { if(this._bit<7)this._buf.push(this._byte); return new Uint8Array(this._buf); }
}

class BitReader {
  constructor(bytes){this._bytes=bytes;this._byteIdx=0;this._bit=7;}
  read(n){
    let result=0;
    for(let i=0;i<n;i++){
      if(this._byteIdx>=this._bytes.length) return result<<(n-1-i);
      const bit=(this._bytes[this._byteIdx]>>>this._bit)&1;
      result=(result<<1)|bit;
      this._bit--;
      if(this._bit<0){this._byteIdx++;this._bit=7;}
    }
    return result;
  }
}

// Test: write 3 fields, read them back
const w = new BitWriter();
w.write(1,   3);  // version: 3 bits → 1
w.write(56,  7);  // movement: 7 bits → 56
w.write(100, 7);  // grit: 7 bits → 100
const bytes = w.flush();

const r = new BitReader(bytes);
console.assert(r.read(3) === 1,   'version');
console.assert(r.read(7) === 56,  'movement');
console.assert(r.read(7) === 100, 'grit');
console.log('BitWriter/BitReader: PASS');
```

Expected: `BitWriter/BitReader: PASS` with no assertion errors.

**Step 3: Commit**

```bash
git add js/url-state.js
git commit -m "feat(url): add BitWriter and BitReader bit-packing classes"
```

---

### Task 2: Embed BIP39 wordlist

**Files:**
- Modify: `js/url-state.js`

The wordlist is 2048 words. It's embedded as a constant so the module has no runtime dependencies and works offline.

**Step 1: Fetch the BIP39 English wordlist**

The canonical BIP39 English wordlist is available at:
`https://raw.githubusercontent.com/trezor/python-mnemonic/master/src/mnemonic/wordlist/english.txt`

Fetch it, split on newlines, remove blank lines — you should have exactly 2048 words.

**Step 2: Replace the `BIP39` placeholder in `url-state.js`**

Replace this line:
```js
const BIP39 = ['abandon', 'ability', 'able']; // temporary — 3 words for smoke test
```

With the full 2048-word array:
```js
const BIP39 = [
  'abandon','ability','able','about','above','absent','absorb','abstract',
  'absurd','abuse','access','accident','account','accuse','achieve','acid',
  // ... all 2048 words ...
  'zoo'
];
```

**Step 3: Verify in browser console**

```js
// After reloading the page, check via import or paste the array check:
console.assert(BIP39.length === 2048, 'Wordlist must have exactly 2048 words');
console.assert(BIP39[0] === 'abandon', 'First word');
console.assert(BIP39[2047] === 'zoo', 'Last word');
console.log('BIP39 wordlist: PASS');
```

Expected: `BIP39 wordlist: PASS` with no assertion errors.

**Step 4: Commit**

```bash
git add js/url-state.js
git commit -m "feat(url): embed BIP39 English wordlist (2048 words)"
```

---

### Task 3: Write `encodeWords` — state → word string

**Files:**
- Modify: `js/url-state.js`

This function takes the app `state` object and returns a hyphen-joined word string like `hollow-amber-echo-drift`.

**Step 1: Add `encodeWords` and a helper `bytesToWords` to `url-state.js`, above the public API section**

```js
// ── Word encoding ──────────────────────────────────────────────────────────

/** Pack app state into bytes using the binary format defined in the design doc */
function stateToBytes(state) {
  const w = new BitWriter();

  w.write(1, 3);  // version = 1

  // Effects controls
  w.write(Math.round(state.controls.movement), 7);
  w.write(Math.round(state.controls.grit),     7);
  w.write(Math.round(state.controls.depth),    7);
  w.write(Math.round(state.controls.space),    6);

  // Bypass flags (1 = bypassed)
  w.write(state.bypass.modulation ? 1 : 0, 1);
  w.write(state.bypass.grit       ? 1 : 0, 1);
  w.write(state.bypass.delay      ? 1 : 0, 1);
  w.write(state.bypass.reverb     ? 1 : 0, 1);

  // Chord layers (L0 and L1)
  for (let i = 0; i < 2; i++) {
    const layer = state.layers[i];
    if (layer.type !== 'chord') {
      w.write(0, 1); // not present
      continue;
    }
    w.write(1, 1); // present
    w.write(CHORD_KEYS.indexOf(layer.chord), 4);
    w.write(Math.round(layer.volume), 7);
    w.write(Math.round(layer.filter), 7);
    w.write(layer.pitch + 24, 6);            // offset encode: -24..+24 → 0..48
    w.write(Math.round(layer.length) - 2, 4); // offset encode: 2..10 → 0..8
    w.write(Math.round(layer.fade * 10), 5);  // scale: 0.0..2.0 → 0..20
  }

  // Sequencer layer (L2 — always present)
  const seq = state.layers[2];
  w.write(Math.round(seq.volume), 7);
  w.write(Math.round(seq.filter), 7);
  w.write(seq.pitch + 24, 6);

  // Sequencer data
  w.write(state.sequencer.snap ? 1 : 0, 1);
  const notes = state.sequencer.notes.slice(0, 15); // cap at 15
  w.write(notes.length, 4);
  for (const n of notes) {
    w.write(NOTE_KEYS.indexOf(n.note), 4);
    w.write(Math.min(63, Math.round(n.time * 16)), 6);
  }

  return w.flush();
}

/** Convert a Uint8Array to a hyphen-joined BIP39 word string */
function bytesToWords(bytes) {
  const words = [];
  const r = new BitReader(bytes);
  // Each word = 11 bits; read enough words to cover all bits
  const totalBits = bytes.length * 8;
  const wordCount = Math.ceil(totalBits / 11);
  for (let i = 0; i < wordCount; i++) {
    words.push(BIP39[r.read(11)]);
  }
  return words.join('-');
}

/** Encode state to a hyphen-joined BIP39 word string */
function encodeWords(state) {
  return bytesToWords(stateToBytes(state));
}
```

**Step 2: Update `encodeState` to call `encodeWords`**

Replace the temporary placeholder:
```js
export function encodeState(state) {
  return btoa(JSON.stringify({ _placeholder: true })); // temporary
}
```

With:
```js
export function encodeState(state) {
  return encodeWords(state);
}
```

**Step 3: Verify in browser console — encode only (decode not yet wired up)**

Open the app, start it playing with some settings, then in the console:

```js
// Trigger a URL update manually by moving a fader, then:
console.log(window.location.search);
// Expected: ?p=word1-word2-word3-...
// All words should be lowercase and from BIP39 list
// Should be roughly 9-19 words depending on note count
```

Also check the URL updates live as you drag faders.

**Step 4: Commit**

```bash
git add js/url-state.js
git commit -m "feat(url): encode state as BIP39 word sequence"
```

---

### Task 4: Write `decodeWords` — word string → preset object

**Files:**
- Modify: `js/url-state.js`

This function is the inverse of `encodeWords`. It must return the same `{v, c, b, l, sq}` shape that `applyPreset` in `main.js` already understands.

**Step 1: Add `wordsToBytes` and `decodeWords` to `url-state.js`, below `encodeWords`**

```js
/** Convert a hyphen-joined BIP39 word string back to a Uint8Array */
function wordsToBytes(wordString) {
  const words = wordString.split('-');
  const w = new BitWriter();
  for (const word of words) {
    const idx = BIP39.indexOf(word);
    if (idx === -1) throw new Error(`Unknown word: ${word}`);
    w.write(idx, 11);
  }
  return w.flush();
}

/** Decode a hyphen-joined BIP39 word string to a preset object.
 *  Returns null if the string is malformed or version is unrecognised. */
function decodeWords(wordString) {
  const bytes = wordsToBytes(wordString);
  const r = new BitReader(bytes);

  const version = r.read(3);
  if (version !== 1) return null;

  // Controls
  const movement = r.read(7);
  const grit     = r.read(7);
  const depth    = r.read(7);
  const space    = r.read(6);

  // Bypass flags
  const bypass = [r.read(1), r.read(1), r.read(1), r.read(1)];

  // Chord layers (L0 and L1)
  const layers = [];
  for (let i = 0; i < 2; i++) {
    const present = r.read(1);
    if (!present) {
      layers.push(null);
      continue;
    }
    const chord  = CHORD_KEYS[r.read(4)];
    const vol    = r.read(7);
    const filter = r.read(7);
    const pitch  = r.read(6) - 24;           // decode offset
    const length = r.read(4) + 2;            // decode offset
    const fade   = r.read(5) / 10;           // decode scale
    layers.push({ ch: chord, v: vol, f: filter, p: pitch, l: length, x: fade });
  }

  // Sequencer layer (L2)
  const seqVol    = r.read(7);
  const seqFilter = r.read(7);
  const seqPitch  = r.read(6) - 24;
  layers.push({ v: seqVol, f: seqFilter, p: seqPitch });

  // Sequencer data
  const snap      = r.read(1) === 1;
  const noteCount = r.read(4);
  const notes     = [];
  for (let i = 0; i < noteCount; i++) {
    const noteIdx = r.read(4);
    const timeIdx = r.read(6);
    notes.push([NOTE_KEYS[noteIdx], timeIdx / 16]);
  }

  return {
    v: 1,
    c: [movement, grit, depth, space],
    b: bypass,
    l: layers,
    sq: { sn: snap ? 1 : 0, n: notes }
  };
}
```

**Step 2: Wire `decodeWords` into `decodeState`**

Replace:
```js
export function decodeState(encoded) {
  try {
    if (encoded.includes('-')) return null; // word decode not yet implemented
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}
```

With:
```js
export function decodeState(encoded) {
  try {
    if (encoded.includes('-')) return decodeWords(encoded);
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}
```

**Step 3: Verify round-trip in browser console**

Open app, load a preset URL that contains notes (e.g. add some sequencer notes, copy URL). Then in the console:

```js
// Get current URL param
const param = new URLSearchParams(window.location.search).get('p');
console.log('Format check (should contain hyphens):', param.includes('-'));

// The param is already decoded and applied on load — verify by checking
// the app state directly. Alternatively, do a manual round-trip:
import('/js/url-state.js').then(({ encodeState, decodeState }) => {
  // Simulate a minimal state object
  const mockState = {
    controls: { movement: 56, grit: 24, depth: 40, space: 30 },
    bypass:   { modulation: false, grit: false, delay: true, reverb: false },
    layers: [
      { type: 'chord', chord: 'Cmaj7', volume: 80, filter: 8, pitch: 0, length: 10, fade: 2.0 },
      { type: 'empty', volume: 80, filter: 50, pitch: 0, length: 6, fade: 1.0 },
      { type: 'sequencer', volume: 100, filter: 33, pitch: -11 }
    ],
    sequencer: {
      snap: true,
      notes: [{ id: 0, note: 'C3', time: 0 }, { id: 1, note: 'E3', time: 1.75 }]
    }
  };

  const encoded = encodeState(mockState);
  console.log('Encoded:', encoded);
  console.log('Word count:', encoded.split('-').length);

  const decoded = decodeState(encoded);
  console.log('Decoded:', decoded);

  // Verify key fields
  console.assert(decoded.v === 1, 'version');
  console.assert(decoded.c[0] === 56, 'movement');
  console.assert(decoded.c[3] === 30, 'space');
  console.assert(decoded.b[2] === 1, 'delay bypassed');
  console.assert(decoded.l[0].ch === 'Cmaj7', 'chord');
  console.assert(decoded.l[0].l === 10, 'length');
  console.assert(decoded.l[0].x === 2.0, 'fade');
  console.assert(decoded.l[1] === null, 'empty layer');
  console.assert(decoded.l[2].p === -11, 'seq pitch');
  console.assert(decoded.sq.n[0][0] === 'C3', 'note name');
  console.assert(decoded.sq.n[1][1] === 1.75, 'note time');
  console.log('Round-trip: PASS');
});
```

Expected output: `Round-trip: PASS` with no assertion errors.

**Step 4: Commit**

```bash
git add js/url-state.js
git commit -m "feat(url): decode BIP39 word sequence back to preset object"
```

---

### Task 5: End-to-end manual verification

**Files:** None (verification only)

**Step 1: Full encode → reload → restore test**

1. Open `index.html` in the browser
2. Select `Cmaj7` for Layer 1, `Am7` for Layer 2
3. Adjust a few faders (vol, tone, pitch)
4. Add 3–5 sequencer notes
5. Wait ~1 second for URL to auto-update
6. Copy the full URL from the address bar
7. Open a new tab and paste the URL
8. Verify: chord selections match, fader positions match, sequencer notes appear in correct grid positions

**Step 2: Backwards compatibility test**

1. Construct a legacy base64 URL manually:
   ```js
   btoa(JSON.stringify({
     v:1,
     c:[56,24,40,30],
     b:[1,0,0,0],
     l:[{"ch":"Cmaj7","v":80,"f":8,"p":0,"l":10,"x":2},null,{"v":100,"f":33,"p":-11}],
     sq:{sn:1,n:[["C3",0],["E3",1.75]]}
   }))
   ```
2. Paste as `?p=<result>` in the address bar
3. Reload — verify all settings restore correctly (no error, no blank screen)

**Step 3: Malformed URL test**

Navigate to `?p=not-a-valid-word-string-xyz123`. The app should load with default settings (no crash, no error message to user).

**Step 4: Commit (if any fixes were needed during verification)**

```bash
git add js/url-state.js
git commit -m "fix(url): [describe any fixes found during verification]"
```

If no fixes needed, skip this commit.

---

### Task 6: Final cleanup and documentation

**Files:**
- Modify: `js/url-state.js` (clean up any temporary comments)
- Modify: `README.md` (update preset sharing section)

**Step 1: Remove any TODO/temporary comments from `url-state.js`**

Scan for `// temporary`, `// placeholder`, `// TODO` and remove or resolve them.

**Step 2: Update README preset sharing section**

In `README.md`, update the Preset Sharing section to mention the word-based format:

```markdown
## Preset Sharing

The full app state encodes automatically into the URL as a `?p=` parameter (debounced 500ms, using `history.replaceState`). Sharing a preset is as simple as copying the address bar.

URLs use a human-readable word format (e.g. `?p=hollow-amber-echo-drift-canyon`) powered by the BIP39 English wordlist. Legacy base64 URLs from earlier versions continue to work.
```

**Step 3: Commit**

```bash
git add js/url-state.js README.md
git commit -m "docs: update README for word-based URL encoding"
```

---

## Verification Checklist

Before marking complete:

- [ ] BitWriter/BitReader round-trip smoke test passes
- [ ] BIP39 array has exactly 2048 words
- [ ] Encode → decode → encode produces identical word strings
- [ ] All field types round-trip correctly: controls (int), bypass (bool→0/1), pitch (offset ±24), length (offset 2–10), fade (float, 1 decimal), note time (0.0625s resolution)
- [ ] Empty chord layer serializes as `null`, restores as empty
- [ ] Sequencer notes (note name + time) restore in correct grid positions
- [ ] Legacy base64 `?p=` URL still restores correctly
- [ ] Malformed `?p=` loads defaults without crash
- [ ] URL updates automatically within ~500ms of any interaction
- [ ] Word count for a typical preset is 9–19 words
