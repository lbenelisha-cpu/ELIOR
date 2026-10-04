import json, math, time, urllib.request, zipfile, io, csv
from datetime import datetime, timezone, date

SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','AAVEUSDT','WLDUSDT','ZROUSDT']
WINDOWS=[8,10,12,15]
START='2021-10-01T00:00:00Z'
START_MS=int(datetime.fromisoformat(START.replace('Z','+00:00')).timestamp()*1000)
END_MS=int(datetime.now(timezone.utc).timestamp()*1000)
MA=200
INITIAL=5000.0

def get_json(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(req,timeout=30) as r:
        return json.loads(r.read().decode())

def month_range(start_date,end_date):
    y,m=start_date.year,start_date.month
    while (y,m) <= (end_date.year,end_date.month):
        yield '%04d-%02d' % (y,m)
        m += 1
        if m == 13:
            y += 1
            m = 1


def fetch(symbol):
    rows=[]
    start_date=date(2021,10,1)
    end_date=datetime.now(timezone.utc).date().replace(day=1)
    base='https://data.binance.vision/data/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{ym}.zip'
    for ym in month_range(start_date,end_date):
        url=base.format(symbol=symbol,ym=ym)
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(req,timeout=30) as r:
                payload=r.read()
            with zipfile.ZipFile(io.BytesIO(payload)) as z:
                name=z.namelist()[0]
                txt=z.read(name).decode('utf-8')
            for x in csv.reader(txt.splitlines()):
                if not x: continue
                rows.append({'closeTime':int(x[6]),'close':float(x[4])})
        except Exception:
            continue
    rows.sort(key=lambda x:x['closeTime'])
    return rows

def eval_wave(candles,min_wave,max_wave,ma_period=200):
    closes=[float(c['close']) for c in candles]
    if len(closes)<ma_period+3: return None
    direction=None; wave_start=closes[0]; extreme=closes[0]
    prev_up=None; prev_down=None; current=0.0
    pct=lambda a,b: abs((b-a)/a)*100 if a else 0.0
    for i in range(1,len(closes)):
        p,prev=closes[i],closes[i-1]
        if direction is None:
            if p>prev: direction='UP'
            elif p<prev: direction='DOWN'
            wave_start=prev; extreme=p; current=pct(wave_start,extreme); continue
        if direction=='UP':
            if p>=extreme:
                extreme=p; current=pct(wave_start,extreme)
            else:
                prev_up=pct(wave_start,extreme); direction='DOWN'; wave_start=extreme; extreme=p; current=pct(wave_start,extreme)
        else:
            if p<=extreme:
                extreme=p; current=pct(wave_start,extreme)
            else:
                prev_down=pct(wave_start,extreme); direction='UP'; wave_start=extreme; extreme=p; current=pct(wave_start,extreme)
    price=closes[-1]
    ma=sum(closes[-ma_period:])/ma_period
    above=price>ma
    buy=(direction=='UP' and prev_down is not None and current>=min_wave and current<=max_wave and current>prev_down and above)
    sell=(direction=='DOWN' and prev_up is not None and current>prev_up)
    return {'price':price,'buy':buy,'sell':sell,'wave':current,'prev_down':prev_down,'prev_up':prev_up}

def backtest(candles,max_wave):
    cash=INITIAL; qty=0.0; entry=None; entry_wave=None; trades=[]; equity=[]
    for i in range(MA+3,len(candles)):
        st=eval_wave(candles[:i+1],4,max_wave,MA)
        if not st: continue
        price=st['price']
        if qty==0 and st['buy']:
            qty=cash/price; entry=price; entry_wave=st['wave']; cash=0.0
        elif qty>0 and st['sell']:
            proceeds=qty*price
            trades.append({'entryPrice':entry,'exitPrice':price,'entryWave':entry_wave,'pnlPct':(price/entry-1)*100,'exitAt':candles[i]['closeTime']})
            cash=proceeds; qty=0.0; entry=None; entry_wave=None
        equity.append(cash+qty*price)
    last=float(candles[-1]['close']) if candles else 0
    final=cash+qty*last
    peak=INITIAL; maxdd=0.0
    for e in equity:
        peak=max(peak,e)
        dd=(e/peak-1)*100 if peak else 0
        maxdd=min(maxdd,dd)
    wins=sum(1 for t in trades if t['pnlPct']>0)
    return {'maxWave':max_wave,'returnPct':(final/INITIAL-1)*100,'finalValue':final,'closedTrades':len(trades),'winRate':wins/len(trades)*100 if trades else 0,'maxDrawdownPct':maxdd,'openPosition':qty>0,'openEntryPrice':entry,'trades':trades}

out={'generatedAt':datetime.now(timezone.utc).isoformat(),'start':START,'symbols':{}}
for sym in SYMBOLS:
    try:
        candles=fetch(sym)
        out['symbols'][sym]={'candles':len(candles),'first':datetime.fromtimestamp(candles[0]['closeTime']/1000,tz=timezone.utc).isoformat() if candles else None,'last':datetime.fromtimestamp(candles[-1]['closeTime']/1000,tz=timezone.utc).isoformat() if candles else None,'results':[backtest(candles,w) for w in WINDOWS]}
    except Exception as e:
        out['symbols'][sym]={'error':str(e)}

with open('backtest-results.json','w',encoding='utf-8') as f:
    json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(out,ensure_ascii=False,indent=2))
