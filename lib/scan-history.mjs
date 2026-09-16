export function scanHistory(saved){
 return saved.map((row,i)=>{
 const previous=saved[i+1],q=row.candidates?.[row.symbol]||{};
 let reason=previous?'המועמד המוביל לא השתנה.':'זו הסריקה המוקדמת ביותר ברשימה; אין כאן סריקה קודמת להשוואה.';
 if(previous&&previous.symbol!==row.symbol){
 const old=row.candidates?.[previous.symbol];
 reason='המוביל השתנה מ־'+previous.symbol+' ל־'+row.symbol+'. ';
 if(Number.isFinite(Number(old?.master)))reason+=row.symbol+' קיבל '+row.score+' לעומת '+old.master+' ל־'+previous.symbol+' באותה סריקה. '+(Number(row.score)===Number(old.master)?'הציונים שווים; סדר הסמלים מכריע את הדירוג.':'הדירוג נקבע לפי הציון המשולב.');
 else reason+='אין ציון מקביל למוביל הקודם בסריקה זו.';
 }
 return {time:row.slot,symbol:row.symbol,score:row.score,market:q.market,trend:q.trend,risk:q.risk,momentum:q.momentum,reason};
 });
}
