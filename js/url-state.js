/**
 * URL state encoding/decoding for preset sharing
 *
 * Encodes app state as compact JSON → base64 in a single ?p= URL param.
 * Uploaded audio files cannot be encoded (binary, arbitrary size) — those
 * layers are serialized as null and will load empty on restore.
 */

// Fixed order ensures a stable encoding across versions
const CONTROL_ORDER = ['movement', 'grit', 'depth', 'space'];
const BYPASS_ORDER  = ['modulation', 'grit', 'delay', 'reverb'];

/**
 * Encode current app state to a base64 string.
 * @param {object} state - The application state object from main.js
 * @returns {string} base64-encoded preset
 */
export function encodeState(state) {
  const preset = {
    v: 1,
    c: CONTROL_ORDER.map(k => state.controls[k]),
    b: BYPASS_ORDER.map(k => state.bypass[k] ? 1 : 0),
    l: state.layers.map((layer, i) => {
      if (i === 2) {
        // Sequencer layer — vol, tone, pitch only (no chord)
        return { v: layer.volume, f: layer.filter, p: layer.pitch };
      }
      if (layer.type !== 'chord') return null; // Empty or uploaded — omit
      return {
        ch: layer.chord,
        v: layer.volume,
        f: layer.filter,
        p: layer.pitch,
        l: layer.length,
        x: layer.fade
      };
    }),
    sq: {
      sn: state.sequencer.snap ? 1 : 0,
      n: state.sequencer.notes.map(n => [n.note, n.time])
    }
  };

  return btoa(JSON.stringify(preset));
}

/**
 * Decode a base64 preset string back to a plain object.
 * Returns null if the string is malformed.
 * @param {string} encoded
 * @returns {object|null}
 */
export function decodeState(encoded) {
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}

/**
 * Read the ?p= parameter from the current URL.
 * @returns {string|null}
 */
export function getUrlParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get('p') || null;
}
