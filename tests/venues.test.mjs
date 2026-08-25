import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VenueError,
  parseBitbank,
  parseBitflyer,
  parseCoincheck,
  parseGmo,
} from '../src/venues.ts';
import { isPlausible } from '../src/spread.ts';

// 2026-08-25 14:10 JST に各取引所から実際に返ってきたレスポンス。
// 仕様が変わったときにここが落ちるように、加工せずそのまま置いてある。
const REAL = {
  gmo: {
    status: 0,
    data: [
      {
        ask: '12571877',
        bid: '12571818',
        high: '12939920',
        last: '12574817',
        low: '12450000',
        symbol: 'BTC',
        timestamp: '2026-08-25T14:10:39.604Z',
        volume: '465.14963',
      },
    ],
    responsetime: '2026-08-25T14:10:39.873Z',
  },
  bitbank: {
    success: 1,
    data: {
      sell: '12581101',
      buy: '12578335',
      open: '12569961',
      high: '12933047',
      low: '12455326',
      last: '12583048',
      vol: '219.3518',
      timestamp: 1787667040045,
    },
  },
  bitflyer: {
    product_code: 'BTC_JPY',
    state: 'RUNNING',
    timestamp: '2026-08-25T14:10:39.93',
    best_bid: 12576025.0,
    best_ask: 12579500.0,
    ltp: 12575283.0,
  },
  coincheck: {
    last: 12575209.0,
    bid: 12574065.0,
    ask: 12578064.0,
    high: 12936075.0,
    low: 12449000.0,
    volume: 1144.25561418,
    timestamp: 1787667031,
  },
};

test('parseGmo: 文字列で返る気配値を数値にする', () => {
  assert.deepEqual(parseGmo(REAL.gmo), { bid: 12_571_818, ask: 12_571_877 });
});

test('parseGmo: statusが0以外なら例外', () => {
  assert.throws(() => parseGmo({ status: 1, data: [] }), VenueError);
});

test('parseGmo: dataが空なら例外', () => {
  assert.throws(() => parseGmo({ status: 0, data: [] }), VenueError);
});

test('parseBitbank: sellがask、buyがbid（名前が直感と逆）', () => {
  // ここを取り違えると ask < bid になり、全データが「異常」として捨てられる。
  const quote = parseBitbank(REAL.bitbank);
  assert.deepEqual(quote, { bid: 12_578_335, ask: 12_581_101 });
  assert.ok(quote.ask > quote.bid);
  assert.equal(isPlausible(quote.bid, quote.ask), true);
});

test('parseBitbank: successが1以外なら例外', () => {
  assert.throws(() => parseBitbank({ success: 0, data: {} }), VenueError);
});

test('parseBitflyer: 板が停止していたら例外', () => {
  assert.deepEqual(parseBitflyer(REAL.bitflyer), { bid: 12_576_025, ask: 12_579_500 });
  assert.throws(
    () => parseBitflyer({ ...REAL.bitflyer, state: 'CLOSED' }),
    VenueError,
  );
});

test('parseCoincheck: そのまま数値で返る', () => {
  assert.deepEqual(parseCoincheck(REAL.coincheck), { bid: 12_574_065, ask: 12_578_064 });
});

test('すべての取引所: 実測値が記録可能と判定される', () => {
  const quotes = [
    parseGmo(REAL.gmo),
    parseBitbank(REAL.bitbank),
    parseBitflyer(REAL.bitflyer),
    parseCoincheck(REAL.coincheck),
  ];
  for (const quote of quotes) {
    assert.equal(isPlausible(quote.bid, quote.ask), true);
  }
});

test('どのパーサーも壊れたレスポンスで例外にする', () => {
  for (const parse of [parseGmo, parseBitbank, parseBitflyer, parseCoincheck]) {
    assert.throws(() => parse(null), VenueError);
    assert.throws(() => parse('文字列'), VenueError);
    assert.throws(() => parse([]), VenueError);
  }
});

test('数値として読めない気配値は例外', () => {
  assert.throws(() => parseCoincheck({ bid: 'あ', ask: 100 }), VenueError);
  assert.throws(() => parseBitflyer({ best_bid: null, best_ask: 100 }), VenueError);
});
