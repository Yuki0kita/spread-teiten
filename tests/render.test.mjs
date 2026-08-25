import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AMOUNT_YEN,
  MAX_AMOUNT_YEN,
  MIN_AMOUNT_YEN,
  STALE_AFTER_SECONDS,
  clampAmount,
  esc,
  formatPercent,
  formatYen,
  isStale,
  renderNotFound,
  renderPage,
} from '../src/render.ts';
import { rank } from '../src/spread.ts';

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

test('renderPage: 観測値があれば比較が出る', () => {
  const ranked = rank(
    [
      { venue: 'gmo', bid: 12_571_818, ask: 12_571_877 },
      { venue: 'coincheck', bid: 12_574_065, ask: 12_578_064 },
    ],
    100_000,
  );
  const html = renderPage({
    amountYen: 100_000,
    ranked,
    gapYen: 7_870.5,
    observedAt: 1_787_667_040,
    now: 1_787_667_100,
    assetVersion: '1',
    siteUrl: 'https://example.com',
  });

  assert.match(html, /<html lang="ja">/);
  assert.match(html, /GMOコイン/);
  assert.match(html, /rank__item--best/);
  // 手数料を含まないことを画面に必ず書く
  assert.match(html, /取引手数料/);
});

test('renderPage: 観測値が無いときは空の案内を出す', () => {
  const html = renderPage({
    amountYen: 100_000,
    ranked: [],
    gapYen: 0,
    observedAt: null,
    now: 1_787_667_100,
    assetVersion: '1',
    siteUrl: 'https://example.com',
  });
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

test('renderPage: 観測が止まっていたら画面の先頭で断る', () => {
  const observedAt = 1_787_600_000;
  const html = renderPage({
    amountYen: 100_000,
    ranked: rank([{ venue: 'gmo', bid: 100, ask: 101 }], 100_000),
    gapYen: 0,
    observedAt,
    now: observedAt + 3_600,
    assetVersion: '1',
    siteUrl: 'https://example.com',
  });
  assert.match(html, /観測が60分止まっています/);
});

test('renderNotFound: 404と500で文面が変わり、noindexが付く', () => {
  const notFound = renderNotFound('1', 404);
  assert.match(notFound, /ページが見つかりません/);
  assert.match(notFound, /name="robots" content="noindex"/);

  const failure = renderNotFound('1', 500);
  assert.match(failure, /問題が起きました/);
  // 内部情報を画面に出さない
  assert.doesNotMatch(failure, /stack|Error:|D1|DB/);
});
