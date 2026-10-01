(() => {
 const toggle=document.getElementById('sound-toggle'),test=document.getElementById('sound-test'),status=document.getElementById('sound-status');
 if(!toggle||!test||!status)return;
 let context=null,enabled=false;const seen=new Set();
 async function ready(){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('הדפדפן אינו תומך בשמע');context=context||new Audio();await context.resume();if(context.state!=='running')throw Error('השמע עדיין חסום בדפדפן');}
 async function beep(){await ready();for(let i=0;i<2;i++){const osc=context.createOscillator(),gain=context.createGain(),start=context.currentTime+i*.3;osc.frequency.value=880;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.12,start+.02);gain.gain.exponentialRampToValueAtTime(.001,start+.18);osc.connect(gain);gain.connect(context.destination);osc.start(start);osc.stop(start+.2);}}
 toggle.onclick=async()=>{try{if(enabled){enabled=false;}else{await ready();enabled=true;await beep();}toggle.textContent=enabled?'השתק צפצוף':'הפעל צפצוף';toggle.setAttribute('aria-pressed',String(enabled));status.textContent=enabled?'השמע מופעל ללשונית זו. צפצוף יופעל לאות מאומת חדש או להתרעת סיכון.':'הצפצוף כבוי';}catch(e){enabled=false;status.textContent=e.message;}};
 test.onclick=async()=>{try{await beep();status.textContent='צליל הבדיקה נוגן. זו אינה התראת מסחר.';}catch(e){status.textContent=e.message;}};
 window.LEVIAlerts={notify:async event=>{if(!enabled||!event||typeof event.id!=='string'||typeof event.message!=='string'||!Number.isFinite(event.timestamp)||Math.abs(Date.now()-event.timestamp)>60000||seen.has(event.id))return false;seen.add(event.id);if(seen.size>500)seen.delete(seen.values().next().value);status.textContent=event.message;await beep();return true;}};
})();

