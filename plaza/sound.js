/*
 * にゃらゲームプラザ — 音。すべて Web Audio でその場で合成する（音源ファイルは使わない）。
 *   商店街 … 雑踏のざわめき、参道の鳩、ときどき自転車のベル。店の前では店内の曲がくぐもって漏れてくる
 *   店内   … 店の曲（オリジナル）と、あちこちの筐体の効果音
 *   天気   … 雨・台風・猛暑（蝉）。店内ではくぐもって小さくなる
 * 入店の演出では、mix（0＝商店街 〜 1＝店内）に合わせて音が入れ替わる。
 * 音声は最初のタップ／クリック／キーで有効になる（shared/audio.js）。それまでは何もしない。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const A = RA.Audio;
  const Plaza = window.Plaza;

  let ac = null;
  let N = null; // つないだノード
  let buf = null;

  function noiseBuffer() {
    if (!buf) {
      buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  function noiseSource() {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  function filter(type, f, q) {
    const b = ac.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q || 0.7;
    return b;
  }

  function gain(v, dest) {
    const g = ac.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  // 低い周波数で param を揺らす
  function wobble(rate, depth, param, type) {
    const o = ac.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = rate;
    o.connect(gain(depth, param));
    o.start();
    return o;
  }

  // 音量の包絡線をつけて dest へ（pan は左右の位置 -1〜1）
  function envOut(t, vol, attack, dur, dest, pan) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (pan && ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(dest);
    } else {
      g.connect(dest);
    }
    return g;
  }

  // 発振音 o = { f, f2, type, dur, vol, at（ac.currentTime からの秒）, t（絶対時刻）, attack, pan }
  function tone(dest, o) {
    const t = o.t != null ? o.t : ac.currentTime + (o.at || 0);
    const dur = o.dur || 0.1;
    const osc = ac.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    osc.connect(envOut(t, o.vol == null ? 0.1 : o.vol, o.attack || 0.004, dur, dest, o.pan));
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ノイズ o = { dur, vol, at, t, attack, filter, f, f2, q, pan }
  function hiss(dest, o) {
    const t = o.t != null ? o.t : ac.currentTime + (o.at || 0);
    const dur = o.dur || 0.1;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const b = filter(o.filter || 'lowpass', o.f || 2000, o.q);
    b.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f2) b.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    src.connect(b).connect(envOut(t, o.vol == null ? 0.2 : o.vol, o.attack || 0.002, dur, dest, o.pan));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // 音声が有効になっていれば、ノードを組む
  function ensure() {
    if (N) return true;
    ac = A.ctx;
    if (!ac) return false;
    N = {};
    N.master = gain(document.hidden ? 0 : 1, A.out);
    N.sfx = gain(1, N.master);
    N.street = gain(0, N.master);
    N.inside = gain(0, N.master);
    N.musicFilter = filter('lowpass', 600, 0.8);
    N.music = gain(0, N.master);
    N.musicFilter.connect(N.music);
    N.weather = gain(1, N.master);
    N.weatherFilter = filter('lowpass', 12000);
    N.weatherFilter.connect(N.weather);
    // 雑踏（低いざわめきと、話し声くらいの高さの帯）
    const low = noiseSource();
    const lg = gain(0.22, N.street);
    low.connect(filter('bandpass', 420, 0.9)).connect(lg);
    wobble(0.23, 0.08, lg.gain);
    const mid = noiseSource();
    const mg = gain(0.07, N.street);
    mid.connect(filter('bandpass', 1150, 1.8)).connect(mg);
    wobble(0.41, 0.035, mg.gain);
    return true;
  }

  document.addEventListener('visibilitychange', () => {
    if (!N) return;
    N.master.gain.cancelScheduledValues(ac.currentTime);
    N.master.gain.setTargetAtTime(document.hidden ? 0 : 1, ac.currentTime, 0.05);
  });

  // ===== 店の曲（オリジナル。イ短調、8分音符で4小節） =====
  const BPM = 138;
  const STEP = 60 / BPM / 2;
  // 半音の数（A4＝0 → 440Hz）。null は休み
  const LEAD = [0, 3, 7, 5, 3, 0, -2, 0, -4, 0, 3, 2, 0, -4, -5, -4, -2, 2, 5, 3, 2, -2, -3, -2, 7, 5, 3, 2, -1, 2, 7, null];
  const ROOTS = [-24, -28, -26, -29]; // Am F G E
  const FIFTH = [7, 7, 7, 7];
  const hz = (n) => 440 * Math.pow(2, n / 12);
  let step = 0;
  let nextAt = 0;

  function scheduleMusic() {
    const now = ac.currentTime;
    if (nextAt < now - 0.3) nextAt = now + 0.05; // 隠れていたあとは、いまから
    while (nextAt < now + 0.25) {
      const i = step % 32;
      const bar = Math.floor(i / 8);
      const loop = Math.floor(step / 32);
      const lead = LEAD[i];
      if (lead != null) tone(N.musicFilter, { f: hz(lead + (loop % 2 && bar < 2 ? 12 : 0)), t: nextAt, dur: STEP * 0.85, type: 'square', vol: 0.035 });
      const k = i % 8;
      const root = ROOTS[bar];
      tone(N.musicFilter, { f: hz(k % 2 ? root + 12 : k === 2 || k === 6 ? root + FIFTH[bar] : root), t: nextAt, dur: STEP * 0.9, type: 'triangle', vol: 0.09 });
      if (k === 0 || k === 4) tone(N.musicFilter, { f: 130, f2: 45, t: nextAt, dur: 0.12, type: 'sine', vol: 0.12 });
      if (k % 2) hiss(N.musicFilter, { t: nextAt, dur: 0.03, vol: 0.03, filter: 'highpass', f: 7000 });
      if (k === 4) hiss(N.musicFilter, { t: nextAt, dur: 0.09, vol: 0.05, filter: 'bandpass', f: 1800, q: 0.8 });
      step++;
      nextAt += STEP;
    }
  }

  // ===== ときどき鳴る音 =====
  let insideAt = 0;
  let pigeonAt = 0;
  let bellAt = 0;
  let craneAt = 0;
  const rand = (a, b) => a + Math.random() * (b - a);

  // あちこちの筐体の音（ピコピコ、爆発、コイン、ジャンプ…）
  const CABINET = [
    (o) => tone(N.inside, Object.assign({ f: 1800, f2: 300, dur: 0.12, vol: 0.03 }, o)),
    (o) => hiss(N.inside, Object.assign({ dur: 0.4, vol: 0.06, filter: 'lowpass', f: 1400, f2: 90 }, o)),
    (o) => {
      tone(N.inside, Object.assign({ f: 988, dur: 0.07, vol: 0.03 }, o));
      tone(N.inside, Object.assign({ f: 1319, dur: 0.25, vol: 0.03, at: 0.07 }, o));
    },
    (o) => tone(N.inside, Object.assign({ f: 300, f2: 900, dur: 0.1, vol: 0.03 }, o)),
    (o) => [523, 659, 784, 1047].forEach((f, k) => tone(N.inside, Object.assign({ f, dur: 0.06, vol: 0.025, at: k * 0.06 }, o))),
    (o) => {
      hiss(N.inside, Object.assign({ dur: 0.06, vol: 0.08, filter: 'bandpass', f: 900 }, o));
      tone(N.inside, Object.assign({ f: 160, f2: 60, dur: 0.1, type: 'sine', vol: 0.08 }, o));
    },
    (o) => [784, 659, 784, 1047, 1319, 1568].forEach((f, k) => tone(N.inside, Object.assign({ f, dur: 0.07, vol: 0.022, at: k * 0.07, type: 'triangle' }, o))),
    (o) => tone(N.inside, Object.assign({ f: 220, f2: 110, dur: 0.3, vol: 0.03, type: 'sawtooth' }, o)),
  ];

  // クレーンゲームの客寄せの曲（オルゴールのような三角波）
  const CRANE = [
    [1047, 0.12],
    [1319, 0.12],
    [1568, 0.12],
    [1319, 0.12],
    [1175, 0.24],
    [988, 0.12],
    [1047, 0.36],
  ];

  function crane(dest, vol, at) {
    let t = at || 0;
    CRANE.forEach(([f, d]) => {
      tone(dest, { f, dur: d * 1.4, type: 'triangle', vol, at: t, pan: -0.5 });
      t += d;
    });
  }

  function randomEvents(now, st) {
    if (st.mix > 0.05 && now >= insideAt) {
      CABINET[Math.floor(Math.random() * CABINET.length)]({ pan: rand(-0.8, 0.8) });
      insideAt = now + rand(0.35, 1.4);
    }
    if (st.mix > 0.05 && now >= craneAt) {
      if (craneAt) crane(N.inside, 0.02);
      craneAt = now + rand(18, 30);
    }
    if (st.street > 0.05 && st.mix < 0.9) {
      if (now >= pigeonAt) {
        // 参道の鳩（ポッ、ポーポー）
        const v = 0.05 * st.sando * st.street;
        if (pigeonAt && v > 0.004 && st.day) {
          tone(N.sfx, { f: 420, f2: 360, dur: 0.18, type: 'sine', vol: v, attack: 0.03 });
          tone(N.sfx, { f: 390, f2: 330, dur: 0.42, type: 'sine', vol: v, at: 0.3, attack: 0.08 });
          tone(N.sfx, { f: 370, f2: 320, dur: 0.38, type: 'sine', vol: v * 0.8, at: 0.8, attack: 0.08 });
        }
        pigeonAt = now + rand(3.5, 8);
      }
      if (now >= bellAt) {
        // 遠くの自転車のベル
        if (bellAt) {
          const v = 0.018 * st.street;
          tone(N.sfx, { f: 2620, dur: 0.12, type: 'sine', vol: v, pan: rand(-0.7, 0.7) });
          tone(N.sfx, { f: 2620, dur: 0.25, type: 'sine', vol: v, at: 0.14, pan: rand(-0.7, 0.7) });
        }
        bellAt = now + rand(14, 28);
      }
    }
  }

  // ===== 天気の環境音（菌糸ライフの窓の音とそろえてある） =====
  let wKind = null;
  let wBed = null;
  let wNext = 0;

  function rainNoise(out, low, high) {
    const src = noiseSource();
    src.connect(filter('highpass', low)).connect(filter('lowpass', high)).connect(out);
    return src;
  }

  const BEDS = {
    rain: { vol: 0.06, build: (out) => [rainNoise(out, 500, 2600)] },
    typhoon: {
      vol: 0.09,
      build: (out) => {
        const wind = noiseSource();
        const bp = filter('bandpass', 500, 1.1);
        const g = gain(1.4, out);
        wind.connect(bp).connect(g);
        return [rainNoise(out, 600, 3800), wind, wobble(0.13, 260, bp.frequency), wobble(0.21, 0.6, g.gain)];
      },
    },
    heat: {
      vol: 0.025,
      build: (out) => {
        const src = noiseSource();
        const g = gain(0.6, out);
        src.connect(filter('bandpass', 4200, 4)).connect(g);
        return [src, wobble(46, 0.4, g.gain, 'square')];
      },
    },
  };

  function setWeather(k) {
    if (k === wKind) return;
    if (wBed) {
      const b = wBed;
      const t = ac.currentTime;
      b.gain.gain.cancelScheduledValues(t);
      b.gain.gain.setValueAtTime(Math.max(0.0001, b.gain.gain.value), t);
      b.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      b.nodes.forEach((n) => n.stop(t + 0.9));
      setTimeout(() => b.gain.disconnect(), 1200);
    }
    wBed = null;
    wKind = k;
    if (!k) return;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(BEDS[k].vol, ac.currentTime + 1.5);
    g.connect(N.weatherFilter);
    wBed = { gain: g, nodes: BEDS[k].build(g) };
    wNext = 0;
  }

  function weatherEvents(now) {
    if (!wBed || now < wNext) return;
    if (wKind === 'rain') {
      tone(N.weatherFilter, { f: 1400 + Math.random() * 1600, f2: 700, dur: 0.05, type: 'sine', vol: 0.03 });
      wNext = now + 0.15 + Math.random() * 0.8;
    } else if (wKind === 'typhoon') {
      hiss(N.weatherFilter, { dur: 2.2, vol: 0.12, filter: 'bandpass', f: 200, f2: 900 + Math.random() * 600, q: 1, attack: 0.9 });
      wNext = now + 2.5 + Math.random() * 4;
    } else if (wKind === 'heat') {
      cicada(N.weatherFilter, 0.02);
      wNext = now + 4 + Math.random() * 5;
    }
  }

  // ミンミンゼミ
  function cicada(dest, vol) {
    tone(dest, { f: 2900, f2: 3400, dur: 0.6, type: 'square', vol, attack: 0.25 });
    for (let i = 0; i < 4; i++) tone(dest, { f: 3300, f2: 2900, dur: 0.16, type: 'square', vol, at: 0.65 + i * 0.2, attack: 0.03 });
    tone(dest, { f: 3200, f2: 2600, dur: 0.7, type: 'square', vol: vol * 0.8, at: 1.5, attack: 0.05 });
  }

  // 空の状態から鳴らす天気の音
  function weatherKind(sky) {
    if (sky.fall === 'storm') return 'typhoon';
    if (sky.fall === 'rain') return 'rain';
    if (sky.mood === 'heat') return 'heat';
    return null;
  }

  /*
   * 毎フレーム呼ぶ。st = {
   *   street … 商店街の音の大きさ（0〜1。タイトルでは0）
   *   mix    … 0＝商店街 〜 1＝店内
   *   door   … 店の入口の近さ（0〜1。漏れてくる曲の大きさ）
   *   sando  … 参道の近さ（0〜1。鳩の声）
   *   day    … 鳩が起きている時間か
   *   sky    … 空の状態（天気の音）
   * }
   */
  function frame(st) {
    if (!ensure()) return;
    const now = ac.currentTime;
    const m = st.mix;
    const set = (param, v) => param.setTargetAtTime(v, now, 0.12);
    set(N.street.gain, st.street * (1 - m));
    set(N.inside.gain, m);
    set(N.music.gain, st.street * (1 - m) * (0.12 + 0.4 * st.door) + m * 1);
    set(N.musicFilter.frequency, 500 + 11000 * m * m + 300 * st.door * (1 - m));
    set(N.weather.gain, st.street * (1 - m) + m * 0.35);
    set(N.weatherFilter.frequency, 12000 - 11200 * m);
    if (st.street > 0 || m > 0) scheduleMusic();
    setWeather(st.street > 0 || m > 0 ? weatherKind(st.sky) : null);
    weatherEvents(now);
    randomEvents(now, st);
  }

  // ===== 効果音 =====
  const sfx = {
    // 時間が巻き戻る（テープの巻き戻しのようなキュルキュル）
    slip() {
      if (!ensure()) return;
      for (let i = 0; i < 28; i++) {
        const f = 2400 - i * 60 + (i % 2) * 380;
        tone(N.sfx, { f, f2: f * 0.6, dur: 0.05, type: 'square', vol: 0.035, at: i * 0.06 });
      }
      hiss(N.sfx, { dur: 1.7, vol: 0.07, filter: 'bandpass', f: 3000, f2: 300, q: 2, attack: 0.2 });
      tone(N.sfx, { f: 110, f2: 55, dur: 1.6, type: 'sawtooth', vol: 0.04, attack: 0.3 });
    },
    // 1996年に着いた（きらきら）
    arrive() {
      if (!ensure()) return;
      [1568, 2093, 2637, 3136, 4186].forEach((f, k) => tone(N.sfx, { f, dur: 0.4, type: 'triangle', vol: 0.06, at: k * 0.06 }));
    },
    // 自動ドアが開く（モーターのウィーンと、止まるときのコトン）
    door() {
      if (!ensure()) return;
      tone(N.sfx, { f: 70, f2: 95, dur: 0.7, type: 'sawtooth', vol: 0.05, attack: 0.1 });
      hiss(N.sfx, { dur: 0.65, vol: 0.05, filter: 'bandpass', f: 700, f2: 1200, q: 1.2, attack: 0.15 });
      tone(N.sfx, { f: 120, f2: 60, dur: 0.12, type: 'sine', vol: 0.1, at: 0.66 });
    },
    // 公衆電話でポケベルに「0840（おはよう）」を打つ
    phone() {
      if (!ensure()) return;
      const DTMF = { 0: [941, 1336], 8: [852, 1336], 4: [770, 1209] };
      '0840'.split('').forEach((dgt, k) => {
        DTMF[dgt].forEach((f) => tone(N.sfx, { f, dur: 0.12, type: 'sine', vol: 0.05, at: 0.15 + k * 0.2 }));
      });
      [0, 1, 2].forEach((k) => tone(N.sfx, { f: 2800, dur: 0.06, type: 'square', vol: 0.03, at: 1.2 + k * 0.1 }));
    },
    // 鳩が飛び立つ羽音
    pigeons() {
      if (!ensure()) return;
      for (let k = 0; k < 9; k++) hiss(N.sfx, { dur: 0.05, vol: 0.12, filter: 'bandpass', f: 1300 + Math.random() * 500, q: 1.5, at: k * 0.055 });
    },
    // クレーンが降りて、つかんで、戻る
    ufo() {
      if (!ensure()) return;
      crane(N.sfx, 0.05);
      tone(N.sfx, { f: 180, f2: 140, dur: 0.9, type: 'sawtooth', vol: 0.02, at: 0.05 });
      tone(N.sfx, { f: 140, f2: 180, dur: 0.9, type: 'sawtooth', vol: 0.02, at: 1.3 });
    },
    // 両替機から百円玉がじゃらじゃら
    coins() {
      if (!ensure()) return;
      for (let k = 0; k < 10; k++) {
        tone(N.sfx, { f: 3000 + Math.random() * 1400, dur: 0.07, type: 'triangle', vol: 0.04, at: 0.05 + k * 0.06 });
        hiss(N.sfx, { dur: 0.03, vol: 0.05, filter: 'highpass', f: 5000, at: 0.05 + k * 0.06 });
      }
    },
    // プリクラの撮影（ピ、ピ、パシャ）
    photo() {
      if (!ensure()) return;
      tone(N.sfx, { f: 1760, dur: 0.06, vol: 0.05 });
      hiss(N.sfx, { dur: 0.05, vol: 0.18, filter: 'highpass', f: 3000, at: 0.02 });
      hiss(N.sfx, { dur: 0.1, vol: 0.12, filter: 'bandpass', f: 1500, at: 0.07 });
      tone(N.sfx, { f: 1760, dur: 0.06, vol: 0.05, at: 0.6 });
      hiss(N.sfx, { dur: 0.05, vol: 0.18, filter: 'highpass', f: 3000, at: 0.62 });
    },
    // 遠くの雷
    thunder() {
      if (!ensure()) return;
      hiss(N.weatherFilter, { dur: 1.6, vol: 0.3, filter: 'lowpass', f: 500, f2: 70, attack: 0.02, at: 0.3 + Math.random() * 0.6 });
    },
  };

  Plaza.sound = { frame, sfx };
})();
