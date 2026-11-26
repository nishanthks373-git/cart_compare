# Cart Compare

An Android app for Indian online shopping. You paste a product link, or share one from the Amazon or Flipkart app. The app then:

1. **Shows the product details**: title, image, brand, price, MRP, discount, rating and stock.
2. **Compares prices** for the same product at other stores: Amazon, Flipkart, Croma, Reliance Digital, Tata CLiQ, Vijay Sales, JioMart, Myntra, AJIO, Nykaa and more.
3. **Shows price history** as an interactive chart, with the lowest, average and highest price and a "good time to buy?" verdict.
4. **Alerts you** with a push notification when the price drops, reaches your target price, changes at all, or the product comes back in stock.

```
 Android app (Kotlin + Jetpack Compose)            Firebase (asia-south1, Mumbai)
 ┌─────────────────────────────┐   callable    ┌───────────────────────────────────────────┐
 │ Paste / Share link          │ ───────────▶ │ lookupProduct   scrape page, save product, │
 │ Product screen              │              │                 history point, comparisons │
 │  • details  • comparison    │ ◀─ realtime ─│ Firestore       products/{id}               │
 │  • price chart  • Track     │   listeners  │                 products/{id}/history/*     │
 │ Watchlist                   │              │                 users/{uid}/tracked/*       │
 │ Notifications  ◀──── FCM ───┼──────────────│ refreshTrackedPrices (every 6 h)            │
 └─────────────────────────────┘              │   re-check prices → history → push alerts   │
                                              └───────────────────────────────────────────┘
```

Why a backend? Price history and alerts need something that checks prices on a schedule, even when your phone is off. Store pages also need to be fetched and parsed somewhere stable.

---

## Setup (about 20 minutes)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Under **Build → Authentication → Sign-in method**, enable **Anonymous**. The app signs users in silently, so there's no login screen.
3. Under **Build → Firestore Database**, click **Create database**. Choose location **asia-south1 (Mumbai)** and **production mode**.
4. Under **Project settings → Usage and billing**, switch to the **Blaze (pay-as-you-go)** plan. Cloud Functions need it, but light personal use normally stays inside the free quotas. Set a budget alert to be safe.
5. Under **Project settings → General → Your apps**, click **Add app → Android**, with package name `com.cartcompare.app`. Download **`google-services.json`** and put it in `android/app/`.

### 2. Deploy the backend
Requires Node.js 22.

```bash
npm install -g firebase-tools
firebase login

cd firebase
# put your project ID in .firebaserc (replace YOUR_FIREBASE_PROJECT_ID)
cd functions
npm install
cp .env.example .env        # optional API keys, see below
npm test                    # 19 tests for parsers, matching, alerts and the SSRF guard
cd ..
firebase deploy --only functions,firestore
```

This deploys 5 functions (`lookupProduct`, `trackProduct`, `untrackProduct`, `refreshTrackedPrices`, `pruneOldHistory`), the Firestore security rules and the indexes. The new indexes can take a few minutes to build.

### 3. Get the APK
GitHub Actions builds the APK on every push (`.github/workflows/build-apk.yml`).

- **Download:** open the **`apk-build`** branch and download **`CartCompare.apk`**. It's also attached as an artifact to each run in the **Actions** tab.
- **Connect it to your Firebase project:** do one of these, and the next build will be connected:
  - commit your `google-services.json` to `android/app/`, or
  - paste its contents into a repository secret named **`GOOGLE_SERVICES_JSON`** (Settings → Secrets and variables → Actions), then re-run the workflow.

  Until you do, the app builds with a placeholder config and shows a "Backend not connected yet" banner.
- Every build is signed with the same key (`android/app/cartcompare.keystore`), so a new APK installs over the old one.
- If a build fails, the error log is pushed to the **`build-log`** branch.

To build locally instead, open the `android/` folder in Android Studio and press Run.

### 4. Use it
1. Install the APK (allow "Install unknown apps" for your browser or file manager if asked). Requires Android 8.0+.
3. Paste a link such as `https://www.amazon.in/dp/B0DGJ65N7V`, or open the Amazon or Flipkart app and tap **Share → Cart Compare**.
4. Tap **Track price**, set a target, and allow notifications.

---

## Optional API keys (`firebase/functions/.env`)

| Key | What it adds | Without it |
|---|---|---|
| `SERPAPI_KEY` ([serpapi.com](https://serpapi.com)) | Comparison across **all** Indian stores, through Google Shopping India | Comparison only searches Amazon.in and Flipkart directly |
| `KEEPA_API_KEY` ([keepa.com](https://keepa.com/#!api)) | Up to **1 year of past price history** for Amazon.in products as soon as you look them up | History starts from the first time anyone looks up the product |
| `SCRAPER_PROXY_URL` | A scraping service, used automatically when a store blocks Google Cloud servers (Amazon often does). Example: `https://api.scraperapi.com/?api_key=KEY&country_code=in&url={url}` | You may see "Amazon blocked the request" |

Tuning settings: `REFRESH_SCHEDULE` (default every 6 hours), `REFRESH_BATCH`, `COMPARE_REFRESH_HOURS`, `MATCH_MIN_SCORE`, `MAX_TRACKED_PER_USER`.

After changing `.env`, run `firebase deploy --only functions` again.

---

## Limitations

- **Scraping is fragile.** Stores change their page layouts, and Amazon in particular blocks cloud servers. Each store has its own parser in `functions/src/stores/`, and most use the structured product data (JSON-LD) that stores publish for Google. When a store changes, update its parser and add a test. Scraping may also be against a store's terms of use. For a public app, switch to the official affiliate product APIs from Amazon and Flipkart, which need approved affiliate accounts.
- **Comparison matches by product name.** The matcher (`compare.ts`) weighs model numbers, storage sizes and variant words like Pro, Plus and Ultra, so "iPhone 16 128 GB" won't match "iPhone 16 Plus" or "256 GB". It can still be wrong, and the app tells users to double-check the variant.
- **Alerts arrive within the refresh interval** (6 hours by default), not instantly.
- **iOS:** the backend works as is. Only the app is Android-only.

## Project layout

```
android/                      Kotlin + Jetpack Compose app
  app/src/main/java/com/cartcompare/app/
    data/                     Firestore models, repository (callables + realtime listeners)
    ui/home/                  paste link, watchlist
    ui/product/               details, comparison, history chart, track dialog
    ui/components/PriceChart  Canvas step chart with tap/drag (no chart library)
    push/                     FCM service + notifications (tap opens the product)
firebase/
  firestore.rules             products readable by signed-in users; watchlists private
  firestore.indexes.json
  functions/src/
    index.ts                  callable + scheduled functions
    product.ts                scrape → save product + history (+ Keepa backfill)
    compare.ts                cross-store search + title matching
    alerts.ts                 alert rules + FCM sending
    http.ts                   fetch with redirect allowlist, proxy fallback
    stores/                   Amazon, Flipkart, Myntra, generic JSON-LD parsers
```

## Firestore data

- `products/{store_id}`: current price, MRP, stock, rating, lowest and highest price, `comparisons[]`, `trackerCount`
- `products/{id}/history/{auto}`: `{ price, at, source }`, written on every price change and at least once a day
- `users/{uid}`: `fcmTokens[]`
- `users/{uid}/tracked/{productId}`: `targetPrice`, `alertMode` (`drop` | `any` | `target_only`), `currentPrice`, `priceWhenAdded`
