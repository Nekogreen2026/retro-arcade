/*
 * 筐体の一覧。1行＝1台。ここに1行足すと、店内に筐体が1台増える（並び順＝店内の並び順）。
 *   id    : games/ の下のフォルダ名（games/<id>/index.html が入口になる）
 *   title : 看板に出す名前
 *   desc  : 一言紹介（全角15文字まで）
 *   color : 看板の色（shared/palette.js の色名: red, orange, gold, green, blue, cyan, pink, brown など）
 *   thumb : 筐体の画面に映す絵（ゲームのフォルダからの相対パス。配列なら順番に切り替わる。省略可）
 */
window.GAMES = [
  { id: 'iai', title: '居合', desc: '鬼を斬れ。猫天使は斬るな。', color: 'red', thumb: ['assets/oni.png', 'assets/neko.png'] },
  { id: 'kinshi', title: '菌糸ライフ', desc: '菌を育てよ。萎れても標本だ。', color: 'green', thumb: ['assets/plain-spore.png', 'assets/plain-young.png', 'assets/plain-adult.png'] },
];
