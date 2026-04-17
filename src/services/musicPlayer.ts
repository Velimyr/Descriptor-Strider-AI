export type Track = 'rock' | 'jazz' | 'lofi' | 'ocean';

export const TRACKS: { id: Track; label: string }[] = [
  { id: 'rock', label: 'Рок' },
  { id: 'jazz', label: 'Джаз' },
  { id: 'lofi', label: 'Lo-fi' },
  { id: 'ocean', label: 'Океан' },
];

export const isValidTrack = (t: unknown): t is Track =>
  typeof t === 'string' && TRACKS.some(x => x.id === t);

class MusicPlayer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private currentTrack: Track | null = null;
  private nodes: AudioNode[] = [];
  private timers: number[] = [];
  private volume = 0.15;

  // Sequencer state
  private bpm = 120;
  private nextBeat = 0;
  private beatIndex = 0;
  private scheduleHandler: ((beat: number, time: number) => void) | null = null;

  private ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }

  play(track: Track) {
    if (this.currentTrack === track) return;
    this.stop();
    this.ensure();
    this.currentTrack = track;
    switch (track) {
      case 'rock':  this.playRock();  break;
      case 'jazz':  this.playJazz();  break;
      case 'lofi':  this.playLofi();  break;
      case 'ocean': this.playOcean(); break;
    }
  }

  stop() {
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
    this.scheduleHandler = null;
    this.nodes.forEach(n => {
      try { (n as any).stop?.(); } catch {}
      try { n.disconnect(); } catch {}
    });
    this.nodes = [];
    this.currentTrack = null;
  }

  isPlaying() {
    return this.currentTrack !== null;
  }

  // ---- Helpers ---------------------------------------------------------

  private noiseBuffer(seconds: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const size = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buf = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * Look-ahead scheduler. Iterates 16th-note grid and calls handler with
   * the audio-clock time at which sounds should be scheduled. Skips ahead
   * if the tab was throttled and we fell behind, to avoid replay bursts.
   */
  private startSequencer(bpm: number, handler: (beat: number, time: number) => void) {
    if (!this.ctx) return;
    this.bpm = bpm;
    this.scheduleHandler = handler;
    this.nextBeat = this.ctx.currentTime + 0.05;
    this.beatIndex = 0;

    const tick = () => {
      if (!this.ctx || !this.scheduleHandler) return;
      const sixteenth = 60 / this.bpm / 4;
      if (this.nextBeat < this.ctx.currentTime - 0.05) {
        const skip = Math.floor((this.ctx.currentTime - this.nextBeat) / sixteenth);
        this.nextBeat += skip * sixteenth;
        this.beatIndex += skip;
      }
      const horizon = this.ctx.currentTime + 0.4;
      while (this.nextBeat < horizon) {
        this.scheduleHandler(this.beatIndex, this.nextBeat);
        this.nextBeat += sixteenth;
        this.beatIndex++;
      }
      const t = window.setTimeout(tick, 80);
      this.timers.push(t);
    };
    tick();
  }

  // ---- Drum / synth voices -------------------------------------------

  private kick(time: number, bus: AudioNode, vel = 1) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * vel, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.connect(g).connect(bus);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private snare(time: number, bus: AudioNode, vel = 1) {
    const ctx = this.ctx!;
    const buf = this.noiseBuffer(0.2);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * vel, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    src.connect(hp).connect(g).connect(bus);
    src.start(time);
    src.stop(time + 0.2);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 200;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.3 * vel, time);
    g2.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(g2).connect(bus);
    osc.start(time);
    osc.stop(time + 0.12);
  }

  private hihat(time: number, bus: AudioNode, vel = 1, open = false) {
    const ctx = this.ctx!;
    const dur = open ? 0.22 : 0.04;
    const buf = this.noiseBuffer(dur + 0.05);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 * vel, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(hp).connect(g).connect(bus);
    src.start(time);
    src.stop(time + dur + 0.05);
  }

  private tone(
    time: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    gainVal: number,
    bus: AudioNode,
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gainVal, time + 0.01);
    g.gain.setValueAtTime(gainVal, Math.max(time + 0.01, time + dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g).connect(bus);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  // ---- Tracks ----------------------------------------------------------

  private playRock() {
    const ctx = this.ctx!;
    const master = this.masterGain!;
    const drumBus = ctx.createGain();
    drumBus.gain.value = 0.7;
    drumBus.connect(master);

    const bassLp = ctx.createBiquadFilter();
    bassLp.type = 'lowpass';
    bassLp.frequency.value = 800;
    const bassBus = ctx.createGain();
    bassBus.gain.value = 0.55;
    bassLp.connect(bassBus).connect(master);

    const guitarBus = ctx.createGain();
    guitarBus.gain.value = 0.28;
    guitarBus.connect(master);

    this.nodes.push(drumBus, bassBus, bassLp, guitarBus);

    // Em - C - G - D, 1 bar each
    const roots  = [82.41, 130.81, 98.00, 73.42];
    const fifths = [123.47, 196.00, 146.83, 110.00];

    this.startSequencer(124, (beat, time) => {
      const s = beat % 16;
      const bar = Math.floor(beat / 16) % 4;

      if (s === 0 || s === 8) this.kick(time, drumBus);
      if (s === 4 || s === 12) this.snare(time, drumBus);
      if (s % 2 === 0) this.hihat(time, drumBus, 0.7);

      if (s % 2 === 0) this.tone(time, roots[bar], 0.12, 'sawtooth', 0.45, bassLp);
      if (s % 4 === 0) {
        this.tone(time, roots[bar] * 2, 0.18, 'sawtooth', 0.18, guitarBus);
        this.tone(time, fifths[bar] * 2, 0.18, 'sawtooth', 0.14, guitarBus);
      }
    });
  }

  private playJazz() {
    const ctx = this.ctx!;
    const master = this.masterGain!;
    const drumBus = ctx.createGain();
    drumBus.gain.value = 0.4;
    drumBus.connect(master);
    const bassBus = ctx.createGain();
    bassBus.gain.value = 0.55;
    bassBus.connect(master);
    const pianoBus = ctx.createGain();
    pianoBus.gain.value = 0.4;
    pianoBus.connect(master);
    this.nodes.push(drumBus, bassBus, pianoBus);

    // ii-V-I-vi in F: Gm7 - C7 - Fmaj7 - Dm7, 1 bar each
    const walks = [
      [98.00, 110.00, 123.47, 130.81],   // Gm: G  A  B  C
      [130.81, 146.83, 130.81, 116.54],  // C7: C  D  C  Bb
      [87.31, 98.00, 110.00, 123.47],    // F:  F  G  A  B
      [73.42, 87.31, 92.50, 98.00],      // Dm: D  F  F# G
    ];
    const voicings = [
      [349.23, 466.16, 587.33], // Gm7 ~ F-Bb-D
      [466.16, 523.25, 659.25], // C7  ~ Bb-C-E
      [349.23, 440.00, 523.25], // Fma7~ F-A-C
      [349.23, 440.00, 523.25], // Dm7 ~ F-A-C
    ];
    // Swing-ish ride pattern (16th positions)
    const swingHits = new Set([0, 3, 4, 7, 8, 11, 12, 15]);

    this.startSequencer(108, (beat, time) => {
      const s = beat % 16;
      const bar = Math.floor(beat / 16) % 4;

      if (s % 4 === 0) {
        const note = walks[bar][s / 4];
        this.tone(time, note, 0.45, 'sine', 0.55, bassBus);
      }
      if (swingHits.has(s)) this.hihat(time, drumBus, 0.35);
      if (s === 4 || s === 12) this.snare(time, drumBus, 0.22);

      // Comp on 2 and 4 (Charleston-esque)
      if (s === 4 || s === 12) {
        voicings[bar].forEach(f => this.tone(time, f, 0.3, 'triangle', 0.18, pianoBus));
      }
    });
  }

  private playLofi() {
    const ctx = this.ctx!;
    const master = this.masterGain!;

    const drumLp = ctx.createBiquadFilter();
    drumLp.type = 'lowpass';
    drumLp.frequency.value = 2500;
    const drumBus = ctx.createGain();
    drumBus.gain.value = 0.55;
    drumBus.connect(drumLp).connect(master);

    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 1500;
    const padBus = ctx.createGain();
    padBus.gain.value = 0.32;
    padBus.connect(padLp).connect(master);

    this.nodes.push(drumLp, drumBus, padLp, padBus);

    // Vinyl crackle
    const crBuf = this.noiseBuffer(2);
    if (crBuf) {
      const src = ctx.createBufferSource();
      src.buffer = crBuf;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 4000;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      src.connect(hp).connect(g).connect(master);
      src.start();
      this.nodes.push(src, hp, g);
    }

    // Cmaj7 - Am7 - Fmaj7 - G7 (one bar each)
    const chords = [
      [130.81, 164.81, 196.00, 246.94], // C E G B
      [110.00, 130.81, 164.81, 196.00], // A C E G
      [87.31, 130.81, 174.61, 220.00],  // F C A...
      [98.00, 123.47, 146.83, 174.61],  // G B D F
    ];

    const bpm = 78;
    this.startSequencer(bpm, (beat, time) => {
      const s = beat % 16;
      const bar = Math.floor(beat / 16) % 4;

      if (s === 0 || s === 10) this.kick(time, drumBus, 0.95);
      if (s === 4 || s === 12) this.snare(time, drumBus, 0.5);
      if (s % 2 === 0) this.hihat(time, drumBus, 0.3);

      if (s === 0) {
        const dur = (60 / bpm) * 4;
        chords[bar].forEach(f => this.tone(time, f, dur, 'triangle', 0.16, padBus));
      }
    });
  }

  private playOcean() {
    const ctx = this.ctx!;
    const master = this.masterGain!;
    const buf = this.noiseBuffer(4);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.3;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(lp).connect(gain).connect(master);
    src.start();
    lfo.start();
    this.nodes.push(src, lp, gain, lfo, lfoGain);
  }
}

export const musicPlayer = new MusicPlayer();
