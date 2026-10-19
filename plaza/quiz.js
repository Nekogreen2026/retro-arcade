/*
 * にゃらゲームプラザ — 名古屋っ子クイズ（ういろう屋のお姉さんが出す、1日1問の3択）。
 * 問題は日本時間の日付で決まる。その日のうちは何度開いても同じ問題・同じ並びで、
 * 全問を出し終わるまで同じ問題は出ない。答えたらその日はおしまい（正解ならういろう肥料1個）。
 * 記録は retro-arcade:top:quiz に { date: 答えた問題の日付, ok: 正解したか }。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const Plaza = window.Plaza;
  const { seeded } = Plaza.kit;
  const KEY = ['top', 'quiz'];

  // a の先頭が正解（出すときに並びを混ぜる）。答えの字数は全角9字まで（選択肢のボタンに収まる長さ）
  const QUESTIONS = [
    { q: '「えらい」って、どういう意味？', a: ['疲れた', '偉い', '怒っている'] },
    { q: '「けった」って、なんのこと？', a: ['自転車', 'サッカー', '蹴り'] },
    { q: '「机をつる」って、どうすること？', a: ['机を運ぶ', '机を吊るす', '机を拭く'] },
    { q: '「B紙」って、どんな紙？', a: ['模造紙', 'B4の紙', '包装紙'] },
    { q: '「ときんときん」って、どんな様子？', a: ['先がとがっている', '時計の音', 'ドキドキする'] },
    { q: '「お湯がちんちん」って、お湯がどうなっとるの？', a: ['とても熱い', 'ぬるい', '沸いていない'] },
    { q: '「でら」って、どういう意味？', a: ['とても', '寺', 'ダメ'] },
    { q: '「だだくさ」って、どういう意味？', a: ['粗末・いいかげん', '草だらけ', '大急ぎ'] },
    { q: '「先生が来てみえる」って、先生がどうしとるの？', a: ['いらっしゃっている', '見える位置にいる', '見に来る'] },
    { q: '喫茶店で朝、飲み物を頼むとトーストなどが付いてくるサービスは？', a: ['モーニング', 'ブランチ', 'サービスセット'] },
    { q: '学校の「放課」って、なんのこと？', a: ['休み時間', '放課後', '課外授業'] },
    { q: '「鍵をかう」って、どうすること？', a: ['鍵をかける', '鍵を買う', '鍵をなくす'] },
    { q: '「そんなもん、あらすか」って、どういう意味？', a: ['あるわけがない', '荒らしてやる', '洗っておいて'] },
    { q: '「たわけ」って、どういう意味？', a: ['ばか者', '働き者', '酒飲み'] },
    { q: '「やっとかめ」って、どういう意味？', a: ['久しぶり', 'やっと終わった', 'ゆっくりね'] },
    { q: '「はよ、まわししやー」の「まわし」って？', a: ['支度', '掃除', '相撲のまわし'] },
    { q: '「食べすぎて、ずつない」の「ずつない」って？', a: ['苦しい', 'ずるい', 'つまらない'] },
    { q: '「時計がこわけた」って、時計がどうなったの？', a: ['壊れた', '怖くなった', '分けられた'] },
    { q: '「おそがい」って、どういう意味？', a: ['怖い', '遅い', '寒い'] },
    { q: '「行こまい」って、どういう意味？', a: ['行こう', '行かない', '行くな'] },
    { q: '「ゴミ、ほかっといて」って、ゴミをどうするの？', a: ['捨てる', '拾う', '分ける'] },
    { q: '「いりゃあせ」って、どういう意味？', a: ['いらっしゃいませ', 'いりません', '入れてください'] },
    { q: '「よう、かんこうしやー」の「かんこう」って？', a: ['工夫すること', '観光すること', '感動すること'] },
    { q: '名古屋城の屋根の上で光っとる、金の飾りは？', a: ['しゃちほこ', '鯉のぼり', '鳳凰'] },
    { q: '名古屋の「味噌カツ」。とんかつに何がかかっとる？', a: ['味噌だれ', 'ケチャップ', '醤油だれ'] },
    { q: '「ひつまぶし」の3杯目は、どうやって食べる？', a: ['だしでお茶漬け', '卵でとじる', '冷やして食べる'] },
    { q: '名古屋名物「ういろう」の、おもな材料は？', a: ['米粉', '小麦粉', '寒天'] },
    { q: '喫茶店の「小倉トースト」に、のっとるのは？', a: ['あんこ', 'チョコ', '黒ごま'] },
    { q: '名古屋の嫁入りで、ご近所にまいて配るのは？', a: ['お菓子', '豆', '花びら'] },
    { q: '名古屋めし「天むす」の具は？', a: ['えびの天ぷら', 'かき揚げ', 'いかの天ぷら'] },
  ];

  function shuffle(list, rnd) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 出す順番（1周ぶん。日付の通し番号で先へ進む）
  const ORDER = shuffle(
    QUESTIONS.map((_, i) => i),
    seeded(1996)
  );

  // 'YYYY-MM-DD' → 1970年1月1日からの日数
  const dayNumber = (date) => Math.floor(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000);

  // 今日の日付（日本時間）
  const today = () => RA.Weather.jst(Date.now()).date;

  // その日の問題。{ q: 問題文, choices: [{ text, ok }, …]（並びは日ごとに混ぜる）, answer: 正解の文字 }
  function question(date) {
    const n = dayNumber(date);
    const item = QUESTIONS[ORDER[((n % ORDER.length) + ORDER.length) % ORDER.length]];
    const choices = shuffle(
      item.a.map((text, i) => ({ text, ok: i === 0 })),
      seeded(n * 7 + 3)
    );
    return { q: item.q, choices, answer: item.a[0] };
  }

  function load() {
    try {
      const r = JSON.parse(RA.Store.get(KEY, 'null'));
      if (r && typeof r.date === 'string' && typeof r.ok === 'boolean') return r;
    } catch (e) {
      // 壊れた記録は、まだ答えていないものとみなす
    }
    return null;
  }

  // その日の記録（まだ答えていなければ null）
  function result(date) {
    const r = load();
    return r && r.date === date ? r : null;
  }

  // date の問題に答えた。正解ならういろう肥料を1個足す。返り値は答えたあとの所持数
  function answer(date, ok) {
    try {
      RA.Store.set(KEY, JSON.stringify({ date, ok }));
    } catch (e) {
      // 保存できなくても、その場の会話は続ける
    }
    return ok ? RA.Fertilizer.add(1) : RA.Fertilizer.count();
  }

  // 確認用（?debug=1 の Q）。今日の記録を消して、もう一度答えられるようにする
  function reset() {
    RA.Store.set(KEY, 'null');
  }

  const CHARS = QUESTIONS.map((x) => x.q + x.a.join('')).join('');

  Plaza.quiz = { QUESTIONS, CHARS, today, question, result, answer, reset };
})();
