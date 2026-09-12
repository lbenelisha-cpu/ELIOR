ELIOR – Continuous AI Monitor (Paper Trading)

מה העדכון עושה:
- מוסיף Netlify Scheduled Function בשם ai-monitor.mjs.
- בודק אוטומטית SPY ו-QQQ בימי מסחר, פעם בשעה בחלון 14:00–21:00 UTC.
- מחשב Market / Trend / Risk / Momentum / Master ללא לחיצה ידנית.
- שומר heartbeat ב-Supabase: זמן בדיקה אחרון, מספר בדיקות, סטטוס וציונים אחרונים.
- שומר החלטת AI יומית לכל תוכנית בלי ליצור כפילויות בכל בדיקה שעתית.
- QQQ במסלול AI דינמי שומר גם יעד חשיפה והחלטה (הגדלה/הקטנה/ללא שינוי).
- אינו מבצע מסחר אמיתי ואינו משנה יחידות בפוזיציה.

חשוב מאוד:
מקור SPY/QQQ הנוכחי הוא Alpha Vantage TIME_SERIES_DAILY. לכן הסוכן אוטומטי ורץ ללא לחיצה,
אבל המחיר עצמו הוא Daily Close ולא מחיר תוך-יומי רציף. Binance BTC נשאר WebSocket חי 24/7.

סדר התקנה:
1. להריץ 01_supabase_ai_monitor.sql ב-Supabase SQL Editor.
2. להחליף ב-GitHub:
   app.js
   index.html
   netlify/functions/cloud-state.js
3. להוסיף ב-GitHub:
   netlify/functions/ai-monitor.mjs
4. Commit ולהמתין ל-Netlify Published.

אין צורך לאפס את התיק ואין לפתוח מחדש SPY/QQQ.
