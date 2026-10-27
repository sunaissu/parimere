PARIMERE 2.0 — COMPARE AND PLAN

Run on Node 24.13 or newer:
  npm ci
  npm start
Open http://127.0.0.1:4189. npm ci runs the preparation script, copying exact locked OCR/barcode libraries and English language data into dist/vendor. No production deployment is performed by these commands. Set PORT to choose another local port. The server binds to loopback. Use a trusted HTTPS reverse proxy and set PARIMERE_ORIGIN to the exact public origin for a deployment.

Comparisons are calculated on the device. Prices, names, notes and photos are not sent to a calculation service. In the web app, optional automatic FX requests send currency codes to Frankfurter. Web household sharing sends only the explicitly reviewed comparison to this app's own server. No AI provider, telemetry, external product catalog or email service is used.

The initial currency follows the browser's explicit region when supported, with USD as the fallback for unknown or language-only locales. This uses local browser settings, not GPS or IP lookup. Restored comparisons keep their currency, and the currency selector remains editable.

WEB AND MOBILE
The web app lives in dist and runs with npm start. The separate React Native / Expo / TypeScript app lives in ../parimere-mobile and targets Android and iOS. Its native screens use the same exact calculation modules through a checked copy. Read that folder's README.txt for its implemented scope, commands and remaining release work. It has separate local storage and does not yet include every web feature.

The earlier Capacitor Android wrapper remains in android, with its JavaScript bridge in mobile. Commands and Android notes in this folder refer to that wrapper. Run npm run build:android to prepare a separate mobile-dist asset copy and sync Capacitor. Follow ANDROID_BUILD.txt for the required JDK/Android SDK, device builds and signing. Read PLAY_STORE_GUIDE.txt for developer-account setup and the release checklist.

The initial Android scope bundles the interface and OCR/barcode assets for offline use. It uses manual exchange rates and has no household sharing, accounts, automatic FX, ads or billing. Existing photos/files are selected through Android's file chooser. Exports use the share sheet; installed apps determine the available receiving/saving destinations. A native print bridge opens the Android print service. Web and Android have separate local storage; transfer comparisons through reviewed file export/import.

Android source and asset sync exist, but no APK/AAB has been compiled or installed. The compile attempt stopped because Java/JDK and the Android SDK are not configured in this environment. Browser tests with a mocked Capacitor bridge do not replace that work.

The app links to a draft privacy page. Its publisher, contact and hosting details must be completed and publicly hosted before Play submission. Under Data on this device, Delete all local data removes saved work, catalog/history, preferences, cached data and local access. The Android bridge also deletes temporary export files. Downloaded/shared files and server copies remain separate; clearing the current comparison alone does not delete saved work.

IMPLEMENTED BACKLOG
PAR-01: Current values survive refresh. Save, rename, duplicate, open and delete up to 40 named local comparisons. Local storage has a 2 MB bound per collection; quota errors are visible and leave the open comparison available for export.
One tab at a time can save on the same origin. Other tabs show a temporary-work notice and allow comparison/export. Close the saving tab and reload the other tab to hand over. Saving requires browser Web Locks; unsupported browsers remain temporary. Unreadable stored data is preserved, saving over it is blocked, and Download recovery data exports the original values without membership credentials. The recovery file can contain private notes and is not a normal comparison import.
PAR-02: Version 1 comparison files show every shared field in a preview. Imports are bounded and reviewed before replacing local values. Exports exclude catalog history and membership keys.
PAR-03: Percentage and fixed discounts, buy-one-get-one, and multibuy total-price offers. Extra costs apply once to an offer; the interface labels physical packs separately.
PAR-04/05/06/18: Target quantity rounds up complete offers, reports checkout and expected net cost, leftovers, budget eligibility, waste-adjusted usable quantity and days at an entered usage rate.
PAR-07/20: Shelf/offer break-even prices include entered costs; FX boundaries compare each product against its best competitor. A mandatory-cost floor can make a matching shelf price impossible.
PAR-08/09: Store/date/barcode fields, up to 200 reusable catalog products, 100 manual observations per product, a chart of the latest 50 observations, exact history values and an on-entry target-price alert. These are local alerts, not background market monitoring.
PAR-10: Whole-store baskets use explicit matching item keys and quantities. Shared delivery replaces per-offer shipping. Missing items and minimum-order failures remain visible; incomplete stores are not declared winners.
Changing the result currency clears the budget and store delivery/minimum-order amounts with a visible re-entry notice. An imported comparison retains its own budget. Basket settings are stored with their currency; older settings with no currency require review/reset.
PAR-11: Entered tax, duty and refundable deposits, with the calculation order shown below. No jurisdiction's rules or rates are inferred.
PAR-12/13: Local barcode/QR photo decoding matches the saved catalog. English OCR reads a captured/selected price-label or receipt photo. A review dialog shows the image, extracted text, target product and editable price; accepting it never guesses pack size or currency. Photos are limited to 8 MiB and 16 megapixels, resized to a 2200 px edge, and OCR has a 45-second timeout. No photo is uploaded.
PAR-14: The web manifest and service worker support offline reload, same-currency calculations and clearly marked saved/manual FX. The web shell must first load online. Web OCR/barcode vendor assets are served locally but are not part of the offline shell cache; capture needs access to those assets. Web automatic rates cache for one hour and must be no more than seven days old. A restored web comparison labels its previous automatic rate as saved instead of silently claiming freshness. Android bundles capture assets and uses manual rates; it does not register the web service worker.
PAR-15: CSV and print reports contain costs, usable quantities, ranking, currency/rate dates and target plans. CSV cells neutralize spreadsheet-formula prefixes.
PAR-16/17: Select the comparison amount independently of input units. Base units are g, mL, m, square meters, items, sheets and doses; incompatible families cannot be ranked together. Existing US/UK fluid ounce and international weight conversions remain exact.
PAR-19/21: Checkout cash and expected after-refund/rebate cost are separately visible, with an explicit objective-ranking choice. Quality criteria and notes remain alongside the objective price result.
PAR-22/23: Undo the last 20 destructive/product actions in the open session. Shopping mode enlarges inputs, gives numeric fields a Next sequence and keeps the result visible while editing. Undo history is not a permanent backup.
PAR-24: Optional household sync has explicit named memberships, reviewed uploads, single-use invitations, revision conflicts, member revocation and owner deletion. Details below.
PAR-25: Exact mixed-pack optimization supports 2–12 alternatives and up to 30,000 normalized quantity steps. It runs in a cancellable worker so editing stays responsive; changing inputs discards an in-flight result. It reports its boundary instead of returning an approximate result as exact. Each selected offer repeats its entered costs; shared shipping is handled by the separate basket workflow.
PAR-26: An entered yield multiplier adjusts prepared quantity within the same measurement family. For washes, choose doses and enter the prepared number of doses; the app does not infer a chemical dilution or cross-family conversion.
PAR-27/28/29: Saved original-versus-current scenarios, product duplication, explicit cost copying, and regional display currency/basis/number-format preferences. Decimal inputs use a dot regardless of display locale.

CALCULATION CONTRACT
Reduced BigInt fractions preserve exact ranking and ties. Display values round for readability. Up to 24 products can be compared. Inputs generally accept six decimal places and values up to one billion; FX accepts ten decimal places.
1. Apply the offer to the shelf price and physical pack quantity.
2. Duty applies to discounted goods.
3. Add shipping.
4. Tax applies to goods + duty + shipping.
5. Payment fee applies to that taxed subtotal.
6. Add fixed costs and the refundable deposit.
7. Convert to the result currency.
Expected net subtracts the deposit and the entered rebate before conversion. A rebate cannot exceed non-refundable checkout cost. Usable quantity is offer quantity × (1 − waste) × entered yield. These are explicit assumptions, not tax, financial or product-use advice.

OPTIONAL WEB HOUSEHOLDS
Set PARIMERE_SYNC=1 when starting the server to enable the module. It stays disabled by default; local comparisons work without it. SQLite uses data/households.sqlite, excluded from Git. This Node release reports its built-in SQLite API as experimental.

Creating a household creates an empty shared workspace. No local comparison is uploaded until the user reviews and confirms a copy. Members can read and replace that shared copy. The owner alone creates invitations, removes other members and deletes the household. A member can leave. Writes require the expected revision; conflicts never overwrite a newer server copy. Users reload, inspect and explicitly share again.

Membership keys are random 256-bit capabilities. The server stores SHA-256 digests; the browser keeps the key in session storage. A separately confirmed private access-key download lets that member reconnect on the same server. This file is a credential and is deliberately separate from comparison exports. Keys expire after 90 days; invitations expire after one day and can be used once. Revocation prevents future requests but cannot recall copies already downloaded. A household with no unexpired members is deleted on the next household request. Owner loss without an unexpired key requires starting a new household from a local copy.

Limits: 100 households per server, 12 active members and outstanding invitations per household, 200 KB shared document, 210 KB request. Creation and API requests are rate-limited. Origin/Host checks, JSON-only mutations, bearer membership, prepared SQL, version CAS, no-store responses and explicit membership filtering are enforced. Production activation, proxy/TLS setup, backups and device installation were not performed during implementation.

SECURITY AND CAPTURE
The web page CSP does not allow eval or WebAssembly compilation. Only the exact bundled OCR worker receives the narrow wasm-unsafe-eval permission needed by its local engine; the web document keeps script-src self. Web files are served from an explicit allowlist. Android packaging supplies its own CSP, allowing local scripts and Wasm with connections restricted to its local origin. Imports have byte/depth/node/field limits and reject prototype keys. Authored text is displayed with textContent. Photo data stays in memory and OCR workers terminate after completion or timeout.

Dependencies and attribution: THIRD_PARTY_NOTICES.txt, package-lock.json, licenses/bundled-assets.json and generated vendor license files. The preparation script includes full notices for verified JavaScript dependencies embedded in prebuilt bundles, checks distributed-file hashes, and records the exact upstream English language-data revision and Apache-2.0 license. Embedded versions can differ from node_modules. Native packaging adds the Capacitor/plugin license files. Review the C/C++ components compiled into OCR Wasm and actual resolved Maven/native dependencies before distribution. Official integration references: https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md and https://github.com/zxing-js/browser .

REVIEW EVIDENCE
npm test covers exact arithmetic, promotions, planning, optimizer limits, safe imports, household isolation, server/proxy checks and local-storage preservation. See RELEASE.txt for the latest run.
npm run test:browser: real local Chrome checks passed for save/reload, undo, duplication, budget/target, reviewed JSON export, CSV, scenarios, actual OCR/barcode decoding, native worker termination during stalled initialization, page/worker CSP separation, 320/390/1440 px overflow, local HTTP household isolation/conflicts/revocation, two independent browser memberships, private-key reconnect, rejected stale UI uploads and offline reload. The test server creates and deletes only its own household. qa screenshots are ignored. Real phone cameras, OS installation, live payment-provider FX quotes and public hosting were not exercised.

npm run test:android-js: generated Android JavaScript passed checks in Chrome with a mocked Capacitor bridge. These exercise manual/imported rates, JSON/CSV export calls, print calls, Back, cache cleanup and local erasure. Actual OCR/barcode decoding used bundled assets with external requests blocked. Android plugin execution, installation, permissions and device behavior remain unverified.

npm audit reported zero vulnerabilities on 2026-10-21 after overriding xcode's build-tool uuid dependency to 11.1.1. This checks the installed npm graph; it does not establish the security of embedded bundle copies or native/Maven dependencies. See ANDROID_BUILD.txt for the override. RELEASE.txt tracks subsequent fixes and outstanding release work.

npm run test:release-fixes exercises full saved collections, corrupt-data recovery, tab isolation/handover, currency changes and worker cancellation at phone and desktop widths. npm run test:optimizer checks worker correctness, cancellation, superseded jobs, timeout, offline loading and UI responsiveness under a heavy calculation.

NAME AND ASSET REVIEW
The October 22 indexed web/app-store search found no obvious Parimere software conflict. Official trademark and image-similarity searches were not completed, so this is not brand clearance. Confirm launch countries and ownership/source records for icon.svg, creator-mark.svg and the sunaissu credit. Keep brandReviewCompleted and assetRightsConfirmed false until that review is complete. The release check also requires the actual publisher/contact details and a finalized public privacy policy.

The review fixed a rebate-sensitive break-even failure, winning-product FX boundaries, maximum-price thresholds, stale saved-rate labels, malformed catalog recovery, scenario persistence and response handling after membership changes. These checks support the implemented workflows; they are not a claim that future inputs or deployments can never reveal another bug.
