ELIOR – AI Monitor Function Fix

הבעיה:
Netlify הציג רק 4 Functions, ולכן AI Monitor לא נפרס ולא יכול היה לרוץ.

מה יש בעדכון:
- קובץ חדש בלבד: netlify/functions/ai-monitor.mjs
- הפונקציה מתוזמנת בימי שני–שישי, אחת לשעה בין 14:00–21:00 UTC.
- היא מנטרת SPY ו-QQQ בלבד כדי להישאר בתוך מגבלת Alpha Vantage החינמית.
- שומרת heartbeat ב-Supabase ומעדכנת מספר בדיקות, זמן בדיקה אחרון וציוני הסוכנים.
- QQQ במסלול AI דינמי שומר גם יעד חשיפה והחלטת AI.
- Paper Trading בלבד. אין מסחר אמיתי ואין שינוי אוטומטי ביחידות.

התקנה:
1. העלה ל-GitHub רק את הקובץ:
   netlify/functions/ai-monitor.mjs
2. Commit.
3. המתן ל-Netlify Published.
4. פתח Netlify > Cloud compute > Functions.
5. אמורות להופיע 5 Functions, כולל ai-monitor עם Scheduled.

אין צורך להריץ שוב SQL ואין צורך לשנות app.js או cloud-state.js.
