/**
 * Effects Chain - Reverb, Delay, Filter, Saturation
 * Creates the spacious, lo-fi character of the drone
 */

import { getAudioContext, createGain } from './audio-engine.js';

export class EffectsChain {
  constructor(output) {
    this.output = output;
    this.nodes = {};
    this.isInitialized = false;
    this.bypass = {
      filter: false,
      grit: false,
      delay: false,
      reverb: false
    };
    this.savedValues = {
      warmth: 40,
      grit: 20,
      depth: 40,
      space: 8
    };
    this.currentReverbTime = 8;
  }

  /**
   * Initialize the effects chain
   * Signal flow: input -> filter -> saturation -> delay -> reverb -> output
   */
  init() {
    if (this.isInitialized) return this.nodes.input;

    const ctx = getAudioContext();

    // Input gain
    this.nodes.input = createGain(1);

    // Filter (warmth control)
    this.nodes.filter = ctx.createBiquadFilter();
    this.nodes.filter.type = 'lowpass';
    this.nodes.filter.frequency.value = 4000;
    this.nodes.filter.Q.value = 0.7;

    // Saturation (grit)
    this.nodes.saturation = this.createSaturation();

    // Delay
    this.nodes.delay = this.createDelay();

    // Reverb
    this.nodes.reverb = this.createReverb();

    // Connect chain
    this.nodes.input.connect(this.nodes.filter);
    this.nodes.filter.connect(this.nodes.saturation.input);
    this.nodes.saturation.output.connect(this.nodes.delay.input);
    this.nodes.delay.output.connect(this.nodes.reverb.input);
    this.nodes.reverb.output.connect(this.output);

    this.isInitialized = true;
    return this.nodes.input;
  }

  /**
   * Create saturation/distortion effect
   */
  createSaturation() {
    const ctx = getAudioContext();

    const input = createGain(1);
    const output = createGain(1);
    const dryGain = createGain(1);
    const wetGain = createGain(0);

    // Waveshaper for saturation
    const waveshaper = ctx.createWaveShaper();
    waveshaper.curve = this.makeSaturationCurve(0.3);
    waveshaper.oversample = '2x';

    // Parallel dry/wet
    input.connect(dryGain);
    input.connect(waveshaper);
    waveshaper.connect(wetGain);
    dryGain.connect(output);
    wetGain.connect(output);

    return {
      input,
      output,
      dryGain,
      wetGain,
      waveshaper,
      setMix: (value) => {
        const normalized = value / 100;
        dryGain.gain.value = 1 - normalized * 0.5;
        wetGain.gain.value = normalized;
      },
      setDrive: (amount) => {
        waveshaper.curve = this.makeSaturationCurve(amount);
      }
    };
  }

  /**
   * Generate saturation curve
   */
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

  /**
   * Create delay effect with feedback
   */
  createDelay() {
    const ctx = getAudioContext();

    const input = createGain(1);
    const output = createGain(1);
    const dryGain = createGain(1);
    const wetGain = createGain(0.3);
    const feedbackGain = createGain(0.4);

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

    return {
      input,
      output,
      dryGain,
      wetGain,
      feedbackGain,
      setMix: (value) => {
        const normalized = value / 100;
        dryGain.gain.value = 1;
        wetGain.gain.value = normalized * 0.6;
        feedbackGain.gain.value = 0.3 + normalized * 0.4;
      }
    };
  }

  /**
   * Create reverb using convolution
   */
  createReverb() {
    const ctx = getAudioContext();

    const input = createGain(1);
    const output = createGain(1);
    const dryGain = createGain(0.4);
    const wetGain = createGain(0.6);

    // Convolver for reverb
    const convolver = ctx.createConvolver();
    convolver.buffer = this.generateImpulseResponse(this.currentReverbTime);

    // Routing
    input.connect(dryGain);
    input.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(output);
    wetGain.connect(output);

    return {
      input,
      output,
      dryGain,
      wetGain,
      convolver
    };
  }

  /**
   * Generate impulse response for convolution reverb
   * @param {number} reverbTime - Reverb time in seconds (0-60)
   */
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

  /**
   * Set filter frequency (warmth: 0-100)
   * 0 = dark (200Hz), 100 = bright (8000Hz)
   */
  setWarmth(value) {
    this.savedValues.warmth = value;
    if (!this.nodes.filter || this.bypass.filter) return;

    // Exponential scaling for natural feel
    const normalized = value / 100;
    const minFreq = 200;
    const maxFreq = 8000;
    const freq = minFreq * Math.pow(maxFreq / minFreq, normalized);

    const ctx = getAudioContext();
    this.nodes.filter.frequency.setTargetAtTime(freq, ctx.currentTime, 0.1);
  }

  /**
   * Set reverb time in seconds (0-60)
   */
  setSpace(value) {
    this.savedValues.space = value;
    if (!this.nodes.reverb || this.bypass.reverb) return;

    const reverbTime = value; // Now directly in seconds

    // Only regenerate if time changed significantly (avoid constant regeneration)
    if (Math.abs(reverbTime - this.currentReverbTime) >= 1) {
      this.currentReverbTime = reverbTime;
      this.nodes.reverb.convolver.buffer = this.generateImpulseResponse(reverbTime);
    }

    // Adjust wet/dry mix based on reverb time
    // 0s = fully dry, 60s = mostly wet
    const wetAmount = reverbTime > 0 ? Math.min(0.8, 0.3 + (reverbTime / 60) * 0.5) : 0;
    const dryAmount = 1 - wetAmount * 0.5;

    const ctx = getAudioContext();
    this.nodes.reverb.dryGain.gain.setTargetAtTime(dryAmount, ctx.currentTime, 0.1);
    this.nodes.reverb.wetGain.gain.setTargetAtTime(wetAmount, ctx.currentTime, 0.1);
  }

  /**
   * Set delay amount (depth: 0-100)
   */
  setDepth(value) {
    this.savedValues.depth = value;
    if (!this.nodes.delay || this.bypass.delay) return;
    this.nodes.delay.setMix(value);
  }

  /**
   * Set saturation amount (grit: 0-100)
   */
  setGrit(value) {
    this.savedValues.grit = value;
    if (!this.nodes.saturation || this.bypass.grit) return;
    this.nodes.saturation.setMix(value);
    this.nodes.saturation.setDrive(value / 100);
  }

  /**
   * Get filter node for modulation
   */
  getFilterNode() {
    return this.nodes.filter;
  }

  /**
   * Bypass/enable filter
   */
  setFilterBypass(bypassed) {
    this.bypass.filter = bypassed;
    if (bypassed) {
      // Set to max frequency (effectively bypassed)
      this.nodes.filter?.frequency.setTargetAtTime(20000, getAudioContext().currentTime, 0.05);
    } else {
      // Restore saved value
      this.setWarmth(this.savedValues.warmth);
    }
  }

  /**
   * Bypass/enable saturation (grit)
   */
  setGritBypass(bypassed) {
    this.bypass.grit = bypassed;
    if (bypassed) {
      this.nodes.saturation?.dryGain.gain.setTargetAtTime(1, getAudioContext().currentTime, 0.05);
      this.nodes.saturation?.wetGain.gain.setTargetAtTime(0, getAudioContext().currentTime, 0.05);
    } else {
      this.setGrit(this.savedValues.grit);
    }
  }

  /**
   * Bypass/enable delay
   */
  setDelayBypass(bypassed) {
    this.bypass.delay = bypassed;
    if (bypassed) {
      this.nodes.delay?.wetGain.gain.setTargetAtTime(0, getAudioContext().currentTime, 0.05);
      this.nodes.delay?.feedbackGain.gain.setTargetAtTime(0, getAudioContext().currentTime, 0.05);
    } else {
      this.setDepth(this.savedValues.depth);
    }
  }

  /**
   * Bypass/enable reverb
   */
  setReverbBypass(bypassed) {
    this.bypass.reverb = bypassed;
    if (bypassed) {
      this.nodes.reverb?.dryGain.gain.setTargetAtTime(1, getAudioContext().currentTime, 0.05);
      this.nodes.reverb?.wetGain.gain.setTargetAtTime(0, getAudioContext().currentTime, 0.05);
    } else {
      this.setSpace(this.savedValues.space);
    }
  }

  /**
   * Disconnect all effects
   */
  disconnect() {
    Object.values(this.nodes).forEach(node => {
      try {
        if (node.disconnect) node.disconnect();
        if (node.input && node.input.disconnect) node.input.disconnect();
        if (node.output && node.output.disconnect) node.output.disconnect();
      } catch (e) {
        // Already disconnected
      }
    });
    this.nodes = {};
    this.isInitialized = false;
  }
}
