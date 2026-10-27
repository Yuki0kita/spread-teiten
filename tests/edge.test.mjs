/**
 * 境界値と異常系。0除算・空板・APIエラーで嘘の数字が出ないことを確かめる。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { costFromBps, isPlausible, roundTripCostYen, spreadBps } from '../src/spread.ts';
import { buyQuantity, roundTripCost, sellProceeds } from '../src/depth.ts';
import { fetchBooks, fetchPair, parseBitbankBook, parseCoincheck, VenueError } from '../src/venues.ts';

/* 0除算 ------------------------------------------------------------- */

test('spreadBps: 0や負の気配値は0除算せずに例外', () => {
  assert.throws(() => spreadBps(0, 0), RangeError);
  assert.throws(() => spreadBps(-1, 1), RangeError);
  assert.throws(() => spreadBps(Number.NaN, 1), RangeError);
});

test('roundTripCostYen: ask=0は例外（分母0にしない）', () => {
  assert.throws(() => roundTripCostYen(100_000, 1, 0), RangeError);
  assert.throws(() => roundTripCostYen(Number.NaN, 1, 2), RangeError);
});

test('costFromBps: 0・負のbpsは0円、金額が0以下は例外', () => {
  assert.equal(costFromBps(100_000, 0), 0);
  assert.equal(costFromBps(100_000, -5), 0);
  assert.throws(() => costFromBps(0, 10), RangeError);
});

test('costFromBps: 気配値から直接出した値と一致する', () => {
  const bid = 9_990_000;
  const ask = 10_010_000;
  const direct = roundTripCostYen(1_000_000, bid, ask);
  assert.ok(Math.abs(costFromBps(1_000_000, spreadBps(bid, ask)) - direct) < 1e-6);
});

test('isPlausible: 20%ちょうどは通し、超えたら落とす', () => {
  // mid=100, ask-bid=20 → 2000bps
  assert.equal(isPlausible(90, 110), true);
  assert.equal(isPlausible(89.9, 110.1), false);
  assert.equal(isPlausible(100, 100), true);
  assert.equal(isPlausible(100, Infinity), false);
});

/* 板の境界 ----------------------------------------------------------- */

test('buyQuantity/sellProceeds: 段の量ちょうどで約定しきれる', () => {
  assert.equal(buyQuantity([[100, 1]], 100), 1);
  assert.equal(sellProceeds([[100, 1]], 1), 100);
});

test('buyQuantity/sellProceeds: 空の板はnull', () => {
  assert.equal(buyQuantity([], 100), null);
  assert.equal(sellProceeds([], 1), null);
});

test('roundTripCost: 片側が空・金額0/NaNならnull', () => {
  const book = { asks: [[101, 10]], bids: [[99, 10]] };
  assert.equal(roundTripCost({ asks: [], bids: book.bids }, 100), null);
  assert.equal(roundTripCost({ asks: book.asks, bids: [] }, 100), null);
  assert.equal(roundTripCost(book, 0), null);
  assert.equal(roundTripCost(book, Number.NaN), null);
});

test('roundTripCost: 売り戻しの板が足りなければnull（0円にしない）', () => {
  const book = { asks: [[101, 10]], bids: [[99, 0.5]] };
  assert.equal(roundTripCost(book, 1000), null);
});

test('parseBitbankBook: asksが売り板（高い側）、bidsが買い板になる', () => {
  const book = parseBitbankBook({
    success: 1,
    data: { asks: [['101', '1'], ['100', '1']], bids: [['98', '1'], ['99', '1']] },
  });
  assert.deepEqual(book.asks[0], [100, 1]);
  assert.deepEqual(book.bids[0], [99, 1]);
  assert.ok(book.asks[0][0] > book.bids[0][0]);
});

test('parseCoincheck: 気配値が欠けていたら例外', () => {
  assert.throws(() => parseCoincheck({ bid: 1 }), VenueError);
  assert.throws(() => parseCoincheck({ bid: '', ask: 'x' }), VenueError);
});

/* APIエラー（fetchを差し替え） --------------------------------------- */

function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('fetchPair: 4xxはやり直さずfetch_errors行きになる', async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return json({}, 404);
    },
    async () => {
      const { quotes, errors } = await fetchPair('btc');
      assert.equal(quotes.length, 0);
      assert.equal(errors.length, 4);
      assert.ok(errors.every((e) => e.message === 'HTTP 404'));
      assert.equal(calls, 4);
    },
  );
});

test('fetchPair: 5xxと接続断は一度だけやり直す', async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      if (calls % 2 === 0) throw new TypeError('network down');
      return json({}, 503);
    },
    async () => {
      const { quotes, errors } = await fetchPair('btc');
      assert.equal(quotes.length, 0);
      assert.equal(errors.length, 4);
      assert.equal(calls, 8);
    },
  );
});

test('fetchPair: 売値<買値の気配値は記録しない', async () => {
  await withFetch(
    async () => json({ bid: 101, ask: 100 }),
    async () => {
      const { quotes, errors } = await fetchPair('btc');
      // Coincheckだけが {bid, ask} の形を読める。他社は形違いで例外になる。
      assert.equal(quotes.length, 0);
      assert.ok(errors.some((e) => e.venue === 'coincheck' && e.message.includes('異常')));
    },
  );
});

test('fetchBooks: 空板とHTTPエラーは板を返さずエラーに残す', async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return calls === 1 ? json({}, 500) : json({ success: 1, data: { asks: [], bids: [] } });
    },
    async () => {
      const { books, errors } = await fetchBooks('btc');
      assert.equal(books.length, 0);
      assert.equal(errors.length, 4);
    },
  );
});
