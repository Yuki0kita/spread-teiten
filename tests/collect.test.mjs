import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerToken, tokenMatches } from '../src/collect.ts';

test('bearerToken: Authorizationヘッダーから取り出す', () => {
  assert.equal(bearerToken('Bearer abc123'), 'abc123');
  assert.equal(bearerToken('  Bearer   abc123  '), 'abc123');
});

test('bearerToken: 形式が違えばundefined', () => {
  assert.equal(bearerToken(undefined), undefined);
  assert.equal(bearerToken(''), undefined);
  assert.equal(bearerToken('abc123'), undefined);
  assert.equal(bearerToken('Basic abc123'), undefined);
});

test('tokenMatches: 一致するときだけtrue', () => {
  assert.equal(tokenMatches('correct-token-value', 'correct-token-value'), true);
  assert.equal(tokenMatches('correct-token-valuX', 'correct-token-value'), false);
  assert.equal(tokenMatches('Correct-token-value', 'correct-token-value'), false);
});

test('tokenMatches: 長さが違えばfalse', () => {
  assert.equal(tokenMatches('short', 'correct-token-value'), false);
  assert.equal(tokenMatches('correct-token-value-longer', 'correct-token-value'), false);
});

test('tokenMatches: 期待値が未設定なら常にfalse（経路ごと閉じる）', () => {
  // COLLECT_TOKEN を設定していないWorkerで、空トークンを送れば通る、を防ぐ
  assert.equal(tokenMatches('', ''), false);
  assert.equal(tokenMatches(undefined, ''), false);
  assert.equal(tokenMatches('anything', ''), false);
  assert.equal(tokenMatches(undefined, 'expected'), false);
});
