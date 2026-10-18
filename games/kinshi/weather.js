/*
 * 菌糸ライフ — 名古屋の季節と天気。
 *
 * 季節は現実の日付（日本時間）で決まる。天気は Open-Meteo（APIキー不要）から名古屋の値を取る。
 *   いま   … 気温・湿度・降水量・風速・最大瞬間風速（風速は m/s）
 *   日ごと … 過去3日と今日の、降水量と最低気温
 * 取得は1時間に1回まで（失敗も1回に数える）。結果は localStorage に置き、開くたびには取りに行かない。
 * 取れなかったときは、季節なりのランダムな天気で代用する（src が 'fallback' になる）。
 * ここは「天気から天候イベントを判定する」までを受け持つ。ゲームへの効き方は game.js で決める。
 */
(function () {
  'use strict';
  const RA = window.RA;

  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  const JST = 9 * HOUR; // 日本時間（UTC+9、夏時間なし）
  const FETCH_EVERY = HOUR; // 取得は1時間に1回まで
  const VALID = 3 * HOUR; // 「いま」の値を、取得の時刻からこの長さだけ有効とみなす
  const TIMEOUT = 8000;
  const KEY = ['kinshi', 'weather'];

  // 名古屋（緯度35.18, 経度136.91）
  const API =
    'https://api.open-meteo.com/v1/forecast?latitude=35.18&longitude=136.91' +
    '&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m' +
    '&daily=precipitation_sum,temperature_2m_min&past_days=3&forecast_days=1' +
    '&wind_speed_unit=ms&timezone=Asia%2FTokyo';

  // 天候イベントの判定
  const TYPHOON_GUST = 20; // 最大瞬間風速（m/s）がこれ以上なら台風
  const TYPHOON_WIND = 10; // 平均風速（m/s）がこれ以上で、しかも雨なら台風
  const HEAT_TEMP = 35; // 気温がこれ以上なら猛暑
  const WET_MM = 1; // 1日の降水量がこれ以上なら「降水あり」（気象庁の降水日数の目安）
  const FROST_MIN = 3; // その日の最低気温がこれ以下なら初霜

  // 季節。from は始まる日（月×100＋日）。梅雨は名古屋の平年（6/6ごろ〜7/19ごろ）に合わせる
  const SEASONS = [
    { id: 'spring', name: '春', from: 301 },
    { id: 'rainy', name: '梅雨', from: 606 },
    { id: 'summer', name: '夏', from: 720 },
    { id: 'autumn', name: '秋', from: 923 },
    { id: 'winter', name: '冬', from: 1201 },
  ];
  // 季節ごとの名古屋のおおよその平年値と、代用の天気の作り方
  //   t 気温, rh 湿度, tmin 最低気温, wet 雨の日の割合, typhoon・heat その時間が台風・猛暑になる割合
  const NORMAL = [
    { t: 15, rh: 62, tmin: 9, wet: 0.3, typhoon: 0, heat: 0 },
    { t: 24, rh: 78, tmin: 20, wet: 0.55, typhoon: 0.01, heat: 0 },
    { t: 29, rh: 72, tmin: 24, wet: 0.25, typhoon: 0.02, heat: 0.12 },
    { t: 18, rh: 68, tmin: 12, wet: 0.25, typhoon: 0.02, heat: 0 },
    { t: 6, rh: 63, tmin: 1, wet: 0.2, typhoon: 0, heat: 0 },
  ];

  // ===== 日本時間の暦 =====
  const pad = (n) => String(n).padStart(2, '0');

  // ms → { date: 'YYYY-MM-DD', md: 月×100＋日, h: 時（小数） }
  function jst(ms) {
    const t = new Date(ms + JST);
    const m = t.getUTCMonth() + 1;
    const d = t.getUTCDate();
    return { date: t.getUTCFullYear() + '-' + pad(m) + '-' + pad(d), md: m * 100 + d, h: t.getUTCHours() + t.getUTCMinutes() / 60 };
  }

  // 'YYYY-MM-DD' を n 日ずらす
  function shiftDate(date, n) {
    const t = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + n * DAY);
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }

  // その時刻の季節（SEASONS の番号）。1月〜2月末は冬
  function seasonAt(ms) {
    const md = jst(ms).md;
    let s = SEASONS.length - 1;
    SEASONS.forEach((x, i) => {
      if (md >= x.from) s = i;
    });
    return s;
  }

  // ms のあとの、日本時間の0時
  function nextMidnight(ms) {
    return Math.floor((ms + JST) / DAY) * DAY + DAY - JST;
  }

  // ===== 記録 =====
  // rec = { at: 取得を試みた時刻, src: 'api'|'fallback', today: 'YYYY-MM-DD',
  //         now: { t 気温, rh 湿度, p 降水量mm, ws 風速, wg 最大瞬間風速 },
  //         days: [{ date, p 降水量mm, tmin 最低気温 }, …]（過去3日と今日。古い順。値が欠けていれば null） }
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const numOr = (v, d) => (isNum(v) ? v : d);
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

  function valid(r) {
    if (!r || !isNum(r.at) || (r.src !== 'api' && r.src !== 'fallback') || !isDate(r.today) || !r.now) return false;
    if (!['t', 'rh', 'p', 'ws', 'wg'].every((k) => isNum(r.now[k]))) return false;
    return Array.isArray(r.days) && r.days.every((d) => d && isDate(d.date) && (d.p === null || isNum(d.p)) && (d.tmin === null || isNum(d.tmin)));
  }

  function load() {
    try {
      const r = JSON.parse(RA.Store.get(KEY, 'null'));
      return valid(r) ? r : null;
    } catch (e) {
      return null;
    }
  }

  function save(rec) {
    RA.Store.set(KEY, JSON.stringify(rec));
  }

  // 取りに行ってよいか（前回の試みから1時間たったか。時計が戻っていたら取り直す）
  function due(rec, now) {
    return !rec || now - rec.at >= FETCH_EVERY || rec.at > now + 60000;
  }

  // Open-Meteo の答えを記録の形に
  function parse(j, at) {
    const c = j && j.current;
    const d = j && j.daily;
    if (!c || !d || !Array.isArray(d.time) || !isNum(c.temperature_2m) || !isNum(c.relative_humidity_2m)) throw new Error('weather');
    const today = isDate(String(c.time).slice(0, 10)) ? String(c.time).slice(0, 10) : jst(at).date;
    const col = (name, i) => (Array.isArray(d[name]) && isNum(d[name][i]) ? d[name][i] : null);
    const days = d.time
      .map((date, i) => ({ date, p: col('precipitation_sum', i), tmin: col('temperature_2m_min', i) }))
      .filter((x) => isDate(x.date) && x.date <= today)
      .slice(-4);
    const now = {
      t: c.temperature_2m,
      rh: c.relative_humidity_2m,
      p: numOr(c.precipitation, 0),
      ws: numOr(c.wind_speed_10m, 0),
      wg: numOr(c.wind_gusts_10m, numOr(c.wind_speed_10m, 0)),
    };
    return { at, src: 'api', today, now, days };
  }

  // 取れなかったときの代用。季節の平年値のまわりで、時刻なりにばらつかせる
  function fallback(at) {
    const n = NORMAL[seasonAt(at)];
    const r = Math.random;
    const spread = (v) => (r() * 2 - 1) * v;
    const one = (v) => Math.round(v * 10) / 10;
    const { date: today, h } = jst(at);
    const daily = -Math.cos(((h - 3) / 24) * 2 * Math.PI) * 4; // 明け方がいちばん寒く、昼すぎがいちばん暑い
    let t = n.t + daily + spread(3);
    let rh = n.rh - daily * 2 + spread(10);
    let p = r() < n.wet ? one(0.2 + r() * 3) : 0;
    let ws = 1 + r() * 4;
    let wg = ws * (1.4 + r() * 0.8);
    if (h >= 11 && h <= 17 && r() < n.heat) t = HEAT_TEMP + r() * 2.5;
    if (r() < n.typhoon) {
      ws = 11 + r() * 6;
      wg = 21 + r() * 10;
      p = one(4 + r() * 16);
    }
    if (p > 0) rh = Math.max(rh, 85);
    const days = [3, 2, 1, 0].map((k) => ({ date: shiftDate(today, -k), p: r() < n.wet ? one(1 + r() * 12) : 0, tmin: one(n.tmin + spread(3)) }));
    const last = days[3];
    last.tmin = Math.min(last.tmin, one(t));
    last.p = Math.max(last.p, p);
    return { at, src: 'fallback', today, now: { t: one(t), rh: Math.round(Math.max(20, Math.min(100, rh))), p, ws: one(ws), wg: one(wg) }, days };
  }

  // 名古屋の天気を取って保存する。失敗したら代用の天気を保存して返す（Promise は必ず成功で終わる）
  function update(at) {
    const done = (rec) => {
      save(rec);
      return rec;
    };
    if (!window.fetch || navigator.onLine === false) return Promise.resolve(done(fallback(at)));
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), TIMEOUT);
    return fetch(API, { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then((res) => {
        if (!res.ok) throw new Error('weather ' + res.status);
        return res.json();
      })
      .then((j) => parse(j, at))
      .catch(() => fallback(at))
      .then((rec) => {
        clearTimeout(timer);
        return done(rec);
      });
  }

  // ===== 天候イベントの判定 =====
  // その日に降水があったか。今日は「いま降っている」も数える。記録にない日は null
  function wetOn(rec, date) {
    const day = rec.days.find((x) => x.date === date);
    if (!day) return null;
    if (date === rec.today && rec.now.p > 0) return true;
    return day.p !== null && day.p >= WET_MM;
  }

  // 日単位のイベント（長雨・初霜）。記録の範囲外の日は null
  //   長雨 … 3日続けて降水あり（過去3日すべて、または おととい・きのう・きょう）
  //   初霜 … その日の最低気温が3°C以下（今日はいまの気温も含めて見る）
  function dayEvents(rec, date) {
    const day = rec && rec.days.find((x) => x.date === date);
    if (!day) return null;
    const wet = (n) => wetOn(rec, shiftDate(date, -n)) === true;
    let tmin = day.tmin;
    if (date === rec.today) tmin = tmin === null ? rec.now.t : Math.min(tmin, rec.now.t);
    return {
      rain3: (wet(0) && wet(1) && wet(2)) || (wet(1) && wet(2) && wet(3)),
      frost: tmin !== null && tmin <= FROST_MIN,
    };
  }

  // いまのイベント（台風・猛暑）
  //   台風 … 最大瞬間風速20m/s以上、または平均風速10m/s以上でしかも雨
  //   猛暑 … 気温35°C以上
  function nowEvents(rec) {
    const n = rec.now;
    return {
      typhoon: n.wg >= TYPHOON_GUST || (n.ws >= TYPHOON_WIND && n.p > 0),
      heat: n.t >= HEAT_TEMP,
    };
  }

  window.KinshiWeather = { SEASONS, NORMAL, VALID, jst, shiftDate, seasonAt, nextMidnight, load, due, update, parse, fallback, dayEvents, nowEvents };
})();
