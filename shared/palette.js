/*
 * 全体共通の16色パレット。サイト内で使う色はすべてここから取る。
 * 描画では RA.P.名前（例: RA.P.red）を使う。番号で引くときは RA.PALETTE[番号]。
 * CSS からは var(--pal-名前) で参照できる。
 */
(function () {
  'use strict';
  const RA = (window.RA = window.RA || {});

  const LIST = [
    ['ink', '#1A161E'], //  0 墨（ドット絵の K）
    ['night', '#2B2340'], //  1 夜空
    ['dusk', '#45385F'], //  2 宵闇
    ['mist', '#6E6487'], //  3 霞
    ['silver', '#A8A3B8'], //  4 銀鼠
    ['cream', '#F4ECDC'], //  5 生成り（ドット絵の W）
    ['white', '#FFFFFF'], //  6 白（ドット絵の H）
    ['maroon', '#6B1E2E'], //  7 臙脂
    ['red', '#D8343F'], //  8 朱
    ['orange', '#F2803A'], //  9 橙
    ['gold', '#FFD45C'], // 10 金
    ['green', '#3F9E5A'], // 11 若竹
    ['blue', '#2E4F9E'], // 12 瑠璃
    ['cyan', '#4FC8E0'], // 13 水
    ['pink', '#E8509A'], // 14 桃
    ['brown', '#7A4E36'], // 15 栗
  ];

  RA.PALETTE = Object.freeze(LIST.map((c) => c[1]));
  RA.P = Object.freeze(Object.fromEntries(LIST));
  RA.PAL_NAMES = Object.freeze(LIST.map((c) => c[0]));

  // 名前を RGB 配列に（文字のしきい値処理で使う）
  RA.rgb = function (name) {
    const hex = RA.P[name];
    if (!hex) throw new Error('パレットにない色: ' + name);
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  };

  const style = document.documentElement.style;
  LIST.forEach(([name, hex]) => style.setProperty('--pal-' + name, hex));
})();
