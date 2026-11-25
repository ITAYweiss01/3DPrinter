# habits · מי אני רוצה להיות

**האתר:** https://api.tiny-habits-plan.workers.dev/ (גיבוי ב־GitHub Pages: https://itayweiss01.github.io/3DPrinter/)

אתר סטטי לבניית הרגלים מבוססי זהות, בהשראת הספר **Atomic Habits** מאת ג'יימס קליר.

שימוש חד־פעמי, בשלושה שלבים:

1. **מטרה:** כותבים מי רוצים להיות, ומקבלים משפט זהות ומפה של 5–6 תכונות, עם הרגל של שתי דקות לכל תכונה (habit stacking: "אחרי ש... אני...").
2. **תוכנית:** בוחרים הרגלים ולכל אחד קובעים **כל יום** או **בימים מסוימים**, ואם רוצים גם **שעה**.
3. **סיכום ו־Todoist:** מורידים **קובץ סיכום** (PDF או טקסט), ושולחים את ההרגלים ל־**Todoist**, שם ממשיכים לעקוב, כולל הווידג'ט במסך הבית.

## איך זה עובד

יש שני מצבים:

- **מצב Claude (עם אינטרנט)**: כל מטרה שכותבים, בכל נושא, נשלחת ל־Claude (`claude-opus-5-5`), שבונה משפט זהות, 5–6 תכונות, הרגל של שתי דקות לכל תכונה, שלושה הרגלים והרגל העמקה. התשובה חוזרת כ־JSON לפי סכמה קבועה ונשמרת בדפדפן, כך שרענון הדף לא שולח בקשה נוספת.
- **מצב מקומי (בלי אינטרנט)**: ספרייה של 37 תחומים (בין השאר: כושר, תזונה, שינה, לימודים, סדר, ריכוז, יצירה, קשרים, רוגע, כסף, קריירה, קריאה, שפות, טכנולוגיה, כתיבה, ביטחון, נתינה, טבע, טיפוח, בישול, מוזיקה, משמעת, משפחה, סבלנות, יעילות, גמילה וספורט) ב־`js/data.js`, לפי מילות מפתח. משמש גם כגיבוי כש־Claude לא זמין.

התוכנית נשמרת ב־`localStorage` בדפדפן בלבד, עד שמורידים אותה או שולחים ל־Todoist.

## השרת (Cloudflare Worker)

ה־Worker פרוס ב־`https://api.tiny-habits-plan.workers.dev` (שם גנרי, בלי פרטים אישיים), ומגיש גם את האתר עצמו: `build-site.mjs` אורז את קבצי האתר לתוך ה־Worker בכל פריסה, עם כותרות אבטחה (CSP, `X-Frame-Options`, HSTS).
האתר שואל אותו ב־`GET /features` אילו יכולות מוגדרות (`claude`, `todoist`, `suggest`), ומפעיל רק אותן. כך אפשר להגדיר כל חלק בנפרד בלי שכפתורים יישברו.

פריסה מחדש: `cd worker && npx wrangler deploy`.

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

## חיבור ל־Todoist (ווידג'ט במסך הבית)

בשלב 3 לוחצים **חבר את Todoist ושלח**, מתחברים עם החשבון שלך, וההרגלים נכנסים לפרויקט **"הרגלים"** כמשימות חוזרות לפי הזמנים שנקבעו:

| בתוכנית | ב־Todoist (`due_string`) |
|---|---|
| כל יום | `every day` |
| כל יום בשעה 07:00 | `every day at 07:00` |
| בימים ראשון, רביעי בשעה 18:30 | `every sun, wed at 18:30` |

ההרגל של שתי דקות נכתב בתיאור המשימה. שליחה חוזרת לא יוצרת כפילויות: הרגל שכבר קיים מתעדכן רק אם הזמן שלו השתנה.
ה־`due_string` נבנה ב־Worker מתוך נתונים מובנים (ימים 0–6, שעה HH:MM), כך שטקסט חופשי מהדפדפן לא מגיע אליו.
**נתק** מבטל את ההרשאה אצל Todoist.

הגדרה חד־פעמית:

1. יוצרים אפליקציה ב־Todoist: https://app.todoist.com/app/settings/integrations/app-management
   - OAuth redirect URL: `https://<ה־Worker שלך>.workers.dev/todoist/callback`
2. ב־`worker/wrangler.toml` ממלאים `TODOIST_CLIENT_ID` (ציבורי), ואז:

```bash
cd worker
npx wrangler kv namespace create TODOIST       # מעתיקים את ה־id ל־wrangler.toml
npx wrangler secret put TODOIST_CLIENT_SECRET
npx wrangler secret put TOKEN_KEY              # מצפין את הטוקנים: openssl rand -base64 32
npx wrangler deploy
```

## בקשות לנושאים חדשים

כשמישהו כותב מטרה שלא מתאימה לאף נושא שמור, האתר מציע לו **לשלוח בקשה לנושא חדש**. שום דבר לא נשלח בלי שהוא לוחץ.
הבקשה נשמרת ב־Workers KV (פרטי, לא ברפוזיטורי), בלי IP, ואחרי הסתרה של מיילים, טלפונים וקישורים. בקשות זהות מתאחדות עם מונה.

**לאשר בקשות:** נכנסים ל־`admin.html` באתר (למשל https://itayweiss01.github.io/3DPrinter/admin.html) עם סיסמת הניהול.
לכל בקשה: **נסח נושא עם Claude** כותב טיוטה בפורמט של הספרייה, אפשר **לערוך**, ואז **אשר ופתח PR**.
האישור פותח Pull Request שמוסיף את הנושא ל־`js/data-extra.js`. **מיזוג ה־PR הוא האישור הסופי**, ואחריו הנושא באתר.
ה־PR לא כולל את הטקסט של המבקרים, כי הרפוזיטורי ציבורי.

הגדרה חד־פעמית ב־Worker:

```bash
cd worker
npx wrangler kv namespace create SUGGESTIONS   # מעתיקים את ה־id ל־wrangler.toml
npx wrangler secret put ADMIN_TOKEN            # סיסמה ארוכה ואקראית (לפחות 24 תווים)
npx wrangler secret put GITHUB_TOKEN           # Fine-grained token: רק הרפוזיטורי הזה, Contents + Pull requests: Read and write
npx wrangler deploy
```

סיסמה אקראית טובה: `openssl rand -base64 32`.

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
js/ideas.js           רעיונות שמעוררים מחשבה, מתחת לתיבת המטרה
js/app.js             המחולל המקומי, המפה, התוכנית והסיכום
js/ai.js              מצב Claude ובקשות לנושאים: שולח ל־Worker (בלי מפתח)
js/todoist.js         חיבור ל־Todoist ושליחת ההרגלים עם הזמנים
js/data-extra.js      נושאים שאושרו מבקשות של מבקרים (מתעדכן דרך PR)
admin.html, js/admin.js  דף ניהול: אישור או דחייה של בקשות לנושאים
js/theme.js           מצב בהיר/כהה (בלי סקריפט inline, בגלל ה־CSP)
config.js             כתובת ה־Worker (ציבורי, בלי מפתחות)
worker/               Cloudflare Worker: המפתח, הפרומפט, הגבלת קצב, בקשות לנושאים, Todoist ובדיקות אבטחה
SECURITY.md           מדיניות האבטחה ומה לעשות אם מפתח דלף
sw.js                 מטמון לעבודה בלי אינטרנט
manifest.webmanifest  התקנה כאפליקציה
```
