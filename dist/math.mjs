export const UNITS = Object.freeze({
  g: { family: 'weight', factor: '1' },
  kg: { family: 'weight', factor: '1000' },
  oz: { family: 'weight', factor: '28.349523125' },
  lb: { family: 'weight', factor: '453.59237' },
  ml: { family: 'volume', factor: '1' },
  L: { family: 'volume', factor: '1000' },
  'us-fl-oz': { family: 'volume', factor: '29.5735295625' },
  'uk-fl-oz': { family: 'volume', factor: '28.4130625' },
  item: { family: 'count', factor: '1' },
});

const INPUT_SCALE = 1000000n;
const RATE_SCALE = 10000000000n;
const UNIT_SCALE = 1000000000000n;
const COST_SCALE = 100n * INPUT_SCALE * INPUT_SCALE * RATE_SCALE;
const QUANTITY_SCALE = INPUT_SCALE * UNIT_SCALE;

function decimal(value, label, allowZero = false, digits = 6) {
  const text = String(value).trim();
  const pattern = new RegExp(
    '^(?:\\d+(?:\\.\\d{0,' + digits + '})?|\\.\\d{1,' + digits + '})$',
  );
  if (!pattern.test(text))
    throw new Error(
      label + ' needs a number with up to ' + digits + ' decimal places.',
    );
  const scale = 10n ** BigInt(digits);
  const [whole = '0', fraction = ''] = text.split('.');
  const scaled =
    BigInt(whole || '0') * scale + BigInt(fraction.padEnd(digits, '0'));
  if ((!allowZero && scaled === 0n) || scaled > 1000000000n * scale) {
    throw new Error(
      label +
        ' must be ' +
        (allowZero ? 'at least 0' : 'greater than 0') +
        ' and no more than 1 billion.',
    );
  }
  return scaled;
}

function fractionValue(numerator, denominator) {
  return (
    Number(numerator / denominator) +
    Number(numerator % denominator) / Number(denominator)
  );
}

function currencyCode(value) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value))
    throw new Error('Choose a valid three-letter currency.');
  return value;
}

function normalize(product, label, baseCurrency) {
  if (!product || !Object.hasOwn(UNITS, product.unit))
    throw new Error('Choose a unit for ' + label + '.');
  const currency = currencyCode(product.currency ?? baseCurrency);
  const price = decimal(product.price, label + ' price', true);
  const amount = decimal(product.amount, label + ' size');
  const pack = String(product.pack).trim();
  if (!/^\d+$/.test(pack) || BigInt(pack) < 1n || BigInt(pack) > 1000000n) {
    throw new Error(
      label + ' pack count must be a whole number from 1 to 1 million.',
    );
  }
  const exchangeRate =
    currency === baseCurrency
      ? RATE_SCALE
      : decimal(
          product.exchangeRate,
          label + ' exchange rate (1 ' + currency + ' in ' + baseCurrency + ')',
          false,
          10,
        );
  const shipping = decimal(
    product.shipping === '' || product.shipping == null
      ? '0'
      : product.shipping,
    label + ' shipping',
    true,
  );
  const fixedFee = decimal(
    product.fixedFee === '' || product.fixedFee == null
      ? '0'
      : product.fixedFee,
    label + ' fixed fee',
    true,
  );
  const feePercent = decimal(
    product.feePercent === '' || product.feePercent == null
      ? '0'
      : product.feePercent,
    label + ' payment fee',
    true,
  );
  if (feePercent > 100n * INPUT_SCALE)
    throw new Error(label + ' payment fee must be between 0% and 100%.');
  const subtotal = price + shipping;
  const total =
    subtotal * (100n * INPUT_SCALE + feePercent) +
    fixedFee * 100n * INPUT_SCALE;
  const converted = total * exchangeRate;
  const unit = UNITS[product.unit];
  return {
    price: converted,
    quantity:
      amount *
      BigInt(pack) *
      decimal(unit.factor, 'Unit conversion', false, 12),
    family: unit.family,
    breakdown: {
      currency,
      exchangeRate: Number(exchangeRate) / Number(RATE_SCALE),
      originalPrice: Number(price) / Number(INPUT_SCALE),
      shipping: Number(shipping) / Number(INPUT_SCALE),
      fixedFee: Number(fixedFee) / Number(INPUT_SCALE),
      feePercent: Number(feePercent) / Number(INPUT_SCALE),
      percentageFee: fractionValue(
        subtotal * feePercent,
        100n * INPUT_SCALE * INPUT_SCALE,
      ),
      totalBeforeConversion: fractionValue(
        total,
        100n * INPUT_SCALE * INPUT_SCALE,
      ),
      convertedTotal: fractionValue(converted, COST_SCALE),
    },
  };
}

export function compareMany(products, baseCurrency = 'PHP') {
  currencyCode(baseCurrency);
  if (!Array.isArray(products) || products.length < 2)
    throw new Error('Add at least two products to compare.');
  const normalized = products.map((product, i) =>
    normalize(product, 'Product ' + (i + 1), baseCurrency),
  );
  const family = normalized[0].family;
  if (normalized.some((product) => product.family !== family)) {
    throw new Error(
      'Use matching units: weight with weight, volume with volume, or items with items.',
    );
  }
  const basis = family === 'count' ? 1 : 100;
  const compareRate = (a, b) => {
    const left = normalized[a].price * normalized[b].quantity;
    const right = normalized[b].price * normalized[a].quantity;
    return left === right ? 0 : left < right ? -1 : 1;
  };
  const order = normalized.map((_, i) => i).sort(compareRate);
  const winners = order.filter((i) => compareRate(i, order[0]) === 0);
  const best = normalized[order[0]],
    runnerUp = normalized[order[1]];
  const high = runnerUp.price * best.quantity,
    low = best.price * runnerUp.quantity;
  return {
    order,
    winners,
    percent: high === 0n ? 0 : (Number(high - low) / Number(high)) * 100,
    rates: normalized.map((x) =>
      fractionValue(
        x.price * BigInt(basis) * QUANTITY_SCALE,
        x.quantity * COST_SCALE,
      ),
    ),
    totals: normalized.map((x) => fractionValue(x.quantity, QUANTITY_SCALE)),
    prices: normalized.map((x) => fractionValue(x.price, COST_SCALE)),
    breakdowns: normalized.map((x) => x.breakdown),
    baseCurrency,
    basis,
    basisLabel:
      family === 'count' ? 'item' : family === 'weight' ? '100 g' : '100 mL',
    baseUnit: family === 'count' ? 'items' : family === 'weight' ? 'g' : 'mL',
  };
}

export function compare(a, b, baseCurrency = 'PHP') {
  const result = compareMany([a, b], baseCurrency);
  return {
    ...result,
    winner:
      result.winners.length === 2 ? 'tie' : result.winners[0] === 0 ? 'a' : 'b',
    saving: Math.abs(result.rates[0] - result.rates[1]),
  };
}
