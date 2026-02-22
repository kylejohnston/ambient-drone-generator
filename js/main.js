/**
 * Main Application - UI binding, layers, step sequencer, and orchestration
 */

import {
  initAudioContext,
  getAudioContext,
  getMasterGain,
  decodeAudioFile,
  resumeContext,
  createGain
} from './audio-engine.js';
import { ModulationSystem } from './modulation.js';
import { EffectsChain } from './effects.js';
import { Visualizer } from './visualizer.js';
import { VerticalFader } from './fader.js';
import { encodeState, decodeState, getUrlParam } from './url-state.js';

// Note frequencies (Hz)
const NOTE_FREQUENCIES = {
  'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56,
  'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00,
  'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
  'C4': 261.63
};

// Note display names (without octave)
const NOTE_NAMES = {
  'C3': 'C', 'C#3': 'C#', 'D3': 'D', 'D#3': 'D#',
  'E3': 'E', 'F3': 'F', 'F#3': 'F#', 'G3': 'G',
  'G#3': 'G#', 'A3': 'A', 'A#3': 'A#', 'B3': 'B',
  'C4': 'C'
};

// Chord definitions
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
const NOTE_DURATION = 3.5; // How long each triggered note sounds (long for ambient blend)

// Application state
const state = {
  isPlaying: false,
  layers: [
    { type: null, chord: null, buffer: null, name: 'Empty', volume: 80, filter: 8, pitch: 0, length: 10, fade: 2 },
    { type: null, chord: null, buffer: null, name: 'Empty', volume: 80, filter: 50, pitch: 0, length: 6, fade: 1 },
    { type: 'sequencer', chord: null, buffer: null, name: 'Sequencer', volume: 100, filter: 33, pitch: -11 }
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
    delay: true,
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

// Audio components
let layerGains = [null, null, null]; // Gain nodes for each layer
let layerFilters = [null, null, null]; // Per-layer filter nodes
let layerSources = [null, null]; // Looping buffer sources for layers 0 and 1
let effects = null;
let modulation = null;
let visualizer = null;
let sequencerOutput = null;
let playheadAnimationFrame = null;

// ============ URL Preset Sharing ============

let _urlUpdateTimer = null;

/**
 * Debounced: update the URL bar with the current encoded state.
 * Uses replaceState to avoid polluting browser history.
 */
function scheduleUrlUpdate() {
  clearTimeout(_urlUpdateTimer);
  _urlUpdateTimer = setTimeout(() => {
    const encoded = encodeState(state);
    history.replaceState(null, '', `?p=${encoded}`);
  }, 500);
}

/**
 * Apply a decoded preset object to the app state and UI.
 * Only chord layers are restored; uploaded-file layers load empty.
 */
function applyPreset(preset) {
  if (!preset || preset.v !== 1) return;

  const CONTROL_ORDER = ['movement', 'grit', 'depth', 'space'];
  const BYPASS_ORDER  = ['modulation', 'grit', 'delay', 'reverb'];

  // Controls
  CONTROL_ORDER.forEach((name, i) => {
    const val = preset.c?.[i];
    if (val == null) return;
    const input = document.getElementById(name);
    if (!input) return;
    input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Bypass states
  BYPASS_ORDER.forEach((stage, i) => {
    const bypassed = preset.b?.[i] === 1;
    const toggle = document.querySelector(`.bypass-toggle[data-bypass="${stage}"]`);
    if (!toggle) return;
    const stageEl = toggle.closest('.control-stage');
    if (bypassed) {
      toggle.classList.remove('active');
      stageEl?.classList.add('bypassed');
    } else {
      toggle.classList.add('active');
      stageEl?.classList.remove('bypassed');
    }
    toggle.setAttribute('aria-pressed', bypassed ? 'true' : 'false');
    state.bypass[stage] = bypassed;
  });

  // Layer params and chord selection
  preset.l?.forEach((layerData, i) => {
    if (layerData == null) return;

    const volInput = document.querySelector(`.layer-vol-slider[data-layer="${i}"]`);
    if (volInput && layerData.v != null) {
      volInput.value = layerData.v;
      volInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const filterInput = document.querySelector(`.layer-filter-slider[data-layer="${i}"]`);
    if (filterInput && layerData.f != null) {
      filterInput.value = layerData.f;
      filterInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const pitchInput = document.querySelector(`.layer-pitch-slider[data-layer="${i}"]`);
    if (pitchInput && layerData.p != null) {
      pitchInput.value = layerData.p;
      pitchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (i < 2) {
      // Length and fade must be set before the chord change event so
      // generateChordBuffer picks up the correct duration/crossfade values
      const lengthInput = document.querySelector(`.layer-length-slider[data-layer="${i}"]`);
      if (lengthInput && layerData.l != null) {
        lengthInput.value = layerData.l;
        lengthInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const fadeInput = document.querySelector(`.layer-fade-slider[data-layer="${i}"]`);
      if (fadeInput && layerData.x != null) {
        fadeInput.value = layerData.x;
        fadeInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Trigger async chord generation via the existing bindLayers listener
      if (layerData.ch) {
        const chordSelect = document.querySelector(`.layer-chord[data-layer="${i}"]`);
        if (chordSelect) {
          chordSelect.value = layerData.ch;
          chordSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  });

  // Sequencer snap and notes
  if (preset.sq) {
    const snap = preset.sq.sn === 1;
    state.sequencer.snap = snap;
    const snapToggle = document.getElementById('quantize-toggle');
    if (snapToggle) snapToggle.checked = snap;

    if (Array.isArray(preset.sq.n)) {
      state.sequencer.notes = preset.sq.n.map(([note, time]) => ({
        id: state.sequencer.nextNoteId++,
        note,
        time
      }));
    }

    updateSequencerUI();
  }
}

/**
 * Initialize the application
 */
function init() {
  const canvas = document.getElementById('visualizer');
  visualizer = new Visualizer(canvas);

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

// ============ Controls ============

function bindControls() {
  const controlNames = ['movement', 'grit', 'depth', 'space'];

  controlNames.forEach(name => {
    const slider = document.getElementById(name);
    if (!slider) return;

    slider.addEventListener('input', (e) => {
      state.controls[name] = parseInt(e.target.value, 10);
      updateParameter(name, state.controls[name]);

      // Update reverb time display
      if (name === 'space') {
        const output = document.getElementById('space-value');
        if (output) output.textContent = `${state.controls[name]}s`;
      }

      scheduleUrlUpdate();
    });
  });
}

function bindLayerParams() {
  // Per-layer filter (Tone)
  document.querySelectorAll('.layer-filter-slider').forEach(slider => {
    const layerIndex = parseInt(slider.dataset.layer, 10);

    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      state.layers[layerIndex].filter = value;
      updateLayerFilter(layerIndex, value);
      scheduleUrlUpdate();
    });
  });

  // Per-layer pitch
  document.querySelectorAll('.layer-pitch-slider').forEach(slider => {
    const layerIndex = parseInt(slider.dataset.layer, 10);

    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      state.layers[layerIndex].pitch = value;
      updateLayerPitch(layerIndex, value);

      // Update pitch display
      const output = document.getElementById(`layer-${layerIndex}-pitch-value`);
      if (output) {
        output.textContent = value > 0 ? `+${value}` : value;
      }

      scheduleUrlUpdate();
    });
  });

  // Per-layer length (for generated chords)
  document.querySelectorAll('.layer-length-slider').forEach(slider => {
    const layerIndex = parseInt(slider.dataset.layer, 10);

    slider.addEventListener('input', async (e) => {
      const value = parseInt(e.target.value, 10);
      state.layers[layerIndex].length = value;

      // Update length display
      const output = document.getElementById(`layer-${layerIndex}-length-value`);
      if (output) {
        output.textContent = `${value}s`;
      }

      // Regenerate buffer if layer has a chord selected
      if (state.layers[layerIndex].chord) {
        const buffer = await generateChordBuffer(state.layers[layerIndex].chord, layerIndex);
        state.layers[layerIndex].buffer = buffer;
        if (state.isPlaying) {
          restartLayerSource(layerIndex);
        }
      }

      scheduleUrlUpdate();
    });
  });

  // Per-layer fade (crossfade for loop smoothing)
  document.querySelectorAll('.layer-fade-slider').forEach(slider => {
    const layerIndex = parseInt(slider.dataset.layer, 10);

    slider.addEventListener('input', async (e) => {
      const value = parseFloat(e.target.value);
      state.layers[layerIndex].fade = value;

      // Update fade display
      const output = document.getElementById(`layer-${layerIndex}-fade-value`);
      if (output) {
        output.textContent = `${value.toFixed(1)}s`;
      }

      // Regenerate buffer if layer has a chord (fade is baked into generated buffer)
      if (state.layers[layerIndex].chord) {
        const buffer = await generateChordBuffer(state.layers[layerIndex].chord, layerIndex);
        state.layers[layerIndex].buffer = buffer;
        if (state.isPlaying) {
          restartLayerSource(layerIndex);
        }
      }
      // Note: For uploaded files, crossfade was applied on upload.
      // Changing fade after upload would require storing the original buffer.

      scheduleUrlUpdate();
    });
  });
}

/**
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

/**
 * Update per-layer filter (Tone: 0-100 maps to frequency)
 */
function updateLayerFilter(index, value) {
  if (!state.isPlaying || !layerFilters[index]) return;

  const ctx = getAudioContext();
  layerFilters[index].frequency.setTargetAtTime(toneToFreq(value), ctx.currentTime, 0.1);
}

/**
 * Update per-layer pitch (semitones)
 */
function updateLayerPitch(index, semitones) {
  if (!state.isPlaying) return;

  const playbackRate = Math.pow(2, semitones / 12);

  // Update source playback rate
  if (index < 2 && layerSources[index]) {
    layerSources[index].playbackRate.value = playbackRate;
  }

  // For sequencer (index 2), pitch affects note frequencies - handled in triggerNote
}

function bindBypassToggles() {
  document.querySelectorAll('.bypass-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const stage = toggle.dataset.bypass;
      const isActive = toggle.classList.contains('active');

      toggle.classList.toggle('active');
      toggle.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      toggle.closest('.control-stage').classList.toggle('bypassed', isActive);

      state.bypass[stage] = isActive;
      applyBypass(stage, isActive);
      scheduleUrlUpdate();
    });
  });
}

function applyBypass(stage, bypassed) {
  if (!state.isPlaying) return;

  switch (stage) {
    case 'modulation':
      modulation?.setMovement(bypassed ? 0 : state.controls.movement);
      break;
    case 'grit':
      effects?.setGritBypass(bypassed);
      break;
    case 'delay':
      effects?.setDelayBypass(bypassed);
      break;
    case 'reverb':
      effects?.setReverbBypass(bypassed);
      break;
  }
}

function updateParameter(name, value) {
  if (!state.isPlaying) return;

  switch (name) {
    case 'movement':
      if (!state.bypass.modulation) modulation?.setMovement(value);
      break;
    case 'grit':
      effects?.setGrit(value);
      break;
    case 'depth':
      effects?.setDepth(value);
      break;
    case 'space':
      effects?.setSpace(value);
      break;
  }
}

// ============ Play Button ============

function bindPlayButton() {
  const playBtn = document.getElementById('play-btn');

  playBtn.addEventListener('click', async () => {
    if (state.isPlaying) {
      stopDrone();
      playBtn.classList.remove('playing');
      playBtn.setAttribute('aria-label', 'Play drone');
    } else {
      await startDrone();
      // Only show playing state if something actually started
      if (state.isPlaying) {
        playBtn.classList.add('playing');
        playBtn.setAttribute('aria-label', 'Pause drone');
      }
    }
  });
}

// ============ Layers 1 & 2 ============

function bindLayers() {
  document.querySelectorAll('.layer-chord').forEach(select => {
    const layerIndex = parseInt(select.dataset.layer, 10);
    if (layerIndex === 2) return;

    const fileInput = document.querySelector(`.layer-upload[data-layer="${layerIndex}"]`);

    select.addEventListener('change', async (e) => {
      const value = e.target.value;

      if (value === 'upload') {
        // Trigger file picker
        fileInput.click();
        // Reset select to previous value (will be updated when file loads)
        const layer = state.layers[layerIndex];
        if (layer.type === 'upload') {
          // Keep showing the filename option
          select.value = `file:${layer.name}`;
        } else if (layer.type === 'chord') {
          select.value = layer.chord;
        } else {
          select.value = '';
        }
        return;
      }

      if (value && !value.startsWith('file:')) {
        // Chord selected
        await initAudioContext();
        const buffer = await generateChordBuffer(value, layerIndex);
        setLayer(layerIndex, 'chord', value, buffer);
        // Remove any file option that might exist
        removeFileOption(select);
      } else if (!value) {
        clearLayer(layerIndex);
        removeFileOption(select);
      }
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await initAudioContext();
        const arrayBuffer = await file.arrayBuffer();
        const rawBuffer = await decodeAudioFile(arrayBuffer);
        // Apply crossfade for smooth looping
        const fadeTime = state.layers[layerIndex].fade || 1;
        const buffer = fadeTime > 0 ? applyCrossfade(rawBuffer, fadeTime) : rawBuffer;
        setLayer(layerIndex, 'upload', file.name, buffer);

        // Add filename as option and select it
        updateSelectWithFilename(select, file.name);
      } catch (error) {
        console.error('Error loading audio file:', error);
      }
      // Reset file input so same file can be re-selected
      fileInput.value = '';
    });
  });

  document.querySelectorAll('.layer-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      const layerIndex = parseInt(btn.dataset.layer, 10);
      if (layerIndex === 2) {
        clearSequencer();
      } else {
        clearLayer(layerIndex);
      }
    });
  });

  // Layer toggle acts as power/clear button
  document.querySelectorAll('.layer-toggle[data-layer]').forEach(btn => {
    const layerIndex = parseInt(btn.dataset.layer, 10);
    btn.addEventListener('click', () => {
      if (layerIndex === 2) {
        if (state.sequencer.notes.length > 0 || state.sequencer.muted) {
          state.sequencer.muted = !state.sequencer.muted;
          updateSequencerUI();
        }
        return;
      }
      // Chord layers: clear if loaded, or auto-select first chord to turn on
      if (state.layers[layerIndex].type) {
        clearLayer(layerIndex);
      } else {
        const chordSelect = document.querySelector(`.layer-chord[data-layer="${layerIndex}"]`);
        if (chordSelect) {
          chordSelect.value = 'Cmaj7';
          chordSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
  });
}

function setLayer(index, type, name, buffer) {
  // Preserve per-layer settings
  const { volume, filter, pitch, length, fade } = state.layers[index];
  state.layers[index] = {
    type,
    chord: type === 'chord' ? name : null,
    buffer,
    name,
    volume,
    filter,
    pitch,
    length,
    fade
  };
  updateLayerUI(index);

  if (state.isPlaying && index < 2) {
    restartLayerSource(index);
  }

  scheduleUrlUpdate();
}

function clearLayer(index) {
  // Preserve per-layer settings
  const { volume, filter, pitch, length, fade } = state.layers[index];
  state.layers[index] = {
    type: null,
    chord: null,
    buffer: null,
    name: 'Empty',
    volume,
    filter,
    pitch,
    length,
    fade
  };
  updateLayerUI(index);

  const chordSelect = document.querySelector(`.layer-chord[data-layer="${index}"]`);
  if (chordSelect) {
    removeFileOption(chordSelect);
    chordSelect.value = '';
  }

  if (state.isPlaying && index < 2) {
    // Stop source
    if (layerSources[index]) {
      try {
        layerSources[index].stop();
      } catch (e) {
        // Already stopped
      }
      layerSources[index] = null;
    }
  }

  scheduleUrlUpdate();
}

function updateLayerUI(index) {
  const layer = state.layers[index];
  const layerEl = document.querySelector(`.layer[data-layer="${index}"]`);
  if (!layerEl) return;

  const nameEl = document.getElementById(`layer-${index}-name`);
  const clearBtn = layerEl.querySelector('.layer-clear');

  if (layer.type && layer.type !== 'sequencer') {
    layerEl.classList.add('has-content');
    nameEl.textContent = layer.name;
    clearBtn.hidden = false;
  } else if (layer.type !== 'sequencer') {
    layerEl.classList.remove('has-content');
    nameEl.textContent = 'Empty';
    clearBtn.hidden = true;
  }
}

/**
 * Add a filename option to the select and choose it
 */
function updateSelectWithFilename(select, filename) {
  // Remove any existing file option
  removeFileOption(select);

  // Truncate long filenames for display
  const displayName = filename.length > 20
    ? filename.slice(0, 17) + '...'
    : filename;

  // Create new option for the file
  const option = document.createElement('option');
  option.value = `file:${filename}`;
  option.textContent = `📁 ${displayName}`;
  option.dataset.isFile = 'true';

  // Insert before the "Upload file..." option
  const uploadOption = select.querySelector('option[value="upload"]');
  select.insertBefore(option, uploadOption);

  // Select the new option
  select.value = `file:${filename}`;
}

/**
 * Remove any file option from the select
 */
function removeFileOption(select) {
  const fileOption = select.querySelector('option[data-is-file="true"]');
  if (fileOption) {
    fileOption.remove();
  }
}

function bindLayerVolumes() {
  document.querySelectorAll('.layer-vol-slider').forEach(slider => {
    const layerIndex = parseInt(slider.dataset.layer, 10);

    slider.addEventListener('input', (e) => {
      const volume = parseInt(e.target.value, 10);
      state.layers[layerIndex].volume = volume;
      updateLayerVolume(layerIndex, volume);
      scheduleUrlUpdate();
    });
  });
}

function updateLayerVolume(index, volume) {
  if (!state.isPlaying) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const gain = volume / 100;

  // All layers now use layerGains for volume control
  if (layerGains[index]) {
    layerGains[index].gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
  }
}

// ============ Sequencer ============

function bindSequencer() {
  const keyboard = document.getElementById('keyboard');
  const snapToggle = document.getElementById('quantize-toggle');
  const grid = document.getElementById('sequencer-grid');

  // Snap toggle
  snapToggle?.addEventListener('change', (e) => {
    state.sequencer.snap = e.target.checked;
    scheduleUrlUpdate();
  });

  // Keyboard mouse input
  keyboard.querySelectorAll('.key').forEach(key => {
    key.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      key.classList.add('active');
      await addNote(key.dataset.note);
    });
    key.addEventListener('mouseup', () => key.classList.remove('active'));
    key.addEventListener('mouseleave', () => key.classList.remove('active'));
  });

  // Keyboard input
  document.addEventListener('keydown', async (e) => {
    if (e.repeat) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    const note = KEY_MAP[e.key.toLowerCase()];
    if (note && !state.activeKeys.has(e.key.toLowerCase())) {
      state.activeKeys.add(e.key.toLowerCase());
      keyboard.querySelector(`[data-key="${e.key.toLowerCase()}"]`)?.classList.add('active');
      await addNote(note);
    }
  });

  document.addEventListener('keyup', (e) => {
    const note = KEY_MAP[e.key.toLowerCase()];
    if (note) {
      state.activeKeys.delete(e.key.toLowerCase());
      keyboard.querySelector(`[data-key="${e.key.toLowerCase()}"]`)?.classList.remove('active');
    }
  });

  // Grid drag support
  grid.addEventListener('mousedown', handleGridMouseDown);
  document.addEventListener('mousemove', handleGridMouseMove);
  document.addEventListener('mouseup', handleGridMouseUp);
}

async function addNote(note) {
  await initAudioContext();
  const ctx = getAudioContext();

  // Calculate time position
  let time;
  if (state.isPlaying && state.sequencer.loopStartTime > 0) {
    const elapsed = ctx.currentTime - state.sequencer.loopStartTime;
    time = elapsed % LOOP_LENGTH;
  } else {
    // Not playing - add at next available grid position
    const existingTimes = state.sequencer.notes.map(n => n.time);
    time = 0;
    const gridSize = LOOP_LENGTH / GRID_DIVISIONS;
    while (existingTimes.some(t => Math.abs(t - time) < gridSize * 0.5)) {
      time += gridSize;
      if (time >= LOOP_LENGTH) {
        time = 0;
        break;
      }
    }
  }

  // Snap to grid if enabled
  if (state.sequencer.snap) {
    const gridSize = LOOP_LENGTH / GRID_DIVISIONS;
    time = Math.round(time / gridSize) * gridSize;
    if (time >= LOOP_LENGTH) time = 0;
  }

  // Add note
  state.sequencer.notes.push({
    id: state.sequencer.nextNoteId++,
    note,
    time
  });

  updateSequencerUI();

  // Play preview sound
  playNotePreview(note);
}

function removeNote(id) {
  state.sequencer.notes = state.sequencer.notes.filter(n => n.id !== id);
  updateSequencerUI();
}

function clearSequencer() {
  state.sequencer.notes = [];
  updateSequencerUI();
}

function updateSequencerUI() {
  const gridNotes = document.getElementById('grid-notes');
  const layerEl = document.querySelector('.sequencer-layer');
  const statusEl = document.getElementById('seq-status');
  const clearBtn = layerEl?.querySelector('.layer-clear');

  // Clear existing blocks
  gridNotes.innerHTML = '';

  // Assign vertical positions to avoid overlap
  const noteRows = assignNoteRows(state.sequencer.notes);

  // Create note blocks
  state.sequencer.notes.forEach((noteData, index) => {
    const block = document.createElement('div');
    block.className = 'note-block';
    block.dataset.noteId = noteData.id;
    block.textContent = NOTE_NAMES[noteData.note];

    // Position: notes fill their column (between grid lines)
    const leftPercent = (noteData.time / LOOP_LENGTH) * 100;
    const row = noteRows.get(noteData.id) || 0;
    const topOffset = 7 + row * 38;

    block.style.left = `calc(${leftPercent}% + 2px)`;
    block.style.top = `${topOffset}px`;

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-note';
    deleteBtn.innerHTML = '×';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeNote(noteData.id);
    });
    block.appendChild(deleteBtn);

    gridNotes.appendChild(block);
  });

  // Update layer status
  if (state.sequencer.notes.length > 0) {
    const count = state.sequencer.notes.length;
    layerEl?.classList.toggle('has-content', !state.sequencer.muted);
    statusEl.textContent = state.sequencer.muted
      ? `${count} note${count > 1 ? 's' : ''} (off)`
      : `${count} note${count > 1 ? 's' : ''}`;
    if (clearBtn) clearBtn.hidden = false;
  } else {
    layerEl?.classList.remove('has-content');
    statusEl.textContent = 'Play notes below to record';
    if (clearBtn) clearBtn.hidden = true;
  }

  scheduleUrlUpdate();
}

function assignNoteRows(notes) {
  const rowMap = new Map();
  const gridSize = LOOP_LENGTH / GRID_DIVISIONS;
  const sortedNotes = [...notes].sort((a, b) => a.time - b.time);

  sortedNotes.forEach(note => {
    // Find first row that doesn't conflict
    let row = 0;
    while (true) {
      const conflict = sortedNotes.some(other => {
        if (other.id === note.id) return false;
        if (rowMap.get(other.id) !== row) return false;
        return Math.abs(other.time - note.time) < gridSize * 2;
      });
      if (!conflict) break;
      row++;
      if (row > 2) { row = 0; break; } // Max 3 rows
    }
    rowMap.set(note.id, row);
  });

  return rowMap;
}

// ============ Drag and Drop ============

function handleGridMouseDown(e) {
  const block = e.target.closest('.note-block');
  if (!block || e.target.classList.contains('delete-note')) return;

  const noteId = parseInt(block.dataset.noteId, 10);
  const grid = document.getElementById('sequencer-grid');
  const rect = grid.getBoundingClientRect();

  state.dragState = {
    noteId,
    startX: e.clientX,
    gridLeft: rect.left,
    gridWidth: rect.width,
    block
  };

  block.classList.add('dragging');
  e.preventDefault();
}

function handleGridMouseMove(e) {
  if (!state.dragState) return;

  const { noteId, gridLeft, gridWidth, block } = state.dragState;

  // Calculate new time based on mouse position
  let relativeX = e.clientX - gridLeft;
  relativeX = Math.max(0, Math.min(relativeX, gridWidth));

  let newTime = (relativeX / gridWidth) * LOOP_LENGTH;

  // Snap to grid if enabled
  if (state.sequencer.snap) {
    const gridSize = LOOP_LENGTH / GRID_DIVISIONS;
    newTime = Math.round(newTime / gridSize) * gridSize;
  }

  newTime = Math.max(0, Math.min(newTime, LOOP_LENGTH - 0.01));

  // Update visual position
  const leftPercent = (newTime / LOOP_LENGTH) * 100;
  block.style.left = `calc(${leftPercent}% + 2px)`;

  // Store pending time
  state.dragState.pendingTime = newTime;
}

function handleGridMouseUp(e) {
  if (!state.dragState) return;

  const { noteId, pendingTime, block } = state.dragState;

  if (pendingTime !== undefined) {
    // Update note time
    const note = state.sequencer.notes.find(n => n.id === noteId);
    if (note) {
      note.time = pendingTime;
    }
  }

  block.classList.remove('dragging');
  state.dragState = null;

  // Re-render to fix row assignments
  updateSequencerUI();
}

// ============ Playhead Animation ============

function startPlayheadAnimation() {
  const playhead = document.getElementById('grid-playhead');

  function animate() {
    if (state.isPlaying && state.sequencer.notes.length > 0) {
      const ctx = getAudioContext();
      if (ctx) {
        const elapsed = ctx.currentTime - state.sequencer.loopStartTime;
        const position = elapsed % LOOP_LENGTH;
        const percent = (position / LOOP_LENGTH) * 100;
        playhead.style.left = `${percent}%`;
      }
    } else {
      playhead.style.left = '0%';
    }
    playheadAnimationFrame = requestAnimationFrame(animate);
  }

  animate();
}

// ============ Note Playback ============

function playNotePreview(note) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const freq = NOTE_FREQUENCIES[note];
  const now = ctx.currentTime;

  // Create soft pad preview sound
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;

  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = freq;

  // Soft envelope: gentle attack and release
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.08);  // Soft attack
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);  // Gentle fade

  osc.connect(gain);
  osc2.connect(gain);

  // Connect to effects if playing, otherwise to destination
  if (sequencerOutput) {
    gain.connect(sequencerOutput);
  } else {
    gain.connect(ctx.destination);
  }

  osc.start(now);
  osc2.start(now);
  osc.stop(now + 0.6);
  osc2.stop(now + 0.6);
}

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
  filter.connect(gain);
  gain.connect(sequencerOutput);

  osc1.start(time);
  osc2.start(time);
  osc3.start(time);
  subOsc.start(time);
  osc1.stop(time + duration + 0.1);
  osc2.stop(time + duration + 0.1);
  osc3.stop(time + duration + 0.1);
  subOsc.stop(time + duration + 0.1);

  // Visual feedback (gentle pulse during attack)
  setTimeout(() => {
    const block = document.querySelector(`.note-block[data-note-id="${noteId}"]`);
    if (block) {
      block.classList.add('playing');
      setTimeout(() => block.classList.remove('playing'), 400);
    }
  }, (time - ctx.currentTime) * 1000);
}

// ============ Audio Generation ============

async function generateChordBuffer(chordName, layerIndex = 0) {
  const layer = state.layers[layerIndex];
  const duration = layer?.length || 6;
  const fadeTime = layer?.fade || 1;
  return generateNotesBuffer(CHORDS[chordName], duration, fadeTime);
}

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

/**
 * Apply crossfade to buffer for seamless looping
 * Mixes the end of the buffer with the beginning
 */
function applyCrossfade(buffer, fadeTime) {
  const sampleRate = buffer.sampleRate;
  const fadeSamples = Math.min(Math.floor(fadeTime * sampleRate), Math.floor(buffer.length / 2));

  if (fadeSamples <= 0) return buffer;

  const ctx = getAudioContext();
  const newBuffer = ctx.createBuffer(buffer.numberOfChannels, buffer.length, sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const inputData = buffer.getChannelData(channel);
    const outputData = newBuffer.getChannelData(channel);

    // Copy the buffer
    outputData.set(inputData);

    // Apply crossfade at the loop point
    for (let i = 0; i < fadeSamples; i++) {
      const fadeIn = i / fadeSamples;  // 0 -> 1
      const fadeOut = 1 - fadeIn;       // 1 -> 0

      // At the beginning: mix in faded end
      const endSample = inputData[buffer.length - fadeSamples + i];
      outputData[i] = inputData[i] * fadeIn + endSample * fadeOut;

      // At the end: mix in faded beginning
      const startSample = inputData[i];
      outputData[buffer.length - fadeSamples + i] = inputData[buffer.length - fadeSamples + i] * fadeOut + startSample * fadeIn;
    }
  }

  return newBuffer;
}

/**
 * Restart a layer's audio source (used when buffer changes during playback)
 */
function restartLayerSource(index) {
  if (!state.isPlaying || index >= 2) return;

  const ctx = getAudioContext();
  const layer = state.layers[index];
  const playbackRate = Math.pow(2, layer.pitch / 12);

  // Stop current source
  if (layerSources[index]) {
    try {
      layerSources[index].stop();
    } catch (e) {
      // Already stopped
    }
  }

  // Start new source
  if (layer.buffer && layerFilters[index]) {
    layerFilters[index].frequency.cancelScheduledValues(0);
    layerFilters[index].frequency.setValueAtTime(toneToFreq(layer.filter), ctx.currentTime);
    const source = ctx.createBufferSource();
    source.buffer = layer.buffer;
    source.loop = true;
    source.playbackRate.value = playbackRate;
    source.connect(layerFilters[index]);
    source.start();
    layerSources[index] = source;
  }
}

// ============ Start/Stop ============

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

  applyControls();

  // Apply bypasses for shared effects
  Object.keys(state.bypass).forEach(stage => {
    if (state.bypass[stage]) {
      applyBypass(stage, true);
    }
  });

  // Start sequencer scheduling
  startSequencerScheduler();

  visualizer.start();
  state.isPlaying = true;
}

function startSequencerScheduler() {
  // Schedule notes every 25ms
  const scheduler = setInterval(() => {
    if (!state.isPlaying) {
      clearInterval(scheduler);
      return;
    }
    scheduleSequencerNotes();
  }, 25);
}

function stopDrone() {
  state.isPlaying = false;

  modulation?.stop();
  visualizer?.stop();

  // Stop layer sources
  layerSources.forEach(source => {
    try {
      source?.stop();
    } catch (e) {
      // Already stopped
    }
  });

  setTimeout(() => {
    effects?.disconnect();
    sequencerOutput?.disconnect();
    layerGains.forEach(g => g?.disconnect());
    layerFilters.forEach(f => f?.disconnect());
    layerGains = [null, null, null];
    layerFilters = [null, null, null];
    layerSources = [null, null];
    effects = null;
    modulation = null;
    sequencerOutput = null;
  }, 300);
}

function applyControls() {
  Object.entries(state.controls).forEach(([name, value]) => {
    updateParameter(name, value);
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', init);
