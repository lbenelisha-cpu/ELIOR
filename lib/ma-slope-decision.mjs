// Display-only guidance. No order execution or trading-policy dependencies.
const messages={
 UNAVAILABLE:{tone:'neutral',icon:'—',title:'אין איתות תקף',detail:'ממתינים לנרות סגורים, רציפים ועדכניים.',entry:'אין להסיק תמיכה בקנייה מהנתונים הזמינים.',exit:'אין להסיק צורך ביציאה מהנתונים הזמינים.'},
 FLAT:{tone:'neutral',icon:'↔',title:'ללא כיוון ברור',detail:'השיפוע הקצר שטוח או קרוב לאפס.',entry:'אין חיזוק לכניסה מצד השיפוע.',exit:'אין אזהרת יציאה מאושרת מצד השיפוע.'},
 EXIT_WARNING:{tone:'danger',icon:'!',title:'אזהרת יציאה',detail:'MA20 פונה נגד הכיוון הנבחר בשני נרות סגורים רצופים.',entry:'השיפוע הקצר אינו תומך בכניסה בכיוון הנבחר.',exit:'יש לבחון את הפוזיציה מול יתר האיתותים והגנות המחיר.'},
 REVERSAL_PENDING:{tone:'warning',icon:'↔',title:'שינוי כיוון · ממתין לאישור',detail:'MA20 פונה נגד הכיוון הנבחר; עדיין אין שני נרות סגורים שמאשרים זאת.',entry:'נדרשת זהירות: השיפוע הקצר החל לשנות כיוון.',exit:'אזהרה מוקדמת בלבד; יש לעקוב אחר הנר הסגור הבא.'},
 WEAKENING:{tone:'warning',icon:'↘',title:'המגמה נחלשת',detail:'MA20 עדיין בכיוון הנבחר, אך השיפוע שלו קטן לעומת הנר הסגור הקודם.',entry:'החיזוק מצד השיפוע נחלש; יש לבחון את יתר תנאי הכניסה.',exit:'יש לשים לב להגנת הרווח ולשינוי אפשרי בכיוון.'},
 ENTRY_SUPPORT:{tone:'good',icon:'✓',title:'תומך בכניסה',detail:'MA200 ו־MA20 תומכים בכיוון הנבחר, והשיפוע הקצר אינו נחלש.',entry:'חיזוק לאיתות הקנייה הקיים, יחד עם תנאי וואיקוף ו־RSI.',exit:'השיפוע תומך בכיוון הפוזיציה; הגנות המחיר ממשיכות לפעול.'},
 MIXED:{tone:'warning',icon:'↔',title:'המגמות חלוקות',detail:'MA20 תומך בכיוון הנבחר, אך MA200 עדיין פונה נגדו.',entry:'התאוששות קצרה מול המגמה הרחבה; אין חיזוק מלא לכניסה.',exit:'הכיוון הרחב והקצר שונים; יש לעקוב אחר שניהם.'},
 BROAD_FLAT:{tone:'neutral',icon:'↔',title:'ממתין לכיוון רחב',detail:'MA20 תומך בכיוון הנבחר, אך שיפוע MA200 קרוב לאפס.',entry:'אין עדיין חיזוק משני הממוצעים יחד.',exit:'אין אזהרת יציאה מאושרת מצד השיפוע הקצר.'}
};
export function slopeDecision(snapshot,side='LONG'){
 if(!['LONG','SHORT'].includes(side))throw Error('INVALID_SLOPE_SIDE');
 const result=state=>({state,...messages[state]});
 const {slow,fast,previousFast:previous}=snapshot||{};
 if(snapshot?.status!=='READY'||![slow?.pctPerMinute,fast?.pctPerMinute,previous?.pctPerMinute,fast?.closeTime,previous?.closeTime].every(Number.isFinite)||fast.closeTime-previous.closeTime!==300000)return result('UNAVAILABLE');
 const sign=side==='LONG'?1:-1,wide=sign*slow.pctPerMinute,current=sign*fast.pctPerMinute,prior=sign*previous.pctPerMinute,epsilon=1e-10;
 // Zero is not a bearish candle, and repeated paints of one candle are not confirmation.
 if(current< -epsilon&&prior< -epsilon)return result('EXIT_WARNING');
 if(current< -epsilon)return result('REVERSAL_PENDING');
 if(current<=epsilon)return result('FLAT');
 if(current<prior-epsilon)return result('WEAKENING');
 if(wide>epsilon)return result('ENTRY_SUPPORT');
 return result(wide< -epsilon?'MIXED':'BROAD_FLAT');
}
