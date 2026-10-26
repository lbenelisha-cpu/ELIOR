// Display-only guidance. No order execution or trading-policy dependencies.
const messages={
 UNAVAILABLE:{tone:'neutral',icon:'—',title:'אין איתות תקף',detail:'ממתינים לנרות סגורים, רציפים ועדכניים.',entry:'אין להסיק תמיכה בקנייה מהנתונים הזמינים.',exit:'אין להסיק צורך ביציאה מהנתונים הזמינים.'},
 FLAT:{tone:'neutral',icon:'↔',title:'ללא כיוון ברור',detail:'השיפוע הקצר שטוח או קרוב לאפס.',entry:'אין חיזוק לכניסה מצד השיפוע.',exit:'אין אזהרת יציאה מאושרת מצד השיפוע.'},
 EXIT_WARNING:{tone:'danger',icon:'!',title:'אזהרת יציאה',detail:'MA100 פונה נגד הכיוון הנבחר בשתי בדיקות רצופות המבוססות על נרות סגורים.',entry:'השיפוע הקצר אינו תומך בכניסה בכיוון הנבחר.',exit:'יש לבחון את הפוזיציה מול יתר האיתותים והגנות המחיר.'},
 REVERSAL_PENDING:{tone:'warning',icon:'↔',title:'שינוי כיוון · ממתין לאישור',detail:'MA100 פונה נגד הכיוון הנבחר; עדיין אין שתי בדיקות רצופות שמאשרות זאת.',entry:'נדרשת זהירות: השיפוע הקצר החל לשנות כיוון.',exit:'אזהרה מוקדמת בלבד; יש לעקוב אחר הבדיקה המתוזמנת הבאה.'},
 WEAKENING:{tone:'warning',icon:'↘',title:'המגמה נחלשת',detail:'MA100 עדיין בכיוון הנבחר, אך השיפוע שלו קטן לעומת הבדיקה הקודמת.',entry:'החיזוק מצד השיפוע נחלש; יש לבחון את יתר תנאי הכניסה.',exit:'יש לשים לב להגנת הרווח ולשינוי אפשרי בכיוון.'},
 ENTRY_SUPPORT:{tone:'good',icon:'✓',title:'תומך בכניסה',detail:'MA200 ו־MA100 תומכים בכיוון הנבחר, והשיפוע הקצר אינו נחלש.',entry:'חיזוק לאיתות הקנייה הקיים, יחד עם תנאי וואיקוף ו־RSI.',exit:'השיפוע תומך בכיוון הפוזיציה; הגנות המחיר ממשיכות לפעול.'},
 MIXED:{tone:'warning',icon:'↔',title:'המגמות חלוקות',detail:'MA100 תומך בכיוון הנבחר, אך MA200 עדיין פונה נגדו.',entry:'התאוששות קצרה מול המגמה הרחבה; אין חיזוק מלא לכניסה.',exit:'הכיוון הרחב והקצר שונים; יש לעקוב אחר שניהם.'},
 BROAD_FLAT:{tone:'neutral',icon:'↔',title:'ממתין לכיוון רחב',detail:'MA100 תומך בכיוון הנבחר, אך שיפוע MA200 קרוב לאפס.',entry:'אין עדיין חיזוק משני הממוצעים יחד.',exit:'אין אזהרת יציאה מאושרת מצד השיפוע הקצר.'}
};
export function slopeDecision(snapshot,side='LONG'){
 if(!['LONG','SHORT'].includes(side))throw Error('INVALID_SLOPE_SIDE');
 const period=snapshot?.fastPeriod??100,confirmationIntervalMs=snapshot?.confirmationIntervalMs??300000;
 const result=state=>({state,...messages[state],detail:messages[state].detail.replaceAll('MA100 ',`MA${period} `)});
 const {slow,fast,previousFast:previous}=snapshot||{};
 if(snapshot?.status!=='READY'||![300000,600000,1200000].includes(confirmationIntervalMs)||![slow?.pctPerMinute,fast?.pctPerMinute,previous?.pctPerMinute,fast?.closeTime,previous?.closeTime].every(Number.isFinite)||fast.closeTime-previous.closeTime!==confirmationIntervalMs)return result('UNAVAILABLE');
 const sign=side==='LONG'?1:-1,wide=sign*slow.pctPerMinute,current=sign*fast.pctPerMinute,prior=sign*previous.pctPerMinute,epsilon=1e-10;
 // Zero is not a bearish candle, and repeated paints of one candle are not confirmation.
 if(current< -epsilon&&prior< -epsilon)return result('EXIT_WARNING');
 if(current< -epsilon)return result('REVERSAL_PENDING');
 if(current<=epsilon)return result('FLAT');
 if(current<prior-epsilon)return result('WEAKENING');
 if(wide>epsilon)return result('ENTRY_SUPPORT');
 return result(wide< -epsilon?'MIXED':'BROAD_FLAT');
}
