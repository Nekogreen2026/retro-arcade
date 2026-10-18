/*
 * 菌糸ライフ — キノコを育てて図鑑を埋める、のんびり育成ゲーム。
 *
 * 栽培ケースに鉢が3つ。空いた鉢をタップすると胞子をまき、
 *   胞子 → 幼菌 → 成菌（タップで収穫）→ しおれ → 乾燥標本（自動で図鑑に載る）
 * と育つ。湿度・温度・光の3つのつまみで、育つ速さ・しおれるまでの長さ・変種が変わる。
 * 変種は「胞子と幼菌のあいだ、どの環境にどれだけいたか」で決まる。条件は画面には出さない。
 * 時間は実時間で進む。閉じていたあいだの分は、開いたときに前回の時刻からまとめて進める。
 * URL に ?debug=1 を付けたときだけ、1時間・1日の早送りボタンを出す。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;

  const canvas = document.getElementById('screen');
  const ctx = RA.setupScreen(canvas);
  const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
  const MOBILE = RA.isMobile();

  // ===== 決まりごと（時間の単位は「時間」） =====
  const HOUR_MS = 3600 * 1000;
  const STAGE_HOURS = 2; // 胞子→幼菌、幼菌→成菌 のそれぞれにかかる時間（つまみがすべて「中」のとき）
  const FRESH_HOURS = 8; // 成菌がしおれるまで（同上）
  const DRY_HOURS = 6; // しおれてから乾燥標本になるまで（同上）
  // つまみの段階（0 低・1 中・2 高）ごとの倍率。並びは 湿度・温度・光
  const GROW = [
    [0.75, 1, 1.25], // 湿り気があるほど早く育つ
    [0.6, 1, 1.5], // 暖かいほど早く育つ
    [1.1, 1, 0.9], // 暗いほうが少し早い
  ];
  const KEEP = [
    [0.5, 1, 1.5], // 乾いているとすぐしおれ、すぐ乾く
    [1.5, 1, 0.6], // 暑いとすぐしおれ、すぐ乾く
    [1.1, 1, 0.8], // 明るいと少し早い
  ];
  const SWING = 0.25; // 両極端の段階にそれぞれこの割合の時間いると、特別な変種になる
  const POTS = 3;
  const REPORT_MIN = 10; // 前回からこの分数以上空いていたら「おかえり」を出す
  const SAVE_EVERY = 5000; // 開いているあいだに保存する間隔（ミリ秒）
  const TOAST_TIME = 2400;

  const HUM = 0;
  const TEMP = 1;
  const LIGHT = 2;
  const DIALS = [
    { name: '湿度', levels: ['低', '中', '高'], color: 'cyan' },
    { name: '温度', levels: ['低', '中', '高'], color: 'orange' },
    { name: '光', levels: ['暗', '中', '明'], color: 'gold' },
  ];

  const STAGES = ['spore', 'young', 'adult', 'wilted', 'dried'];
  const NEXT = { spore: 'young', young: 'adult', adult: 'wilted', wilted: 'dried' };
  const STAGE_NAME = { spore: '胞子', young: '幼菌', adult: '成菌', wilted: 'しおれ', dried: '標本' };
  const STAGE_COLOR = { spore: 'silver', young: 'cream', adult: 'gold', wilted: 'mist', dried: 'orange' };

  // 変種。並び順＝図鑑の番号。絵は assets/<id>-<段階>.png（段階は STAGES）
  const VARIANTS = [
    { id: 'plain', name: 'ヘイボンダケ', text: ['どこにでも生える。', '平凡は才能の別名だ。'] },
    { id: 'drop', name: 'シズクダケ', text: ['いつも傘のふちに', '雫をためている。'] },
    { id: 'snow', name: 'ワタユキダケ', text: ['綿雪のように白い。', '触ると少しひんやり。'] },
    { id: 'sleepy', name: 'ネボスケダケ', text: ['傘を閉じたまま', '一生を寝て過ごす。'] },
    { id: 'lamp', name: 'アンドンダケ', text: ['闇の中でだけ', 'ぼんやりと灯る。'] },
    { id: 'ember', name: 'オキビダケ', text: ['触れるとほのかに温かい。', '火の気を忘れない。'] },
    { id: 'moss', name: 'コケモリダケ', text: ['森の匂いがする。', '苔とは古い友人。'] },
    { id: 'sun', name: 'ヒダマリダケ', text: ['陽だまりの色をした', 'おおらかな傘。'] },
    { id: 'twotone', name: 'フタオモテダケ', text: ['暑さも寒さも', '知っている顔。'] },
    { id: 'blink', name: 'マタタキダケ', text: ['明かりがつくたび', '瞬きをするらしい。'] },
  ];
  const BY_ID = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

  /*
   * 変種を決める。exp[つまみ][段階] は、胞子・幼菌のあいだにその段階にいた時間。
   * まだ時間がたっていなければ、いまのつまみ env で見立てる（胞子・幼菌の絵はこの見立てで出す）。
   * ここが出現条件のすべて。ゲーム内では見せない（README の「ネタバレ」に同じ表がある）。
   */
  function decide(exp, env) {
    const total = exp[HUM][0] + exp[HUM][1] + exp[HUM][2];
    const share = (k, lv) => (total > 0 ? exp[k][lv] / total : env[k] === lv ? 1 : 0);
    if (share(TEMP, 0) >= SWING && share(TEMP, 2) >= SWING) return 'twotone'; // 寒暖差
    if (share(LIGHT, 0) >= SWING && share(LIGHT, 2) >= SWING) return 'blink'; // 明暗の行き来
    // 時間で平均して 0 低・1 中・2 高 に分ける
    const level = (k) => {
      const avg = share(k, 1) + share(k, 2) * 2;
      return avg < 2 / 3 ? 0 : avg > 4 / 3 ? 2 : 1;
    };
    const h = level(HUM);
    const t = level(TEMP);
    const l = level(LIGHT);
    if (h === 2 && t === 0 && l !== 2) return 'drop';
    if (t === 0 && l === 2) return 'snow';
    if (t === 0 && l === 0) return 'sleepy';
    if (t === 2 && l === 0) return 'lamp';
    if (t === 2 && h === 0) return 'ember';
    if (h === 2 && t === 1) return 'moss';
    if (l === 2) return 'sun';
    return 'plain';
  }

  // ===== 保存 =====
  // state: { last: 最後に時間を進めた時刻(ms), env: [湿度, 温度, 光], pots: [鉢 or null, ...] }
  //   鉢: { stage, prog: その段階の進み(0〜1), exp: 育つあいだの環境の記録, variant: 成菌で決まる変種 }
  // book: { 変種ID: { h: 採取した数, d: 乾燥標本の数, n: 図鑑で未確認の新着 } }
  const KEY_STATE = ['kinshi', 'state'];
  const KEY_BOOK = ['kinshi', 'book'];

  function readJSON(parts) {
    try {
      return JSON.parse(RA.Store.get(parts, 'null'));
    } catch (e) {
      return null;
    }
  }

  const isLevel = (v) => v === 0 || v === 1 || v === 2;
  const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const count = (v) => (Number.isInteger(v) && v > 0 ? v : 0);

  function cleanPot(p) {
    if (!p || STAGES.indexOf(p.stage) < 0 || !isTime(p.prog) || p.prog > 1) return null;
    if (!Array.isArray(p.exp) || p.exp.length !== 3) return null;
    if (!p.exp.every((row) => Array.isArray(row) && row.length === 3 && row.every(isTime))) return null;
    const growing = p.stage === 'spore' || p.stage === 'young';
    if (!growing && !BY_ID[p.variant]) return null;
    return { stage: p.stage, prog: p.prog, exp: p.exp.map((row) => row.slice()), variant: growing ? null : p.variant };
  }

  function loadState() {
    const s = readJSON(KEY_STATE);
    if (!s || !isTime(s.last) || !Array.isArray(s.env) || s.env.length !== 3 || !s.env.every(isLevel) || !Array.isArray(s.pots)) return null;
    const pots = [];
    for (let i = 0; i < POTS; i++) pots.push(cleanPot(s.pots[i]));
    return { last: s.last, env: s.env.slice(), pots };
  }

  function loadBook() {
    const b = readJSON(KEY_BOOK) || {};
    const out = {};
    VARIANTS.forEach((v) => {
      const e = b[v.id] || {};
      out[v.id] = { h: count(e.h), d: count(e.d), n: e.n === true };
    });
    return out;
  }

  const saved = loadState();
  const state = saved || { last: Date.now(), env: [1, 1, 1], pots: [null, null, null] };
  const book = loadBook();
  let savedAt = 0;

  function save() {
    RA.Store.set(KEY_STATE, JSON.stringify(state));
    savedAt = performance.now();
  }

  function saveBook() {
    RA.Store.set(KEY_BOOK, JSON.stringify(book));
  }

  // 図鑑に記録する。kind は 'h'（採取）か 'd'（乾燥標本）。初めて見つけた変種なら true
  function register(id, kind) {
    const e = book[id];
    const isNew = !e.h && !e.d;
    e[kind]++;
    if (e[kind] === 1) e.n = true;
    saveBook();
    return isNew;
  }

  // ===== 時間の進み =====
  const product = (tab, env) => tab[0][env[0]] * tab[1][env[1]] * tab[2][env[2]];

  // その段階が1時間に進む割合（1 で次の段階）
  function rateOf(stage, env) {
    if (stage === 'spore' || stage === 'young') return product(GROW, env) / STAGE_HOURS;
    if (stage === 'adult') return 1 / (FRESH_HOURS * product(KEEP, env));
    if (stage === 'wilted') return 1 / (DRY_HOURS * product(KEEP, env));
    return 0; // 乾燥標本はそれ以上変わらない
  }

  function newPot() {
    return {
      stage: 'spore',
      prog: 0,
      exp: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      variant: null,
    };
  }

  // 鉢 i を hours 時間進める。段階が変わるたびに events に積む（途中で何段階進んでもよい）
  function grow(i, hours, events) {
    const pot = state.pots[i];
    const env = state.env;
    let left = hours;
    while (pot && left > 0) {
      const rate = rateOf(pot.stage, env);
      if (!rate) break;
      const need = (1 - pot.prog) / rate;
      const dt = Math.min(left, need);
      if (pot.stage === 'spore' || pot.stage === 'young') for (let k = 0; k < 3; k++) pot.exp[k][env[k]] += dt;
      if (dt < need) {
        pot.prog += dt * rate;
        break;
      }
      left -= need;
      pot.prog = 0;
      pot.stage = NEXT[pot.stage];
      if (pot.stage === 'adult') pot.variant = decide(pot.exp, env);
      events.push({ type: pot.stage, pot: i, id: pot.variant, first: false });
    }
  }

  // すべての鉢を hours 時間進める。乾燥標本になったものはその場で図鑑に載せる
  function advance(hours) {
    const events = [];
    for (let i = 0; i < POTS; i++) grow(i, hours, events);
    events.forEach((e) => {
      if (e.type === 'dried') e.first = register(e.id, 'd');
    });
    return events;
  }

  // 前回から今までの実時間を進める（時計が戻っていたら進めない）
  function tick() {
    const now = Date.now();
    const hours = (now - state.last) / HOUR_MS;
    state.last = now;
    return hours > 0 ? advance(hours) : [];
  }

  // 鉢ごとの最後の変化を数える（留守のあいだに成菌→しおれ と進んだ鉢は「しおれ」だけ数える）
  function finals(events) {
    const last = {};
    events.forEach((e) => (last[e.pot] = e.type));
    const n = { young: 0, adult: 0, wilted: 0, dried: 0 };
    Object.keys(last).forEach((k) => n[last[k]]++);
    return n;
  }

  // 「成菌2・標本1」のような一行のまとめ
  function summary(events) {
    const n = finals(events);
    return [
      ['young', '幼菌'],
      ['adult', '成菌'],
      ['wilted', 'しおれ'],
      ['dried', '標本'],
    ]
      .filter(([k]) => n[k])
      .map(([k, label]) => label + n[k])
      .join('・');
  }

  function agoText(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 60) return min + '分ぶり';
    const h = Math.floor(min / 60);
    return h < 48 ? h + '時間ぶり' : Math.floor(h / 24) + '日ぶり';
  }

  function etaText(hours) {
    const min = Math.ceil(hours * 60);
    if (min < 60) return '約' + Math.max(5, Math.ceil(min / 5) * 5) + '分';
    return '約' + Math.round(hours) + '時間';
  }

  const speedText = () => {
    const g = product(GROW, state.env);
    return g >= 1.2 ? '速い' : g <= 0.8 ? '遅い' : 'ふつう';
  };
  const keepText = () => {
    const k = product(KEEP, state.env);
    return k >= 1.3 ? '長い' : k <= 0.75 ? '短い' : 'ふつう';
  };

  // 胞子・幼菌はまだ変種が決まっていないので、いまの見立てで絵を出す
  const shownVariant = (pot) => pot.variant || decide(pot.exp, state.env);

  // ===== 効果音 =====
  const A = RA.Audio;
  const snd = {
    start() {
      RA.sfx.coin();
    },
    plant() {
      A.noise({ dur: 0.14, vol: 0.22, filter: 'lowpass', f: 900, f2: 250 });
      A.tone({ f: 330, f2: 560, dur: 0.12, type: 'triangle', vol: 0.12 });
    },
    dial(lv) {
      A.tone({ f: [523, 659, 784][lv], dur: 0.06, vol: 0.09 });
      A.noise({ dur: 0.02, vol: 0.12, filter: 'highpass', f: 4000 });
    },
    limit() {
      A.tone({ f: 140, dur: 0.1, vol: 0.12 });
    },
    // 「ポン」と抜ける音
    harvest() {
      A.tone({ f: 420, f2: 1260, dur: 0.08, type: 'sine', vol: 0.28 });
      A.noise({ dur: 0.04, vol: 0.2, filter: 'highpass', f: 2500 });
      A.tone({ f: 1568, dur: 0.16, type: 'triangle', vol: 0.12, at: 0.08 });
    },
    discover() {
      A.melody(
        [
          [784, 0.08],
          [988, 0.08],
          [1175, 0.08],
          [1568, 0.32],
        ],
        { vol: 0.11, at: 0.14 }
      );
    },
    info() {
      RA.sfx.blip();
    },
    grown() {
      A.tone({ f: 1047, dur: 0.1, type: 'triangle', vol: 0.12 });
      A.tone({ f: 1568, dur: 0.22, type: 'triangle', vol: 0.12, at: 0.1 });
    },
    sad() {
      A.tone({ f: 330, f2: 220, dur: 0.28, type: 'triangle', vol: 0.14 });
    },
    // 乾いた「カサッ」
    shelve() {
      A.noise({ dur: 0.08, vol: 0.28, filter: 'bandpass', f: 3200, q: 2 });
      A.tone({ f: 660, dur: 0.08, type: 'triangle', vol: 0.1, at: 0.06 });
    },
    page() {
      A.tone({ f: 660, dur: 0.04, vol: 0.08 });
      A.tone({ f: 990, dur: 0.05, vol: 0.08, at: 0.04 });
    },
    skip() {
      A.tone({ f: 200, f2: 1600, dur: 0.25, type: 'sawtooth', vol: 0.06 });
    },
  };

  // ===== 配置 =====
  const CASE = { x: 4, y: 28, w: 248, h: 128 }; // 栽培ケース
  const POT_X = [52, 128, 204]; // 鉢の中心
  const BED_Y = 122; // 菌床の上面
  const BOX = 64; // キノコの絵の枠（32×32 の絵なら2倍）
  const LABEL_Y = 134;
  const MSG_Y = 34;
  const PANEL_Y = 160;
  const DIAL_X = [4, 88, 172];

  // ===== 背景（一度だけ描いて使い回す） =====
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  const FLOOR = BED_Y + 10 - CASE.y; // ケースの中での床の高さ

  // ケースの奥。光の段階ごとに壁の色と天井の灯りが変わる
  function paintWall(light) {
    const c = makeCanvas(CASE.w, CASE.h);
    const g = c.getContext('2d');
    g.fillStyle = P[['ink', 'night', 'dusk'][light]];
    g.fillRect(0, 0, CASE.w, CASE.h);
    // 灯りが当たるところをディザで明るく
    if (light > 0) {
      g.fillStyle = P[light === 2 ? 'mist' : 'dusk'];
      for (let y = 4; y < FLOOR; y++) {
        const spread = (y / FLOOR) * 26;
        const lv = (light === 2 ? 0.5 : 0.22) - (y / FLOOR) * 0.2;
        for (let x = Math.floor(36 - spread); x < CASE.w - 36 + spread; x++) if (bayer(x, y) < lv) g.fillRect(x, y, 1, 1);
      }
    }
    // 天井の蛍光灯
    g.fillStyle = P.ink;
    g.fillRect(34, 0, CASE.w - 68, 4);
    g.fillStyle = P[['dusk', 'silver', 'white'][light]];
    g.fillRect(36, 1, CASE.w - 72, 2);
    // 床
    g.fillStyle = P.ink;
    g.fillRect(0, FLOOR, CASE.w, CASE.h - FLOOR);
    g.fillStyle = P.dusk;
    g.fillRect(0, FLOOR, CASE.w, 1);
    return c;
  }

  // 温度「低」: 四隅の霜
  function paintFrost() {
    const c = makeCanvas(CASE.w, CASE.h);
    const g = c.getContext('2d');
    const R = 22;
    for (let y = 0; y < CASE.h; y++) {
      for (let x = 0; x < CASE.w; x++) {
        const dx = Math.min(x, CASE.w - 1 - x);
        const dy = Math.min(y, CASE.h - 1 - y);
        const lv = 1 - (dx + dy) / R;
        const b = bayer(x, y);
        if (lv <= b) continue;
        g.fillStyle = P[lv - b > 0.3 ? 'white' : 'cyan'];
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  // 温度「高」: 床から立つ熱
  function paintHeat() {
    const c = makeCanvas(CASE.w, CASE.h);
    const g = c.getContext('2d');
    for (let y = FLOOR - 24; y < FLOOR; y++) {
      const lv = ((y - (FLOOR - 24)) / 24) * 0.45;
      for (let x = 0; x < CASE.w; x++) {
        if (bayer(x, y) >= lv) continue;
        g.fillStyle = P[bayer(x, y) < lv * 0.3 ? 'red' : 'maroon'];
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  // 湿度「高」: 床にたまる霧
  function paintFog() {
    const c = makeCanvas(CASE.w, CASE.h);
    const g = c.getContext('2d');
    g.fillStyle = P.silver;
    for (let y = FLOOR - 30; y < FLOOR; y++) {
      const lv = ((y - (FLOOR - 30)) / 30) * 0.4;
      for (let x = 0; x < CASE.w; x++) if (bayer(x + 2, y + 1) < lv) g.fillRect(x, y, 1, 1);
    }
    return c;
  }

  // 菌床のブロック
  function paintBed() {
    const c = makeCanvas(56, 10);
    const g = c.getContext('2d');
    const rnd = seeded(31);
    g.fillStyle = P.ink;
    g.fillRect(0, 0, 56, 10);
    g.fillStyle = P.brown;
    g.fillRect(1, 1, 54, 8);
    g.fillStyle = P.orange;
    g.fillRect(2, 1, 52, 1);
    g.fillStyle = P.maroon;
    for (let i = 0; i < 26; i++) g.fillRect(1 + Math.floor(rnd() * 54), 2 + Math.floor(rnd() * 7), 1, 1);
    return c;
  }

  const walls = [0, 1, 2].map(paintWall);
  const frost = paintFrost();
  const heat = paintHeat();
  const fog = paintFog();
  const bed = paintBed();

  // ガラスにつく水滴（湿度が上がるほど増える。一部はゆっくり流れ落ちる）
  const DROPS = (() => {
    const rnd = seeded(5);
    return Array.from({ length: 28 }, () => ({
      x: 2 + Math.floor(rnd() * (CASE.w - 4)),
      y: Math.floor(rnd() * (FLOOR - 12)),
      v: rnd() < 0.4 ? 2 + rnd() * 5 : 0,
    }));
  })();

  // タイトルに舞う胞子
  const MOTES = (() => {
    const rnd = seeded(9);
    return Array.from({ length: 30 }, (_, i) => ({
      x: rnd() * W,
      y: rnd() * H,
      v: 4 + rnd() * 8,
      ph: rnd() * 6.28,
      color: ['cream', 'silver', 'mist'][i % 3],
    }));
  })();

  // ===== 状態 =====
  const img = {}; // img[変種ID][段階]
  const sil = {}; // 図鑑で未発見の変種に出す影
  let scene = 'loading'; // loading, error, title, main, book
  let errorText = '';
  let report = null; // タイトルに出す「おかえり」 { ago, lines }
  let toast = null; // { text, color, until }
  let effects = [];
  let bookSel = 0;
  let bookNew = new Set(); // 今回図鑑を開いたときの新着
  let focus = 0; // キーボードで選んでいる操作
  let kbd = false; // キーボードで操作中（選択枠を出す）

  const backBtn = RA.backButton();
  const bookBtn = new RA.Button({ x: 188, y: 4, w: 64, h: 20, label: '図鑑' });
  const hourBtn = new RA.Button({ x: 72, y: 4, w: 54, h: 20, label: '+1時間' });
  const dayBtn = new RA.Button({ x: 130, y: 4, w: 54, h: 20, label: '+1日' });
  const dialBtns = DIAL_X.map((x) => [
    new RA.Button({ x: x + 3, y: PANEL_Y + 36, w: 36, h: 38, label: '－' }),
    new RA.Button({ x: x + 41, y: PANEL_Y + 36, w: 36, h: 38, label: '＋' }),
  ]);

  function say(text, color) {
    toast = { text, color: color || 'cream', until: performance.now() + TOAST_TIME };
  }

  // ===== 操作 =====
  // 開いているあいだに起きた変化を知らせる
  function notify(events) {
    if (!events.length) return;
    save();
    const first = events.some((e) => e.first);
    if (events.length > 1) {
      say(summary(events));
      if (first) snd.discover();
      else snd.grown();
      return;
    }
    const e = events[0];
    if (e.type === 'young') {
      say('芽が出た');
      snd.info();
    } else if (e.type === 'adult') {
      say('成菌になった！', 'gold');
      snd.grown();
    } else if (e.type === 'wilted') {
      say('しおれてしまった…', 'silver');
      snd.sad();
    } else if (first) {
      say('新しい乾燥標本！', 'gold');
      snd.discover();
    } else {
      say('乾燥標本になった', 'orange');
      snd.shelve();
    }
  }

  const sync = () => notify(tick());

  function tapPot(i, t) {
    sync();
    const pot = state.pots[i];
    const cx = POT_X[i];
    if (!pot) {
      state.pots[i] = newPot();
      effects.push({ kind: 'puff', cx, at: t });
      snd.plant();
      say('胞子をまいた');
    } else if (pot.stage === 'adult') {
      const v = BY_ID[pot.variant];
      const isNew = register(v.id, 'h');
      state.pots[i] = null;
      effects.push({ kind: 'pop', cx, at: t, im: img[v.id].adult });
      snd.harvest();
      if (isNew) {
        effects.push({ kind: 'stars', cx, at: t });
        snd.discover();
        say('新種！' + v.name, 'gold');
      } else {
        say(v.name + 'を採った');
      }
    } else if (pot.stage === 'dried') {
      state.pots[i] = null;
      snd.shelve();
      say('標本をしまった', 'orange');
    } else {
      const head = { spore: '胞子。芽が出るまで', young: '幼菌。育つまで', wilted: 'しおれた。標本まで' }[pot.stage];
      say(head + etaText((1 - pot.prog) / rateOf(pot.stage, state.env)), pot.stage === 'wilted' ? 'silver' : 'cream');
      if (pot.stage === 'wilted') snd.sad();
      else snd.info();
    }
    save();
  }

  function turn(k, d) {
    sync(); // 変える前の環境で、ここまでの時間を進めておく
    const lv = state.env[k] + d;
    if (!isLevel(lv)) return snd.limit();
    state.env[k] = lv;
    snd.dial(lv);
    save();
  }

  // デバッグ用の早送り（いまのつまみのまま hours 時間進める）
  function skip(hours) {
    sync();
    const events = advance(hours);
    const sum = summary(events);
    say((hours === 1 ? '+1時間' : '+1日') + (sum ? ' ' + sum : ''), 'pink');
    if (events.some((e) => e.first)) snd.discover();
    else snd.skip();
    save();
  }

  function start() {
    snd.start();
    scene = 'main';
    focus = MAIN_CONTROLS.findIndex((c) => c.row === 1);
    sync();
    save();
  }

  function openBook() {
    sync();
    bookNew = new Set(VARIANTS.filter((v) => book[v.id].n).map((v) => v.id));
    if (bookNew.size) {
      bookSel = VARIANTS.findIndex((v) => bookNew.has(v.id));
      VARIANTS.forEach((v) => (book[v.id].n = false));
      saveBook();
    }
    scene = 'book';
    focus = 1 + bookSel;
    snd.page();
  }

  function closeBook() {
    scene = 'main';
    focus = MAIN_CONTROLS.indexOf(BOOK_CONTROL);
    snd.page();
  }

  function selectEntry(i) {
    if (i !== bookSel) RA.sfx.blip();
    bookSel = i;
  }

  // ===== 入力 =====
  // 画面ごとの操作の一覧。row が同じものは ←→、隣の row へは ↑↓ で移る
  function control(btn, row, act) {
    return {
      x: btn.x,
      y: btn.y,
      w: btn.w,
      h: btn.h,
      row,
      act(t) {
        btn.flash(t);
        act(t);
      },
    };
  }

  const BOOK_CONTROL = control(bookBtn, 0, openBook);
  const MAIN_CONTROLS = [
    control(backBtn, 0, RA.goTop),
    ...(DEBUG ? [control(hourBtn, 0, () => skip(1)), control(dayBtn, 0, () => skip(24))] : []),
    BOOK_CONTROL,
    ...POT_X.map((cx, i) => ({ x: cx - 36, y: 54, w: 72, h: CASE.y + CASE.h - 54, row: 1, act: (t) => tapPot(i, t) })),
    ...dialBtns.flatMap(([minus, plus], k) => [control(minus, 2, () => turn(k, -1)), control(plus, 2, () => turn(k, 1))]),
  ];

  const GRID = { x: 8, y: 46, w: 46, h: 54, pitchX: 48, pitchY: 56 };
  const cellRect = (i) => ({ x: GRID.x + (i % 5) * GRID.pitchX, y: GRID.y + Math.floor(i / 5) * GRID.pitchY, w: GRID.w, h: GRID.h });
  const BOOK_CONTROLS = [
    control(backBtn, 0, closeBook),
    ...VARIANTS.map((v, i) => Object.assign(cellRect(i), { row: 1 + Math.floor(i / 5), entry: i, act: () => selectEntry(i) })),
  ];

  const controls = () => (scene === 'main' ? MAIN_CONTROLS : scene === 'book' ? BOOK_CONTROLS : null);

  function moveFocus(list, dx, dy) {
    const cur = list[focus];
    const mid = (c) => c.x + c.w / 2;
    let best = -1;
    let bestDist = Infinity;
    list.forEach((c, i) => {
      if (c.row !== cur.row + dy || i === focus) return;
      const d = mid(c) - mid(cur);
      if (dx && Math.sign(d) !== dx) return;
      if (Math.abs(d) < bestDist) {
        bestDist = Math.abs(d);
        best = i;
      }
    });
    if (best < 0) return;
    focus = best;
    if (list[best].entry != null) selectEntry(list[best].entry);
  }

  function onPress(ev) {
    kbd = false;
    if (scene === 'error') return location.reload();
    if (scene === 'title') {
      if (backBtn.hit(ev.x, ev.y)) return RA.goTop();
      return start();
    }
    const list = controls();
    if (!list) return;
    const i = list.findIndex((c) => ev.x >= c.x && ev.x < c.x + c.w && ev.y >= c.y && ev.y < c.y + c.h);
    if (i < 0) return;
    focus = i;
    list[i].act(ev.t);
  }

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  function onKey(ev) {
    const c = ev.code;
    const back = c === 'Escape' || c === 'Backspace';
    const ok = c === 'Space' || c === 'Enter';
    if (scene === 'error') {
      if (ok) location.reload();
      return;
    }
    if (scene === 'title') {
      if (back) RA.goTop();
      else if (ok) start();
      return;
    }
    const list = controls();
    if (!list) return;
    if (ARROWS[c]) {
      if (kbd) moveFocus(list, ARROWS[c][0], ARROWS[c][1]);
      kbd = true; // 最初の1回は選択枠を出すだけ
      return;
    }
    if (ok) {
      kbd = true;
      return list[focus].act(ev.t);
    }
    if (scene === 'book') {
      if (back || c === 'KeyZ') closeBook();
      return;
    }
    if (back) return RA.goTop();
    if (c === 'KeyZ') return openBook();
    const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(c);
    if (n >= 0) return tapPot(n, ev.t);
    if (DEBUG && c === 'KeyH') return skip(1);
    if (DEBUG && c === 'KeyD') return skip(24);
  }

  RA.bindInput(canvas, { press: onPress, key: onKey });

  // 閉じる・隠れるときに保存（次に開いたとき、この時刻から時間を進める）
  const persist = () => {
    if (scene === 'title' || scene === 'main' || scene === 'book') save();
  };
  document.addEventListener('visibilitychange', () => document.hidden && persist());
  window.addEventListener('pagehide', persist);

  // ===== 描画の部品 =====
  function rect(color, x, y, w, h) {
    ctx.fillStyle = P[color];
    ctx.fillRect(x, y, w, h);
  }

  function frame(color, x, y, w, h) {
    rect(color, x, y, w, 1);
    rect(color, x, y + h - 1, w, 1);
    rect(color, x, y, 1, h);
    rect(color, x + w - 1, y, 1, h);
  }

  // 絵を size×size の枠に、収まる最大の整数倍で、下端中央にそろえて描く
  function drawIn(im, x, y, size, dy) {
    let s = Math.floor(Math.min(size / im.width, size / im.height));
    if (s < 1) s = Math.min(size / im.width, size / im.height);
    const w = Math.round(im.width * s);
    const h = Math.round(im.height * s);
    ctx.drawImage(im, x + Math.round((size - w) / 2), y + size - h + (dy || 0), w, h);
  }

  function star(x, y, color) {
    rect(color, Math.round(x) - 1, Math.round(y), 3, 1);
    rect(color, Math.round(x), Math.round(y) - 1, 1, 3);
  }

  // つまみの小さな絵（8×10 ドット）
  function dialIcon(k, x, y) {
    if (k === HUM) {
      [1, 3, 5, 7, 7, 7, 5].forEach((w, i) => rect('cyan', x + 4 - Math.ceil(w / 2), y + 2 + i, w, 1));
      rect('white', x + 2, y + 5, 1, 2);
    } else if (k === TEMP) {
      rect('silver', x + 2, y, 3, 7);
      rect('red', x + 3, y + 3, 1, 4);
      rect('red', x + 1, y + 7, 5, 3);
      rect('orange', x + 2, y + 7, 1, 1);
    } else {
      rect('gold', x + 2, y + 3, 4, 4);
      rect('gold', x + 3, y, 2, 2);
      rect('gold', x + 3, y + 8, 2, 2);
      rect('gold', x, y + 4, 1, 2);
      rect('gold', x + 7, y + 4, 1, 2);
    }
  }

  function drawFocus(ts) {
    const list = controls();
    if (!kbd || !list || Math.floor(ts / 300) % 3 === 2) return;
    const c = list[focus];
    if (c.entry != null) return; // 図鑑の升目は選択中の枠で示す
    frame('gold', c.x - 2, c.y - 2, c.w + 4, c.h + 4);
  }

  // ===== 栽培室 =====
  function drawCase(ts) {
    const env = state.env;
    frame('silver', CASE.x - 1, CASE.y - 1, CASE.w + 2, CASE.h + 2);
    ctx.drawImage(walls[env[LIGHT]], CASE.x, CASE.y);
    if (env[TEMP] === 2) {
      ctx.drawImage(heat, CASE.x, CASE.y);
      for (let i = 0; i < 14; i++) {
        const x = CASE.x + 6 + ((i * 53) % (CASE.w - 12)) + Math.round(Math.sin(ts / 400 + i) * 1.5);
        const y = CASE.y + FLOOR - 2 - Math.floor(((ts / 1000) * (5 + (i % 4) * 3) + i * 17) % 70);
        rect(i % 3 ? 'orange' : 'red', x, y, 1, 1);
      }
    }
    if (env[HUM] === 2) ctx.drawImage(fog, CASE.x, CASE.y);
    const drops = [0, 10, 28][env[HUM]];
    for (let i = 0; i < drops; i++) {
      const d = DROPS[i];
      const y = CASE.y + 6 + (Math.floor(d.y + (ts / 1000) * d.v) % (FLOOR - 12));
      rect('white', CASE.x + d.x, y, 1, 1);
      rect('cyan', CASE.x + d.x, y + 1, 1, 2);
    }
    if (env[TEMP] === 0) ctx.drawImage(frost, CASE.x, CASE.y);
  }

  // 鉢の下のゲージ: 育つまで（緑）・しおれるまで（金）・乾くまで（灰）
  function gaugeOf(pot) {
    if (pot.stage === 'spore') return { v: pot.prog / 2, color: 'green' };
    if (pot.stage === 'young') return { v: (1 + pot.prog) / 2, color: 'green' };
    if (pot.stage === 'adult') return { v: 1 - pot.prog, color: 'gold' };
    if (pot.stage === 'wilted') return { v: pot.prog, color: 'mist' };
    return null;
  }

  function drawPot(i, ts) {
    const cx = POT_X[i];
    ctx.drawImage(bed, cx - 28, BED_Y);
    const pot = state.pots[i];
    if (!pot) return;
    drawIn(img[shownVariant(pot)][pot.stage], cx - BOX / 2, BED_Y + 2 - BOX, BOX);
    const g = gaugeOf(pot);
    if (g) {
      rect('ink', cx - 21, BED_Y + 4, 42, 4);
      rect(g.color, cx - 20, BED_Y + 5, Math.round(40 * Math.min(1, g.v)), 2);
    }
    // 採りごろの合図
    const ph = Math.floor(ts / 400) % 3;
    if (pot.stage === 'adult' && ph < 2) star(cx + 24, BED_Y - 54, ph ? 'gold' : 'white');
  }

  function drawEffects(ts) {
    effects = effects.filter((f) => ts - f.at < 700);
    effects.forEach((f) => {
      const el = Math.max(0, ts - f.at);
      if (f.kind === 'pop') {
        // 採ったキノコが跳ねて消える
        if (el > 350 && Math.floor(el / 60) % 2) return;
        drawIn(f.im, f.cx - BOX / 2, BED_Y + 2 - BOX, BOX, -Math.round(el / 25));
      } else if (f.kind === 'puff') {
        // 胞子が菌床に降りる
        for (let k = 0; k < 7; k++) {
          const y = BED_Y - 34 + ((k * 7) % 9) + Math.round((el / 500) * 32);
          if (y < BED_Y) rect(k % 2 ? 'cream' : 'silver', f.cx - 15 + k * 5, y, 1, 1);
        }
      } else if (f.kind === 'stars') {
        const r = 12 + el * 0.06;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          star(f.cx + Math.cos(a) * r * 1.4, 88 + Math.sin(a) * r, el < 350 ? 'white' : 'gold');
        }
      }
    });
  }

  function drawMessage(ts) {
    let text = null;
    let color = 'silver';
    if (toast && performance.now() < toast.until) {
      text = toast.text;
      color = toast.color;
    } else if (!state.pots.some(Boolean)) {
      if (Math.floor(ts / 600) % 3 < 2) text = '鉢をタップして胞子をまこう';
      color = 'cream';
    } else {
      text = '育ち ' + speedText() + '　持ち ' + keepText();
    }
    if (text) RA.text(ctx, text, 128, MSG_Y, { color, align: 'center', outline: 'ink' });
  }

  function drawDial(k, ts) {
    const d = DIALS[k];
    const x = DIAL_X[k];
    const lv = state.env[k];
    rect('dusk', x, PANEL_Y, 80, 78);
    rect('ink', x + 1, PANEL_Y + 1, 78, 76);
    dialIcon(k, x + 5, PANEL_Y + 6);
    RA.text(ctx, d.name, x + 16, PANEL_Y + 2, { color: 'silver' });
    RA.text(ctx, d.levels[lv], x + 75, PANEL_Y + 2, { color: d.color, align: 'right' });
    for (let i = 0; i < 3; i++) rect(i <= lv ? d.color : 'night', x + 6 + i * 23, PANEL_Y + 24, 21, 6);
    dialBtns[k][0].draw(ctx, ts);
    dialBtns[k][1].draw(ctx, ts);
  }

  function drawMain(ts) {
    rect('ink', 0, 0, W, H);
    drawCase(ts);
    for (let i = 0; i < POTS; i++) drawPot(i, ts);
    drawEffects(ts);
    state.pots.forEach((pot, i) => {
      const label = pot ? STAGE_NAME[pot.stage] : '空き';
      RA.text(ctx, label, POT_X[i], LABEL_Y, { color: pot ? STAGE_COLOR[pot.stage] : 'mist', align: 'center', outline: 'ink' });
    });
    drawMessage(ts);
    backBtn.draw(ctx, ts);
    bookBtn.draw(ctx, ts);
    if (VARIANTS.some((v) => book[v.id].n) && Math.floor(ts / 400) % 2 === 0) rect('pink', bookBtn.x + bookBtn.w - 7, bookBtn.y + 3, 3, 3);
    if (DEBUG) {
      hourBtn.draw(ctx, ts);
      dayBtn.draw(ctx, ts);
    } else {
      RA.text(ctx, '菌糸ライフ', 128, 5, { color: 'green', align: 'center' });
    }
    for (let k = 0; k < 3; k++) drawDial(k, ts);
    drawFocus(ts);
  }

  // ===== 図鑑 =====
  const isFound = (e) => e.h > 0 || e.d > 0;

  function drawCell(i, ts) {
    const r = cellRect(i);
    const v = VARIANTS[i];
    const e = book[v.id];
    const on = i === bookSel;
    rect(on ? 'gold' : 'dusk', r.x, r.y, r.w, r.h);
    rect(on ? 'night' : 'ink', r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    const im = e.h ? img[v.id].adult : e.d ? img[v.id].dried : sil[v.id];
    if (im) drawIn(im, r.x + 7, r.y + 2, 32);
    else RA.text(ctx, '？', r.x + 23, r.y + 10, { color: 'mist', align: 'center' });
    RA.text(ctx, '採', r.x + 6, r.y + 35, { color: e.h ? 'gold' : 'dusk' });
    RA.text(ctx, '標', r.x + 24, r.y + 35, { color: e.d ? 'orange' : 'dusk' });
    if (bookNew.has(v.id) && Math.floor(ts / 300) % 2 === 0) RA.text(ctx, 'NEW', r.x + 2, r.y + 3, { font: 'en', color: 'pink', outline: 'ink' });
  }

  function drawEntry(i) {
    const v = VARIANTS[i];
    const e = book[v.id];
    const y = 162;
    rect('dusk', 4, y, W - 8, 76);
    rect('ink', 5, y + 1, W - 10, 74);
    if (e.h) drawIn(img[v.id].adult, 10, y + 4, 32);
    else if (sil[v.id]) drawIn(sil[v.id], 10, y + 4, 32);
    if (e.d) drawIn(img[v.id].dried, 10, y + 38, 32);
    RA.text(ctx, 'No.' + String(i + 1).padStart(2, '0'), 50, y + 6, { font: 'en', color: 'mist' });
    if (!isFound(e)) {
      RA.text(ctx, '？？？', 92, y + 2, { color: 'mist' });
      RA.text(ctx, 'まだ見つかっていない。', 50, y + 28, { color: 'mist' });
      return;
    }
    RA.text(ctx, v.name, 92, y + 2, { color: 'gold' });
    RA.text(ctx, v.text[0], 50, y + 20, { color: 'cream' });
    RA.text(ctx, v.text[1], 50, y + 38, { color: 'cream' });
    RA.text(ctx, '採取 ' + e.h + '　標本 ' + e.d, 50, y + 56, { color: 'silver' });
  }

  function statsText() {
    const n = VARIANTS.length;
    const found = VARIANTS.filter((v) => isFound(book[v.id])).length;
    const dried = VARIANTS.filter((v) => book[v.id].d > 0).length;
    return '発見 ' + found + '／' + n + '　標本 ' + dried + '／' + n;
  }

  function drawBook(ts) {
    rect('night', 0, 0, W, H);
    backBtn.draw(ctx, ts);
    RA.text(ctx, '菌糸図鑑', 128, 5, { color: 'green', align: 'center' });
    RA.text(ctx, statsText(), 128, 26, { color: 'silver', align: 'center' });
    for (let i = 0; i < VARIANTS.length; i++) drawCell(i, ts);
    drawEntry(bookSel);
    drawFocus(ts);
  }

  // ===== タイトル =====
  function makeReport(ms, events) {
    const n = finals(events);
    const lines = [];
    if (n.young) lines.push(['芽が出た', n.young]);
    if (n.adult) lines.push(['成菌になった', n.adult]);
    if (n.wilted) lines.push(['しおれた', n.wilted]);
    if (n.dried) lines.push(['乾燥標本になった', n.dried]);
    if (events.some((e) => e.first)) lines.push(['図鑑に新しい標本！', 0]);
    if (!lines.length) lines.push([state.pots.some(Boolean) ? 'すくすく育っている' : '鉢はからっぽのまま', 0]);
    return { ago: agoText(ms), lines: lines.slice(-4) };
  }

  function drawTitle(ts) {
    rect('night', 0, 0, W, H);
    MOTES.forEach((m) => {
      const y = (((m.y - (ts / 1000) * m.v) % H) + H) % H;
      rect(m.color, Math.round(m.x + Math.sin(ts / 900 + m.ph) * 3), Math.round(y), 1, 1);
    });
    backBtn.draw(ctx, ts);
    if (DEBUG) RA.text(ctx, 'DEBUG', 250, 10, { font: 'en', color: 'pink', align: 'right' });
    RA.text(ctx, '菌糸ライフ', 130, 26, { size: 32, color: 'green', align: 'center' });
    RA.text(ctx, '菌糸ライフ', 128, 24, { size: 32, color: 'cream', align: 'center', outline: 'ink' });
    if (report) {
      rect('dusk', 20, 70, W - 40, 100);
      rect('ink', 21, 71, W - 42, 98);
      RA.text(ctx, 'おかえり。' + report.ago, 128, 74, { color: 'gold', align: 'center' });
      report.lines.forEach(([label, num], k) => {
        RA.text(ctx, label, 32, 96 + k * 18, { color: 'cream' });
        if (num) RA.text(ctx, num + '鉢', W - 32, 96 + k * 18, { color: 'silver', align: 'right' });
      });
    } else {
      drawIn(img.plain.adult, 80, 70, 96);
    }
    RA.text(ctx, statsText(), 128, 174, { color: 'silver', align: 'center' });
    if (Math.floor(ts / 500) % 2 === 0) {
      RA.text(ctx, MOBILE ? 'タップではじめる' : 'クリック／スペースではじめる', 128, 196, { color: 'cream', align: 'center' });
    }
    if (!MOBILE) {
      RA.text(ctx, 'ARROWS+SPACE:SELECT  ESC:TOP', 128, 220, { font: 'en', color: 'mist', align: 'center' });
      RA.text(ctx, '1-3:POTS  Z:BOOK', 128, 230, { font: 'en', color: 'mist', align: 'center' });
    }
  }

  function drawLoading(ts) {
    rect('ink', 0, 0, W, H);
    const dots = '...'.slice(0, Math.floor(ts / 300) % 4);
    RA.text(ctx, 'よみこみちゅう' + dots, 72, 112, { color: 'silver' });
  }

  function drawError() {
    rect('ink', 0, 0, W, H);
    RA.text(ctx, '絵を読み込めませんでした', 128, 96, { color: 'red', align: 'center' });
    RA.text(ctx, errorText, 128, 120, { font: 'en', color: 'silver', align: 'center' });
    RA.text(ctx, 'タップで読み込み直す', 128, 140, { color: 'cream', align: 'center' });
  }

  function draw(ts) {
    if (scene === 'loading') drawLoading(ts);
    else if (scene === 'error') drawError();
    else if (scene === 'title') drawTitle(ts);
    else if (scene === 'book') drawBook(ts);
    else drawMain(ts);
  }

  RA.loop((ts) => {
    if (scene === 'main' || scene === 'book') {
      notify(tick());
      if (performance.now() - savedAt > SAVE_EVERY) save();
    }
    draw(ts);
  });

  // ===== 読み込み =====
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        const decoded = im.decode ? im.decode().catch(() => {}) : Promise.resolve();
        decoded.then(() => resolve(im));
      };
      im.onerror = () => reject(new Error(src));
      im.src = src;
    });
  }

  // 絵の形だけを1色で塗った影（半透明の点は、しきい値で有り無しに分ける）
  function silhouette(im, color) {
    const c = makeCanvas(im.width, im.height);
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    const [r, gr, b] = RA.rgb(color);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = r;
      d.data[i + 1] = gr;
      d.data[i + 2] = b;
      d.data[i + 3] = d.data[i + 3] >= 128 ? 255 : 0;
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  const CHARS =
    '菌糸ライフ図鑑発見標本採取もどるタップではじめるクリック／スペースおかえり。分時間日ぶり' +
    '芽が出た成菌になったしおれた乾燥標本！すくすく育っている鉢はからっぽのまま胞子幼菌空き' +
    'まいた新種を採ったしまった芽が出るまで育つまで約てしまった…育ち持ち速い遅いふつう長い短い' +
    'タップして胞子をまこう湿度温度光低中高暗明－＋まだ見つかっていない？' +
    'よみこちゅう絵を読み込めませんでした直す' +
    VARIANTS.map((v) => v.name + v.text.join('')).join('');

  const jobs = [];
  VARIANTS.forEach((v) => {
    img[v.id] = {};
    STAGES.forEach((st) => jobs.push(loadImage('assets/' + v.id + '-' + st + '.png').then((im) => (img[v.id][st] = im))));
  });

  Promise.all([...jobs, RA.textReady(CHARS)])
    .then(() => {
      VARIANTS.forEach((v) => {
        try {
          sil[v.id] = silhouette(img[v.id].adult, 'dusk');
        } catch (e) {
          sil[v.id] = null; // file:// で開いたときなど、絵の画素を読めない環境では「？」を出す
        }
      });
      const away = Date.now() - state.last;
      const events = tick();
      if (saved && (away >= REPORT_MIN * 60000 || events.length)) report = makeReport(away, events);
      save();
      scene = 'title';
    })
    .catch((err) => {
      errorText = err.message;
      scene = 'error';
    });
})();
