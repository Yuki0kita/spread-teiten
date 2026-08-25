import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOCALE, LOCALES, isLocale, localeFromHeader, otherLocale, t } from '../src/i18n.ts';
import { PAIRS, findPair } from '../src/pairs.ts';

test('isLocale: 対応している言語だけ通す', () => {
  assert.equal(isLocale('ja'), true);
  assert.equal(isLocale('en'), true);
  assert.equal(isLocale('fr'), false);
  assert.equal(isLocale(undefined), false);
  // パスの一部を言語と誤認しないこと
  assert.equal(isLocale('btc'), false);
});

test('localeFromHeader: Accept-Languageから言語を決める', () => {
  assert.equal(localeFromHeader('ja,en-US;q=0.9'), 'ja');
  assert.equal(localeFromHeader('en-US,en;q=0.9'), 'en');
  assert.equal(localeFromHeader('fr-FR,fr;q=0.9'), DEFAULT_LOCALE);
  assert.equal(localeFromHeader(undefined), DEFAULT_LOCALE);
  assert.equal(localeFromHeader(''), DEFAULT_LOCALE);
});

test('localeFromHeader: 先に書かれた言語を優先する', () => {
  assert.equal(localeFromHeader('en;q=0.8,ja;q=0.9'), 'en');
});

test('otherLocale: 言語切り替えは往復する', () => {
  assert.equal(otherLocale('ja'), 'en');
  assert.equal(otherLocale('en'), 'ja');
});

test('両方の言語に同じ項目がそろっている', () => {
  // 片方だけ書き忘れると、その箇所が空欄のまま公開されてしまう
  const keys = LOCALES.map((locale) => Object.keys(t(locale)).sort());
  assert.deepEqual(keys[0], keys[1]);
});

test('注意書きの本数が言語で食い違わない', () => {
  assert.equal(t('ja').about.length, t('en').about.length);
});

test('findPair: 知らない銘柄はundefined', () => {
  assert.equal(findPair('btc')?.id, 'btc');
  assert.equal(findPair('eth')?.id, 'eth');
  assert.equal(findPair('doge'), undefined);
  assert.equal(findPair(undefined), undefined);
  // パス区切りや大文字を混ぜても通さない
  assert.equal(findPair('BTC'), undefined);
  assert.equal(findPair('btc/'), undefined);
});

test('銘柄には日英の名前が両方ある', () => {
  for (const pair of PAIRS) {
    assert.ok(pair.nameJa.length > 0, `${pair.id} に日本語名がない`);
    assert.ok(pair.nameEn.length > 0, `${pair.id} に英語名がない`);
    assert.match(pair.id, /^[a-z]+$/, `${pair.id} はURLに使えない文字を含む`);
  }
});
