export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensureContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playJump() {
    const ctx = this.ensureContext();
    if (!ctx || !this.enabled) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Bouncy cartoon chirp jump sound (rising frequency with smooth envelope)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.12);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.24, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.16);
    } catch {
      /* Audio playback failure should not block game loop */
    }
  }

  playStar() {
    const ctx = this.ensureContext();
    if (!ctx || !this.enabled) return;
    try {
      const now = ctx.currentTime;

      // Iconic 2-tone bright coin pickup chime (B5 987.77Hz -> E6 1318.51Hz), lasting ~0.50s
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      // Pitch sequence: note 1 (B5) for ~0.075s, note 2 (E6) ringing out until ~0.5s
      osc1.frequency.setValueAtTime(987.77, now);
      osc1.frequency.setValueAtTime(1318.51, now + 0.075);

      osc2.frequency.setValueAtTime(987.77 * 2, now);
      osc2.frequency.setValueAtTime(1318.51 * 2, now + 0.075);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(4800, now);

      // Volume envelope lasting ~0.50 seconds total
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.28, now + 0.015);
      gain.gain.setValueAtTime(0.24, now + 0.075);
      gain.gain.linearRampToValueAtTime(0.32, now + 0.09);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.50);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.50);
      osc2.stop(now + 0.50);
    } catch {
      /* Audio playback failure should not block game loop */
    }
  }
}
