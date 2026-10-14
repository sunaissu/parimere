import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, compareMany } from '../dist/math.mjs';
const product = (price, amount, unit = 'ml', pack = '1') => ({
  price,
  amount,
  unit,
  pack,
});
test('milk: compare mL against L and calculate percent against higher unit price', () => {
  const r = compare(product(149, 750), product(189, 1, 'L'));
  assert.equal(r.winner, 'b');
  assert.deepEqual(r.totals, [750, 1000]);
  assert.ok(Math.abs(r.percent - 4.86577181208) < 1e-9);
});
test('multipack size is multiplied, its price is not', () => {
  const r = compare(product(90, 25, 'g', 6), product(110, 200, 'g'));
  assert.equal(r.winner, 'b');
  assert.deepEqual(r.rates, [60, 55]);
});
test('decimal equivalence produces an exact tie', () => {
  assert.equal(
    compare(product('.3', '.3', 'kg'), product('.1', 100, 'g')).winner,
    'tie',
  );
});
test('free packs are valid and two free packs tie', () => {
  assert.equal(compare(product(0, 1), product(5, 1)).percent, 100);
  assert.equal(compare(product(0, 1), product(0, 2)).winner, 'tie');
});
test('counts and winner reversal', () => {
  const a = product(100, 12, 'item'),
    b = product(100, 10, 'item');
  assert.equal(compare(a, b).winner, 'a');
  assert.equal(compare(b, a).winner, 'b');
  assert.equal(compare(a, b).basisLabel, 'item');
});
test('reject missing, negative, nonfinite and incompatible inputs', () => {
  for (const x of ['', -1, 'NaN', 'Infinity', '1e3', '0.0000001'])
    assert.throws(() => compare(product(x, 1), product(1, 1)));
  for (const x of [0, -1, ''])
    assert.throws(() => compare(product(1, x), product(1, 1)));
  assert.throws(() => compare(product(1, 1, 'g'), product(1, 1, 'ml')));
  for (const x of [0, 1.5, -2, 1000001])
    assert.throws(() => compare(product(1, 1, 'g', x), product(1, 1, 'g')));
  assert.throws(() => compare(product(1, 1, 'toString'), product(1, 1)));
});
test('large valid quantities preserve exact winner without overflow', () => {
  const r = compare(
    product('1000000000', '1000000000', 'kg', 1000000),
    product('999999999', '1000000000', 'kg', 1000000),
  );
  assert.equal(r.winner, 'b');
  assert.ok(Number.isFinite(r.percent));
});

test('rank four different sizes, and compare winner against next best', () => {
  const r = compareMany([
    product(90, 25, 'g', 6),
    product(110, 200, 'g'),
    product(150, 300, 'g'),
    product(270, 500, 'g'),
  ]);
  assert.deepEqual(r.order, [2, 3, 1, 0]);
  assert.deepEqual(r.winners, [2]);
  assert.ok(Math.abs(r.percent - 7.407407407407407) < 1e-12);
});
test('keep all exact lowest-price ties in original order', () => {
  const r = compareMany([
    product('.30', '.3', 'kg'),
    product(2, 1, 'kg'),
    product('.10', 100, 'g'),
  ]);
  assert.deepEqual(r.winners, [0, 2]);
  assert.deepEqual(r.order, [0, 2, 1]);
  assert.equal(r.percent, 0);
});
test('reject incomplete or incompatible third product and fewer than two products', () => {
  assert.throws(() => compareMany([product(1, 1)]));
  assert.throws(() =>
    compareMany([product(1, 1), product(2, 2), product('', 3)]),
  );
  assert.throws(() =>
    compareMany([product(1, 1), product(2, 2), product(3, 3, 'g')]),
  );
});
test('handle several free products and more than 26 products', () => {
  const free = compareMany([product(5, 1), product(0, 1), product(0, 2)]);
  assert.deepEqual(free.winners, [1, 2]);
  assert.equal(free.percent, 0);
  const r = compareMany(
    Array.from({ length: 30 }, (_, i) => product(30 - i, 1)),
  );
  assert.equal(r.order[0], 29);
});

test('convert purchase, shipping, percentage fee and fixed fee in the stated order', () => {
  const local = { ...product(740, 1, 'L'), currency: 'PHP' };
  const imported = {
    ...product(10, 1, 'L'),
    currency: 'USD',
    exchangeRate: 58,
    shipping: 2,
    feePercent: 3,
    fixedFee: 0.5,
  };
  const r = compareMany([local, imported], 'PHP');
  assert.equal(r.prices[1], 745.88);
  assert.equal(r.breakdowns[1].totalBeforeConversion, 12.86);
  assert.deepEqual(r.winners, [0]);
  assert.deepEqual(
    compareMany(
      [local, { ...imported, shipping: 0, feePercent: 0, fixedFee: 0 }],
      'PHP',
    ).winners,
    [1],
  );
});
test('require an explicit positive rate for each foreign product', () => {
  for (const rate of [undefined, '', 0, -1, 'NaN', 'Infinity']) {
    assert.throws(() =>
      compareMany(
        [
          { ...product(10, 1), currency: 'USD', exchangeRate: rate },
          product(580, 1),
        ],
        'PHP',
      ),
    );
  }
  assert.throws(() => compareMany([product(1, 1), product(1, 1)], 'bad'));
  assert.throws(() =>
    compareMany([{ ...product(1, 1), currency: 'bad' }, product(1, 1)], 'PHP'),
  );
});
test('same currency always uses one and exact converted values tie', () => {
  const r = compareMany(
    [
      { ...product(0.1, 1), currency: 'USD', exchangeRate: '.3' },
      { ...product(0.03, 1), currency: 'EUR', exchangeRate: 'bad' },
    ],
    'EUR',
  );
  assert.deepEqual(r.winners, [0, 1]);
  assert.equal(r.prices[0], 0.03);
});
test('accept small manual rates and reject invalid optional fees', () => {
  const r = compareMany(
    [
      { ...product(100000, 1), currency: 'VND', exchangeRate: '.00004' },
      product(4, 1),
    ],
    'USD',
  );
  assert.deepEqual(r.winners, [0, 1]);
  for (const key of ['shipping', 'fixedFee', 'feePercent']) {
    for (const value of [-1, 'no', NaN])
      assert.throws(() =>
        compareMany([{ ...product(1, 1), [key]: value }, product(1, 1)]),
      );
  }
  assert.throws(() =>
    compareMany([{ ...product(1, 1), feePercent: 101 }, product(1, 1)]),
  );
});
test('international weights and US or UK fluid volumes convert exactly', () => {
  assert.deepEqual(
    compareMany([product(1, 16, 'oz'), product(1, 1, 'lb')]).winners,
    [0, 1],
  );
  assert.deepEqual(
    compareMany([product(1, 128, 'us-fl-oz'), product(1, '3785.411784', 'ml')])
      .winners,
    [0, 1],
  );
  assert.deepEqual(
    compareMany([product(1, 160, 'uk-fl-oz'), product(1, '4546.09', 'ml')])
      .winners,
    [0, 1],
  );
  assert.deepEqual(
    compareMany([product(1, 1, 'us-fl-oz'), product(1, 1, 'uk-fl-oz')]).winners,
    [0],
  );
  assert.throws(() =>
    compareMany([product(1, 1, 'oz'), product(1, 1, 'us-fl-oz')]),
  );
});
test('changing the comparison currency requires rates for previously local prices', () => {
  assert.throws(() =>
    compareMany(
      [
        { ...product(1, 1), currency: 'PHP' },
        { ...product(1, 1), currency: 'USD', exchangeRate: 58 },
      ],
      'EUR',
    ),
  );
});
