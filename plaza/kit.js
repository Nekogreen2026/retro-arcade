/*
 * にゃらゲームプラザ（トップページ）の部品の置き場と、描画の小道具。
 * plaza/ の各ファイルは window.Plaza に自分の受け持ちを足していく。
 *   kit.js    … 描画の小道具・日本時間の暦
 *   sky.js    … 空（名古屋の天気と、日本時間の朝・昼・夕・夜）
 *   sound.js  … 商店街と店内の環境音、効果音
 *   street.js … 画面1 街並み（大須・1996年）
 *   inside.js … 画面3 店内
 * 場面の切り替え・入店の演出・入力は ../index.js が受け持つ。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const Plaza = (window.Plaza = window.Plaza || {});

  // 4×4 のディザ（中間色を作らずに、2色の割合で濃淡を出す）
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

  // g に、パレットの色で矩形を塗る関数を作る
  function painter(g) {
    return (color, x, y, w, h) => {
      g.fillStyle = P[color];
      g.fillRect(x, y, w, h);
    };
  }

  // 文字の行で描く小さな絵。map は文字→色名（'.' は透けたまま）。flip で左右反転
  function pix(g, rows, x, y, map, flip) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const color = map[row[i]];
        if (!color) continue;
        g.fillStyle = P[color];
        g.fillRect(x + (flip ? row.length - 1 - i : i), y + j, 1, 1);
      }
    });
  }

  // 範囲 (x, y, w, h) のうち、lv(x, y)（0〜1）の割合の点を color で塗る
  function dither(g, color, x, y, w, h, lv) {
    g.fillStyle = P[color];
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) if (bayer(i, j) < (typeof lv === 'function' ? lv(i, j) : lv)) g.fillRect(i, j, 1, 1);
    }
  }

  // 1ドットの線（ブレゼンハム）
  function line(g, color, x0, y0, x1, y1) {
    g.fillStyle = P[color];
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      g.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  const ease = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ===== 日本時間の暦 =====
  const JST = 9 * 3600 * 1000;
  const WEEK = '日月火水木金土';
  const two = (n) => String(n).padStart(2, '0');

  // ms → { y, m, d, h（時、小数）, wd（曜日の字）, doy（1月1日を0とした日数） }
  function jstNow(ms) {
    const t = new Date(ms + JST);
    const y = t.getUTCFullYear();
    const doy = Math.floor((Date.UTC(y, t.getUTCMonth(), t.getUTCDate()) - Date.UTC(y, 0, 1)) / 86400000);
    return { y, m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours() + t.getUTCMinutes() / 60, wd: WEEK[t.getUTCDay()], doy };
  }

  // その年の同じ月日の曜日（1996年はうるう年なので、2月29日もある）
  const weekdayIn = (y, m, d) => WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

  // 「1996.10.19」
  const dateText = (y, m, d) => y + '.' + two(m) + '.' + two(d);

  Plaza.kit = { bayer, seeded, makeCanvas, painter, pix, dither, line, ease, clamp, jstNow, weekdayIn, dateText, two };
  Plaza.YEAR = 1996; // 店の中の年
})();
