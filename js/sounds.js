// Tiny synthesized UI sounds (no audio files to host). Tab-audio capture picks these up when recording.
window.ChatSounds = (() => {
  let ctx = null;
  let enabled = true;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ freq, to, dur, gain = 0.18, type = 'sine', delay = 0 }) {
    const c = ac();
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() { try { ac(); } catch {} },
    setEnabled(v) { enabled = v; },
    // outgoing "pop/whoosh"
    send() {
      if (!enabled) return;
      tone({ freq: 520, to: 1100, dur: 0.11, gain: 0.12 });
    },
    // incoming two-note chime
    receive() {
      if (!enabled) return;
      tone({ freq: 880, dur: 0.14, gain: 0.12 });
      tone({ freq: 1320, dur: 0.22, gain: 0.1, delay: 0.09 });
    },
    // soft key click while "typing" in the composer
    key() {
      if (!enabled) return;
      tone({ freq: 1800 + Math.random() * 600, dur: 0.025, gain: 0.025, type: 'triangle' });
    },
  };
})();
