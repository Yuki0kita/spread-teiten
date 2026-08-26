import test from 'node:test';
import assert from 'node:assert/strict';
import { isCountable, normalizePath, referrerHost } from '../src/visits.ts';

test('isCountable: 画面だけを数える', () => {
  assert.equal(isCountable('/ja/', 'GET'), true);
  assert.equal(isCountable('/ja/btc/', 'GET'), true);
  assert.equal(isCountable('/ja/btc/2026-08-26/', 'GET'), true);
});

test('isCountable: APIと静的ファイルは数えない', () => {
  // 監視画面は60秒ごとにAPIを叩く。これを数えると人の数が分からなくなる
  assert.equal(isCountable('/api/pulse.json', 'GET'), false);
  assert.equal(isCountable('/api/latest.json', 'GET'), false);
  assert.equal(isCountable('/style.css', 'GET'), false);
  assert.equal(isCountable('/app.js', 'GET'), false);
  assert.equal(isCountable('/og.png', 'GET'), false);
  assert.equal(isCountable('/robots.txt', 'GET'), false);
  assert.equal(isCountable('/sitemap.xml', 'GET'), false);
});

test('isCountable: 収集エンドポイントとGET以外は数えない', () => {
  assert.equal(isCountable('/internal/collect', 'POST'), false);
  assert.equal(isCountable('/internal/visits.json', 'GET'), false);
  assert.equal(isCountable('/ja/', 'POST'), false);
  assert.equal(isCountable('/ja/', 'HEAD'), false);
});

test('referrerHost: ホスト名だけを残す', () => {
  // URL全体を残すと、他所のサイトのクエリに混ざった個人情報まで持ち込むことになる
  assert.equal(referrerHost('https://www.google.com/search?q=personal+info', 'example.com'), 'www.google.com');
  assert.equal(referrerHost('https://x.com/someone/status/123', 'example.com'), 'x.com');
});

test('referrerHost: 自サイト内の移動は流入ではない', () => {
  assert.equal(referrerHost('https://example.com/ja/btc/', 'example.com'), 'self');
});

test('referrerHost: 無い・壊れている場合はdirect', () => {
  assert.equal(referrerHost(undefined, 'example.com'), 'direct');
  assert.equal(referrerHost('', 'example.com'), 'direct');
  assert.equal(referrerHost('こわれたURL', 'example.com'), 'direct');
});

test('normalizePath: クエリを落とす', () => {
  // ?amount=... を残すと同じ画面が別の行として増え続ける
  assert.equal(normalizePath('/ja/btc/?amount=1000000'), '/ja/btc/');
  assert.equal(normalizePath('/ja/'), '/ja/');
});

test('normalizePath: 極端に長いパスで行を増やさせない', () => {
  const long = '/' + 'a'.repeat(500);
  assert.ok(normalizePath(long).length <= 120);
});
