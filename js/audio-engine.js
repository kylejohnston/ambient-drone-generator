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

/**
 * Resume audio context if suspended
 */
export async function resumeContext() {
  if (audioContext && audioContext.state === 'suspended') {
    await audioContext.resume();
  }
}

/**
 * Get the current audio context
 */
export function getAudioContext() {
  return audioContext;
}

/**
 * Get the master gain node
 */
export function getMasterGain() {
  return masterGain;
}

/**
 * Get the analyser node
 */
export function getAnalyser() {
  return analyser;
}

/**
 * Get current time from audio context
 */
export function getCurrentTime() {
  return audioContext ? audioContext.currentTime : 0;
}

/**
 * Create a gain node
 */
export function createGain(value = 1) {
  const gain = audioContext.createGain();
  gain.gain.value = value;
  return gain;
}

/**
 * Decode audio file to buffer
 */
export async function decodeAudioFile(arrayBuffer) {
  return audioContext.decodeAudioData(arrayBuffer);
}

/**
 * Check if audio is initialized
 */
export function isAudioInitialized() {
  return isInitialized;
}
