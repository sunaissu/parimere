// A device region is a preference, not a measurement of the user's location.
// Unknown or language-only locales deliberately fall back to USD.
const regionalCurrencies = {
  PH: 'PHP', US: 'USD', GB: 'GBP', JP: 'JPY', AU: 'AUD', CA: 'CAD',
  CH: 'CHF', CN: 'CNY', HK: 'HKD', SG: 'SGD', IN: 'INR', ID: 'IDR',
  KR: 'KRW', MY: 'MYR', TH: 'THB', VN: 'VND', AE: 'AED', SA: 'SAR', NZ: 'NZD',
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR', FI: 'EUR',
  FR: 'EUR', GR: 'EUR', HR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR', LU: 'EUR',
  LV: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SI: 'EUR', SK: 'EUR',
};
export function currencyForLocale(locale) {
  if (locale?.currencyCode && /^[A-Z]{3}$/.test(locale.currencyCode)) return locale.currencyCode;
  let region = locale?.regionCode;
  if (!region && locale?.languageTag) {
    try { region = new Intl.Locale(locale.languageTag).region; } catch { /* USD fallback */ }
  }
  return regionalCurrencies[region] || 'USD';
}
export function browserCurrency() {
  try {
    return currencyForLocale({ languageTag: globalThis.navigator?.languages?.[0] || globalThis.navigator?.language });
  } catch { return 'USD'; }
}
