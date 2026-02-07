/**
 * Ambient Visualizer - Subtle, slowly-evolving visuals that respond to audio
 */

import { getAnalyser } from './audio-engine.js';

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.isRunning = false;
    this.animationId = null;

    // Visual state
    this.hue = 240; // Starting blue
    this.targetHue = 240;
    this.brightness = 0.05;
    this.time = 0;

    // Audio data
    this.dataArray = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Resize canvas to window
   */
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /**
   * Start visualization
   */
  start() {
    if (this.isRunning) return;

    const analyser = getAnalyser();
    if (analyser) {
      this.dataArray = new Uint8Array(analyser.frequencyBinCount);
    }

    this.isRunning = true;
    this.animate();
  }

  /**
   * Stop visualization
   */
  stop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    // Fade to dark
    this.fadeOut();
  }

  /**
   * Fade out animation
   */
  fadeOut() {
    const fade = () => {
      this.brightness *= 0.95;
      if (this.brightness > 0.001) {
        this.drawFrame();
        requestAnimationFrame(fade);
      } else {
        this.brightness = 0;
        this.ctx.fillStyle = '#0a0a0f';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    };
    fade();
  }

  /**
   * Main animation loop
   */
  animate() {
    if (!this.isRunning) return;

    this.updateAudioData();
    this.drawFrame();

    this.time += 0.01;
    this.animationId = requestAnimationFrame(() => this.animate());
  }

  /**
   * Update visual state based on audio
   */
  updateAudioData() {
    const analyser = getAnalyser();
    if (!analyser || !this.dataArray) return;

    analyser.getByteFrequencyData(this.dataArray);

    // Calculate average amplitude
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    const average = sum / this.dataArray.length / 255;

    // Smoothly adjust brightness based on audio level
    const targetBrightness = 0.03 + average * 0.15;
    this.brightness += (targetBrightness - this.brightness) * 0.05;

    // Slowly shift hue based on low frequencies
    let lowSum = 0;
    for (let i = 0; i < 10; i++) {
      lowSum += this.dataArray[i];
    }
    const lowAverage = lowSum / 10 / 255;

    // Shift hue slowly over time, influenced by bass
    this.targetHue += 0.1 + lowAverage * 0.5;
    if (this.targetHue > 360) this.targetHue -= 360;

    this.hue += (this.targetHue - this.hue) * 0.01;
    if (this.hue > 360) this.hue -= 360;
  }

  /**
   * Draw a single frame
   */
  drawFrame() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;

    // Create radial gradient from center
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.max(width, height);

    const gradient = ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, maxRadius
    );

    // Main color with slow evolution
    const hue1 = this.hue;
    const hue2 = (this.hue + 30) % 360;

    // Very subtle, dark colors
    const saturation = 40;
    const lightness1 = this.brightness * 100;
    const lightness2 = this.brightness * 50;

    gradient.addColorStop(0, `hsl(${hue1}, ${saturation}%, ${lightness1}%)`);
    gradient.addColorStop(0.5, `hsl(${hue2}, ${saturation}%, ${lightness2}%)`);
    gradient.addColorStop(1, '#0a0a0f');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Add subtle noise texture
    this.drawNoise();

    // Add slow-moving shapes
    this.drawOrbs();
  }

  /**
   * Draw subtle noise overlay
   */
  drawNoise() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;

    // Very subtle noise
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 8;
      data[i] += noise;
      data[i + 1] += noise;
      data[i + 2] += noise;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Draw slow-moving ambient orbs
   */
  drawOrbs() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;

    // A few slow-moving orbs
    for (let i = 0; i < 3; i++) {
      const phase = this.time * 0.1 + i * 2.1;
      const x = width * (0.3 + 0.4 * Math.sin(phase * 0.7));
      const y = height * (0.3 + 0.4 * Math.cos(phase * 0.5));
      const size = 100 + 50 * Math.sin(phase);

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
      const hue = (this.hue + i * 40) % 360;
      const alpha = this.brightness * 0.3;

      gradient.addColorStop(0, `hsla(${hue}, 50%, 30%, ${alpha})`);
      gradient.addColorStop(1, `hsla(${hue}, 50%, 10%, 0)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
  }
}
