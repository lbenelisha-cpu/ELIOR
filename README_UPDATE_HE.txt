ELIOR - עדכון היסטוריית החלטות AI

1. לפני העלאת הקבצים ל-GitHub, פתח Supabase > SQL Editor.
2. הרץ את הקובץ 01_supabase_ai_history.sql פעם אחת בלבד.
3. לאחר הצלחה, העלה ל-GitHub והחלף רק את הקבצים:
   - app.js
   - index.html
   - netlify/functions/cloud-state.js
   - netlify/functions/daily-snapshot.mjs
4. המתן ל-Netlify Published.
5. באפליקציה לחץ פעם אחת על 'טען שוק + מט"ח'.

מה חדש:
- כל Snapshot חדש שומר Market / Trend / Risk / Momentum / Master.
- נשמרת המלצת ה-AI באותו יום והמסלול הפעיל.
- נוספה טבלת 'היסטוריית החלטות AI'.
- Snapshots ישנים נשמרים ולא נמחקים; בשדות החדשים שלהם יוצג —.
