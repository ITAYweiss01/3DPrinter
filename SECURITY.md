# אבטחה

## איפה נמצא המפתח
מפתח ה־API של Claude נמצא **רק** כ־secret ב־Cloudflare Worker (`ANTHROPIC_API_KEY`).
הוא לא נמצא בקוד, לא ב־`config.js`, לא ב־GitHub ולא בדפדפן של אף משתמש.
הדפדפן שולח ל־Worker רק את המטרה ואת הזמן הפנוי. את הפרומפט בונה ה־Worker.

## אמצעי ההגנה

**ב־Worker**
- רשימת מקורות מורשים (`ALLOWED_ORIGINS`). אם היא ריקה, הכול חסום.
- הגבלת קצב: 5 בקשות לדקה לכל כתובת IP.
- בדיקת בוטים אופציונלית עם Cloudflare Turnstile (`TURNSTILE_SECRET`).
- בדיקת קלט: JSON בלבד, עד 4KB, מטרה עד 600 תווים, זמן מתוך 10/30/60 בלבד.
- המודל ו־`max_tokens` קבועים בשרת. אין כלים ואין גישה כללית ל־API.
- שגיאות חוזרות לדפדפן כקוד כללי בלבד, בלי פרטים מה־API ובלי המפתח.
- כותרות אבטחה בכל תשובה (`nosniff`, `no-store`, `CSP`, `HSTS`, `no-referrer`).

**באתר**
- Content-Security-Policy קשוח: אין סקריפטים או סגנונות inline, וחיבורים רק ל־Worker.
- `Referrer-Policy: no-referrer`.
- כל הטקסט מוצג עם `textContent`, אף פעם לא כ־HTML.
- גרסה קודמת שמרה מפתח בדפדפן. האתר מוחק אותו אוטומטית.

**ב־GitHub**
- סריקת מפתחות (gitleaks) בכל push ו־pull request.
- בדיקה שאין שום דבר שנראה כמו מפתח בקבצי האתר.
- בדיקות אבטחה אוטומטיות ל־Worker (`worker/test.mjs`).
- `.gitignore` חוסם `.env`, `.dev.vars` וקבצי מפתחות.
- רק קבצי האתר מתפרסמים ב־GitHub Pages.

## מה עוד כדאי לעשות
- **להגדיר מגבלת הוצאה חודשית** ב־Anthropic Console (Settings → Limits). זו ההגנה הכי חשובה מפני חיוב לא צפוי.
- להשתמש במפתח נפרד רק לאתר הזה, כדי שאפשר יהיה לבטל אותו בלי להשפיע על שום דבר אחר.
- להפעיל ב־GitHub את Settings → Code security → **Secret scanning** ו־**Push protection**.

## אם מפתח דלף
1. מבטלים אותו מיד ב־Anthropic Console ויוצרים חדש.
2. `npx wrangler secret put ANTHROPIC_API_KEY` עם המפתח החדש.
3. מוחקים את המפתח מהקוד. גם אחרי מחיקה הוא נשאר בהיסטוריה של git, ולכן הביטול בשלב 1 הוא מה שבאמת חשוב.
