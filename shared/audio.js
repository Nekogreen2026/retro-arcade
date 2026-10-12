/*
 * 効果音。音源ファイルは使わず、Web Audio API でその場で合成する。
 * 音声は最初のタップ／クリック／キー入力で有効化する（ブラウザの自動再生制限のため）。
 */
(function () {
  'use strict';
  const RA = window.RA;

  let ctx = null;
  let out = null;
  let noiseBuf = null;
  let primed = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.6;
    out.connect(ctx.destination);
    return ctx;
  }

  // ユーザー操作の中で呼ぶと音が出せるようになる。何度呼んでもよい
  function unlock() {
    const c = ensure();
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    if (!primed) {
      // 古い iOS は操作の中で一度でも鳴らさないと解放されないので、無音を1サンプル鳴らす
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
      primed = true;
    }
  }

  ['pointerdown', 'pointerup', 'touchend', 'keydown'].forEach((type) =>
    window.addEventListener(type, unlock, true)
  );
  // 別のページから「戻る」で復帰したときも鳴るように
  window.addEventListener('pageshow', () => ctx && ctx.state !== 'running' && ctx.resume().catch(() => {}));

  function usable() {
    return ctx && ctx.state !== 'closed';
  }

  function noiseBuffer() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // 音量の包絡線（立ち上がり attack 秒で vol、dur 秒で消える）
  function envelope(t, vol, attack, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  /*
   * 発振音。o = { f: 周波数, f2: 終わりの周波数, type: 'square'|'triangle'|'sine'|'sawtooth',
   *              dur: 長さ(秒), vol: 音量, at: 遅らせる秒数, attack: 立ち上がり秒 }
   */
  function tone(o) {
    if (!usable()) return;
    const t = ctx.currentTime + (o.at || 0);
    const dur = o.dur || 0.1;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    const g = envelope(t, o.vol == null ? 0.2 : o.vol, o.attack || 0.004, dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /*
   * ノイズ。o = { dur, vol, at, attack, filter: 'lowpass'|'highpass'|'bandpass',
   *              f: フィルタ周波数, f2: 終わりのフィルタ周波数, q }
   */
  function noise(o) {
    if (!usable()) return;
    const t = ctx.currentTime + (o.at || 0);
    const dur = o.dur || 0.1;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter || 'lowpass';
    filter.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f2) filter.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    filter.Q.value = o.q || 0.7;
    const g = envelope(t, o.vol == null ? 0.3 : o.vol, o.attack || 0.002, dur);
    src.connect(filter).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // 音符を順に鳴らす。notes = [[周波数, 長さ秒], ...]（周波数0は休符）
  function melody(notes, o) {
    o = o || {};
    let at = o.at || 0;
    notes.forEach(([f, dur]) => {
      if (f) tone({ f, dur: dur * 0.95, type: o.type || 'square', vol: o.vol == null ? 0.12 : o.vol, at });
      at += dur;
    });
  }

  RA.Audio = {
    unlock,
    tone,
    noise,
    melody,
    // 細かく作り込みたいときに直接使う
    get ctx() {
      return usable() ? ctx : null;
    },
    get out() {
      return out;
    },
  };

  // よく使う共通の音
  RA.sfx = {
    blip() {
      tone({ f: 880, dur: 0.05, vol: 0.1 });
    },
    coin() {
      tone({ f: 988, dur: 0.07, vol: 0.15 });
      tone({ f: 1319, dur: 0.35, vol: 0.15, at: 0.07 });
    },
  };
})();
