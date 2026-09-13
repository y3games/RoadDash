/**
 * Sound, synthesised at runtime.
 *
 * No audio files ship, for the same reason no image files do: three short
 * sounds are cheaper to describe than to store, and a game that loads nothing
 * cannot fail to load. Everything here is oscillators and a noise buffer.
 *
 * The game holds this behind the interface rather than calling Web Audio
 * directly, so a scene never has to know whether sound exists — and a browser
 * that refuses to make an AudioContext (or a test running in node) just gets an
 * object whose methods do nothing.
 */
export interface Sfx {
  /**
   * Start the audio hardware. Browsers refuse until a user gesture, so this is
   * called from the first tap or keypress and is a no-op after that.
   */
  unlock(): void;
  /** A level-up: two rising notes. */
  levelUp(): void;
  /** The end of a run. */
  crash(): void;
  /** Passing a row, scaled 0..1 by how little room there was. */
  squeeze(closeness: number): void;
  setMuted(muted: boolean): void;
}

/** Every sound in the game, and the only place their shapes are described. */
const VOICES = {
  levelUp: { notes: [660, 990], seconds: 0.09, gain: 0.14 },
  crash: { sweepFrom: 210, sweepTo: 55, seconds: 0.42, gain: 0.3 },
  squeeze: { from: 1500, to: 420, seconds: 0.1, minGain: 0.04, maxGain: 0.15 },
} as const;

export class WebAudioSfx implements Sfx {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private isMuted: boolean;
  /** Set once the browser has refused, so we stop asking every frame. */
  private unavailable = false;

  constructor(muted: boolean) {
    this.isMuted = muted;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.master !== null) this.master.gain.value = muted ? 0 : 1;
  }

  unlock(): void {
    const context = this.ensure();
    // Created before a gesture, a context starts suspended and every sound is
    // silently dropped; resuming is what a gesture is for.
    if (context !== null && context.state === 'suspended') void context.resume();
  }

  levelUp(): void {
    const context = this.ready();
    if (context === null) return;

    const { notes, seconds, gain } = VOICES.levelUp;
    notes.forEach((frequency, index) => {
      const at = context.currentTime + index * seconds;
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, at);
      oscillator.connect(this.envelope(at, seconds, gain));
      oscillator.start(at);
      oscillator.stop(at + seconds);
    });
  }

  crash(): void {
    const context = this.ready();
    if (context === null) return;

    const { sweepFrom, sweepTo, seconds, gain } = VOICES.crash;
    const at = context.currentTime;

    const thud = context.createOscillator();
    thud.type = 'sawtooth';
    thud.frequency.setValueAtTime(sweepFrom, at);
    thud.frequency.exponentialRampToValueAtTime(sweepTo, at + seconds);
    thud.connect(this.envelope(at, seconds, gain));
    thud.start(at);
    thud.stop(at + seconds);

    // The scrape: noise on top of the thud, or the crash reads as a door slam.
    const source = this.noiseSource(context);
    if (source !== null) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1800, at);
      filter.frequency.exponentialRampToValueAtTime(300, at + seconds * 0.7);
      source.connect(filter).connect(this.envelope(at, seconds * 0.7, gain * 0.7));
      source.start(at);
      source.stop(at + seconds * 0.7);
    }
  }

  squeeze(closeness: number): void {
    const context = this.ready();
    if (context === null) return;

    const { from, to, seconds, minGain, maxGain } = VOICES.squeeze;
    const amount = Math.min(Math.max(closeness, 0), 1);
    const at = context.currentTime;

    const source = this.noiseSource(context);
    if (source === null) return;

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + seconds);

    source
      .connect(filter)
      .connect(this.envelope(at, seconds, minGain + (maxGain - minGain) * amount));
    source.start(at);
    source.stop(at + seconds);
  }

  /** A gain node that fades a voice out, so nothing ends in a click. */
  private envelope(at: number, seconds: number, peak: number): GainNode {
    const context = this.context!;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + seconds * 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    gain.connect(this.master!);
    return gain;
  }

  private noiseSource(context: AudioContext): AudioBufferSourceNode | null {
    if (this.noise === null) {
      const frames = Math.floor(context.sampleRate * 0.5);
      const buffer = context.createBuffer(1, frames, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < frames; i += 1) samples[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    const source = context.createBufferSource();
    source.buffer = this.noise;
    return source;
  }

  /** The context, if there is one and the player wants to hear it. */
  private ready(): AudioContext | null {
    if (this.isMuted) return null;
    const context = this.ensure();
    return context !== null && context.state === 'running' ? context : null;
  }

  private ensure(): AudioContext | null {
    if (this.context !== null || this.unavailable) return this.context;
    try {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = this.isMuted ? 0 : 1;
      master.connect(context.destination);
      this.context = context;
      this.master = master;
    } catch {
      // No Web Audio here — a very old browser, or a test in node. Play nothing.
      this.unavailable = true;
    }
    return this.context;
  }
}
