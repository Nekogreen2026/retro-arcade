/*
 * 画面内のボタンと、トップページへ戻る処理。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;

  const TONES = {
    normal: { fill: 'dusk', hi: 'mist', lo: 'night', label: 'cream' },
    primary: { fill: 'red', hi: 'orange', lo: 'maroon', label: 'cream' },
    lit: { fill: 'gold', hi: 'white', lo: 'orange', label: 'ink' },
  };

  // 左向きの小さな三角（6×7 ドット）
  function arrowLeft(ctx, x, y, color) {
    ctx.fillStyle = P[color];
    for (let i = 0; i < 4; i++) ctx.fillRect(x + i, y + 3 - i, 1, i * 2 + 1);
    ctx.fillRect(x + 4, y, 2, 7);
  }

  class Button {
    // o = { x, y, w, h, label, tone: 'normal'|'primary', icon: 'back' }
    constructor(o) {
      Object.assign(this, { h: 20, tone: 'normal', icon: null }, o);
      this.flashUntil = 0;
    }

    hit(x, y) {
      return x >= this.x && x < this.x + this.w && y >= this.y && y < this.y + this.h;
    }

    // 押した見た目を少しのあいだ出す
    flash(now) {
      this.flashUntil = now + 160;
    }

    draw(ctx, now) {
      const { x, y, w, h } = this;
      const t = TONES[now < this.flashUntil ? 'lit' : this.tone];
      // 角を1ドット欠いた縁取り
      ctx.fillStyle = P.ink;
      ctx.fillRect(x + 1, y, w - 2, h);
      ctx.fillRect(x, y + 1, w, h - 2);
      ctx.fillStyle = P[t.fill];
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      ctx.fillStyle = P[t.hi];
      ctx.fillRect(x + 2, y + 1, w - 4, 1);
      ctx.fillStyle = P[t.lo];
      ctx.fillRect(x + 2, y + h - 2, w - 4, 1);
      const ty = y + Math.round((h - 16) / 2);
      if (this.icon === 'back') {
        arrowLeft(ctx, x + 6, y + Math.round((h - 7) / 2), t.label);
        RA.text(ctx, this.label, x + 15 + (w - 15) / 2 - 2, ty, { color: t.label, align: 'center' });
      } else {
        RA.text(ctx, this.label, x + w / 2, ty, { color: t.label, align: 'center' });
      }
    }
  }

  RA.Button = Button;

  // 各ゲーム共通の「もどる」ボタン（左上）
  RA.backButton = function () {
    return new Button({ x: 4, y: 4, w: 64, h: 20, label: 'もどる', icon: 'back' });
  };

  // ゲームは games/<名前>/index.html にあるので、トップは2階層上
  RA.TOP_PATH = '../../index.html';

  RA.goTop = function () {
    location.href = RA.TOP_PATH;
  };

  // トップページの絶対URL（共有文に入れる用）
  RA.topUrl = function () {
    return new URL('../../', location.href).href;
  };
})();
