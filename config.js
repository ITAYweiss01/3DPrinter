/* הגדרות פריסה. אין כאן מפתחות ואסור שיהיו: הקובץ הזה ציבורי.
   proxyUrl:          כתובת ה־Cloudflare Worker (תיקיית worker/). המפתח של Claude נשמר רק שם.
                      כשהאתר מוגש מה־Worker עצמו, הבקשות הולכות לאותה כתובת.
   turnstileSiteKey:  אופציונלי. Site key ציבורי של Cloudflare Turnstile להגנה מבוטים. */
window.HABITS_CONFIG = {
  proxyUrl: /\.workers\.dev$/.test(location.hostname) ? location.origin : 'https://api.tiny-habits-plan.workers.dev',
  turnstileSiteKey: ''
};
