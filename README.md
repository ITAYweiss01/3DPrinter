# habits · מי אני רוצה להיות

**האתר:** https://itayweiss01.github.io/habits/

אתר סטטי לבניית הרגלים מבוססי זהות, בהשראת הספר **Atomic Habits** מאת ג'יימס קליר.

כותבים מה רוצים לעשות או להיות, ומקבלים:

- **משפט זהות** ("אני אדם ש...") שנבנה מהתחומים שזוהו בטקסט.
- **מפת בועות** של 5–6 תכונות. לוחצים על תכונה ורואים איך אדם כזה מתנהל ואילו הרגלים לאמץ.
- **הרגל של שתי דקות** לכל תכונה, בנוסחת habit stacking: "אחרי ש[עוגן], אני [הרגל]".
- **התאמה לזמן הפנוי**: עד 10 דקות, 30 דקות, או שעה ויותר (כולל הרגלי העמקה).
- **מעקב יומי**: לוח של 7 ימים, רצפים, מונה "הצבעות לזהות" ותזכורת "לא מפספסים פעמיים".
- קישור לשיתוף, העתקה כטקסט, הדפסה, מצב כהה, ועבודה בלי אינטרנט (PWA).

## איך זה עובד

יש שני מצבים:

- **מצב Claude (עם אינטרנט)**: כל מטרה שכותבים, בכל נושא, נשלחת ל־Claude (`claude-opus-5-5`), שבונה משפט זהות, 5–6 תכונות, הרגל של שתי דקות לכל תכונה, שלושה הרגלים והרגל העמקה. התשובה חוזרת כ־JSON לפי סכמה קבועה ונשמרת בדפדפן, כך שרענון הדף לא שולח בקשה נוספת.
- **מצב מקומי (בלי אינטרנט)**: ספרייה של 11 תחומים (כושר, תזונה, שינה, לימודים, סדר, ריכוז, יצירה, קשרים, רוגע, כסף, קריירה) ב־`js/data.js`, לפי מילות מפתח. משמש גם כגיבוי כש־Claude לא זמין.

הנתונים של המעקב נשמרים ב־`localStorage` בדפדפן בלבד.

## חיבור ל־Claude

המפתח של Claude לא נמצא באתר בכלל. הוא נשמר רק ב־Cloudflare Worker (תיקיית `worker/`),
והאתר שולח לו רק את המטרה ואת הזמן הפנוי. פרטים על כל אמצעי ההגנה ב־[SECURITY.md](SECURITY.md).

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY     # מדביקים את המפתח. הוא לא נשמר בשום קובץ
# ב־wrangler.toml: ALLOWED_ORIGINS = כתובת האתר שלכם
npx wrangler deploy
```

אחר כך מכניסים את כתובת ה־Worker ל־`config.js`:

```js
window.HABITS_CONFIG = { proxyUrl: 'https://habits-proxy.<you>.workers.dev', turnstileSiteKey: '' };
```

אופציונלי, הגנה מבוטים: יוצרים widget ב־Cloudflare Turnstile, שמים את ה־site key (ציבורי) ב־`config.js`,
ואת ה־secret key ב־Worker: `npx wrangler secret put TURNSTILE_SECRET`.

אם ה־Worker על דומיין משלכם (לא `workers.dev`), מוסיפים אותו ל־`connect-src` ב־Content-Security-Policy שב־`index.html`.

**חשוב:** הגדירו מגבלת הוצאה חודשית ב־Anthropic Console.

בדיקות האבטחה של ה־Worker: `cd worker && npm test`.

## הרצה מקומית

```bash
python3 -m http.server 8000
# ואז לפתוח http://localhost:8000
```

## פרסום ב־GitHub Pages

ה־workflow ב־`.github/workflows/pages.yml` מפרסם את האתר בכל push ל־`main`.
צריך להפעיל פעם אחת: **Settings → Pages → Source: GitHub Actions**. רק קבצי האתר מתפרסמים, בלי `worker/`.

## הוספת תחום או הרגל

עורכים את `js/data.js`. לכל תחום יש `keywords`, משפט `identity`, משפט `avoid` ושתי תכונות.
לכל תכונה יש `starter` (עוגן + הרגל של שתי דקות), שלושה `habits` ו־`stretch` למי שיש יותר זמן.

## מבנה

```
index.html            הדף
css/style.css         עיצוב (בהיר/כהה, RTL, מותאם לנייד)
js/data.js            ספריית התחומים, התכונות וההרגלים
js/app.js             המחולל המקומי, המפה והמעקב
js/ai.js              מצב Claude: שולח מטרה ל־Worker (בלי מפתח)
js/theme.js           מצב בהיר/כהה (בלי סקריפט inline, בגלל ה־CSP)
config.js             כתובת ה־Worker (ציבורי, בלי מפתחות)
worker/               Cloudflare Worker: המפתח, הפרומפט, הגבלת קצב ובדיקות אבטחה
SECURITY.md           מדיניות האבטחה ומה לעשות אם מפתח דלף
sw.js                 מטמון לעבודה בלי אינטרנט
manifest.webmanifest  התקנה כאפליקציה
```
