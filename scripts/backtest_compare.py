import json, urllib.request, zipfile, io, csv, math
from datetime import datetime, timezone, date

SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','AAVEUSDT','WLDUSDT','ZROUSDT']
WINDOWS=[8,10,12,15]
START_DATE=date(2021,10,1)
MA=200
INITIAL=5000.0

def normalize_ms(ts):
    ts=int(ts)
    while ts>10_000_000_000_000:
        ts//=1000
    return ts

def month_range(start_date,end_date):
    y,m=start_date.year,start_date.month
    while (y,m) <= (end_date.year,end_date.month):
        yield f"{y:04d}-{m:02d}"
        m += 1
        if m == 13:
            y += 1
            m = 1

def fetch(symbol):
    rows=[]
    end_date=datetime.now(timezone.utc).date().replace(day=1)
    base='https://data.binance.vision/data/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{ym}.zip'
    for ym in month_range(START_DATE,end_date):
        url=base.format(symbol=symbol,ym=ym)
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(req,timeout=30) as r:
                payload=r.read()
            with zipfile.ZipFile(io.BytesIO(payload)) as z:
                name=z.namelist()[0]
                txt=z.read(name).decode('utf-8')
            for x in csv.reader(txt.splitlines()):
                if not x:
                    continue
                rows.append({'closeTime':normalize_ms(x[6]),'close':float(x[4])})
        except Exception:
            continue
    rows.sort(key=lambda x:x['closeTime'])
    dedup={}
    for x in rows:
        dedup[x['closeTime']]=x
    return [dedup[k] for k in sorted(dedup)]

def eval_wave(candles,min_wave,max_wave,ma_period=200):
    closes=[float(c['close']) for c in candles]
    if len(closes)<ma_period+3:
        return None
    direction=None
    wave_start=closes[0]
    extreme=closes[0]
    prev_up=None
    prev_down=None
    current=0.0
    pct=lambda a,b: abs((b-a)/a)*100 if a else 0.0
    for i in range(1,len(closes)):
        p,prev=closes[i],closes[i-1]
        if direction is None:
            if p>prev: direction='UP'
            elif p<prev: direction='DOWN'
            wave_start=prev
            extreme=p
            current=pct(wave_start,extreme)
            continue
        if direction=='UP':
            if p>=extreme:
                extreme=p
                current=pct(wave_start,extreme)
            else:
                prev_up=pct(wave_start,extreme)
                direction='DOWN'
                wave_start=extreme
                extreme=p
                current=pct(wave_start,extreme)
        else:
            if p<=extreme:
                extreme=p
                current=pct(wave_start,extreme)
            else:
                prev_down=pct(wave_start,extreme)
                direction='UP'
                wave_start=extreme
                extreme=p
                current=pct(wave_start,extreme)

    price=closes[-1]
    ma=sum(closes[-ma_period:])/ma_period
    above=price>ma
    buy=(direction=='UP' and prev_down is not None and current>=min_wave and current<=max_wave and current>prev_down and above)
    sell=(direction=='DOWN' and prev_up is not None and current>prev_up)

    return {
        'price':price,'ma':ma,'aboveMA':above,'direction':direction,
        'wave':current,'prev_down':prev_down,'prev_up':prev_up,
        'buy':buy,'sell':sell
    }

def backtest(candles,max_wave):
    cash=INITIAL
    qty=0.0
    entry=None
    entry_wave=None
    entry_at=None
    trades=[]
    equity=[]

    for i in range(MA+3,len(candles)):
        st=eval_wave(candles[:i+1],4,max_wave,MA)
        if not st:
            continue
        price=st['price']
        if qty==0 and st['buy']:
            qty=cash/price
            entry=price
            entry_wave=st['wave']
            entry_at=candles[i]['closeTime']
            cash=0.0
        elif qty>0 and st['sell']:
            proceeds=qty*price
            trades.append({
                'entryPrice':entry,
                'exitPrice':price,
                'entryWave':entry_wave,
                'entryAt':entry_at,
                'exitAt':candles[i]['closeTime'],
                'pnlPct':(price/entry-1)*100
            })
            cash=proceeds
            qty=0.0
            entry=None
            entry_wave=None
            entry_at=None
        equity.append(cash+qty*price)

    last=float(candles[-1]['close']) if candles else 0
    final=cash+qty*last

    peak=INITIAL
    maxdd=0.0
    for e in equity:
        peak=max(peak,e)
        dd=(e/peak-1)*100 if peak else 0
        maxdd=min(maxdd,dd)

    wins=sum(1 for t in trades if t['pnlPct']>0)
    return_pct=(final/INITIAL-1)*100
    win_rate=wins/len(trades)*100 if trades else 0.0

    # Stability-oriented score: reward return and win rate, penalize drawdown,
    # with a small confidence bonus for having multiple closed trades.
    trade_bonus=min(len(trades),10)*0.75
    composite=return_pct + 0.15*win_rate + 0.60*maxdd + trade_bonus

    return {
        'maxWave':max_wave,
        'returnPct':return_pct,
        'finalValue':final,
        'closedTrades':len(trades),
        'winRate':win_rate,
        'maxDrawdownPct':maxdd,
        'openPosition':qty>0,
        'openEntryPrice':entry,
        'compositeScore':composite,
        'trades':trades
    }

out={'generatedAt':datetime.now(timezone.utc).isoformat(),'start':START_DATE.isoformat(),'symbols':{},'summary':{}}
all_rows=[]
for sym in SYMBOLS:
    try:
        candles=fetch(sym)
        if len(candles)<MA+3:
            out['symbols'][sym]={'error':f'Not enough candles: {len(candles)}'}
            continue
        results=[backtest(candles,w) for w in WINDOWS]
        best=max(results,key=lambda x:x['compositeScore'])
        out['symbols'][sym]={
            'candles':len(candles),
            'first':datetime.fromtimestamp(candles[0]['closeTime']/1000,tz=timezone.utc).isoformat(),
            'last':datetime.fromtimestamp(candles[-1]['closeTime']/1000,tz=timezone.utc).isoformat(),
            'bestWindow':best['maxWave'],
            'results':results
        }
        for r in results:
            all_rows.append((sym,r))
    except Exception as e:
        out['symbols'][sym]={'error':str(e)}

for w in WINDOWS:
    rows=[r for sym,r in all_rows if r['maxWave']==w]
    if rows:
        out['summary'][str(w)]={
            'avgReturnPct':sum(r['returnPct'] for r in rows)/len(rows),
            'avgWinRate':sum(r['winRate'] for r in rows)/len(rows),
            'avgMaxDrawdownPct':sum(r['maxDrawdownPct'] for r in rows)/len(rows),
            'totalClosedTrades':sum(r['closedTrades'] for r in rows),
            'avgCompositeScore':sum(r['compositeScore'] for r in rows)/len(rows)
        }

with open('backtest-results.json','w',encoding='utf-8') as f:
    json.dump(out,f,ensure_ascii=False,indent=2)
print(json.dumps(out,ensure_ascii=False,indent=2))
