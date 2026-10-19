/*
 * 菌糸ライフ — キノコを育てて図鑑を埋める、のんびり育成ゲーム。
 *
 * 栽培ケースに鉢が3つ。空いた鉢をタップすると胞子をまき、
 *   胞子 → 幼菌 → 成菌（タップで収穫）→ しおれ → 乾燥標本（自動で図鑑に載る）
 * と育つ。湿度・温度・光の3つのつまみで、育つ速さ・しおれるまでの長さ・変種が変わる。
 * 変種は「胞子と幼菌のあいだ、どの環境にどれだけいたか」で決まる。条件は画面には出さない。
 * ケースの湿度・温度は、つまみに季節（現実の日付）と名古屋の実際の気温・湿度が少し加わったものになる。
 * 名古屋に台風・猛暑・長雨・初霜が来ているあいだは、それぞれ特別な変種が出やすくなる（天気は shared/weather.js）。
 * トップページのういろう屋のクイズでもらう「ういろう肥料」を育ち途中の鉢に使うと、その株はレアな変種になりやすい。
 * 時間は実時間で進む。閉じていたあいだの分は、開いたときに前回の時刻からまとめて進める。
 * URL に ?debug=1 を付けたときだけ、早送りと、季節・天候を切り替えるボタンを出す。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;
  const WX = RA.Weather;

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
  const WX_EFFECT = 0.15; // 名古屋の気温・湿度が平年からずれたとき、ケースを動かす最大の幅（つまみ1段＝1）
  const EVENT_ODDS = [0.6, 0.25]; // 天候イベントの中だけで育った鉢が、その変種になる確率（未発見・発見済み）
  const WILD_RATE = 0.7; // 台風のあいだ、空き鉢1つに1時間あたり胞子が飛んでくる回数の見込み
  const WEATHER_WAIT = 4000; // 開いたとき、留守の分を進める前に天気の取得を待つ上限（ミリ秒）
  // ういろう肥料（所持数はトップページと共通。shared/fertilizer.js）。レア＝季節限定と天候イベントの変種（図鑑の2ページ目）
  const FERT_BOOST = 3; // 肥料を使った株の、レアの出やすさの倍率（天候イベントの変種のくじと、下の FERT_LUCK に掛ける。確率は1まで）
  const FERT_LUCK = 0.05; // 肥料を使った株が、条件に関係なく「成菌になったときの季節」の季節限定になる確率のもと（× FERT_BOOST）
  const LUCK_SALT = 8; // 肥料のくじに使う、鉢ごとのくじの番号（0〜3 は天候イベントのくじ）

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

  // 季節（期間は shared/weather.js）。hum・temp は季節によるケースの湿度・温度のずれ（つまみ1段＝1）
  const SEASON_FX = {
    spring: { hum: 0, temp: 0, color: 'pink' },
    rainy: { hum: 0.5, temp: 0.25, color: 'cyan' },
    summer: { hum: 0.25, temp: 0.5, color: 'gold' },
    autumn: { hum: -0.25, temp: 0, color: 'orange' },
    winter: { hum: -0.5, temp: -0.5, color: 'white' },
  };
  const SEASONS = WX.SEASONS.map((s) => Object.assign({}, SEASON_FX[s.id], s));

  // 天候イベント（判定は shared/weather.js）。並び＝空模様と環境音で優先する順
  const EVENTS = [
    { id: 'typhoon', name: '台風', color: 'cyan', hello: '台風だ。胞子が飛んでくる' },
    { id: 'heat', name: '猛暑', color: 'red', hello: '猛暑だ。陽炎がゆらめく' },
    { id: 'rain3', name: '長雨', color: 'green', hello: '長雨だ。菌がざわめく' },
    { id: 'frost', name: '初霜', color: 'white', hello: '初霜だ。霜の気配がする' },
  ];
  const EV = Object.fromEntries(EVENTS.map((e, k) => [e.id, k]));
  // 図鑑に「見つけたときの天候」として記録するもの（並び＝ビットの順）。イベントがなければ「雨」か「ふだん」
  const WEATHERS = [{ id: 'calm', name: 'ふだん', color: 'cream' }, { id: 'rain', name: '雨', color: 'silver' }, ...EVENTS];

  // 変種。並び順＝図鑑の番号。絵は assets/<id>-<段階>.png（段階は STAGES）
  //   season … その季節にしか出ない  event … その天候イベントのあいだだけ出る
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
    { id: 'haze', name: 'ハルガスミダケ', season: 'spring', text: ['霞のような胞子を', '春風にまかせる。'] },
    { id: 'shelter', name: 'アマヤドリダケ', season: 'rainy', text: ['大きな傘の下で', '誰かを待っている。'] },
    { id: 'squall', name: 'ユウダチダケ', season: 'summer', text: ['ひと雨ごとに', '背が伸びるという。'] },
    { id: 'crisp', name: 'アキバレダケ', season: 'autumn', text: ['からりと乾いた', '高い空が好き。'] },
    { id: 'cozy', name: 'コタツダケ', season: 'winter', text: ['一度もぐると', 'なかなか出てこない。'] },
    { id: 'gale', name: 'ノワキダケ', event: 'typhoon', text: ['嵐の夜にだけ', 'どこからか飛んでくる。'] },
    { id: 'shimmer', name: 'カゲロウダケ', event: 'heat', text: ['陽炎の向こうで', 'ゆらゆら揺れている。'] },
    { id: 'gaze', name: 'ナガメダケ', event: 'rain3', text: ['降りつづく雨を', 'じっと眺めている。'] },
    { id: 'frost', name: 'ハツシモダケ', event: 'frost', text: ['霜の降りた朝、', '音もなく立っている。'] },
  ];
  const BY_ID = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

  // ===== ケースの中の状態 =====
  // つまみの段階（0〜2 の整数）に、季節と天気のずれを足した実数（0〜2）。光には足さない
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function effective(env, cond) {
    return [clamp(env[HUM] + cond.shift[0], 0, 2), clamp(env[TEMP] + cond.shift[1], 0, 2), env[LIGHT]];
  }

  // 実数の状態を、両どなりの段階への割り振りにする（1.25 なら 中0.75・高0.25）
  function split(e) {
    const w = [0, 0, 0];
    const lo = Math.min(1, Math.floor(e));
    w[lo] = lo + 1 - e;
    w[lo + 1] = e - lo;
    return w;
  }

  // 実数の状態を 0 低・1 中・2 高 に分ける（変種の判定と同じ境目）
  const levelOf = (e) => (e < 2 / 3 ? 0 : e > 4 / 3 ? 2 : 1);

  // 鉢ごとのくじ。seed と salt で決まる 0〜1
  function roll(seed, salt) {
    let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  const newSeed = () => Math.floor(Math.random() * 4294967296) >>> 0;

  const isRare = (id) => !!(BY_ID[id].season || BY_ID[id].event);

  /*
   * 変種を決める。pot.exp[つまみ][段階] は、胞子・幼菌のあいだにその段階にいた時間（季節と天気を足した実際の状態で数える）。
   * pot.ev[イベント] は、そのあいだ天候イベントの中にいた時間。cond はそのときの季節と天気、eff はそのときの状態。
   * まだ時間がたっていなければ、いまの状態で見立てる（胞子・幼菌の絵はこの見立てで出す）。
   * ここが出現条件のすべて。ゲーム内では見せない（README の「ネタバレ」に同じ表がある）。
   */
  function decide(pot, eff, cond) {
    const id = byCondition(pot, eff, cond);
    if (!pot.fert || isRare(id)) return id;
    // ういろう肥料のまぐれ。鉢ごとのくじで、そのときの季節の季節限定になる
    const lucky = VARIANTS.find((v) => v.season === SEASONS[cond.season].id);
    return lucky && roll(pot.seed, LUCK_SALT) < Math.min(1, FERT_LUCK * FERT_BOOST) ? lucky.id : id;
  }

  function byCondition(pot, eff, cond) {
    if (pot.wild) return pot.wild; // 台風で飛んできた胞子は、何になるか決まっている
    const exp = pot.exp;
    const total = exp[HUM][0] + exp[HUM][1] + exp[HUM][2];
    // 天候イベントの変種。イベントの中で育った割合に応じた確率で、鉢ごとのくじで決まる（ノワキダケは飛んでくる胞子からだけ）。
    // ういろう肥料を使った株は、その確率が FERT_BOOST 倍
    const boost = pot.fert ? FERT_BOOST : 1;
    for (const v of VARIANTS) {
      const k = EV[v.event];
      if (k == null || k === EV.typhoon) continue;
      const share = total > 0 ? pot.ev[k] / total : cond.events[k] ? 1 : 0;
      if (roll(pot.seed, k) < share * Math.min(1, EVENT_ODDS[isFound(book[v.id]) ? 1 : 0] * boost)) return v.id;
    }
    const share = (k, lv) => (total > 0 ? exp[k][lv] / total : split(eff[k])[lv]);
    if (share(TEMP, 0) >= SWING && share(TEMP, 2) >= SWING) return 'twotone'; // 寒暖差
    if (share(LIGHT, 0) >= SWING && share(LIGHT, 2) >= SWING) return 'blink'; // 明暗の行き来
    // 時間で平均して 0 低・1 中・2 高 に分ける
    const level = (k) => levelOf(share(k, 1) + share(k, 2) * 2);
    const h = level(HUM);
    const t = level(TEMP);
    const l = level(LIGHT);
    // 季節限定（そのときの季節のものだけ）
    const season = SEASONS[cond.season].id;
    if (season === 'spring' && h === 1 && t === 1 && l === 2) return 'haze';
    if (season === 'rainy' && h === 2 && l === 0) return 'shelter';
    if (season === 'summer' && h === 2 && t === 2) return 'squall';
    if (season === 'autumn' && h === 0 && t === 0 && l === 1) return 'crisp';
    if (season === 'winter' && h === 0 && t === 2 && l === 0) return 'cozy';
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
  //   鉢: { stage, prog: その段階の進み(0〜1), exp: 育つあいだの環境の記録, ev: 育つあいだ各イベントの中にいた時間,
  //         seed: 鉢ごとのくじの種, wild: 台風で飛んできた胞子の変種 or null, fert: ういろう肥料を使ったか, variant: 成菌で決まる変種 }
  // book: { 変種ID: { h: 採取した数, d: 乾燥標本の数, n: 図鑑で未確認の新着, s: 見つけた季節, w: 見つけた天候 } }
  //   s・w はビットの集まり（並びは SEASONS・WEATHERS）。前の版の記録には無いので 0 から始まる
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
  const bits = (v, n) => (Number.isInteger(v) && v > 0 ? v & ((1 << n) - 1) : 0);

  function cleanPot(p) {
    if (!p || STAGES.indexOf(p.stage) < 0 || !isTime(p.prog) || p.prog > 1) return null;
    if (!Array.isArray(p.exp) || p.exp.length !== 3) return null;
    if (!p.exp.every((row) => Array.isArray(row) && row.length === 3 && row.every(isTime))) return null;
    const growing = p.stage === 'spore' || p.stage === 'young';
    if (!growing && !BY_ID[p.variant]) return null;
    return {
      stage: p.stage,
      prog: p.prog,
      exp: p.exp.map((row) => row.slice()),
      ev: Array.isArray(p.ev) && p.ev.length === EVENTS.length && p.ev.every(isTime) ? p.ev.slice() : EVENTS.map(() => 0),
      seed: Number.isInteger(p.seed) && p.seed >= 0 ? p.seed >>> 0 : newSeed(),
      wild: growing && BY_ID[p.wild] ? p.wild : null,
      fert: growing && p.fert === true,
      variant: growing ? null : p.variant,
    };
  }

  function loadState() {
    const s = readJSON(KEY_STATE);
    if (!s || !isTime(s.last) || !Array.isArray(s.env) || s.env.length !== 3 || !s.env.every(isLevel) || !Array.isArray(s.pots)) return null;
    const pots = [];
    for (let i = 0; i < POTS; i++) pots.push(cleanPot(s.pots[i]));
    return { last: s.last, env: s.env.slice(), pots };
  }

  // 前の版の図鑑（h・d・n だけ）もそのまま読める。増えた変種は空の記録から始まる
  function loadBook() {
    const b = readJSON(KEY_BOOK) || {};
    const out = {};
    VARIANTS.forEach((v) => {
      const e = b[v.id] || {};
      out[v.id] = { h: count(e.h), d: count(e.d), n: e.n === true, s: bits(e.s, SEASONS.length), w: bits(e.w, WEATHERS.length) };
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

  const isFound = (e) => e.h > 0 || e.d > 0;

  // 図鑑に付ける天候。イベントがあればそれを、なければ雨かふだん（天気のわからない時間は付けない）
  function weatherBits(cond) {
    let b = 0;
    cond.events.forEach((on, k) => {
      if (on) b |= 1 << (2 + k);
    });
    if (!b && cond.rec) b = 1 << (cond.rec.now.p > 0 ? 1 : 0);
    return b;
  }

  // 図鑑に記録する。kind は 'h'（採取）か 'd'（乾燥標本）、cond はそのときの季節と天気。初めて見つけた変種なら true
  function register(id, kind, cond) {
    const e = book[id];
    const isNew = !isFound(e);
    e[kind]++;
    if (e[kind] === 1) e.n = true;
    e.s |= 1 << cond.season;
    e.w |= weatherBits(cond);
    saveBook();
    return isNew;
  }

  // ===== 季節と天気 =====
  let wx = WX.load(); // いちばん新しい天気の記録
  let wxPrev = null; // ひとつ前の記録（閉じていたあいだを進めるとき、その時刻に有効だったほうを使う）
  let fetching = null;
  let debugSeason = -1; // デバッグで固定した季節（-1 は日付どおり）
  let debugEvent = -1; // デバッグで固定した天候（-1 は実際の天気どおり、0 はなし、1〜 は EVENTS の番号＋1）

  /*
   * 時刻 t の季節と天気。{ season, rec, events, shift }
   *   rec    … その時刻に有効な「いま」の天気の記録（取得から3時間。なければ null）
   *   events … イベントごとに起きているか（台風・猛暑は rec から、長雨・初霜はその日の記録から）
   *   shift  … ケースの [湿度, 温度] のずれ。季節のずれに、名古屋の気温・湿度が平年からずれたぶんを少し足す
   */
  function condAt(t) {
    const season = debugSeason >= 0 ? debugSeason : WX.seasonAt(t);
    const rec = [wx, wxPrev].find((r) => r && r.at <= t && t < r.at + WX.VALID) || null;
    const date = WX.jst(t).date;
    const day = (wx && WX.dayEvents(wx, date)) || (wxPrev && WX.dayEvents(wxPrev, date)) || {};
    const now = rec ? WX.nowEvents(rec) : {};
    const events = EVENTS.map((e, k) => (debugEvent >= 0 ? debugEvent === k + 1 : !!(now[e.id] || day[e.id])));
    const shift = [SEASONS[season].hum, SEASONS[season].temp];
    if (rec) {
      const n = WX.NORMAL[season];
      shift[0] += clamp((rec.now.rh - n.rh) / 150, -WX_EFFECT, WX_EFFECT);
      shift[1] += clamp((rec.now.t - n.t) / 40, -WX_EFFECT, WX_EFFECT);
    }
    return { season, rec, events, shift };
  }

  // 起きているイベントのうち先頭のもの（EVENTS の番号。なければ -1）
  const topEvent = (cond) => cond.events.indexOf(true);

  // 1時間たっていれば天気を取りに行く。届いたら記録を差し替える
  function checkWeather() {
    if (!fetching && WX.due(wx, Date.now())) {
      fetching = WX.update(Date.now()).then((rec) => {
        wxPrev = wx;
        wx = rec;
        fetching = null;
      });
    }
    return fetching;
  }

  let world = condAt(Date.now()); // いまの季節と天気（毎フレーム作り直す）
  const worldEff = () => effective(state.env, world);

  // ===== 時間の進み =====
  // 段階ごとの倍率の表 tab から、状態 eff での倍率（段階のあいだは直線でつなぐ）
  const product = (tab, eff) => [0, 1, 2].reduce((acc, k) => acc * split(eff[k]).reduce((s, w, lv) => s + w * tab[k][lv], 0), 1);

  // その段階が1時間に進む割合（1 で次の段階）
  function rateOf(stage, eff) {
    if (stage === 'spore' || stage === 'young') return product(GROW, eff) / STAGE_HOURS;
    if (stage === 'adult') return 1 / (FRESH_HOURS * product(KEEP, eff));
    if (stage === 'wilted') return 1 / (DRY_HOURS * product(KEEP, eff));
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
      ev: EVENTS.map(() => 0),
      seed: newSeed(),
      wild: null,
      fert: false,
      variant: null,
    };
  }

  // 台風で飛んでくる胞子の種類。ノワキダケが多く、まだ見つけていない変種も来やすい。
  // ヘイボンダケと、ほかの季節・天候の変種は来ない
  function pickWild(season) {
    const pool = VARIANTS.filter((v) => v.id !== 'plain' && (v.event ? v.event === 'typhoon' : !v.season || v.season === SEASONS[season].id));
    const weight = (v) => (v.event ? 5 : 1) * (isFound(book[v.id]) ? 1 : 2);
    let r = Math.random() * pool.reduce((s, v) => s + weight(v), 0);
    for (const v of pool) {
      r -= weight(v);
      if (r < 0) return v.id;
    }
    return pool[pool.length - 1].id;
  }

  // 鉢 i を、季節と天気 cond（状態 eff）のもとで hours 時間進める。段階が変わるたびに events に積む（途中で何段階進んでもよい）。
  // 空き鉢には、台風のあいだ胞子が飛んでくることがある
  function grow(i, hours, cond, eff, events) {
    let left = hours;
    if (!state.pots[i]) {
      if (!cond.events[EV.typhoon]) return;
      const wait = -Math.log(1 - Math.random()) / WILD_RATE; // 次に飛んでくるまでの時間
      if (wait >= left) return;
      left -= wait;
      state.pots[i] = Object.assign(newPot(), { wild: pickWild(cond.season) });
      events.push({ type: 'wild', pot: i, id: state.pots[i].wild, cond, first: false });
    }
    const pot = state.pots[i];
    while (left > 0) {
      const rate = rateOf(pot.stage, eff);
      if (!rate) break;
      const need = (1 - pot.prog) / rate;
      const dt = Math.min(left, need);
      if (pot.stage === 'spore' || pot.stage === 'young') {
        for (let k = 0; k < 3; k++) split(eff[k]).forEach((w, lv) => (pot.exp[k][lv] += dt * w));
        cond.events.forEach((on, k) => on && (pot.ev[k] += dt));
      }
      if (dt < need) {
        pot.prog += dt * rate;
        break;
      }
      left -= need;
      pot.prog = 0;
      pot.stage = NEXT[pot.stage];
      if (pot.stage === 'adult') pot.variant = decide(pot, eff, cond);
      events.push({ type: pot.stage, pot: i, id: pot.variant, cond, first: false });
    }
  }

  // すべての鉢を、季節と天気 cond のもとで hours 時間進める。乾燥標本になったものはその場で図鑑に載せる
  function advance(hours, cond) {
    const eff = effective(state.env, cond);
    const events = [];
    for (let i = 0; i < POTS; i++) grow(i, hours, cond, eff, events);
    events.forEach((e) => {
      if (e.type === 'dried') e.first = register(e.id, 'd', e.cond);
    });
    return events;
  }

  // t のあとで、季節や天気の効き方が変わる最初の時刻（日本時間の0時か、天気の記録の始まり・終わり）
  function nextChange(t) {
    let next = WX.nextMidnight(t);
    [wx, wxPrev].forEach((r) => {
      if (r) [r.at, r.at + WX.VALID].forEach((b) => b > t && b < next && (next = b));
    });
    return next;
  }

  // 前回から今までの実時間を進める（時計が戻っていたら進めない）。区切りごとに、その時刻の季節と天気で進める
  function tick() {
    const now = Date.now();
    const events = [];
    for (let t = state.last; t < now; ) {
      const end = Math.min(now, nextChange(t));
      events.push(...advance((end - t) / HOUR_MS, condAt(t)));
      t = end;
    }
    state.last = now;
    return events;
  }

  // 鉢ごとの最後の変化を数える（留守のあいだに成菌→しおれ と進んだ鉢は「しおれ」だけ数える）
  function finals(events) {
    const last = {};
    events.forEach((e) => (last[e.pot] = e.type));
    const n = { wild: 0, young: 0, adult: 0, wilted: 0, dried: 0 };
    Object.keys(last).forEach((k) => n[last[k]]++);
    return n;
  }

  // 「成菌2・標本1」のような一行のまとめ
  function summary(events) {
    const n = finals(events);
    return [
      ['wild', '飛来'],
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
    const g = product(GROW, worldEff());
    return g >= 1.2 ? '速い' : g <= 0.8 ? '遅い' : 'ふつう';
  };
  const keepText = () => {
    const k = product(KEEP, worldEff());
    return k >= 1.3 ? '長い' : k <= 0.75 ? '短い' : 'ふつう';
  };

  // 胞子・幼菌はまだ変種が決まっていないので、いまの見立てで絵を出す
  const shownVariant = (pot) => pot.variant || decide(pot, worldEff(), world);

  // 図鑑で、まだ見つけていない季節・天候の変種に出す手がかり
  function hintOf(v) {
    if (v.season) return SEASONS.find((s) => s.id === v.season).name + 'にだけ出るらしい。';
    if (v.event === 'typhoon') return '台風に乗ってくるらしい。';
    if (v.event) return EVENTS[EV[v.event]].name + 'の日に出るらしい。';
    return null;
  }

  // ===== 効果音 =====
  const A = RA.Audio;

  // ミンミンゼミ（ミーン、ミンミンミン、ミー）
  function cicada(vol) {
    A.tone({ f: 2900, f2: 3400, dur: 0.6, type: 'square', vol, attack: 0.25 });
    for (let i = 0; i < 4; i++) A.tone({ f: 3300, f2: 2900, dur: 0.16, type: 'square', vol, at: 0.65 + i * 0.2, attack: 0.03 });
    A.tone({ f: 3200, f2: 2600, dur: 0.7, type: 'square', vol: vol * 0.8, at: 1.5, attack: 0.05 });
  }

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
    // 風に乗って胞子が飛んできた「ヒュウッ」
    wild() {
      A.noise({ dur: 0.5, vol: 0.18, filter: 'bandpass', f: 400, f2: 2400, q: 1.2, attack: 0.15 });
      A.tone({ f: 1319, dur: 0.08, type: 'triangle', vol: 0.1, at: 0.35 });
      A.tone({ f: 1760, dur: 0.16, type: 'triangle', vol: 0.1, at: 0.43 });
    },
    // 天候イベントが来た合図
    weather(id) {
      if (id === 'typhoon') A.noise({ dur: 1.4, vol: 0.22, filter: 'bandpass', f: 180, f2: 1200, q: 0.9, attack: 0.5 });
      else if (id === 'heat') cicada(0.05);
      else if (id === 'rain3') {
        A.melody(
          [
            [1568, 0.09],
            [1175, 0.09],
            [1319, 0.09],
            [988, 0.2],
          ],
          { type: 'triangle', vol: 0.09 }
        );
      } else [2093, 2637, 3136, 4186].forEach((f, i) => A.tone({ f, dur: 0.3, type: 'triangle', vol: 0.06, at: i * 0.07 }));
    },
    gone() {
      A.tone({ f: 523, f2: 392, dur: 0.3, type: 'triangle', vol: 0.08 });
    },
    // 遠くで鳴る雷
    thunder() {
      A.noise({ dur: 1.6, vol: 0.3, filter: 'lowpass', f: 500, f2: 70, attack: 0.02, at: 0.3 + Math.random() * 0.6 });
    },
    // ういろう肥料をまく「サラサラ、キラン」
    feed() {
      A.noise({ dur: 0.3, vol: 0.16, filter: 'highpass', f: 3000, attack: 0.05 });
      A.tone({ f: 1568, dur: 0.1, type: 'triangle', vol: 0.1, at: 0.25 });
      A.tone({ f: 2093, dur: 0.25, type: 'triangle', vol: 0.1, at: 0.33 });
    },
  };

  // ===== 環境音（雨音・風・蝉・霜） =====
  // 鳴らしっぱなしのノイズ（bed）に、ときどき鳴る音を重ねる。音声が有効になるまでは何もしない
  const ambience = (() => {
    let kind = null;
    let bed = null;
    let buf = null;
    let nextAt = 0;

    function noiseSource(ac) {
      if (!buf) {
        buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start(0, Math.random() * 1.5);
      return src;
    }

    function filter(ac, type, f, q) {
      const b = ac.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q || 0.7;
      return b;
    }

    // 低い周波数で param を揺らす
    function wobble(ac, rate, depth, param, type) {
      const o = ac.createOscillator();
      o.type = type || 'sine';
      o.frequency.value = rate;
      const g = ac.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
      return o;
    }

    // 雨音（ノイズの low〜high Hz だけを通す）
    function rainNoise(ac, out, low, high) {
      const src = noiseSource(ac);
      src
        .connect(filter(ac, 'highpass', low))
        .connect(filter(ac, 'lowpass', high))
        .connect(out);
      return src;
    }

    // build(ac, out) は鳴らし始めたノードを返す（止めるときに使う）
    const BEDS = {
      rain: { vol: 0.05, build: (ac, out) => [rainNoise(ac, out, 500, 2600)] },
      rain3: { vol: 0.07, build: (ac, out) => [rainNoise(ac, out, 400, 3200)] },
      // 雨に、うなる風を重ねる
      typhoon: {
        vol: 0.09,
        build: (ac, out) => {
          const wind = noiseSource(ac);
          const bp = filter(ac, 'bandpass', 500, 1.1);
          const g = ac.createGain();
          g.gain.value = 1.4;
          wind.connect(bp).connect(g).connect(out);
          return [rainNoise(ac, out, 600, 3800), wind, wobble(ac, 0.13, 260, bp.frequency), wobble(ac, 0.21, 0.6, g.gain)];
        },
      },
      // 遠くのアブラゼミの「ジー」
      heat: {
        vol: 0.025,
        build: (ac, out) => {
          const src = noiseSource(ac);
          const g = ac.createGain();
          g.gain.value = 0.6;
          src
            .connect(filter(ac, 'bandpass', 4200, 4))
            .connect(g)
            .connect(out);
          return [src, wobble(ac, 46, 0.4, g.gain, 'square')];
        },
      },
      // 冷えた空気のかすかな音
      frost: {
        vol: 0.012,
        build: (ac, out) => {
          const src = noiseSource(ac);
          src.connect(filter(ac, 'highpass', 7000)).connect(out);
          return [src];
        },
      },
    };

    function fadeOut(ac, b) {
      const t = ac.currentTime;
      b.gain.gain.cancelScheduledValues(t);
      b.gain.gain.setValueAtTime(Math.max(0.0001, b.gain.gain.value), t);
      b.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      b.nodes.forEach((n) => n.stop(t + 0.9));
      setTimeout(() => b.gain.disconnect(), 1200);
    }

    // 鳴らす環境音を切り替える（null で止める）。同じなら何もしない
    function set(k) {
      const ac = A.ctx;
      if (!ac) k = null;
      if (k === kind) return;
      if (bed && ac) fadeOut(ac, bed);
      bed = null;
      kind = k;
      if (!k) return;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(BEDS[k].vol, ac.currentTime + 1.5);
      gain.connect(A.out);
      bed = { gain, nodes: BEDS[k].build(ac, gain) };
      nextAt = 0;
    }

    // ときどき鳴る音（雨だれ・吹きつける風・蝉・霜の鈴）
    function frame(now) {
      if (!bed || now < nextAt) return;
      const r = Math.random();
      if (kind === 'rain' || kind === 'rain3') {
        A.tone({ f: 1400 + r * 1600, f2: 700, dur: 0.05, type: 'sine', vol: kind === 'rain3' ? 0.05 : 0.035 });
        nextAt = now + 150 + Math.random() * (kind === 'rain3' ? 500 : 900);
      } else if (kind === 'typhoon') {
        A.noise({ dur: 2.2, vol: 0.14, filter: 'bandpass', f: 200, f2: 900 + r * 600, q: 1, attack: 0.9 });
        nextAt = now + 2500 + Math.random() * 4000;
      } else if (kind === 'heat') {
        cicada(0.025);
        nextAt = now + 4000 + Math.random() * 5000;
      } else if (kind === 'frost') {
        A.tone({ f: [2093, 2349, 2637, 3136, 3520][Math.floor(r * 5)], dur: 0.5, type: 'triangle', vol: 0.035 });
        nextAt = now + 1200 + Math.random() * 2800;
      }
    }

    return { set, frame };
  })();

  // いま鳴らす環境音。イベントがあればそれ、なければ雨が降っていれば雨音
  function ambientKind() {
    const k = topEvent(world);
    if (k >= 0) return EVENTS[k].id;
    return world.rec && world.rec.now.p > 0 ? 'rain' : null;
  }

  // ===== 配置 =====
  const SKY_H = 42; // 窓から見える空の高さ（その下に窓の桟）
  const READ_Y = 24; // 空の下の段（名古屋の天気・季節の札）
  const CASE = { x: 4, y: 46, w: 248, h: 116 }; // 栽培ケース
  const POT_X = [52, 128, 204]; // 鉢の中心
  const BED_Y = 128; // 菌床の上面
  const BOX = 64; // キノコの絵の枠（32×32 の絵なら2倍）
  const LABEL_Y = 140;
  const MSG_Y = 48;
  const PANEL_Y = 166;
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

  // 四隅の霜（ケースの温度「低」と、初霜の窓）
  function paintFrost(w, h, R) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = Math.min(x, w - 1 - x);
        const dy = Math.min(y, h - 1 - y);
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
  const frost = paintFrost(CASE.w, CASE.h, 22);
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

  // ===== 空の素材 =====
  // 時間帯と空模様ごとの、上・中・下の色（あいだはディザでつなぐ）
  const SKY_COLORS = {
    clear: { night: ['ink', 'night', 'dusk'], dawn: ['night', 'dusk', 'orange'], day: ['blue', 'blue', 'cyan'], eve: ['night', 'maroon', 'orange'] },
    cloudy: { night: ['ink', 'night', 'night'], dawn: ['dusk', 'mist', 'mist'], day: ['mist', 'silver', 'silver'], eve: ['night', 'dusk', 'mist'] },
    storm: { night: ['ink', 'ink', 'night'], dawn: ['ink', 'night', 'dusk'], day: ['night', 'dusk', 'mist'], eve: ['ink', 'night', 'dusk'] },
    heat: { night: ['night', 'dusk', 'maroon'], dawn: ['dusk', 'orange', 'gold'], day: ['cyan', 'cyan', 'white'], eve: ['maroon', 'red', 'orange'] },
    frost: { night: ['ink', 'night', 'blue'], dawn: ['night', 'blue', 'cyan'], day: ['blue', 'cyan', 'white'], eve: ['night', 'blue', 'cyan'] },
  };
  const skyCache = {};

  function skyBase(mood, tod) {
    const key = mood + tod;
    if (skyCache[key]) return skyCache[key];
    const stops = SKY_COLORS[mood][tod];
    const c = makeCanvas(W, SKY_H);
    const g = c.getContext('2d');
    for (let y = 0; y < SKY_H; y++) {
      const pos = (y / (SKY_H - 1)) * 2;
      const seg = Math.min(1, Math.floor(pos));
      for (let x = 0; x < W; x++) {
        g.fillStyle = P[bayer(x, y) < pos - seg ? stops[seg + 1] : stops[seg]];
        g.fillRect(x, y, 1, 1);
      }
    }
    return (skyCache[key] = c);
  }

  // 丸を重ねた雲（上を top、下の影を shade で塗る）
  function paintCloud(w, h, seed, top, shade) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const rnd = seeded(seed);
    const blobs = Array.from({ length: 4 }, (_, i) => ({ x: w * (0.2 + (0.6 * i) / 3), y: h * (0.6 + rnd() * 0.15), r: h * (0.32 + rnd() * 0.22) }));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!blobs.some((b) => (x - b.x) ** 2 + ((y - b.y) * 1.5) ** 2 < b.r * b.r)) continue;
        g.fillStyle = P[y > h * 0.62 ? shade : top];
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  const CLOUDS = {
    cloudy: { day: ['silver', 'mist'], dawn: ['mist', 'dusk'], eve: ['mist', 'dusk'], night: ['dusk', 'night'] },
    storm: { day: ['mist', 'dusk'], dawn: ['dusk', 'night'], eve: ['dusk', 'night'], night: ['night', 'ink'] },
  };
  const cloudCache = {};

  function cloudsOf(mood, tod) {
    const key = mood + tod;
    if (!cloudCache[key]) {
      const [top, shade] = CLOUDS[mood][tod];
      cloudCache[key] = [
        [46, 14, 3],
        [62, 18, 4],
        [38, 12, 5],
      ].map(([w, h, s]) => paintCloud(w, h, s, top, shade));
    }
    return cloudCache[key];
  }

  // 夏の昼の入道雲
  const THUNDERHEAD = (() => {
    const c = makeCanvas(40, 30);
    const g = c.getContext('2d');
    [
      [20, 8, 9],
      [12, 15, 9],
      [28, 14, 10],
      [20, 21, 14],
    ].forEach(([cx, cy, r]) => {
      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < 40; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 >= r * r) continue;
          g.fillStyle = P[x > cx + r * 0.35 || y > 24 ? 'silver' : 'white'];
          g.fillRect(x, y, 1, 1);
        }
      }
    });
    return c;
  })();

  // 名古屋の街並みと城（空の下の帯）。夜はビルの窓に灯りがつく
  const CASTLE_X = 166; // 城の中心
  const SKYLINE = (() => {
    const h = 16;
    const c = makeCanvas(W, h);
    const g = c.getContext('2d');
    const rnd = seeded(77);
    const lights = [];
    g.fillStyle = P.ink;
    for (let x = -2; x < W; ) {
      const w = 6 + Math.floor(rnd() * 9);
      const bh = 3 + Math.floor(rnd() * 8);
      if (x + w < CASTLE_X - 16 || x > CASTLE_X + 16) {
        g.fillRect(x, h - bh, w, bh);
        if (bh > 4)
          for (let k = 0; k < 2; k++) lights.push({ x: x + 1 + Math.floor(rnd() * (w - 2)), y: h - bh + 2 + Math.floor(rnd() * (bh - 3)), p: 4 + rnd() * 9 });
      }
      x += w + Math.floor(rnd() * 3);
    }
    // 城（石垣の上に三重の屋根。棟の両端に金の飾り）
    const cx = CASTLE_X;
    [
      [h - 3, 3, 13],
      [h - 6, 3, 9],
      [h - 7, 1, 11],
      [h - 9, 2, 7],
      [h - 10, 1, 9],
      [h - 12, 2, 5],
      [h - 13, 1, 7],
      [h - 14, 1, 4],
    ].forEach(([y, rows, half]) => g.fillRect(cx - half, y, half * 2, rows));
    g.fillStyle = P.gold;
    g.fillRect(cx - 4, h - 15, 1, 1);
    g.fillRect(cx + 3, h - 15, 1, 1);
    return { c, lights, y: SKY_H - h };
  })();

  const windowFrost = paintFrost(W, SKY_H, 16);

  // 空と、タイトルに降る・舞う粒の置き場所（0〜1）
  const PARTS = (() => {
    const rnd = seeded(13);
    return Array.from({ length: 80 }, () => ({ x: rnd(), y: rnd(), v: rnd(), ph: rnd() * 6.28 }));
  })();

  const STARS = (() => {
    const rnd = seeded(21);
    return Array.from({ length: 22 }, () => ({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * (SKY_H - 18)), p: 500 + Math.floor(rnd() * 900) }));
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
  let bookPage = 0;
  let bookNew = new Set(); // 今回図鑑を開いたときの新着
  let focus = 0; // キーボードで選んでいる操作
  let kbd = false; // キーボードで操作中（選択枠を出す）
  let picking = false; // ういろう肥料を使う鉢を選んでいるところ
  let heard = -1; // 最後に知らせた天候イベント（EVENTS の番号、なしは -1）
  let thunderAt = -1; // 最後に雷を鳴らした稲光の番号

  const backBtn = RA.backButton();
  const bookBtn = new RA.Button({ x: 188, y: 4, w: 64, h: 20, label: '図鑑' });
  const FEED_PLATE = { x: 72, y: 4, w: 58, h: 20 }; // ういろう肥料の所持数
  const feedBtn = new RA.Button({ x: 134, y: 4, w: 50, h: 20, label: '使う' });
  const hourBtn = new RA.Button({ x: 4, y: 24, w: 54, h: 18, label: '+1時間' });
  const dayBtn = new RA.Button({ x: 62, y: 24, w: 54, h: 18, label: '+1日' });
  const seasonBtn = new RA.Button({ x: 162, y: 24, w: 44, h: 18, label: '' });
  const eventBtn = new RA.Button({ x: 208, y: 24, w: 44, h: 18, label: '' });
  const prevBtn = new RA.Button({ x: 188, y: 4, w: 30, h: 20, label: '前' });
  const nextBtn = new RA.Button({ x: 222, y: 4, w: 30, h: 20, label: '次' });
  const dialBtns = DIAL_X.map((x) => [
    new RA.Button({ x: x + 3, y: PANEL_Y + 32, w: 36, h: 38, label: '－' }),
    new RA.Button({ x: x + 41, y: PANEL_Y + 32, w: 36, h: 38, label: '＋' }),
  ]);

  function say(text, color) {
    toast = { text, color: color || 'cream', until: performance.now() + TOAST_TIME };
  }

  // ===== 操作 =====
  // 開いているあいだに起きた変化を知らせる
  function notify(events) {
    if (!events.length) return;
    save();
    events.forEach((e) => e.type === 'wild' && effects.push({ kind: 'gust', cx: POT_X[e.pot], at: performance.now() }));
    const first = events.some((e) => e.first);
    if (events.length > 1) {
      say(summary(events));
      if (first) snd.discover();
      else snd.grown();
      return;
    }
    const e = events[0];
    if (e.type === 'wild') {
      say('胞子が飛んできた！', 'cyan');
      snd.wild();
    } else if (e.type === 'young') {
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

  // 天候イベントが来た・去ったことを知らせる（栽培室を見ているとき）
  function watchEvent() {
    const k = topEvent(world);
    if (k === heard) return;
    if (k >= 0) {
      say(EVENTS[k].hello, EVENTS[k].color);
      snd.weather(EVENTS[k].id);
    } else if (heard >= 0) {
      say(EVENTS[heard].name + 'が去った', 'silver');
      snd.gone();
    }
    heard = k;
  }

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
      const isNew = register(v.id, 'h', world);
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
      say(head + etaText((1 - pot.prog) / rateOf(pot.stage, worldEff())), pot.stage === 'wilted' ? 'silver' : 'cream');
      if (pot.stage === 'wilted') snd.sad();
      else snd.info();
    }
    save();
  }

  // ===== ういろう肥料 =====
  // 使えるのは、まだ変種が決まっていない（胞子・幼菌の）鉢に1回ずつ
  const canFeed = (pot) => !!pot && (pot.stage === 'spore' || pot.stage === 'young') && !pot.fert;
  const NO_FERT = 'ういろう屋のクイズでもらえる';

  // 「使う」を押した。使う鉢を選ぶところへ（選んでいる途中なら、やめる）
  function startFeed() {
    sync();
    if (picking) {
      picking = false;
      RA.sfx.blip();
      return;
    }
    if (!RA.Fertilizer.count()) {
      say(NO_FERT, 'silver');
      return snd.limit();
    }
    if (!state.pots.some(canFeed)) {
      say('胞子か幼菌の鉢に使える', 'silver');
      return snd.limit();
    }
    picking = true;
    toast = null;
    RA.sfx.blip();
    if (kbd) focus = MAIN_CONTROLS.findIndex((c) => c.pot != null && canFeed(state.pots[c.pot]));
  }

  // 鉢 i に肥料を使う
  function feed(i, t) {
    picking = false;
    sync();
    const pot = state.pots[i];
    if (!canFeed(pot)) {
      say(pot && pot.fert ? '肥料はもう効いている' : '胞子か幼菌の鉢に使える', 'silver');
      return snd.limit();
    }
    if (!RA.Fertilizer.take()) {
      say(NO_FERT, 'silver');
      return snd.limit();
    }
    pot.fert = true;
    effects.push({ kind: 'feed', cx: POT_X[i], at: t });
    snd.feed();
    say('肥料でレアが出やすくなった', 'gold');
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

  // デバッグ用の早送り（いまのつまみ・季節・天気のまま hours 時間進める）
  function skip(hours) {
    sync();
    const events = advance(hours, condAt(Date.now()));
    events.forEach((e) => e.type === 'wild' && effects.push({ kind: 'gust', cx: POT_X[e.pot], at: performance.now() }));
    const sum = summary(events);
    say((hours === 1 ? '+1時間' : '+1日') + (sum ? ' ' + sum : ''), 'pink');
    if (events.some((e) => e.first)) snd.discover();
    else snd.skip();
    save();
  }

  // デバッグ用。季節を 日付どおり → 春 → 梅雨 → 夏 → 秋 → 冬 → 日付どおり の順に切り替える
  function cycleSeason() {
    sync(); // 切り替える前の季節で、ここまでの時間を進めておく
    debugSeason = debugSeason + 1 < SEASONS.length ? debugSeason + 1 : -1;
    world = condAt(Date.now());
    say(debugSeason < 0 ? '季節 日付どおり（' + SEASONS[world.season].name + '）' : '季節 ' + SEASONS[debugSeason].name + 'に固定', 'pink');
    RA.sfx.blip();
    save();
  }

  // デバッグ用。天候を 実際の天気 → なし → 台風 → 猛暑 → 長雨 → 初霜 → 実際の天気 の順に切り替える
  function cycleEvent() {
    sync();
    debugEvent = debugEvent < EVENTS.length ? debugEvent + 1 : -1;
    world = condAt(Date.now());
    heard = topEvent(world);
    const label = debugEvent < 0 ? '実際の天気' : debugEvent === 0 ? 'なしに固定' : EVENTS[debugEvent - 1].name + 'に固定';
    say('天候 ' + label, 'pink');
    if (heard >= 0) snd.weather(EVENTS[heard].id);
    else RA.sfx.blip();
    save();
  }

  function start() {
    snd.start();
    scene = 'main';
    focus = MAIN_CONTROLS.findIndex((c) => c.row === POT_ROW);
    sync();
    save();
  }

  // ===== 図鑑のページ =====
  const PAGE = 10; // 1ページの升目（5×2）
  const PAGES = Math.ceil(VARIANTS.length / PAGE);
  const pageOf = (i) => Math.floor(i / PAGE);

  function openBook() {
    sync();
    picking = false;
    bookNew = new Set(VARIANTS.filter((v) => book[v.id].n).map((v) => v.id));
    if (bookNew.size) {
      bookSel = VARIANTS.findIndex((v) => bookNew.has(v.id));
      VARIANTS.forEach((v) => (book[v.id].n = false));
      saveBook();
    }
    bookPage = pageOf(bookSel);
    scene = 'book';
    focus = bookControls(bookPage).findIndex((c) => c.entry === bookSel);
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

  // ページをめくる。選択はそのページの最初の升目へ（キーボードの選択枠はボタンに残す）
  function turnPage(d) {
    const p = bookPage + d;
    if (p < 0 || p >= PAGES) return snd.limit();
    bookPage = p;
    bookSel = p * PAGE;
    snd.page();
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

  const POT_ROW = DEBUG ? 2 : 1; // デバッグのときは、上に早送り・季節・天候のボタンの段が入る
  const BOOK_CONTROL = control(bookBtn, 0, openBook);
  const FEED_CONTROL = control(feedBtn, 0, startFeed);
  const MAIN_CONTROLS = [
    control(backBtn, 0, RA.goTop),
    FEED_CONTROL,
    BOOK_CONTROL,
    ...(DEBUG ? [control(hourBtn, 1, () => skip(1)), control(dayBtn, 1, () => skip(24)), control(seasonBtn, 1, cycleSeason), control(eventBtn, 1, cycleEvent)] : []),
    // 肥料を使う鉢を選んでいるあいだは、鉢を押すとその鉢に使う
    ...POT_X.map((cx, i) => ({ x: cx - 36, y: CASE.y + 8, w: 72, h: CASE.h - 8, row: POT_ROW, pot: i, act: (t) => (picking ? feed(i, t) : tapPot(i, t)) })),
    ...dialBtns.flatMap(([minus, plus], k) => [control(minus, POT_ROW + 1, () => turn(k, -1)), control(plus, POT_ROW + 1, () => turn(k, 1))]),
  ];

  const GRID = { x: 8, y: 44, w: 46, h: 50, pitchX: 48, pitchY: 52 };
  // 升目の位置（i は図鑑の番号）。ページの最後の行が5つに満たないときは中央に寄せる
  function cellRect(i) {
    const j = i % PAGE;
    const rowStart = i - (j % 5);
    const inRow = Math.min(5, VARIANTS.length - rowStart);
    const x = GRID.x + ((5 - inRow) * GRID.pitchX) / 2 + (j % 5) * GRID.pitchX;
    return { x, y: GRID.y + Math.floor(j / 5) * GRID.pitchY, w: GRID.w, h: GRID.h };
  }

  const bookLists = [];
  function bookControls(page) {
    if (!bookLists[page]) {
      bookLists[page] = [
        control(backBtn, 0, closeBook),
        control(prevBtn, 0, () => turnPage(-1)),
        control(nextBtn, 0, () => turnPage(1)),
        ...VARIANTS.map((v, i) => i)
          .filter((i) => pageOf(i) === page)
          .map((i) => Object.assign(cellRect(i), { row: 1 + Math.floor((i % PAGE) / 5), entry: i, act: () => selectEntry(i) })),
      ];
    }
    return bookLists[page];
  }

  const controls = () => (scene === 'main' ? MAIN_CONTROLS : scene === 'book' ? bookControls(bookPage) : null);

  // 図鑑の端の升目から、さらに左右へ進んだら隣のページへ
  function flipPage(from, dx) {
    const p = bookPage + dx;
    if (p < 0 || p >= PAGES) return;
    const list = bookControls(p);
    let best = -1;
    list.forEach((c, i) => {
      if (c.row !== from.row || c.entry == null) return;
      if (best < 0 || (dx > 0 ? c.x < list[best].x : c.x > list[best].x)) best = i;
    });
    if (best < 0) return;
    bookPage = p;
    focus = best;
    selectEntry(list[best].entry);
  }

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
    if (best < 0) {
      if (scene === 'book' && dx && cur.entry != null) flipPage(cur, dx);
      return;
    }
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
    if (picking && (i < 0 || isOther(list[i]))) picking = false; // 鉢と「使う」以外を押したら、選ぶのをやめる
    if (i < 0) return;
    focus = i;
    list[i].act(ev.t);
  }

  const isOther = (c) => c.pot == null && c !== FEED_CONTROL;

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
      if (picking && isOther(list[focus])) picking = false;
      return list[focus].act(ev.t);
    }
    if (scene === 'book') {
      if (back || c === 'KeyZ') closeBook();
      return;
    }
    const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(c);
    if (picking) {
      if (n >= 0) return feed(n, ev.t);
      if (back || c === 'KeyU') return startFeed(); // 選ぶのをやめる
    }
    if (back) return RA.goTop();
    if (c === 'KeyZ') return openBook();
    if (c === 'KeyU') return FEED_CONTROL.act(ev.t);
    if (n >= 0) return tapPot(n, ev.t);
    if (DEBUG && c === 'KeyF') {
      say('肥料 ' + RA.Fertilizer.add(1) + '個', 'pink');
      return RA.sfx.blip();
    }
    if (DEBUG && c === 'KeyH') return skip(1);
    if (DEBUG && c === 'KeyD') return skip(24);
    if (DEBUG && c === 'KeyS') return cycleSeason();
    if (DEBUG && c === 'KeyE') return cycleEvent();
  }

  RA.bindInput(canvas, { press: onPress, key: onKey });

  // 閉じる・隠れるときに保存（次に開いたとき、この時刻から時間を進める）。環境音も止める
  const persist = () => {
    if (scene === 'title' || scene === 'main' || scene === 'book') save();
    ambience.set(null);
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

  // 文字列の点絵を描く。map は 文字 → パレット名（'.' は透明）
  function pix(rows, x, y, map) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (map[row[i]]) rect(map[row[i]], x + i, y + j, 1, 1);
    });
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

  // ===== 空 =====
  // いまの空。tod 時間帯, mood 空模様, fall 降るもの, drift 舞うもの, h 時刻
  function skyNow() {
    const h = WX.jst(Date.now()).h;
    const tod = h < 4.5 || h >= 19 ? 'night' : h < 6.5 ? 'dawn' : h < 16.5 ? 'day' : 'eve';
    const ev = EVENTS[topEvent(world)];
    const rec = world.rec;
    const raining = !!(rec && rec.now.p > 0);
    const season = SEASONS[world.season].id;
    let mood = 'clear';
    let fall = null;
    let drift = null;
    if (ev && ev.id === 'typhoon') {
      mood = 'storm';
      fall = 'storm';
      drift = 'gust';
    } else if ((ev && ev.id === 'rain3') || raining) {
      mood = 'cloudy';
      fall = rec && rec.now.t <= 1 ? 'snow' : 'rain';
    } else if (ev && ev.id === 'heat') {
      mood = 'heat';
    } else if (ev && ev.id === 'frost') {
      mood = 'frost';
      drift = 'twinkle';
    } else if (season === 'rainy') {
      mood = 'cloudy';
    }
    if (!fall && !drift) drift = { spring: 'petal', autumn: 'leaf', summer: tod === 'night' ? 'firefly' : null }[season] || null;
    return { tod, mood, fall, drift, h };
  }

  // 降る・舞う粒を、範囲 (x0, y0, w, h) に n 個描く
  function drawParticles(kind, x0, y0, w, h, ts, n) {
    const s = ts / 1000;
    const wrap = (v, m) => ((v % m) + m) % m;
    const dot = (color, x, y, dw, dh) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x >= x0 && y >= y0 && x + (dw || 1) <= x0 + w && y + (dh || 1) <= y0 + h) rect(color, x, y, dw || 1, dh || 1);
    };
    for (let i = 0; i < n; i++) {
      const p = PARTS[i];
      if (kind === 'rain') {
        dot(i % 3 ? 'cyan' : 'silver', x0 + p.x * w, y0 + wrap(p.y * h + s * (110 + p.v * 60), h + 4) - 4, 1, 3);
      } else if (kind === 'storm') {
        const y = wrap(p.y * h + s * (150 + p.v * 60), h + 6) - 6;
        const x = x0 + wrap(p.x * w + y * 1.2 + s * 40, w);
        for (let k = 0; k < 3; k++) dot(i % 3 ? 'silver' : 'cyan', x - k, y0 + y + k * 1.2);
      } else if (kind === 'snow') {
        dot(i % 2 ? 'white' : 'cream', x0 + wrap(p.x * w + Math.sin(s + p.ph) * 3, w), y0 + wrap(p.y * h + s * (8 + p.v * 8), h));
      } else if (kind === 'petal') {
        if (i % 3) continue;
        dot('pink', x0 + wrap(p.x * w + s * (10 + p.v * 6), w), y0 + wrap(p.y * h + s * (5 + p.v * 4) + Math.sin(s * 2 + p.ph) * 2, h), 2, 1);
      } else if (kind === 'leaf') {
        if (i % 3) continue;
        const color = ['orange', 'red', 'gold'][i % 3 === 0 ? (i / 3) % 3 : 0];
        const y = y0 + wrap(p.y * h + s * (6 + p.v * 5), h);
        dot(color, x0 + wrap(p.x * w + Math.sin(s * 1.5 + p.ph) * 4, w), y, 2, Math.floor(s * 3 + p.ph) % 2 ? 1 : 2);
      } else if (kind === 'firefly') {
        if (i % 4 || Math.floor(s * 1.5 + p.ph) % 3 === 0) continue;
        dot('gold', x0 + wrap(p.x * w + Math.sin(s * 0.7 + p.ph) * 6, w), y0 + h * 0.4 + p.y * h * 0.5 + Math.cos(s * 0.9 + p.ph) * 3);
      } else if (kind === 'gust') {
        if (i % 2) continue;
        const color = ['cream', 'green', 'brown', 'cyan'][(i / 2) % 4];
        dot(color, x0 + wrap(p.x * w + s * (90 + p.v * 70), w + 8) - 8, y0 + wrap(p.y * h + Math.sin(s * 3 + p.ph) * 4 + s * 6, h), 2, 1);
      } else if (kind === 'twinkle') {
        if (i % 4 || Math.floor(s * 2 + p.ph) % 3) continue;
        const x = x0 + Math.round(p.x * (w - 4)) + 2;
        const y = y0 + Math.round(p.y * (h - 4)) + 2;
        dot('white', x, y);
        dot('cyan', x - 1, y);
        dot('cyan', x + 1, y);
        dot('cyan', x, y - 1);
        dot('cyan', x, y + 1);
      }
    }
  }

  // 太陽（色を変えて猛暑・朝夕にも使う）
  function sun(x, y, core, ray, ts) {
    pix(['.ooo.', 'ooooo', 'ooooo', 'ooooo', '.ooo.'], x - 2, y - 2, { o: core });
    if (Math.floor(ts / 400) % 2)
      [
        [-4, 0],
        [4, 0],
        [0, -4],
        [0, 4],
        [-3, -3],
        [3, -3],
        [-3, 3],
        [3, 3],
      ].forEach(([dx, dy]) => rect(ray, x + dx, y + dy, 1, 1));
  }

  function drawSky(ts) {
    const st = skyNow();
    const clear = st.mood !== 'cloudy' && st.mood !== 'storm';
    ctx.drawImage(skyBase(st.mood, st.tod), 0, 0);
    // 稲光（台風）。光った瞬間に遠くで雷が鳴る
    let flash = false;
    if (st.mood === 'storm') {
      const n = Math.floor(ts / 7000);
      const ph = ts % 7000;
      flash = ph < 200 && Math.floor(ph / 70) !== 1;
      if (ph < 200 && n !== thunderAt) {
        thunderAt = n;
        if (scene === 'main') snd.thunder();
      }
      if (flash) rect('mist', 0, 0, W, SKY_H);
    }
    // 星と月、または太陽（弧を描いて動く）
    const arc = (k) => 6 + Math.round(10 * (k * 2 - 1) ** 2);
    if (clear && st.tod === 'night') {
      STARS.forEach((s, i) => Math.floor(ts / s.p + i) % 4 && rect(i % 3 ? 'silver' : 'white', s.x, s.y, 1, 1));
      const k = ((st.h + 5) % 24) / 10;
      const x = 20 + Math.round(k * 216);
      pix(['..ccc', '.cc..', 'cc...', 'cc...', 'cc...', '.cc..', '..ccc'], x - 2, arc(k) - 3, { c: 'cream' });
    } else if (clear) {
      const k = clamp((st.h - 5) / 14, 0, 1);
      const x = 20 + Math.round(k * 216);
      if (st.mood === 'heat') sun(x, arc(k), 'white', 'gold', ts);
      else if (st.tod === 'day') sun(x, arc(k), 'gold', 'gold', ts);
      else sun(x, arc(k), 'orange', 'gold', ts);
    }
    // 雲。曇りはゆっくり、台風は速く流れる
    if (!clear) {
      const set = cloudsOf(st.mood, st.tod);
      const speed = st.mood === 'storm' ? 34 : 3;
      for (let i = 0; i < 6; i++) {
        const c = set[i % 3];
        const span = W + c.width;
        const x = Math.round((((i * 97 + (ts / 1000) * speed * (1 + (i % 3) * 0.3)) % span) + span) % span) - c.width;
        ctx.drawImage(c, x, ((i * 7) % 18) - 2);
      }
    }
    if (flash) {
      // 稲妻
      const bx = 60 + ((Math.floor(ts / 7000) * 53) % 140);
      for (let y = 0, x = bx; y < SKY_H - 10; y += 3, x += ((y * 7) % 5) - 2) rect('white', x, y, 1, 3);
    }
    if (st.mood === 'clear' && st.tod === 'day' && SEASONS[world.season].id === 'summer') ctx.drawImage(THUNDERHEAD, 96, SKY_H - 34);
    // 街と城
    ctx.drawImage(SKYLINE.c, 0, SKYLINE.y);
    if (st.tod !== 'day') SKYLINE.lights.forEach((l) => Math.floor(ts / 1000 / l.p) % 5 && rect('gold', l.x, SKYLINE.y + l.y, 1, 1));
    if (Math.floor(ts / 900) % 4 === 0) {
      rect('white', CASTLE_X - 4, SKYLINE.y + 1, 1, 1); // 金の飾りがきらり
      rect('white', CASTLE_X + 3, SKYLINE.y + 1, 1, 1);
    }
    // 陽炎（地平の行を左右に揺らす）
    if (st.mood === 'heat') {
      for (let y = SKY_H - 12; y < SKY_H; y++) {
        const dx = Math.round(Math.sin(ts / 160 + y * 0.9));
        if (dx) ctx.drawImage(canvas, 0, y, W, 1, dx, y, W, 1);
      }
    }
    if (st.fall) drawParticles(st.fall, 0, 0, W, SKY_H, ts, st.fall === 'storm' ? 60 : st.fall === 'snow' ? 30 : 44);
    if (st.drift) drawParticles(st.drift, 0, 0, W, SKY_H, ts, 60);
    if (st.mood === 'frost') ctx.drawImage(windowFrost, 0, 0);
    // 窓の桟
    rect('brown', 0, SKY_H, W, 1);
    rect('ink', 0, SKY_H + 1, W, 1);
  }

  // いまの天気の小さな絵（9×9 ドット）
  const ICONS = {
    sun: ['....g....', '.g.....g.', '...ggg...', '..ggggg..', 'g.ggggg.g', '..ggggg..', '...ggg...', '.g.....g.', '....g....'],
    moon: ['..ccc....', '.cc......', 'cc.......', 'cc.......', 'cc.......', 'cc.......', '.cc...c..', '..ccccc..', '.........'],
    rain: ['...sss...', '.sssssss.', 'sssssssss', '.sssssss.', '.........', '.C..C..C.', 'C..C..C..', '.........', '.........'],
    snow: ['...sss...', '.sssssss.', 'sssssssss', '.sssssss.', '.........', '.W..W..W.', '...W..W..', '.........', '.........'],
    typhoon: ['..CCCC...', '.C....C..', 'C..CC..C.', 'C.C..C.C.', 'C.C.CC.C.', 'C..C...C.', '.C....C..', '..CCCC...', '.........'],
    heat: ['....r....', '.r.....r.', '...ooo...', '..oWWoo..', 'r.oWooo.r', '..ooooo..', '...ooo...', '.r.....r.', '....r....'],
    frost: ['....W....', '.W..W..W.', '..W.W.W..', '...WWW...', 'WWWWCWWWW', '...WWW...', '..W.W.W..', '.W..W..W.', '....W....'],
  };
  const ICON_COLORS = { g: 'gold', c: 'cream', s: 'silver', C: 'cyan', W: 'white', o: 'orange', r: 'red' };

  function weatherIcon(x, y) {
    const ev = EVENTS[topEvent(world)];
    const st = skyNow();
    let name = st.tod === 'night' ? 'moon' : 'sun';
    if (ev) name = ev.id === 'rain3' ? 'rain' : ev.id;
    else if (st.fall) name = st.fall;
    ctx.fillStyle = P.ink;
    ctx.fillRect(x - 1, y - 1, 11, 11);
    pix(ICONS[name], x, y, ICON_COLORS);
  }

  // 名古屋のいまの天気（「名古屋 18°C 65%」）。取得できずに代用しているあいだは灰色
  function readoutText() {
    return '名古屋 ' + (wx ? Math.round(wx.now.t) + '°C ' + Math.round(wx.now.rh) + '%' : '--°C --%');
  }

  // 空の下の段に置く札（墨の地に宵闇の縁。空がどんな色でも読めるように）
  function plate(x, w) {
    rect('dusk', x, READ_Y, w, 18);
    rect('ink', x + 1, READ_Y + 1, w - 2, 16);
  }

  // 天気の絵と文字。align が 'right' なら x を右端に。onPlate なら札に載せる（栽培室の窓）
  function drawReadout(x, y, align, onPlate) {
    const text = readoutText();
    const w = RA.textWidth(text);
    const left = align === 'right' ? x - w : x + 13;
    if (onPlate) plate(left - 15, w + 18);
    weatherIcon(left - 12, y + 5);
    RA.text(ctx, text, left, y, { color: wx && wx.src === 'api' ? 'cream' : 'mist', outline: onPlate ? null : 'ink' });
  }

  // 季節と天候イベント（右端 x にそろえる）。栽培室の窓では札に載せて横に、タイトルでは縦に並べる
  function drawTags(x, y, onPlate) {
    const s = SEASONS[world.season];
    const ev = EVENTS[topEvent(world)];
    const ws = RA.textWidth(s.name);
    const we = ev ? RA.textWidth(ev.name) : 0;
    if (onPlate) plate(x - ws - (ev ? we + 6 : 0) - 4, ws + (ev ? we + 6 : 0) + 7);
    const outline = onPlate ? null : 'ink';
    RA.text(ctx, s.name, x, y, { color: s.color, align: 'right', outline });
    if (ev) RA.text(ctx, ev.name, onPlate ? x - ws - 6 : x, onPlate ? y : y + 18, { color: ev.color, align: 'right', outline });
  }

  // ===== 栽培室 =====
  function drawCase(ts) {
    const eff = worldEff();
    const env = [levelOf(eff[HUM]), levelOf(eff[TEMP]), state.env[LIGHT]];
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
    // 水滴は湿り気に合わせて少しずつ増える（低で0・中で10・高で28）
    const drops = Math.round(eff[HUM] <= 1 ? eff[HUM] * 10 : 10 + (eff[HUM] - 1) * 18);
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
    // ういろう肥料が効いている（変種が決まるまで、菌床の脇に袋を置いておく）
    if (pot.fert && (pot.stage === 'spore' || pot.stage === 'young')) RA.Fertilizer.icon(ctx, cx + 22, BED_Y - 4);
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
      } else if (f.kind === 'gust') {
        // 風に乗った胞子が横から飛んできて、菌床に降りる
        const p = Math.min(1, el / 600);
        for (let k = 0; k < 8; k++) {
          const y = BED_Y - 44 + ((k * 5) % 9) + Math.round(p * 42);
          if (y < BED_Y) rect(k % 2 ? 'cyan' : 'cream', f.cx - 70 + Math.round(p * 56) + k * 4, y, 1, 1);
        }
      } else if (f.kind === 'feed') {
        // 肥料の袋が降りてきて、粒が菌床にまかれる
        if (el < 300) RA.Fertilizer.icon(ctx, f.cx - 6, BED_Y - 64 + Math.round(el / 12));
        for (let k = 0; k < 9; k++) {
          const y = BED_Y - 36 + ((k * 11) % 13) + Math.round((el / 600) * 36);
          if (el > 200 && y < BED_Y) rect(['pink', 'cream', 'white'][k % 3], f.cx - 16 + k * 4, y, 1, 1);
        }
      } else if (f.kind === 'stars') {
        const r = 12 + el * 0.06;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          star(f.cx + Math.cos(a) * r * 1.4, BED_Y - 34 + Math.sin(a) * r, el < 350 ? 'white' : 'gold');
        }
      }
    });
  }

  function drawMessage(ts) {
    let text = null;
    let color = 'silver';
    if (picking) {
      if (Math.floor(ts / 500) % 3 < 2) text = 'どの鉢に使う？';
      color = 'gold';
    } else if (toast && performance.now() < toast.until) {
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
    rect('dusk', x, PANEL_Y, 80, 72);
    rect('ink', x + 1, PANEL_Y + 1, 78, 70);
    dialIcon(k, x + 5, PANEL_Y + 6);
    RA.text(ctx, d.name, x + 16, PANEL_Y + 2, { color: 'silver' });
    RA.text(ctx, d.levels[lv], x + 75, PANEL_Y + 2, { color: d.color, align: 'right' });
    for (let i = 0; i < 3; i++) rect(i <= lv ? d.color : 'night', x + 6 + i * 23, PANEL_Y + 21, 21, 5);
    // その下の細い線は、季節と天気を足したケースの中の実際の状態（つまみの段と同じ目盛り）
    rect('night', x + 6, PANEL_Y + 28, 67, 1);
    rect('white', x + 6, PANEL_Y + 28, 21 + Math.round(23 * worldEff()[k]), 1);
    dialBtns[k][0].draw(ctx, ts);
    dialBtns[k][1].draw(ctx, ts);
  }

  // ういろう肥料の所持数と「使う」ボタン（使う鉢を選んでいるあいだは赤）
  function drawFeed(ts) {
    const n = RA.Fertilizer.count();
    const { x, y, w, h } = FEED_PLATE;
    rect('dusk', x, y, w, h);
    rect('ink', x + 1, y + 1, w - 2, h - 2);
    RA.text(ctx, '肥料', x + 4, y + 2, { color: 'cream' });
    RA.text(ctx, String(n), x + w - 4, y + 2, { color: n ? 'gold' : 'mist', align: 'right' });
    feedBtn.tone = picking ? 'primary' : 'normal';
    feedBtn.draw(ctx, ts);
  }

  function drawMain(ts) {
    rect('ink', 0, 0, W, H);
    drawSky(ts);
    drawCase(ts);
    for (let i = 0; i < POTS; i++) drawPot(i, ts);
    drawEffects(ts);
    // 肥料を使える鉢を点滅で示す
    if (picking && Math.floor(ts / 300) % 3 < 2) {
      state.pots.forEach((pot, i) => canFeed(pot) && frame('gold', POT_X[i] - 36, CASE.y + 8, 72, CASE.h - 8));
    }
    state.pots.forEach((pot, i) => {
      const label = pot ? STAGE_NAME[pot.stage] : '空き';
      RA.text(ctx, label, POT_X[i], LABEL_Y, { color: pot ? STAGE_COLOR[pot.stage] : 'mist', align: 'center', outline: 'ink' });
    });
    drawMessage(ts);
    backBtn.draw(ctx, ts);
    bookBtn.draw(ctx, ts);
    if (VARIANTS.some((v) => book[v.id].n) && Math.floor(ts / 400) % 2 === 0) rect('pink', bookBtn.x + bookBtn.w - 7, bookBtn.y + 3, 3, 3);
    drawFeed(ts);
    if (DEBUG) {
      // デバッグのときは、名古屋の天気の札の代わりに早送りのボタン（天気の中身はタイトルに出る）
      hourBtn.draw(ctx, ts);
      dayBtn.draw(ctx, ts);
      const ev = EVENTS[topEvent(world)];
      seasonBtn.label = SEASONS[world.season].name;
      seasonBtn.tone = debugSeason >= 0 ? 'primary' : 'normal';
      eventBtn.label = ev ? ev.name : 'なし';
      eventBtn.tone = debugEvent >= 0 ? 'primary' : 'normal';
      seasonBtn.draw(ctx, ts);
      eventBtn.draw(ctx, ts);
    } else {
      drawReadout(5, READ_Y, 'left', true);
      drawTags(W - 6, READ_Y, true);
    }
    for (let k = 0; k < 3; k++) drawDial(k, ts);
    drawFocus(ts);
  }

  // ===== 図鑑 =====
  function drawCell(i, ts) {
    const r = cellRect(i);
    const v = VARIANTS[i];
    const e = book[v.id];
    const on = i === bookSel;
    rect(on ? 'gold' : 'dusk', r.x, r.y, r.w, r.h);
    rect(on ? 'night' : 'ink', r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    const im = e.h ? img[v.id].adult : e.d ? img[v.id].dried : sil[v.id];
    if (im) drawIn(im, r.x + 7, r.y + 1, 32);
    else RA.text(ctx, '？', r.x + 23, r.y + 8, { color: 'mist', align: 'center' });
    RA.text(ctx, '採', r.x + 6, r.y + 32, { color: e.h ? 'gold' : 'dusk' });
    RA.text(ctx, '標', r.x + 24, r.y + 32, { color: e.d ? 'orange' : 'dusk' });
    if (bookNew.has(v.id) && Math.floor(ts / 300) % 2 === 0) RA.text(ctx, 'NEW', r.x + 2, r.y + 3, { font: 'en', color: 'pink', outline: 'ink' });
  }

  // 季節・天候の札を横に並べる。mask のビットが立っているものだけ色を付ける
  function drawStamps(list, mask, x, y) {
    list.forEach((s, k) => {
      x += RA.text(ctx, s.name, x, y, { color: mask & (1 << k) ? s.color : 'dusk' }) + 6;
    });
  }

  function drawEntry(i, ts) {
    const v = VARIANTS[i];
    const e = book[v.id];
    const y = 148;
    rect('dusk', 4, y, W - 8, 90);
    rect('ink', 5, y + 1, W - 10, 88);
    // 採取と標本の両方があれば、絵を交互に見せる
    const im = e.h && (!e.d || Math.floor(ts / 1500) % 2 === 0) ? img[v.id].adult : e.d ? img[v.id].dried : sil[v.id];
    if (im) drawIn(im, 10, y + 4, 32);
    RA.text(ctx, 'No.' + String(i + 1).padStart(2, '0'), 50, y + 6, { font: 'en', color: 'mist' });
    if (!isFound(e)) {
      RA.text(ctx, '？？？', 92, y + 2, { color: 'mist' });
      RA.text(ctx, 'まだ見つかっていない。', 50, y + 20, { color: 'mist' });
      const hint = hintOf(v);
      if (hint) RA.text(ctx, hint, 50, y + 38, { color: 'silver' });
      return;
    }
    RA.text(ctx, v.name, 92, y + 2, { color: 'gold' });
    RA.text(ctx, v.text[0], 50, y + 20, { color: 'cream' });
    RA.text(ctx, v.text[1], 50, y + 38, { color: 'cream' });
    // 見つけた季節と天候
    drawStamps(SEASONS, e.s, 10, y + 54);
    RA.text(ctx, '採取' + e.h + ' 標本' + e.d, W - 10, y + 54, { color: 'silver', align: 'right' });
    drawStamps(WEATHERS, e.w, 10, y + 70);
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
    prevBtn.draw(ctx, ts);
    nextBtn.draw(ctx, ts);
    RA.text(ctx, '菌糸図鑑', 128, 3, { color: 'green', align: 'center' });
    for (let p = 0; p < PAGES; p++) rect(p === bookPage ? 'green' : 'dusk', 128 - PAGES * 4 + p * 8 + 1, 22, 6, 2);
    RA.text(ctx, statsText(), 128, 26, { color: 'silver', align: 'center' });
    for (let i = bookPage * PAGE; i < Math.min(VARIANTS.length, (bookPage + 1) * PAGE); i++) drawCell(i, ts);
    drawEntry(bookSel, ts);
    drawFocus(ts);
  }

  // ===== タイトル =====
  function makeReport(ms, events) {
    const n = finals(events);
    const wild = events.filter((e) => e.type === 'wild').length;
    const lines = [];
    if (n.young) lines.push(['芽が出た', n.young]);
    if (wild) lines.push(['胞子が飛んできた', wild]);
    if (n.adult) lines.push(['成菌になった', n.adult]);
    if (n.wilted) lines.push(['しおれた', n.wilted]);
    if (n.dried) lines.push(['乾燥標本になった', n.dried]);
    if (events.some((e) => e.first)) lines.push(['図鑑に新しい標本！', 0]);
    if (!lines.length) lines.push([state.pots.some(Boolean) ? 'すくすく育っている' : '鉢はからっぽのまま', 0]);
    return { ago: agoText(ms), lines: lines.slice(-4) };
  }

  // デバッグ用。取得した天気の中身（英字の小さな文字で2行）
  function weatherLines() {
    if (!wx) return ['NO WEATHER YET'];
    const t = new Date(wx.at + 9 * HOUR_MS);
    const two = (v) => String(v).padStart(2, '0');
    const r = (v) => (v === null ? '-' : Math.round(v));
    const past = wx.days.filter((d) => d.date < wx.today);
    const today = wx.days.find((d) => d.date === wx.today);
    const n = wx.now;
    return [
      (wx.src === 'api' ? 'API ' : 'RND ') + two(t.getUTCHours()) + ':' + two(t.getUTCMinutes()) + ' P' + n.p + ' W' + n.ws + ' G' + n.wg,
      'P' + past.map((d) => r(d.p)).join('/') + ' MIN' + past.map((d) => r(d.tmin)).join('/') + ' T' + (today ? r(today.tmin) : '-'),
    ].map((s) => s.slice(0, 32));
  }

  function drawTitle(ts) {
    rect('night', 0, 0, W, H);
    const st = skyNow();
    const windy = st.fall === 'storm';
    MOTES.forEach((m) => {
      const y = (((m.y - (ts / 1000) * m.v) % H) + H) % H;
      const x = windy ? (((m.x + (ts / 1000) * (60 + m.v * 8)) % W) + W) % W : m.x + Math.sin(ts / 900 + m.ph) * 3;
      rect(m.color, Math.round(x), Math.round(y), 1, 1);
    });
    if (st.fall) drawParticles(st.fall, 0, 0, W, H, ts, 70);
    if (st.drift === 'twinkle') drawParticles('twinkle', 0, 0, W, H, ts, 60);
    backBtn.draw(ctx, ts);
    drawReadout(W - 5, 5, 'right');
    drawTags(W - 5, 24, false);
    if (DEBUG) RA.text(ctx, 'DEBUG', 6, 28, { font: 'en', color: 'pink' });
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
    if (DEBUG) {
      weatherLines().forEach((s, k) => RA.text(ctx, s, 128, 218 + k * 11, { font: 'en', color: 'pink', align: 'center' }));
    } else if (!MOBILE) {
      RA.text(ctx, 'ARROWS+SPACE:SELECT  ESC:TOP', 128, 220, { font: 'en', color: 'mist', align: 'center' });
      RA.text(ctx, '1-3:POTS  Z:BOOK  U:FERT', 128, 230, { font: 'en', color: 'mist', align: 'center' });
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
    checkWeather();
    world = condAt(Date.now());
    if (scene === 'main' || scene === 'book') {
      notify(tick());
      if (scene === 'main') watchEvent();
      if (performance.now() - savedAt > SAVE_EVERY) save();
      ambience.set(document.hidden ? null : ambientKind());
      ambience.frame(performance.now());
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
    '名古屋°C%-前次飛来胞子が飛んできた！が去ったにだけ出るらしい。台風に乗ってくるらしい。の日に' +
    '季節日付どおり（）に固定天候実際の天気なし' +
    '肥料使うどの鉢に使う？でレアが出やすくなったういろう屋のクイズでもらえる胞子か幼菌の鉢に使える肥料はもう効いている個' +
    SEASONS.map((s) => s.name).join('') +
    WEATHERS.map((w) => w.name + (w.hello || '')).join('') +
    VARIANTS.map((v) => v.name + v.text.join('')).join('');

  const jobs = [];
  VARIANTS.forEach((v) => {
    img[v.id] = {};
    STAGES.forEach((st) => jobs.push(loadImage('assets/' + v.id + '-' + st + '.png').then((im) => (img[v.id][st] = im))));
  });

  // 天気は待ちすぎない（届かなければ手元の記録で留守の分を進め、あとから届いたぶんはそこから効く）
  const weatherReady = Promise.race([checkWeather() || Promise.resolve(), new Promise((resolve) => setTimeout(resolve, WEATHER_WAIT))]);

  Promise.all([...jobs, RA.textReady(CHARS), weatherReady])
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
