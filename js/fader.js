/**
 * VerticalFader — Custom vertical fader component
 *
 * Wraps an existing <input type="range"> (visually hidden via CSS).
 * Reads min/max/step/value from the input's attributes.
 * On interaction, sets input.value and dispatches native 'input' events
 * so existing main.js listeners work unchanged.
 */

// Must match .fader__readout height in CSS
const READOUT_H = 32;

export class VerticalFader {
  constructor(input) {
    this.input = input;
    this.min = parseFloat(input.min) || 0;
    this.max = parseFloat(input.max) || 100;
    this.step = parseFloat(input.step) || 1;
    this.label = input.dataset.faderLabel || '';
    this.format = input.dataset.faderFormat || 'number';

    this.build();
    this.bind();
    this.sync();
    this.hookInputValue();
  }

  /** Generate fader DOM and insert after the hidden input */
  build() {
    const fader = document.createElement('div');
    fader.className = 'fader';
    fader.setAttribute('role', 'slider');
    fader.setAttribute('tabindex', '0');
    fader.setAttribute('aria-valuemin', this.min);
    fader.setAttribute('aria-valuemax', this.max);
    fader.setAttribute('aria-valuenow', this.input.value);
    if (this.label) fader.setAttribute('aria-label', this.label);

    fader.innerHTML = `
      <div class="fader__track">
        <div class="fader__fill"></div>
        <div class="fader__readout">${this.formatValue(this.input.value)}</div>
      </div>
      <div class="fader__label">${this.label}</div>
    `;

    this.el = fader;
    this.track = fader.querySelector('.fader__track');
    this.fill = fader.querySelector('.fader__fill');
    this.readout = fader.querySelector('.fader__readout');

    // Insert after input (input is hidden via CSS)
    this.input.insertAdjacentElement('afterend', fader);
  }

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
    let value = parseFloat(this.input.value);

    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        e.preventDefault();
        value = Math.min(this.max, value + this.step);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        e.preventDefault();
        value = Math.max(this.min, value - this.step);
        break;
      case 'Home':
        e.preventDefault();
        value = this.min;
        break;
      case 'End':
        e.preventDefault();
        value = this.max;
        break;
      default:
        return;
    }

    this.setValue(value);
  }

  /** Set value on hidden input and dispatch native event */
  setValue(val) {
    // Round to step precision to avoid floating point drift
    const decimals = (this.step.toString().split('.')[1] || '').length;
    const rounded = parseFloat(val.toFixed(decimals));

    this._settingValue = true;
    this.input.value = rounded;
    this._settingValue = false;

    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.sync();
  }

  /** Sync visual state from input value */
  sync() {
    const value = parseFloat(this.input.value);
    const percent = ((value - this.min) / (this.max - this.min)) * 100;
    const ratio = (percent / 100).toFixed(4);

    // Fill height occupies the usable area above the readout band
    this.fill.style.height = `calc(${ratio} * (100% - ${READOUT_H}px))`;
    this.readout.textContent = this.formatValue(value);
    this.el.setAttribute('aria-valuenow', value);
  }

  /** Format display value based on data-fader-format */
  formatValue(val) {
    const v = parseFloat(val);
    switch (this.format) {
      case 'pitch':
        return v > 0 ? `+${v}` : `${v}`;
      case 'time':
        return `${v}s`;
      case 'fade':
        return `${v.toFixed(1)}s`;
      default:
        return `${Math.round(v)}`;
    }
  }

  /**
   * Override input.value setter to detect programmatic changes from main.js
   * (e.g. when Easy mode's mood slider sets control values).
   */
  hookInputValue() {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const fader = this;

    Object.defineProperty(this.input, 'value', {
      get() {
        return descriptor.get.call(this);
      },
      set(v) {
        descriptor.set.call(this, v);
        if (!fader._settingValue) {
          fader.sync();
        }
      }
    });
  }
}
