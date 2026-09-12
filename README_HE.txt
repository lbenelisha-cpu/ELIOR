ELIOR – מעבר ל-Twelve Data + AI Monitor כל 5 דקות

להעלות/להחליף ב-GitHub רק את הקבצים הבאים:
1. app.js  (בשורש הפרויקט)
2. netlify/functions/market-data.js
3. netlify/functions/fx-rate.js
4. netlify/functions/ai-monitor.mjs

דרישה שכבר הושלמה:
TWELVE_DATA_API_KEY קיים ב-Netlify Environment variables.

מה משתנה:
- SPY/QQQ והמט״ח עוברים ל-Twelve Data.
- נתוני המודל נשענים על 100 ימי מסחר, והמחיר האחרון מתרענן ממחיר עדכני.
- AI Monitor רץ כל 5 דקות בימים שני-שישי, 14:00-21:59 UTC.
- בכל הרצה: SPY history + price, QQQ history + price, USD/ILS = בערך 5 credits.
- 96 הרצות ביום × 5 = בערך 480 credits, מתחת למגבלת Basic של 800 ליום.
- Alpha Vantage נשאר ב-Netlify כגיבוי בלבד; אין צורך למחוק את המפתח כרגע.
- Binance Live לא משתנה.
- המערכת נשארת סימולציית Paper Trading בלבד. הסוכן אינו שולח הוראות מסחר ואינו משנה units.

אימות אחרי Deploy:
Netlify > Cloud compute > Functions
ai-monitor צריך להופיע כ-Scheduled.
לאחר הרצה, במסך ELIOR אזור AI Monitor אמור להציג בדיקה אחרונה ומונה בדיקות עולה.
