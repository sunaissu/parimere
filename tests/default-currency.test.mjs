import test from 'node:test';
import assert from 'node:assert/strict';
import { currencyForLocale } from '../dist/default-currency.mjs';

test('explicit device currency wins over language and region', () => {
  assert.equal(currencyForLocale({ currencyCode: 'PHP', languageTag: 'en-US', regionCode: 'US' }), 'PHP');
});
test('browser regions select local currencies without guessing from language', () => {
  for (const [languageTag, currency] of [['en-PH', 'PHP'], ['en-GB', 'GBP'], ['fr-CA', 'CAD'], ['de-DE', 'EUR'], ['ja-JP', 'JPY'], ['en', 'USD'], ['invalid!', 'USD']]) {
    assert.equal(currencyForLocale({ languageTag }), currency);
  }
  assert.equal(currencyForLocale(), 'USD');
  assert.equal(currencyForLocale({ regionCode: 'ZZ' }), 'USD');
  assert.equal(currencyForLocale({ currencyCode: 'invalid' }), 'USD');
});
