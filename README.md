# Massive Bloom ¦ Ambient drone generator

A browser-based instrument for creating evolving, atmospheric drone textures inspired by the production techniques of Fred again.. and Brian Eno.

No build tools, no dependencies, no server required. Open `index.html` in a browser.

## How It Works

### Signal Flow
```
⟡ - - - - - - - - - - - - - - - ⟡
  CHORD 1 / 2   ¦ SEQUENCER
   BiquadFilter |  BiquadFilter
   GainNode     |  GainNode
⟡ - - - - - - - ↓ - - - - - - - ⟡
  EFFECTS CHAIN (shared)
  ± Saturation  ↓
  ± Delay       ↓
  ± Reverb      ↓
⟡ - - - - - - - ↓ - - - - - - - ⟡
  ± M. Gain     ↓
  ± Analyser    ↓
  = Output ⋆.˚⟡ ࣪ ˖⋆.˚⟡  ࣪ ˖⋆.˚
⟡ - - - - - - - - - - - - - - - ⟡
```

Each layer has independent volume, tone (lowpass filter), and pitch controls. Chord layers also have length and crossfade parameters that regenerate the audio buffer in real time.

### Audio Architecture

All audio runs through the **Web Audio API** with zero external libraries.

**Chord layers** generate sound using offline rendering (`OfflineAudioContext`). Each chord is three detuned sawtooth oscillators plus a sub-octave sine per note, rendered into a looping buffer with configurable crossfade for seamless loops.

**Sequencer** triggers notes in real time using the same oscillator recipe (3 detuned sawtooths + sub sine), routed through a per-note lowpass filter. Notes are scheduled ahead via `setInterval` at 25ms intervals to prevent timing gaps.

**Effects chain** processes all layers together:

| Stage | Implementation | Control |
|-------|---------------|---------|
| Saturation | `WaveShaperNode` with soft-clipping curve, parallel dry/wet | Grit (0-100) |
| Delay | Stereo delay (0.37s L / 0.53s R) with filtered feedback loop | Depth (0-100) |
| Reverb | `ConvolverNode` with generated impulse response, time-based (0-60s) | Reverb time |

**Modulation** uses four unsynchronized LFOs (0.03-0.19 Hz) connected to per-layer filter cutoff frequencies. The non-synced rates create organic, non-repeating evolution — the sound never loops back to the same state.

### Per-Layer Controls

| Control | Parameter | Range |
|---------|-----------|-------|
| VOL  | Layer gain | 0-100 |
| TONE | Lowpass filter cutoff (200-8000 Hz, exponential) | 0-100 |
| PTCH | Playback rate / frequency multiplier | -24 to +24 semitones |
| LGTH | Generated buffer duration (chord layers only) | 2-10 seconds |
| XFAD | Loop crossfade time (chord layers only) | 0-2 seconds |

### Effect Bypass

Each effect stage has an independent bypass toggle. Bypassed stages crossfade to dry signal over 50ms to avoid clicks. Modulation bypass sets LFO depth to zero.

## Project Structure

```
├── index.html              UI layout (rack-mount panel design)
├── css/
│   ├── styles.css          Hardware synth aesthetic (IBM Plex Mono, amber accent)
├── js/
│   ├── audio-engine.js     AudioContext, master gain, analyser setup
│   ├── effects.js          Saturation, delay, convolution reverb chain
│   ├── modulation.js       4-LFO modulation system
│   ├── fader.js            Custom vertical fader component
│   ├── url-state.js        URL preset encoding/decoding
└   └── main.js             Application state, UI bindings, sequencer
```

## UI

The interface uses a hardware synthesizer / rack-mount aesthetic:

- **Vertical faders** with numeric readouts replace horizontal sliders
- **Panel layout**: effects top-right, two chord layers side-by-side, full-width sequencer bottom
- **Bypass toggles** styled as small illuminated dot indicators
- **Responsive**: stacks to single column below 768px

### Fader Component

`js/fader.js` implements a custom vertical fader using the **Hidden Input Bridge** pattern:

1. Each `<input type="range" data-fader>` is visually hidden via CSS
2. A `<div class="fader" role="slider">` is inserted after it with full ARIA semantics
3. Pointer events (drag) and keyboard (arrows, home/end) update the hidden input's value
4. A native `input` event is dispatched so existing event listeners work unchanged
5. A property descriptor override on `input.value` detects programmatic changes and syncs the visual

## Sequencer

The step sequencer records notes into a 4-second loop divided into 16 grid positions. Input methods:

- **On-screen keyboard** (click/tap)
- **Computer keyboard** mapping: `A S D F G H J K` (white keys C3-C4), `W E T Y U` (black keys)
- **Snap-to-grid** quantizes note placement to 16th-note divisions

Notes appear as draggable blocks in the grid. The playhead animates during playback via `requestAnimationFrame`. Notes are scheduled 100ms ahead using Web Audio's precise timing.

The sequencer **toggle** mutes and unmutes the layer without clearing notes. The status line shows `N notes (off)` when muted so the pattern is preserved.

## Preset Sharing

The full app state encodes automatically into the URL as a `?p=` parameter (debounced 500ms, using `history.replaceState`). Sharing a preset is as simple as copying the address bar.

URLs use a human-readable word format powered by the BIP39 English wordlist (e.g. `?p=hollow-amber-echo-drift-canyon-river`). Legacy base64 URLs from earlier versions are still decoded correctly.

**What is serialized:** effect control values, bypass states, chord layer settings (chord name, vol, tone, pitch, length, crossfade), sequencer layer settings, snap toggle, and all sequencer notes.

**What is not serialized:** uploaded audio files (binary data cannot be encoded in a URL). Layers loaded from uploaded files are silently omitted; they load empty when the URL is restored.

Opening a URL with a `?p=` parameter restores the full preset on load. Malformed parameters fail silently and load defaults.

## Open Source Credits

This project uses no runtime libraries. One open-source asset is bundled directly:

### BIP39 English Wordlist
- **What:** 2048-word list used to encode preset URLs as human-readable word sequences (e.g. `?p=hollow-amber-echo-drift`)
- **Author:** SatoshiLabs (Trezor)
- **License:** [MIT](https://opensource.org/licenses/MIT)
- **Source:** https://github.com/trezor/python-mnemonic/blob/master/src/mnemonic/wordlist/english.txt
- **Specification:** [BIP-0039](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)

The wordlist is embedded inline in `js/url-state.js`.

---

## Browser Support

Requires a modern browser with:
- Web Audio API (`AudioContext`, `OfflineAudioContext`, `ConvolverNode`)
- ES Modules (`<script type="module">`)
- Pointer Events API
- CSS Grid

Tested in Chrome and Safari. No polyfills needed.

## Development

No build step. Edit files and refresh the browser.