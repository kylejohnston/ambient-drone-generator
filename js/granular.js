/**
 * Granular Synthesis Engine
 * Creates evolving drone textures by scheduling overlapping audio grains
 */

import { getAudioContext, getCurrentTime, createGain } from './audio-engine.js';

export class GranularProcessor {
  constructor(output) {
    this.output = output;
    this.buffer = null;
    this.isPlaying = false;
    this.schedulerInterval = null;
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

  /**
   * Set the base playback rate for pitch shifting
   */
  setPlaybackRate(rate) {
    this.playbackRate = rate;
  }

  /**
   * Set the audio buffer to granulate
   */
  setBuffer(buffer) {
    this.buffer = buffer;
  }

  /**
   * Update granular parameters
   */
  setParams(params) {
    Object.assign(this.params, params);
  }

  /**
   * Set texture (maps 0-100 to grain size and density)
   */
  setTexture(value) {
    // Low value = smooth (large grains, low density)
    // High value = granular (small grains, high density)
    // Made more subtle: larger minimum grain size, lower max density
    const normalized = value / 100;

    // Grain size: 300ms at 0, 80ms at 100 (larger grains = smoother)
    this.params.grainSize = 0.3 - (normalized * 0.22);

    // Density: 6 at 0, 15 at 100 (lower density = less choppy)
    this.params.grainDensity = 6 + (normalized * 9);

    // Increase overlap for smoother crossfades
    this.params.overlap = 0.6 + (normalized * 0.2);
  }

  /**
   * Set pitch drift amount (0-100)
   */
  setDrift(value) {
    // 0 = stable, 100 = up to 0.15 semitones of scatter (reduced from 0.5)
    // More subtle pitch variation to avoid obvious detuning
    this.params.pitchScatter = (value / 100) * 0.15;
  }

  /**
   * Start the granular processor
   */
  start() {
    if (!this.buffer || this.isPlaying) return;

    const ctx = getAudioContext();
    this.grainOutput = createGain(1);
    this.grainOutput.connect(this.output);

    this.isPlaying = true;
    this.nextGrainTime = ctx.currentTime;

    // Schedule grains ahead of time
    this.scheduleGrains();
    this.schedulerInterval = setInterval(() => this.scheduleGrains(), 25);
  }

  /**
   * Stop the granular processor
   */
  stop() {
    this.isPlaying = false;

    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }

    // Fade out active grains
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    this.activeGrains.forEach(grain => {
      try {
        grain.gain.gain.cancelScheduledValues(now);
        grain.gain.gain.setValueAtTime(grain.gain.gain.value, now);
        grain.gain.gain.linearRampToValueAtTime(0, now + 0.1);
        grain.source.stop(now + 0.15);
      } catch (e) {
        // Grain may have already stopped
      }
    });

    this.activeGrains = [];

    // Disconnect output after fade
    setTimeout(() => {
      if (this.grainOutput) {
        this.grainOutput.disconnect();
        this.grainOutput = null;
      }
    }, 200);
  }

  /**
   * Schedule grains ahead of time
   */
  scheduleGrains() {
    if (!this.isPlaying || !this.buffer) return;

    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const scheduleAhead = 0.1; // Schedule 100ms ahead

    // Clean up finished grains
    this.activeGrains = this.activeGrains.filter(g => g.endTime > now);

    // Limit active grains to prevent CPU overload
    if (this.activeGrains.length > 50) return;

    // Schedule new grains
    while (this.nextGrainTime < now + scheduleAhead) {
      this.scheduleGrain(this.nextGrainTime);
      this.nextGrainTime += 1 / this.params.grainDensity;
    }
  }

  /**
   * Schedule a single grain
   */
  scheduleGrain(time) {
    const ctx = getAudioContext();
    const { grainSize, pitchScatter, positionRandom } = this.params;

    // Create buffer source for grain
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;

    // Apply base playback rate (for pitch shifting) plus random scatter
    let rate = this.playbackRate;
    if (pitchScatter > 0) {
      const pitchOffset = (Math.random() * 2 - 1) * pitchScatter;
      rate *= Math.pow(2, pitchOffset / 12);
    }
    source.playbackRate.value = rate;

    // Create grain envelope (Hann window for smooth crossfade)
    const grainGain = ctx.createGain();

    // Attack and release times (longer for smoother crossfades)
    const attackTime = grainSize * 0.4;
    const releaseTime = grainSize * 0.4;

    // Envelope shape
    grainGain.gain.setValueAtTime(0, time);
    grainGain.gain.linearRampToValueAtTime(1, time + attackTime);
    grainGain.gain.setValueAtTime(1, time + grainSize - releaseTime);
    grainGain.gain.linearRampToValueAtTime(0, time + grainSize);

    // Connect grain: source -> grainGain -> grainOutput
    source.connect(grainGain);
    grainGain.connect(this.grainOutput);

    // Random position in buffer
    const maxOffset = Math.max(0, this.buffer.duration - grainSize);
    const basePosition = Math.random() * maxOffset;
    const position = basePosition + (Math.random() * positionRandom * maxOffset) % maxOffset;

    // Start grain
    source.start(time, Math.max(0, position), grainSize + 0.01);

    // Track active grain
    this.activeGrains.push({
      source,
      gain: grainGain,
      endTime: time + grainSize
    });

    // Clean up after grain ends
    source.onended = () => {
      try {
        grainGain.disconnect();
      } catch (e) {
        // Already disconnected
      }
    };
  }
}
