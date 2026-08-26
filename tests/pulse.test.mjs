import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_RATIO,
  MIN_BASELINE_BPS,
  WATCH_RATIO,
  formatRatio,
  levelOf,
  loudest,
  median,
  overallLevel,
  ratioOf,
} from '../src/pulse.ts';

test('median: 奇数個は真ん中、偶数個は真ん中2つの平均', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([5]), 5);
});

test('median: 極端な値に引きずられない', () => {
  // 平均だと 200 を超えるが、中央値は動かない。これが基準に中央値を使う理由
  assert.equal(median([1, 1, 1, 1, 1000]), 1);
});

test('median: 空や非数はnull／無視', () => {
  assert.equal(median([]), null);
  assert.equal(median([NaN, Infinity]), null);
  assert.equal(median([1, NaN, 3]), 2);
});

test('ratioOf: 平常時の何倍かを出す', () => {
  assert.equal(ratioOf(10, 2), 5);
  assert.equal(ratioOf(2, 2), 1);
});

test('ratioOf: 基準が極端に小さくても倍率が跳ねない', () => {
  // 板が1円差で張り付いている取引所では基準がほぼ0になる。
  // 下限で頭を押さえないと、平常時なのに何百倍と表示されてしまう
  const withFloor = ratioOf(1, 0.0001);
  assert.equal(withFloor, 1 / MIN_BASELINE_BPS);
  assert.ok(withFloor < 100, `倍率が跳ねている: ${withFloor}`);
});

test('ratioOf: 値が無ければnull', () => {
  assert.equal(ratioOf(null, 2), null);
  assert.equal(ratioOf(10, null), null);
  assert.equal(ratioOf(NaN, 2), null);
});

test('levelOf: しきい値ちょうどは上の段階に入る', () => {
  assert.equal(levelOf(ALERT_RATIO), 'alert');
  assert.equal(levelOf(ALERT_RATIO - 0.01), 'watch');
  assert.equal(levelOf(WATCH_RATIO), 'watch');
  assert.equal(levelOf(WATCH_RATIO - 0.01), 'calm');
  assert.equal(levelOf(1), 'calm');
  // 判定できないときは騒がない
  assert.equal(levelOf(null), 'calm');
});

const pulse = (venue, ratio) => ({
  venue,
  bps: ratio === null ? null : ratio,
  baselineBps: 1,
  ratio,
  level: levelOf(ratio),
  spark: [],
});

test('overallLevel: ひとつでも荒れていればそちらを名乗る', () => {
  assert.equal(overallLevel([pulse('a', 1), pulse('b', 1.2)]), 'calm');
  assert.equal(overallLevel([pulse('a', 1), pulse('b', 3)]), 'watch');
  assert.equal(overallLevel([pulse('a', 3), pulse('b', 9)]), 'alert');
  assert.equal(overallLevel([]), 'calm');
});

test('loudest: いちばん開いている取引所を返す', () => {
  assert.equal(loudest([pulse('a', 1), pulse('b', 7), pulse('c', 3)])?.venue, 'b');
  // 判定できないものしか無ければnull
  assert.equal(loudest([pulse('a', null)]), null);
});

test('formatRatio: 読み取れない細かさは出さない', () => {
  assert.equal(formatRatio(1.04), '1.0倍');
  assert.equal(formatRatio(3.26), '3.3倍');
  assert.equal(formatRatio(12.4), '12倍');
  assert.equal(formatRatio(null), '—');
});
