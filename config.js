/* הגדרות פריסה. אין כאן מפתחות ואסור שיהיו: הקובץ הזה ציבורי.
   proxyUrl:          כתובת ה־Cloudflare Worker (תיקיית worker/). המפתח של Claude נשמר רק שם.
                      כשהאתר מוגש מה־Worker עצמו, הבקשות הולכות לאותה כתובת.
   turnstileSiteKey:  אופציונלי. Site key ציבורי של Cloudflare Turnstile להגנה מבוטים.
   donateUrl:         אופציונלי. קישור https לדף תרומה (למשל Buy Me a Coffee). ריק = אין כפתור "קפה". */
window.HABITS_CONFIG = {
  proxyUrl: /\.workers\.dev$/.test(location.hostname) ? location.origin : 'https://api.tiny-habits-plan.workers.dev',
  turnstileSiteKey: '',
  donateUrl: 'https://www.bitpay.co.il/app/me/D1F250C5-F5C2-5BA0-845C-2CC3243F15615375'
};
