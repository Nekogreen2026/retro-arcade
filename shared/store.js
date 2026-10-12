/*
 * localStorage。キーは必ず「retro-arcade:ゲーム名:項目」
 * （区分があるときは「retro-arcade:ゲーム名:区分:項目」）の形になる。
 *   RA.Store.key('iai', 'pc', 'best-count') → 'retro-arcade:iai:pc:best-count'
 * 保存できない環境（プライベートモードなど）でも落ちないようにしてある。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const SITE = 'retro-arcade';

  function key(...parts) {
    if (parts.length < 2 || parts.length > 3) throw new Error('キーは ゲーム名:項目 か ゲーム名:区分:項目');
    parts.forEach((p) => {
      if (!/^[a-z0-9-]+$/.test(p)) throw new Error('キーに使えない文字: ' + p);
    });
    return [SITE, ...parts].join(':');
  }

  RA.Store = {
    key,
    get(parts, fallback) {
      try {
        const v = localStorage.getItem(key(...parts));
        return v == null ? fallback : v;
      } catch (e) {
        return fallback;
      }
    },
    getNumber(parts, fallback) {
      const v = Number(this.get(parts, NaN));
      return Number.isFinite(v) ? v : fallback;
    },
    set(parts, value) {
      try {
        localStorage.setItem(key(...parts), String(value));
        return true;
      } catch (e) {
        return false;
      }
    },
  };
})();
