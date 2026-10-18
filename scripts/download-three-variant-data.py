import urllib.request,urllib.parse,json,time,os,sys,hashlib,concurrent.futures
from datetime import datetime,timezone
config=json.load(open(sys.argv[1]));directory=sys.argv[2];os.makedirs(directory,exist_ok=True)
step=300000;end=int(sys.argv[3]) if len(sys.argv)>3 else int(time.time()*1000)//step*step;start=end-(config['days']+config['warmupDays'])*86400000
base='https://data-api.binance.vision/api/v3/klines?'
def download(symbol):
 file=f'{directory}/{symbol}.json';rows=[];cursor=start
 while cursor<end:
  query=urllib.parse.urlencode(dict(symbol=symbol,interval='5m',limit=1000,startTime=cursor,endTime=end-1))
  for attempt in range(3):
   try:
    with urllib.request.urlopen(base+query,timeout=20) as response:batch=json.load(response)
    if not isinstance(batch,list):raise RuntimeError(str(batch))
    break
   except Exception:
    if attempt==2:raise
    time.sleep(1+attempt)
  if not batch:break
  rows.extend(x for x in batch if start<=int(x[0]) and int(x[6])<end)
  next=int(batch[-1][0])+step
  if next<=cursor:raise RuntimeError('Invalid pagination')
  cursor=next
  if len(batch)<1000:break
 rows=sorted({int(x[0]):x for x in rows}.values(),key=lambda x:int(x[0]))
 if len(rows)!=(end-start)//step or any(int(x[0])!=start+i*step for i,x in enumerate(rows)):raise RuntimeError(f'{symbol}: incomplete coverage {len(rows)}')
 encoded=json.dumps(rows,separators=(',',':')).encode();open(file+'.tmp','wb').write(encoded);os.replace(file+'.tmp',file)
 print(symbol,len(rows),flush=True)
 return dict(symbol=symbol,bars=len(rows),sha256=hashlib.sha256(encoded).hexdigest())
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:files=list(executor.map(download,config['symbols']))
manifest=dict(source='https://data-api.binance.vision/api/v3/klines',downloadedAt=datetime.now(timezone.utc).isoformat(),start=start,end=end,step=step,files=files)
json.dump(manifest,open(directory+'/manifest.json','w'),indent=2)
print('COMPLETE',manifest['start'],manifest['end'],flush=True)
