/* 音樂與音效：全部用瀏覽器即時合成，不需要音樂檔。 */
(function () {
  const Snd = { playing: false };
  let ac = null, master = null, music = null, bus = null, timer = null, noise = null, step = 0;

  function ctx() {
    if (!ac) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      ac = new A();
      master = ac.createGain();
      master.gain.value = 0.9;
      master.connect(ac.destination);
    }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }
  function tone(f, t, d, v, type, dest) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "triangle";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + d + 0.05);
  }
  Snd.ok = () => { if (!ctx()) return; const t = ac.currentTime; tone(784, t, .25, .14); tone(1175, t + .09, .35, .12); };
  Snd.ng = () => { if (!ctx()) return; const t = ac.currentTime; tone(330, t, .3, .1, "sine"); tone(247, t + .12, .4, .09, "sine"); };
  Snd.win = () => { if (!ctx()) return; const t = ac.currentTime; [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * .12, .55, .12)); };
  Snd.tap = () => { if (!ctx()) return; tone(660, ac.currentTime, .12, .05, "sine"); };

  const SCALE = [392, 440, 523, 587, 659, 784, 880];
  function start() {
    music = ac.createGain();
    music.gain.setValueAtTime(0.0001, ac.currentTime);
    music.gain.linearRampToValueAtTime(0.7, ac.currentTime + 1.5);
    music.connect(master);
    bus = ac.createGain(); bus.gain.value = 1; bus.connect(music);
    const dl = ac.createDelay(); dl.delayTime.value = 0.42;
    const fb = ac.createGain(); fb.gain.value = 0.35;
    bus.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(music);
    // 海浪：低通的白噪音，慢慢起伏
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    noise = ac.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520;
    const ng = ac.createGain(); ng.gain.value = 0.05;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.09;
    const lg = ac.createGain(); lg.gain.value = 0.04;
    lfo.connect(lg); lg.connect(ng.gain);
    noise.connect(lp); lp.connect(ng); ng.connect(music);
    noise.start(); lfo.start(); noise._lfo = lfo;
    step = 0;
    timer = setInterval(() => {
      const t = ac.currentTime; step++;
      if (Math.random() < 0.55) tone(SCALE[(Math.random() * SCALE.length) | 0], t, 1.4, 0.045, "sine", bus);
      if (step % 8 === 1) tone(SCALE[0] / 2, t, 2.6, 0.05, "sine", bus);
      if (step % 8 === 5) tone(SCALE[2] / 2, t, 2.6, 0.04, "sine", bus);
    }, 450);
    Snd.playing = true;
  }
  function stop() {
    clearInterval(timer);
    const m = music, n = noise, t = ac.currentTime;
    m.gain.cancelScheduledValues(t);
    m.gain.setValueAtTime(m.gain.value, t);
    m.gain.linearRampToValueAtTime(0.0001, t + 0.6);
    setTimeout(() => { try { n.stop(); n._lfo.stop(); m.disconnect(); } catch (e) {} }, 700);
    Snd.playing = false;
  }
  Snd.toggleMusic = function () {
    if (!ctx()) return false;
    if (Snd.playing) stop(); else start();
    return Snd.playing;
  };
  window.Sound = Snd;
})();
