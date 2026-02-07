/**
 * Modulation System - LFOs for parameter evolution
 * Creates organic, non-repeating movement using unsynchronized LFOs
 */

import { getAudioContext } from './audio-engine.js';

export class ModulationSystem {
  constructor() {
    this.lfos = [];
    this.targets = new Map();
    this.isRunning = false;
    this.depth = 0.5; // 0-1 modulation depth
  }

  /**
   * Initialize LFOs with different rates and shapes
   */
  init() {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Create multiple LFOs at non-synced rates (key to organic movement)
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

  /**
   * Set modulation depth (0-100)
   */
  setMovement(value) {
    // Apply curve to make modulation more subtle overall
    // Low values have minimal effect, high values are still controlled
    const normalized = value / 100;
    this.depth = normalized * normalized * 0.6; // Quadratic curve, max 60% depth
    this.updateDepths();
  }

  /**
   * Update LFO depths based on current depth setting
   */
  updateDepths() {
    if (!this.isRunning) return;

    const ctx = getAudioContext();
    const now = ctx.currentTime;

    this.targets.forEach((config, param) => {
      const range = config.max - config.min;
      const modulationAmount = range * this.depth * config.intensity;

      // Update the gain that's connected to this parameter
      if (config.gainNode) {
        config.gainNode.gain.setTargetAtTime(modulationAmount, now, 0.1);
      }
    });
  }

  /**
   * Connect an LFO to modulate an AudioParam
   * @param {AudioParam} param - The parameter to modulate
   * @param {Object} config - { min, max, intensity, lfoIndex }
   */
  connect(param, config) {
    const ctx = getAudioContext();
    if (!ctx || this.lfos.length === 0) return;

    const lfoIndex = config.lfoIndex || 0;
    const lfo = this.lfos[lfoIndex % this.lfos.length];

    // Create a gain node to scale the LFO output for this specific target
    const scalingGain = ctx.createGain();
    const range = config.max - config.min;
    scalingGain.gain.value = range * this.depth * (config.intensity || 1);

    // Connect LFO -> scaling gain -> parameter
    lfo.gain.connect(scalingGain);
    scalingGain.connect(param);

    // Set the base value to the center of the range
    const centerValue = config.min + range / 2;
    param.setValueAtTime(centerValue, ctx.currentTime);

    // Store for later updates
    this.targets.set(param, {
      ...config,
      gainNode: scalingGain,
      lfo
    });
  }

  /**
   * Disconnect a parameter from modulation
   */
  disconnect(param) {
    const config = this.targets.get(param);
    if (config && config.gainNode) {
      config.gainNode.disconnect();
    }
    this.targets.delete(param);
  }

  /**
   * Start all LFOs
   */
  start() {
    if (this.isRunning) return;

    this.init();

    this.lfos.forEach(lfo => {
      lfo.oscillator.start();
      lfo.gain.gain.value = 1;
    });

    this.isRunning = true;
  }

  /**
   * Stop all LFOs
   */
  stop() {
    if (!this.isRunning) return;

    this.lfos.forEach(lfo => {
      try {
        lfo.oscillator.stop();
        lfo.oscillator.disconnect();
        lfo.gain.disconnect();
      } catch (e) {
        // May already be stopped
      }
    });

    this.targets.forEach((config, param) => {
      if (config.gainNode) {
        config.gainNode.disconnect();
      }
    });

    this.lfos = [];
    this.targets.clear();
    this.isRunning = false;
  }
}
