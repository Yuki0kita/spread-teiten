import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AMOUNT_YEN,
  MAX_AMOUNT_YEN,
  MIN_AMOUNT_YEN,
  STALE_AFTER_SECONDS,
  clampAmount,
  dayPath,
  esc,
  formatPercent,
  formatYen,
  homePath,
  isStale,
  pairPath,
  renderDailyPage,
  renderNotFound,
  renderPairPage,
} from '../src/render.ts';
import { rank } from '../src/spread.ts';
import { PAIRS } from '../src/pairs.ts';
import { t as messagesFor } from '../src/i18n.ts';
const tJa = messagesFor('ja');

const BTC = PAIRS[0];
const BASE = { siteUrl: 'https://example.com', assetVersion: '1' };

test('clampAmount: カンマや円を取り除いて読む', () => {
  assert.equal(clampAmount('100,000'), 100_000);
  assert.equal(clampAmount('50000円'), 50_000);
  assert.equal(clampAmount(' 20000 '), 20_000);
});

test('clampAmount: 範囲外は丸める', () => {
  assert.equal(clampAmount('1'), MIN_AMOUNT_YEN);
  assert.equal(clampAmount('999999999999'), MAX_AMOUNT_YEN);
});

test('clampAmount: 読めない値は既定値', () => {
  assert.equal(clampAmount(undefined), DEFAULT_AMOUNT_YEN);
  assert.equal(clampAmount(''), DEFAULT_AMOUNT_YEN);
  assert.equal(clampAmount('あ'), DEFAULT_AMOUNT_YEN);
  assert.equal(clampAmount('-500'), DEFAULT_AMOUNT_YEN);
});

test('formatYen: 桁に応じて小数を出し分ける', () => {
  assert.equal(formatYen(1961), '1,961円');
  assert.equal(formatYen(45.67), '45.7円');
  assert.equal(formatYen(4.7), '4.70円');
  assert.equal(formatYen(0), '0円');
});

test('formatYen: 1円未満を0円に丸めない', () => {
  // 「取られる額がほぼ無い取引所がある」ことが伝わらないと比較の意味が薄れる
  assert.equal(formatYen(0.0099), '0.0099円');
  assert.equal(formatYen(0.24), '0.24円');
  assert.equal(formatYen(0.00001), '0.0001円未満');
});

test('formatPercent: 桁が違っても有効数字2桁で潰さない', () => {
  // 比較記事が「約0.01%」と丸めているところを、実測のまま出せることが要件
  assert.equal(formatPercent(0.0008), '0.000008%');
  assert.equal(formatPercent(0.047), '0.00047%');
  assert.equal(formatPercent(0.5903), '0.0059%');
  assert.equal(formatPercent(3.0326), '0.03%');
  assert.equal(formatPercent(150), '1.50%');
  assert.equal(formatPercent(0), '0%');
});

test('formatPercent: 指数表記に落ちる大きさは言葉で表す', () => {
  // 1e-6%を下回るとJavaScriptが "8e-8" のような表記に切り替わってしまう
  assert.equal(formatPercent(0.000008), '0.000001%未満');
});

test('esc: HTMLに埋める値をエスケープする', () => {
  assert.equal(esc('<script>"x"&\'y\''), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
});

const pairPage = (overrides = {}) =>
  renderPairPage({
    ...BASE,
    locale: 'ja',
    pair: BTC,
    amountYen: 100_000,
    ranked: rank(
      [
        { venue: 'gmo', bid: 12_571_818, ask: 12_571_877 },
        { venue: 'coincheck', bid: 12_574_065, ask: 12_578_064 },
      ],
      100_000,
    ),
    gapYen: 7_870.5,
    observedAt: 1_787_667_040,
    now: 1_787_667_100,
    recentDays: ['2026-08-26', '2026-08-25'],
    depth: [],
    ...overrides,
  });

test('renderPairPage: 観測値があれば比較が出る', () => {
  const html = pairPage();
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /GMOコイン/);
  assert.match(html, /rank__item--best/);
  // 手数料を含まないことを画面に必ず書く
  assert.match(html, /取引手数料/);
});

test('renderPairPage: 観測値が無いときは空の案内を出す', () => {
  const html = pairPage({ ranked: [], observedAt: null });
  assert.match(html, /まだ観測データがありません/);
  assert.doesNotMatch(html, /rank__item/);
});


test('isStale: 観測が止まったら古いと認める', () => {
  const now = 1_787_667_100;
  assert.equal(isStale(now - STALE_AFTER_SECONDS, now), false);
  assert.equal(isStale(now - STALE_AFTER_SECONDS - 1, now), true);
});

test('isStale: 観測がまだ1件も無いときは「古い」とは言わない', () => {
  // 公開直後は必ずこの状態。空であることは別の文言で伝える
  assert.equal(isStale(null, 1_787_667_100), false);
});

test('renderPairPage: 観測が止まっていたら画面の先頭で断る', () => {
  const observedAt = 1_787_600_000;
  const html = pairPage({ observedAt, now: observedAt + 3_600 });
  assert.match(html, /観測が60分止まっています/);
});

test('renderNotFound: 404と500で文面が変わり、noindexが付く', () => {
  const notFound = renderNotFound('ja', 'https://example.com', '1', 404);
  assert.match(notFound, /ページが見つかりません/);
  assert.match(notFound, /name="robots" content="noindex"/);

  const failure = renderNotFound('ja', 'https://example.com', '1', 500);
  assert.match(failure, /問題が起きました/);
  // 内部情報を画面に出さない
  assert.doesNotMatch(failure, /stack|Error:|D1|DB/);
});

test('パスは /{lang}/{pair}/{date}/ の形になる', () => {
  assert.equal(homePath('ja'), '/ja/');
  assert.equal(pairPath('en', 'btc'), '/en/btc/');
  assert.equal(dayPath('ja', 'eth', '2026-08-26'), '/ja/eth/2026-08-26/');
});

test('hreflang と canonical が言語ごとに正しく出る', () => {
  const html = pairPage();
  assert.match(html, /<link rel="canonical" href="https:\/\/example.com\/ja\/btc\/">/);
  assert.match(html, /hreflang="ja" href="https:\/\/example.com\/ja\/btc\/"/);
  assert.match(html, /hreflang="en" href="https:\/\/example.com\/en\/btc\/"/);
  assert.match(html, /hreflang="x-default" href="https:\/\/example.com\/ja\/btc\/"/);
});

test('英語ページは英語で出て、canonicalも英語側を指す', () => {
  const html = pairPage({ locale: 'en' });
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example.com\/en\/btc\/">/);
  assert.match(html, /Only the spread is shown/);
  assert.doesNotMatch(html, /取引手数料/);
});

test('銘柄ページから日別ページへの導線がある', () => {
  const html = pairPage();
  assert.match(html, /\/ja\/btc\/2026-08-26\//);
});

test('renderDailyPage: 記録を表にして、金額に直した結論を添える', () => {
  const html = renderDailyPage({
    ...BASE,
    locale: 'ja',
    pair: BTC,
    day: '2026-08-26',
    rows: [
      { day: '2026-08-26', venue: 'gmo', avg_bps: 0.5, min_bps: 0.1, max_bps: 2, samples: 200 },
      { day: '2026-08-26', venue: 'bitflyer', avg_bps: 3, min_bps: 1, max_bps: 9, samples: 200 },
    ],
    prevDay: '2026-08-25',
    nextDay: null,
    amountYen: 100_000,
  });
  assert.match(html, /2026-08-26/);
  assert.match(html, /GMOコイン/);
  assert.match(html, /この日いちばん狭かったのは GMOコイン/);
  assert.match(html, /\/ja\/btc\/2026-08-25\//);
});


test('renderPairPage: 金額別の実効コスト表が出て、行ごとの最安が強調される', () => {
  const html = pairPage({
    depth: [
      { venue: 'gmo', costs: { '100000': 29, '300000': 120, '1000000': 519, '3000000': 2600, '10000000': 12000 } },
      { venue: 'bitbank', costs: { '100000': 5, '300000': 30, '1000000': 134, '3000000': 900, '10000000': 5200 } },
      { venue: 'coincheck', costs: { '100000': 13, '300000': 70, '1000000': 367, '3000000': 2400, '10000000': null } },
    ],
  });
  assert.match(html, /金額別の実効コスト/);
  assert.match(html, /cell--best/);
  // 板が足りない段は数字を出さず、そう書く
  assert.match(html, /板不足/);
  // 「板の一番上だけ」の表と混ざらないよう見出しを分ける
  assert.match(html, /板の一番上だけを見た場合/);
});

test('renderPairPage: 金額で最安が入れ替わるならそう書く', () => {
  const html = pairPage({
    depth: [
      { venue: 'gmo', costs: { '100000': 100, '300000': 100, '1000000': 100, '3000000': 100, '10000000': 1 } },
      { venue: 'bitbank', costs: { '100000': 1, '300000': 1, '1000000': 1, '3000000': 1, '10000000': 100 } },
    ],
  });
  assert.match(html, /金額によって答えが変わります/);
});

test('renderPairPage: どの金額でも同じ取引所が最安ならそう書く', () => {
  const html = pairPage({
    depth: [
      { venue: 'gmo', costs: { '100000': 100, '300000': 100, '1000000': 100, '3000000': 100, '10000000': 100 } },
      { venue: 'bitbank', costs: { '100000': 1, '300000': 1, '1000000': 1, '3000000': 1, '10000000': 1 } },
    ],
  });
  assert.match(html, /どの金額でもbitbankがいちばん安く済みます/);
});

test('renderPairPage: 板の観測がまだ無いときは、その旨だけ出す', () => {
  const html = pairPage({ depth: [] });
  assert.match(html, /まだ板を観測できていません/);
  assert.doesNotMatch(html, /cell--best/);
});


test('renderPairPage: 販売所の注意を、実効コストの表のすぐ下に出す', () => {
  const html = pairPage({
    depth: [{ venue: 'gmo', costs: { '100000': 29, '300000': 120, '1000000': 519, '3000000': 2600, '10000000': 12000 } }],
  });
  assert.match(html, /販売所/);
  assert.match(html, /notice--warn/);

  // ページ下部の注記ではなく、表の直後に出ていること
  const tableAt = html.indexOf('金額別の実効コスト');
  const warnAt = html.indexOf('notice--warn');
  const bottomNotesAt = html.indexOf('この数字について');
  assert.ok(tableAt < warnAt, '注意が表より前に出ている');
  assert.ok(warnAt < bottomNotesAt, '注意がページ下部に埋もれている');
});

test('販売所の注意に、実測していない数値を書かない', () => {
  // 販売所レートは公開APIから取れない。ここに%や円を書くと実測でない数字が混ざる
  const html = pairPage({ depth: [] });
  const lead = tJa.dealerWarnLead + tJa.dealerWarnBody;
  assert.doesNotMatch(lead, /[0-9]+\s*%/);
  assert.doesNotMatch(lead, /[0-9,]+\s*円/);
  assert.doesNotMatch(lead, /[0-9]+\s*倍/);
  assert.match(html, /板の値段だけ/);
});
