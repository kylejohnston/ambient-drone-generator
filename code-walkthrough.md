# Massive Bloom — Code Walkthrough

*2026-03-01T01:15:22Z by Showboat 0.6.1*
<!-- showboat-id: a8521c3d-e2d9-4a95-85ab-2c25829a50d4 -->

Massive Bloom is a browser-based ambient drone generator — no build tools, no framework, no dependencies. It runs as a single HTML page with vanilla ES modules. This walkthrough traces the code from startup to sound, following the signal path: UI → audio context → synthesis → effects → speakers.

## The file structure

Seven files do everything:

```bash
ls -1 js/ && echo '---' && wc -l js/*.js | sort -n
```

```output
audio-engine.js
effects.js
fader.js
granular.js
main.js
modulation.js
url-state.js
---
      97 js/audio-engine.js
     163 js/modulation.js
     182 js/fader.js
     218 js/granular.js
     338 js/effects.js
     507 js/url-state.js
    1443 js/main.js
    2948 total
```

main.js is the orchestrator — almost half the total code. The other six modules are focused helpers. Let's walk through them in the order the browser encounters them.

## Step 1 — The HTML entry point (index.html)

The browser loads index.html, which is the entire UI. There are no templates, no components — just semantic HTML. The rack layout has three rows: effects panel, two chord layers side-by-side, and a sequencer spanning full width.

The page ends with two scripts: a tiny inline handler for the info modal, and the ES module entry point:

```bash
grep -n 'script' index.html
```

```output
334:  <script type="module" src="js/main.js"></script>
335:  <script>
353:  </script>
```

The `type="module"` attribute means main.js runs as an ES module — it can use `import` statements, and it executes after the DOM is parsed. The other script (inline, non-module) handles the info modal's open/close because it needs no imports and benefits from being simpler.

## Step 2 — audio-engine.js: the audio context singleton

Web Audio requires an AudioContext — the clock and factory for all audio nodes. Browsers block context creation until a user gesture (to prevent autoplay abuse). audio-engine.js wraps this in a module-level singleton:

```bash
sed -n '1,37p' js/audio-engine.js
```

```output
/**
 * Audio Engine - Core audio context and routing management
 */

let audioContext = null;
let masterGain = null;
let analyser = null;
let isInitialized = false;

/**
 * Initialize the audio context (must be called from user gesture)
 */
export async function initAudioContext() {
  if (isInitialized) {
    await resumeContext();
    return { audioContext, masterGain, analyser };
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // Create master gain
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.7;

  // Create analyser for visualizations
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  // Route: masterGain -> analyser -> destination
  masterGain.connect(analyser);
  analyser.connect(audioContext.destination);

  isInitialized = true;

  return { audioContext, masterGain, analyser };
}
```

The master signal path baked into the engine: `masterGain → analyser → destination`. Every sound in the app eventually reaches masterGain. The analyser node sits between master gain and speakers — it can read FFT data without affecting the audio, useful for visualizations (the app has the node even though no visualizer is currently displayed).

The `0.7` master gain gives headroom so the summed layers don't clip at full volume.

## Step 3 — modulation.js: LFOs for organic movement

The MOD fader controls a ModulationSystem. Instead of a single LFO (which would sound periodic and robotic), it creates four oscillators at deliberately unsynchronized rates — they never align, so the modulation pattern never exactly repeats:

```bash
sed -n '24,48p' js/modulation.js
```

```output
    // Slower rates for more gradual, subtle evolution
    const lfoConfigs = [
      { rate: 0.03, shape: 'sine' },      // Very slow (was 0.07)
      { rate: 0.07, shape: 'sine' },      // Slow (was 0.13)
      { rate: 0.11, shape: 'triangle' },  // Medium-slow (was 0.23)
      { rate: 0.19, shape: 'sine' },      // Medium (was 0.41)
    ];

    this.lfos = lfoConfigs.map(config => {
      const osc = ctx.createOscillator();
      osc.type = config.shape;
      osc.frequency.value = config.rate;

      const gain = ctx.createGain();
      gain.gain.value = 0; // Will be set by depth

      osc.connect(gain);

      return {
        oscillator: osc,
        gain,
        baseRate: config.rate
      };
    });
  }
```

Rates of 0.03, 0.07, 0.11, 0.19 Hz have no simple integer ratio between them — their combined waveform has a period measured in hours rather than seconds. The triangle shape on the third LFO adds subtle timbral variety (triangle has a softer harmonic spectrum than sine).

Each LFO connects to a target AudioParam via a scaling gain node — the gain controls how much of the LFO swing reaches the target. Modulation depth uses a quadratic curve (value² × 0.6) so the lower range of the MOD fader stays subtle:

```bash
sed -n '52,58p' js/modulation.js
```

```output
   */
  setMovement(value) {
    // Apply curve to make modulation more subtle overall
    // Low values have minimal effect, high values are still controlled
    const normalized = value / 100;
    this.depth = normalized * normalized * 0.6; // Quadratic curve, max 60% depth
    this.updateDepths();
```

## Step 4 — effects.js: the shared signal chain

All three layers feed into a single effects chain: saturation → delay → reverb → masterGain. Each effect is implemented as a parallel dry/wet mixer, so you can blend in as little or as much as you want.

### Saturation (GRIT)

Uses a WaveShaper node with a soft-clipping curve. The curve formula is the classic arctangent approximation:

```bash
sed -n '101,113p' js/effects.js
```

```output
  makeSaturationCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;

    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      // Soft clipping curve
      curve[i] = ((3 + amount * 10) * x * 20 * deg) / (Math.PI + amount * 10 * Math.abs(x));
    }

    return curve;
  }
```

The WaveShaper maps each input amplitude to an output amplitude via a lookup table. Values near zero pass through unchanged; values near ±1 get compressed toward the limits — that's the harmonic grit. The `2x` oversample setting reduces aliasing artifacts at high drive amounts.

### Delay (DLAY)

Two delay lines with deliberately non-synced times (370ms and 530ms) create a stereo spread. They feed into a shared feedback loop with a low-pass filter to make repeats progressively darker and warmer:

```bash
sed -n '127,158p' js/effects.js
```

```output
    // Create stereo delay for width
    const delayL = ctx.createDelay(2);
    const delayR = ctx.createDelay(2);
    delayL.delayTime.value = 0.37;  // Non-synced times for organic feel
    delayR.delayTime.value = 0.53;

    // Stereo merger
    const merger = ctx.createChannelMerger(2);

    // Filter in feedback loop for darker repeats
    const feedbackFilter = ctx.createBiquadFilter();
    feedbackFilter.type = 'lowpass';
    feedbackFilter.frequency.value = 2000;

    // Routing
    input.connect(dryGain);
    dryGain.connect(output);

    input.connect(delayL);
    input.connect(delayR);

    delayL.connect(merger, 0, 0);
    delayR.connect(merger, 0, 1);
    merger.connect(wetGain);
    wetGain.connect(output);

    // Feedback loop
    delayL.connect(feedbackFilter);
    feedbackFilter.connect(feedbackGain);
    feedbackGain.connect(delayL);
    feedbackGain.connect(delayR);

```

The feedback routing is a graph cycle (delayL → feedbackFilter → feedbackGain → delayL), which is legal in Web Audio. The feedbackGain is set below 1.0 to prevent runaway resonance.

### Reverb (RVRB)

The reverb uses convolution — the audio is convolved with a synthetically generated impulse response. The impulse is exponentially-decaying noise, which approximates the diffuse reflections of a real space:

```bash
sed -n '209,237p' js/effects.js
```

```output
  generateImpulseResponse(reverbTime) {
    const ctx = getAudioContext();
    const sampleRate = ctx.sampleRate;

    // Minimum duration of 0.1s to avoid empty buffer
    const duration = Math.max(0.1, reverbTime);
    const length = Math.floor(sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, sampleRate);

    // Calculate decay factor based on reverb time
    // Longer reverb = slower decay (lower value)
    // RT60 approximation: decay so that amplitude is -60dB at end
    const decayFactor = reverbTime > 0 ? 3 * (1 + Math.log10(Math.max(1, reverbTime / 2))) : 3;

    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);

      for (let i = 0; i < length; i++) {
        // Exponential decay with noise
        const t = i / length;
        const envelope = Math.pow(1 - t, decayFactor);
        // Stereo decorrelation with filtered noise for smoother tail
        const noise = (Math.random() * 2 - 1);
        channelData[i] = noise * envelope;
      }
    }

    return impulse;
  }
```

The RVRB fader ranges from 0 to 60 seconds of reverb time. At 60s, the impulse buffer is 60 seconds of audio — large but generated in memory. The `setSpace` method only regenerates when the time changes by ≥1 second, avoiding expensive regeneration on every small fader move.

The two channels get independent random noise samples, creating stereo decorrelation — the left and right tails sound different, which contributes spatial width.

## Step 5 — fader.js: custom vertical fader UI

The HTML uses `<input type="range">` for all controls — standard, accessible, URL-serializable. But the design calls for custom vertical faders. fader.js wraps each hidden range input with a rendered fader without replacing it:

```bash
sed -n '56,92p' js/fader.js
```

```output
  /** Bind pointer and keyboard events */
  bind() {
    // Pointer events for drag interaction
    this.track.addEventListener('pointerdown', (e) => this.onPointerDown(e));

    // Keyboard interaction on the fader wrapper
    this.el.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  onPointerDown(e) {
    e.preventDefault();
    this.track.setPointerCapture(e.pointerId);
    this.updateFromPointer(e);

    const onMove = (ev) => this.updateFromPointer(ev);
    const onUp = (ev) => {
      this.track.releasePointerCapture(ev.pointerId);
      this.track.removeEventListener('pointermove', onMove);
      this.track.removeEventListener('pointerup', onUp);
    };

    this.track.addEventListener('pointermove', onMove);
    this.track.addEventListener('pointerup', onUp);
  }

  updateFromPointer(e) {
    const rect = this.track.getBoundingClientRect();
    // Vertical: top = max, bottom = min (exclude readout band at bottom)
    const usableH = rect.height - READOUT_H;
    const ratio = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / usableH));
    const raw = this.min + ratio * (this.max - this.min);
    const stepped = Math.round(raw / this.step) * this.step;
    const clamped = Math.max(this.min, Math.min(this.max, stepped));
    this.setValue(clamped);
  }

  onKeyDown(e) {
```

Key technique: `setPointerCapture` keeps mouse events flowing to the track element even if the pointer moves outside it during a drag. This prevents the fader from losing track when you drag quickly.

The fader dispatches a native `input` event on the hidden range input whenever its value changes. This means all the main.js event listeners on those inputs work without modification — the fader is a transparent wrapper.

There's also a `hookInputValue` method that uses `Object.defineProperty` to intercept programmatic writes to `input.value`, so the visual fader stays in sync when the URL preset restores values.

## Step 6 — url-state.js: BIP39 preset sharing

Every time you move a fader the URL updates with the current state (debounced 500ms). The encoding uses BIP39 — the same 2048-word wordlist used in cryptocurrency wallet seed phrases. A preset looks like: `?p=abstract-canyon-flame-echo-vivid`

The encoding is bit-packed binary serialized to BIP39 words (11 bits per word). Here's the format:

```bash
sed -n '340,393p' js/url-state.js
```

```output
function stateToBytes(state) {
  const w = new BitWriter();

  w.write(1, 3);  // version = 1

  // Effects controls
  w.write(Math.round(state.controls.movement), 7);
  w.write(Math.round(state.controls.grit),     7);
  w.write(Math.round(state.controls.depth),    7);
  w.write(Math.round(state.controls.space),    6); // max=60, fits in 6 bits (0–63)

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
    const chordIdx = CHORD_KEYS.indexOf(layer.chord);
    if (chordIdx === -1) throw new Error(`Unknown chord: ${layer.chord}`);
    w.write(chordIdx, 4);
    w.write(Math.round(layer.volume), 7);
    w.write(Math.round(layer.filter), 7);
    w.write(layer.pitch + 24, 6);             // offset encode: -24..+24 → 0..48
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
    const noteIdx = NOTE_KEYS.indexOf(n.note);
    if (noteIdx === -1) throw new Error(`Unknown note: ${n.note}`);
    w.write(noteIdx, 4);
    w.write(Math.min(63, Math.round(n.time * 16)), 6);
  }

  return w.flush();
}
```

Every field is packed into the minimum bits needed: MOD (0–100) needs 7 bits, RVRB (0–60) fits in 6. Pitch (±24 semitones) is offset-encoded as 0–48 so it's always positive. The full state fits in roughly 8–10 BIP39 words — short enough to share in a URL.

The BitWriter/BitReader classes work at the individual bit level. The words are then looked up in a 2048-entry array (exactly 2^11 = 2048 entries, so 11 bits maps cleanly to one word).

Legacy base64-encoded URLs are still decoded if found (the format changed — base64 URLs never contain hyphens, so the decoder branches on that).

```bash
sed -n '495,507p' js/url-state.js
```

```output
export function decodeState(encoded) {
  try {
    if (encoded.includes('-')) return decodeWords(encoded);
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

## Step 7 — main.js: orchestration

main.js is where everything connects. It starts with constant tables:

```bash
sed -n '35,58p' js/main.js
```

```output
const CHORDS = {
  'Cmaj7': [130.81, 164.81, 196.00, 246.94],
  'Am7': [110.00, 130.81, 164.81, 196.00],
  'Fmaj7': [87.31, 130.81, 164.81, 207.65],
  'Dm7': [73.42, 110.00, 146.83, 174.61],
  'G7': [98.00, 123.47, 146.83, 174.61],
  'Em7': [82.41, 123.47, 146.83, 196.00],
  'Bbmaj7': [116.54, 146.83, 174.61, 220.00],
  'Csus2': [130.81, 146.83, 196.00, 261.63],
  'Fsus2': [87.31, 98.00, 130.81, 174.61],
  'Asus2': [110.00, 123.47, 164.81, 220.00],
};

// Keyboard mapping
const KEY_MAP = {
  'a': 'C3', 's': 'D3', 'd': 'E3', 'f': 'F3',
  'g': 'G3', 'h': 'A3', 'j': 'B3', 'k': 'C4',
  'w': 'C#3', 'e': 'D#3', 't': 'F#3', 'y': 'G#3', 'u': 'A#3'
};

// Sequencer constants
const LOOP_LENGTH = 4.0;   // 4 seconds
const GRID_DIVISIONS = 16; // 16th notes
const NOTE_DURATION = 3.5; // How long each triggered note sounds (long for ambient blend)8
```

Chords are stored as frequency arrays (Hz) not note names — they go straight to oscillator frequencies without any additional lookup. The sequencer keyboard maps the familiar QWERTY home row (A–K for white keys, W E T Y U for black keys, skipping the gaps where there are no black keys).

### The application state object

All runtime state lives in one plain object:

```bash
sed -n '60,91p' js/main.js
```

```output
// Application state
const state = {
  isPlaying: false,
  layers: [
    { type: null, chord: null, buffer: null, name: 'Empty', volume: 100, filter: 8, pitch: 0, length: 10, fade: 2 },
    { type: null, chord: null, buffer: null, name: 'Empty', volume: 100, filter: 16, pitch: 24, length: 6, fade: 1 },
    { type: 'sequencer', chord: null, buffer: null, name: 'Sequencer', volume: 100, filter: 32, pitch: 0 }
  ],
  controls: {
    movement: 56, // Modulation amount
    grit: 24,     // Amount of distortion/saturation
    depth: 40,    // Delay
    space: 60     // Reverb time in seconds
  },
  bypass: {
    modulation: false,
    grit: false,
    delay: false,
    reverb: false
  },
  sequencer: {
    snap: true,
    muted: false,
    notes: [], // { id, note, time }
    loopStartTime: 0,
    nextNoteId: 0,
    scheduledNotes: [],
    lastScheduleTime: 0
  },
  activeKeys: new Set(),
  dragState: null
};
```

Layer 2's default filter (32) is higher than layers 0/1 (8, 16) — the sequencer is meant to sound brighter by default. Layer 1 defaults to pitch +24 (two octaves up), so when you add a second chord layer, it sits in a harmonic register above the first without any configuration.

### Startup: init()

On DOMContentLoaded, `init()` wires everything up:

```bash
sed -n '222,241p' js/main.js
```

```output
function init() {
  bindControls();
  bindLayerParams();
  bindBypassToggles();
  bindPlayButton();
  bindLayers();
  bindLayerVolumes();
  bindSequencer();

  startPlayheadAnimation();

  // Initialize vertical faders for all data-fader inputs
  document.querySelectorAll('input[data-fader]').forEach(input => {
    new VerticalFader(input);
  });

  // Restore preset from URL if present
  const saved = getUrlParam();
  if (saved) applyPreset(decodeState(saved));
}
```

No audio is created here — init() only attaches event listeners. Audio only initializes on play button click (user gesture requirement). The fader loop finds every `input[data-fader]` element by the data attribute and wraps each one with a VerticalFader. The URL check at the end restores a shared preset if one is in the query string.

### Chord buffer generation

When a chord is selected, it generates audio in an OfflineAudioContext — a non-realtime context that renders to a buffer as fast as the CPU allows:

```bash
sed -n '1187,1229p' js/main.js
```

```output
async function generateNotesBuffer(frequencies, duration = 6, fadeTime = 1) {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

  frequencies.forEach((freq) => {
    const osc = offlineCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    const detunedOsc = offlineCtx.createOscillator();
    detunedOsc.type = 'sawtooth';
    detunedOsc.frequency.value = freq * 1.003;

    const subOsc = offlineCtx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = freq / 2;

    const gains = [0.15, 0.1, 0.1].map(v => {
      const g = offlineCtx.createGain();
      g.gain.value = v;
      return g;
    });

    osc.connect(gains[0]);
    detunedOsc.connect(gains[1]);
    subOsc.connect(gains[2]);
    gains.forEach(g => g.connect(offlineCtx.destination));

    [osc, detunedOsc, subOsc].forEach(o => {
      o.start(0);
      o.stop(duration);
    });
  });

  const rawBuffer = await offlineCtx.startRendering();

  // Apply crossfade for seamless looping
  if (fadeTime > 0) {
    return applyCrossfade(rawBuffer, fadeTime);
  }
  return rawBuffer;
}
```

Each chord note gets three oscillators: a sawtooth at the fundamental, a sawtooth slightly detuned (+0.3%), and a sine at half-frequency (one octave down) for warmth. The slight detune creates natural-sounding beating — the two sawtooth waves phase in and out of alignment, like two string players not quite in tune.

After rendering, `applyCrossfade` mixes the buffer's tail into its head and vice versa. This makes the loop point inaudible — when the buffer source loops, the transition is a pre-baked crossfade in the audio data itself.

### Starting the drone: startDrone()

When the play button is pressed for the first time, the audio graph is assembled:

```bash
sed -n '1304,1395p' js/main.js
```

```output
async function startDrone() {
  const { masterGain } = await initAudioContext();
  await resumeContext();

  const ctx = getAudioContext();
  state.sequencer.loopStartTime = ctx.currentTime;
  state.sequencer.scheduledNotes = [];

  // Create effects chain (shared: saturation, delay, reverb)
  effects = new EffectsChain(masterGain);
  const effectsInput = effects.init();

  // Create sequencer output with per-layer filter and volume
  const seqLayer = state.layers[2];
  const seqVolume = seqLayer.volume / 100;

  // Sequencer filter (per-layer)
  layerFilters[2] = ctx.createBiquadFilter();
  layerFilters[2].type = 'lowpass';
  layerFilters[2].Q.value = 0.7;
  applyFilterValue(layerFilters[2], seqLayer.filter);

  // Sequencer gain
  layerGains[2] = createGain(seqVolume);

  // Chain: sequencerOutput -> filter -> gain -> effects
  sequencerOutput = createGain(1);
  sequencerOutput.connect(layerFilters[2]);
  layerFilters[2].connect(layerGains[2]);
  layerGains[2].connect(effectsInput);

  // Create modulation (will connect to filters after they're created)
  modulation = new ModulationSystem();
  modulation.start();

  // Setup layers 0 and 1
  const activeLayers = state.layers.slice(0, 2).filter(l => l.buffer);

  // Create layer audio routing with per-layer filter
  state.layers.slice(0, 2).forEach((layer, index) => {
    // Create per-layer filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    applyFilterValue(filter, layer.filter);
    layerFilters[index] = filter;

    // Create volume gain node for this layer
    const volume = layer.volume / 100;
    layerGains[index] = createGain(volume);

    // Chain: source -> filter -> volume -> effects
    filter.connect(layerGains[index]);
    layerGains[index].connect(effectsInput);

    // Calculate playback rate from pitch
    const playbackRate = Math.pow(2, layer.pitch / 12);

    // Start looping source if layer has buffer
    if (layer.buffer) {
      const source = ctx.createBufferSource();
      source.buffer = layer.buffer;
      source.loop = true;
      source.playbackRate.value = playbackRate;
      source.connect(filter);
      source.start();
      layerSources[index] = source;
    }
  });

  // Connect modulation to all layer filters for subtle movement
  layerFilters.forEach((filter, index) => {
    if (filter) {
      modulation.connect(filter.frequency, {
        min: 800, max: 2500, intensity: 0.15, lfoIndex: index % 4
      });
    }
  });

  // Start sequencer scheduling
  startSequencerScheduler();

  state.isPlaying = true;

  // Apply controls and bypasses after isPlaying = true so their guards pass
  applyControls();
  Object.keys(state.bypass).forEach(stage => {
    if (state.bypass[stage]) {
      applyBypass(stage, true);
    }
  });
}
```

The full audio graph at runtime:

```
Layer 0 source ──→ layerFilter[0] ──→ layerGain[0] ──┐
Layer 1 source ──→ layerFilter[1] ──→ layerGain[1] ──┤
Sequencer oscs ──→ layerFilter[2] ──→ layerGain[2] ──┤
                                                      ↓
                                              effectsInput
                                                      ↓
                                               saturation
                                                      ↓
                                                  delay
                                                      ↓
                                                  reverb
                                                      ↓
                                               masterGain
                                                      ↓
                                                 analyser
                                                      ↓
                                               destination
```

Modulation's LFOs connect to each `layerFilter[n].frequency` parameter, adding gentle filter sweeps. Each layer uses a different LFO (index mod 4) so the three layers' filters move independently.

### The sequencer: scheduling ahead of time

The sequencer uses a classic Web Audio technique: a setInterval runs every 25ms and schedules notes 100ms into the future. This small lookahead buffer means notes always fire precisely on time, even if JavaScript is briefly blocked by other work:

```bash
sed -n '1068,1104p' js/main.js
```

```output
function scheduleSequencerNotes() {
  if (!state.isPlaying || state.sequencer.notes.length === 0 || state.sequencer.muted) return;

  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const loopStart = state.sequencer.loopStartTime;
  const elapsed = now - loopStart;
  const currentLoopTime = elapsed % LOOP_LENGTH;
  const currentLoop = Math.floor(elapsed / LOOP_LENGTH);

  // Schedule notes for the next 100ms
  const scheduleAhead = 0.1;

  state.sequencer.notes.forEach(noteData => {
    const noteTime = noteData.time;

    // Calculate when this note should play in the current and next loop
    for (let loopOffset = 0; loopOffset <= 1; loopOffset++) {
      const absoluteTime = loopStart + (currentLoop + loopOffset) * LOOP_LENGTH + noteTime;

      // Check if this note should be scheduled
      if (absoluteTime >= now && absoluteTime < now + scheduleAhead) {
        // Check if already scheduled
        const scheduleKey = `${noteData.id}-${currentLoop + loopOffset}`;
        if (!state.sequencer.scheduledNotes.includes(scheduleKey)) {
          state.sequencer.scheduledNotes.push(scheduleKey);
          triggerNote(noteData.note, absoluteTime, noteData.id);

          // Cleanup old schedule keys
          if (state.sequencer.scheduledNotes.length > 100) {
            state.sequencer.scheduledNotes = state.sequencer.scheduledNotes.slice(-50);
          }
        }
      }
    }
  });
}
```

The `scheduleKey` (e.g. `"5-3"` = note id 5, loop iteration 3) prevents double-scheduling: each unique note-per-loop-iteration is only queued once. The loop checks both the current and next loop iteration to handle the case where the lookahead window spans a loop boundary.

### Sequencer note synthesis: triggerNote()

Each triggered note creates a four-oscillator pad sound in the live audio context:

```bash
sed -n '1106,1155p' js/main.js
```

```output
function triggerNote(note, time, noteId) {
  const ctx = getAudioContext();
  const baseFreq = NOTE_FREQUENCIES[note];

  // Apply pitch shift from layer 2 (sequencer)
  const pitchShift = state.layers[2].pitch || 0;
  const pitchMultiplier = Math.pow(2, pitchShift / 12);
  const freq = baseFreq * pitchMultiplier;

  // Ambient pad-style envelope: slow attack, long sustain, gentle release
  const duration = NOTE_DURATION;
  const attackTime = 0.4;  // Slow fade in
  const releaseTime = duration * 0.4;  // Long fade out
  const peakGain = 0.06;  // Lower gain so overlapping notes don't clip

  // Create pad sound with multiple oscillators
  const osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = freq;

  const osc2 = ctx.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.value = freq * 1.002; // Slight detune for warmth

  const osc3 = ctx.createOscillator();
  osc3.type = 'sawtooth';
  osc3.frequency.value = freq * 0.998; // Detune other direction

  const subOsc = ctx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.value = freq / 2;

  // Lowpass filter to soften the bright sawtooth sound
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;  // Mellow cutoff
  filter.Q.value = 0.5;

  // Amplitude envelope: slow attack, sustain, slow release
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peakGain, time + attackTime);
  gain.gain.setValueAtTime(peakGain, time + duration - releaseTime);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  // Connect oscillators -> filter -> gain -> output
  osc1.connect(filter);
  osc2.connect(filter);
  osc3.connect(filter);
  subOsc.connect(gain);  // Sub goes direct (already smooth sine)
```

Two sawtooths slightly above (+0.2%) and below (-0.2%) the target frequency cause gentle beating. The sub-oscillator (one octave down, sine wave) goes directly to the gain node, bypassing the low-pass filter — because the sub is already a pure sine, there's nothing to filter. `NOTE_DURATION = 3.5s` means notes decay over 3.5 seconds, much longer than the 4-second loop. Notes constantly overlap, creating the blurred, ambient character.

The pitch fader affects sequencer notes by multiplying the base frequency: `freq × 2^(semitones/12)` is the equal-temperament formula.

### The TONE (filter) fader: logarithmic mapping

The TONE fader doesn't map linearly to Hz. It uses an exponential curve so the fader feels proportional to how humans hear pitch:

```bash
sed -n '357,368p' js/main.js
```

```output
 * Map a 0-100 tone value to a filter frequency (Hz)
 */
function toneToFreq(value) {
  return 200 * Math.pow(8000 / 200, value / 100);
}

/**
 * Apply filter value to a filter node (0-100 maps to frequency)
 */
function applyFilterValue(filter, value) {
  filter.frequency.value = toneToFreq(value);
}
```

At value=0: 200 × (8000/200)^0 = 200 Hz (dark, nearly muffled). At value=100: 200 × (8000/200)^1 = 8000 Hz (bright, full harmonic content). The exponential curve `200 × 40^(v/100)` gives more resolution in the low end where the interesting tonal changes happen.

## Bonus: granular.js (present but currently unused)

The codebase includes a complete granular synthesis engine — it breaks a buffer into short overlapping "grains" and scatters them, creating evolving textural drones rather than looping playback. It's fully implemented but not currently wired into the UI:

```bash
sed -n '14,30p' js/granular.js
```

```output
    this.activeGrains = [];

    // Granular parameters
    this.params = {
      grainSize: 0.08,       // seconds (20ms - 200ms)
      grainDensity: 15,      // grains per second
      pitchScatter: 0,       // semitones of random pitch variation
      positionRandom: 0.3,   // how much to randomize playback position
      overlap: 0.5,          // grain overlap factor
    };

    // Internal state
    this.nextGrainTime = 0;
    this.grainOutput = null;
    this.playbackRate = 1;   // Base playback rate for pitch shifting
  }

```

Each grain gets a Hann-window envelope (ramp up, plateau, ramp down) and plays a randomly-chosen position in the buffer. The scheduler runs on setInterval(25ms) like the sequencer, queuing grains 100ms ahead. At 15 grains/second with 50% overlap, there are always 1–2 active grains — enough to be seamless without CPU overload.

## Summary

The signal flow in one line:

**UI event → state update → audio param change → browser renders audio → speakers**

The architecture keeps each concern isolated:
- **audio-engine.js** owns the context and master routing
- **modulation.js** produces LFO signals (no knowledge of what they're connected to)
- **effects.js** accepts any audio input and returns a processed output
- **fader.js** wraps any range input without touching audio code
- **url-state.js** knows nothing about the DOM — just serializes/deserializes a plain object
- **main.js** wires all of it together and owns the application state

The whole thing runs in any modern browser: no bundler, no framework, no server needed.
