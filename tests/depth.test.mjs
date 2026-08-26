import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMOUNT_LADDER,
  buyQuantity,
  costLadder,
  isSaneBook,
  parseLadder,
  roundTripCost,
  sellProceeds,
} from '../src/depth.ts';
import { parseBitbankBook, parseBitflyerBook, parseCoinCheckBook, parseGmoBook, VenueError } from '../src/venues.ts';

/** 値段100で1個、101で2個…という単純な板。手計算で追える形にしてある。 */
const BOOK = {
  asks: [
    [100, 1],
    [110, 1],
    [200, 10],
  ],
  bids: [
    [90, 1],
    [80, 1],
    [10, 10],
  ],
};

test('buyQuantity: 1段で足りるときはその値段で割るだけ', () => {
  // 50円ぶんを100円の段で買う → 0.5個
  assert.equal(buyQuantity(BOOK.asks, 50), 0.5);
});

test('buyQuantity: 足りなければ下の段まで食い進む', () => {
  // 100円で1個ぶん(100円)、残り10円を110円の段で → 1 + 10/110
  assert.equal(buyQuantity(BOOK.asks, 110), 1 + 10 / 110);
});

test('buyQuantity: 板を全部食っても足りなければnull', () => {
  // 板の総額は 100 + 110 + 2000 = 2210円
  assert.equal(buyQuantity(BOOK.asks, 2_210 + 1), null);
  assert.notEqual(buyQuantity(BOOK.asks, 2_210), null);
});

test('sellProceeds: 数量ぶん売り下がって戻る金額', () => {
  assert.equal(sellProceeds(BOOK.bids, 0.5), 45);
  assert.equal(sellProceeds(BOOK.bids, 2), 90 + 80);
});

test('sellProceeds: 板が足りなければnull', () => {
  assert.equal(sellProceeds(BOOK.bids, 12 + 0.1), null);
});

test('roundTripCost: 板の一番上だけで往復できるときのコスト', () => {
  // 50円で0.5個買い、90円で売ると45円。消えるのは5円
  assert.equal(roundTripCost(BOOK, 50), 5);
});

test('roundTripCost: 金額が大きいほどコストは比例より速く増える', () => {
  const small = roundTripCost(BOOK, 50);
  const large = roundTripCost(BOOK, 200);
  // 金額が4倍でも、コストは4倍では済まない
  assert.ok(large > small * 4, `${large} は ${small * 4} より大きいはず`);
});

test('roundTripCost: 壊れた板では計算しない', () => {
  // 売値が買値以下になっている板
  assert.equal(roundTripCost({ asks: [[90, 1]], bids: [[100, 1]] }, 50), null);
  assert.equal(roundTripCost({ asks: [], bids: [[100, 1]] }, 50), null);
  assert.equal(roundTripCost(BOOK, 0), null);
  assert.equal(roundTripCost(BOOK, -1), null);
});

test('isSaneBook: 売値が買値を上回っているものだけ通す', () => {
  assert.equal(isSaneBook(BOOK), true);
  assert.equal(isSaneBook({ asks: [[100, 1]], bids: [[100, 1]] }), false);
  assert.equal(isSaneBook({ asks: [[0, 1]], bids: [[-1, 1]] }), false);
});

test('costLadder: はしごの全段ぶんが埋まる（足りない段はnull）', () => {
  const ladder = costLadder(BOOK);
  assert.deepEqual(Object.keys(ladder).map(Number), [...AMOUNT_LADDER]);
  // この小さな板では10万円は約定しきれない
  assert.equal(ladder['100000'], null);
});

test('parseLadder: 壊れたJSONでも画面を止めない', () => {
  assert.deepEqual(parseLadder('こわれている'), {});
  assert.deepEqual(parseLadder('null'), {});
  const ok = parseLadder(JSON.stringify({ '100000': 12.5, '300000': null }));
  assert.equal(ok['100000'], 12.5);
  assert.equal(ok['300000'], null);
  // はしごに無い金額は読み込まない
  assert.equal(Object.keys(ok).length, AMOUNT_LADDER.length);
});

/* 板レスポンスの解釈 --------------------------------------------------- */

test('板の解釈: 4社とも共通の形にそろい、並びが保証される', () => {
  const parsed = [
    parseGmoBook({ data: { asks: [{ price: '110', size: '1' }, { price: '100', size: '1' }], bids: [{ price: '90', size: '1' }] } }),
    parseBitbankBook({ data: { asks: [['110', '1'], ['100', '1']], bids: [['90', '1']] } }),
    parseBitflyerBook({ asks: [{ price: 110, size: 1 }, { price: 100, size: 1 }], bids: [{ price: 90, size: 1 }] }),
    parseCoinCheckBook({ asks: [['110', '1'], ['100', '1']], bids: [['90', '1']] }),
  ];
  for (const book of parsed) {
    // asksは安い順に並べ直されていること。逆だと高い段から食うことになる
    assert.equal(book.asks[0][0], 100);
    assert.equal(book.asks[1][0], 110);
    assert.equal(book.bids[0][0], 90);
    assert.equal(isSaneBook(book), true);
  }
});

test('板の解釈: 数値として読めない段は捨てる', () => {
  const book = parseBitbankBook({
    data: { asks: [['あ', '1'], ['100', '1']], bids: [['90', 'x'], ['80', '1']] },
  });
  assert.equal(book.asks.length, 1);
  assert.equal(book.bids.length, 1);
});

test('板の解釈: 空の板は例外', () => {
  assert.throws(() => parseBitbankBook({ data: { asks: [], bids: [['90', '1']] } }), VenueError);
  assert.throws(() => parseGmoBook({ data: {} }), VenueError);
});
