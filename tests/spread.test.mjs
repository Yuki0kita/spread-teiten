import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketOf,
  isPlausible,
  jstDay,
  rank,
  roundTripCostYen,
  spreadBps,
  venueGapYen,
} from '../src/spread.ts';

test('spreadBps: 中値を分母にして計算する', () => {
  // bid 100, ask 102 → 差2, 中値101 → 約198.02bps
  assert.equal(Math.round(spreadBps(100, 102) * 100) / 100, 198.02);
  assert.equal(spreadBps(100, 100), 0);
});

test('spreadBps: 実測値でも桁が合う', () => {
  // 2026-08-25 14:10 のGMOコインの実測値
  const bps = spreadBps(12_571_818, 12_571_877);
  assert.ok(bps > 0.04 && bps < 0.06, `期待した桁と違う: ${bps}`);
});

test('roundTripCostYen: 買値で買って売値で売り戻した差額', () => {
  // 10万円を ask=102 で買うと 980.39... 単位。bid=100 で売ると 98,039円。
  const cost = roundTripCostYen(100_000, 100, 102);
  assert.equal(Math.round(cost), 1961);
  assert.equal(Math.round((100_000 * 2) / 102), 1961);
});

test('roundTripCostYen: スプレッドが無ければコストは0', () => {
  assert.equal(roundTripCostYen(100_000, 100, 100), 0);
});

test('roundTripCostYen: 金額が0以下なら例外', () => {
  assert.throws(() => roundTripCostYen(0, 100, 102), RangeError);
  assert.throws(() => roundTripCostYen(-1, 100, 102), RangeError);
});

test('isPlausible: 売値が買値を下回る板は記録しない', () => {
  assert.equal(isPlausible(102, 100), false);
});

test('isPlausible: 20%を超えるスプレッドは壊れているとみなす', () => {
  assert.equal(isPlausible(100, 125), false); // 中値112.5に対して22.2%
  assert.equal(isPlausible(100, 122), true); // 中値111に対して19.8%
});

test('isPlausible: 0や非数は落とす', () => {
  assert.equal(isPlausible(0, 100), false);
  assert.equal(isPlausible(100, 0), false);
  assert.equal(isPlausible(NaN, 100), false);
  assert.equal(isPlausible(100, Infinity), false);
});

test('rank: スプレッドの狭い順に並ぶ', () => {
  const ranked = rank(
    [
      { venue: 'coincheck', bid: 12_574_065, ask: 12_578_064 },
      { venue: 'gmo', bid: 12_571_818, ask: 12_571_877 },
      { venue: 'bitbank', bid: 12_578_335, ask: 12_581_101 },
    ],
    100_000,
  );
  assert.deepEqual(
    ranked.map((r) => r.venue),
    ['gmo', 'bitbank', 'coincheck'],
  );
  // 狭いほど失う金額も小さい
  assert.ok(ranked[0].costYen < ranked[1].costYen);
  assert.ok(ranked[1].costYen < ranked[2].costYen);
});

test('rank: 同じスプレッドなら取引所IDで安定して並ぶ', () => {
  const ranked = rank(
    [
      { venue: 'zzz', bid: 100, ask: 101 },
      { venue: 'aaa', bid: 100, ask: 101 },
    ],
    100_000,
  );
  assert.deepEqual(
    ranked.map((r) => r.venue),
    ['aaa', 'zzz'],
  );
});

test('venueGapYen: 同じ瞬間の中値の最大差', () => {
  const gap = venueGapYen([
    { venue: 'gmo', bid: 12_571_818, ask: 12_571_877 },
    { venue: 'bitbank', bid: 12_578_335, ask: 12_581_101 },
  ]);
  // GMOの中値 12,571,847.5 と bitbankの中値 12,579,718 の差
  assert.equal(gap, 7_870.5);
});

test('venueGapYen: 1件以下なら0', () => {
  assert.equal(venueGapYen([]), 0);
  assert.equal(venueGapYen([{ venue: 'gmo', bid: 100, ask: 101 }]), 0);
});

test('bucketOf: 10分単位に切り捨てる', () => {
  assert.equal(bucketOf(1_787_667_040), 1_787_667_000);
  assert.equal(bucketOf(600), 600);
  assert.equal(bucketOf(599), 0);
});

test('jstDay: 日付の区切りは日本時間', () => {
  // 2026-08-25T14:59:00Z = JST 23:59 → まだ8/25
  assert.equal(jstDay(Date.UTC(2026, 7, 25, 14, 59, 0) / 1000), '2026-08-25');
  // 2026-08-25T15:00:00Z = JST 翌0:00 → 8/26
  assert.equal(jstDay(Date.UTC(2026, 7, 25, 15, 0, 0) / 1000), '2026-08-26');
});
