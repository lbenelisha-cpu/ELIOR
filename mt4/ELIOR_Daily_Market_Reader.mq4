#property strict
#property description "Read-only market collector with closed daily bars for Wyckoff. Never sends orders."
input string SiteURL="";
input string WriteToken="";
input int ExpectedAccount=102598;
input string ExpectedServer="TGLColmex-Demo";
input bool Colmex=true;
input int DailyHistory=500;
int cursor=0;
string J(string s){StringReplace(s,"\\","\\\\");StringReplace(s,"\"","\\\"");StringReplace(s,"\r"," ");StringReplace(s,"\n"," ");StringReplace(s,"\t"," ");return "\""+s+"\"";}
string N(double v){return DoubleToString(v,8);}
int OnInit(){if(StringLen(WriteToken)<32||StringFind(SiteURL,"https://")!=0||DailyHistory<20||DailyHistory>500)return INIT_PARAMETERS_INCORRECT;EventSetTimer(30);return INIT_SUCCEEDED;}
void OnDeinit(const int reason){EventKillTimer();}
void OnTimer(){
 if(!IsConnected()||AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO||AccountNumber()!=ExpectedAccount||AccountServer()!=ExpectedServer)return;
 int total=SymbolsTotal(true);if(total<1)return;int count=MathMin(total,600),offset=(int)MathRound((TimeCurrent()-TimeGMT())/900.0)*900;string catalog="[",items="[";
 for(int i=0;i<count;i++){if(i>0)catalog+=",";catalog+=J(SymbolName(i,true));}catalog+="]";
 int batch=MathMin(count,10),period=Colmex?PERIOD_M5:PERIOD_M30;
 for(int n=0;n<batch;n++){
  string s=SymbolName((cursor+n)%count,true);if(n>0)items+=",";
  string bars="[";int written=0;
  for(int k=1;k<=60;k++){datetime bt=iTime(s,period,k);double bc=iClose(s,period,k);if(bt<=0||bc<=0)break;if(written++>0)bars+=",";bars+="{\"time\":"+IntegerToString((int)bt-offset)+",\"close\":"+N(bc)+"}";}bars+="]";
  string daily="[";written=0;
  for(int d=DailyHistory;d>=1;d--){datetime bt=iTime(s,PERIOD_D1,d);double bc=iClose(s,PERIOD_D1,d);if(bt<=0||bc<=0)continue;datetime closed=bt+86400-offset-1;if(closed>=TimeGMT())continue;if(written++>0)daily+=",";daily+="{\"closeTime\":"+DoubleToString((double)closed*1000,0)+",\"open\":"+N(iOpen(s,PERIOD_D1,d))+",\"high\":"+N(iHigh(s,PERIOD_D1,d))+",\"low\":"+N(iLow(s,PERIOD_D1,d))+",\"close\":"+N(bc)+"}";}daily+="]";
  items+="{\"symbol\":"+J(s)+",\"description\":"+J(SymbolInfoString(s,SYMBOL_DESCRIPTION))+",\"tradeAllowed\":"+(MarketInfo(s,MODE_TRADEALLOWED)>0?"true":"false")+
   ",\"bid\":"+N(MarketInfo(s,MODE_BID))+",\"ask\":"+N(MarketInfo(s,MODE_ASK))+",\"tickTime\":"+IntegerToString((int)MarketInfo(s,MODE_TIME)-offset)+
   ",\"tickSize\":"+N(MarketInfo(s,MODE_TICKSIZE))+",\"tickValue\":"+N(MarketInfo(s,MODE_TICKVALUE))+",\"contractSize\":"+N(MarketInfo(s,MODE_LOTSIZE))+
   ",\"minLot\":"+N(MarketInfo(s,MODE_MINLOT))+",\"lotStep\":"+N(MarketInfo(s,MODE_LOTSTEP))+",\"profitMode\":"+N(MarketInfo(s,MODE_PROFITCALCMODE))+
   ",\"depositCurrency\":"+J(AccountCurrency())+",\"baseCurrency\":"+J(SymbolInfoString(s,SYMBOL_CURRENCY_BASE))+",\"profitCurrency\":"+J(SymbolInfoString(s,SYMBOL_CURRENCY_PROFIT))+
   ",\"marginRequired\":"+N(MarketInfo(s,MODE_MARGINREQUIRED))+",\"swapLong\":"+N(MarketInfo(s,MODE_SWAPLONG))+",\"swapShort\":"+N(MarketInfo(s,MODE_SWAPSHORT))+",\"swapType\":"+N(MarketInfo(s,MODE_SWAPTYPE))+
   ",\"bars\":"+bars+",\"dailyBars\":"+daily+"}";
 }
 items+="]";cursor=(cursor+batch)%count;
 string body="{\"version\":1,\"account\":"+J(IntegerToString(AccountNumber()))+",\"server\":"+J(ExpectedServer)+",\"tradeMode\":0,\"isDemo\":true,\"timeframeSeconds\":"+IntegerToString(Colmex?300:1800)+",\"capturedAt\":"+IntegerToString((int)TimeGMT())+",\"totalAvailable\":"+IntegerToString(total)+",\"catalog\":"+catalog+",\"items\":"+items+"}";
 char data[],result[];string headers;int len=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);ArrayResize(data,len-1);
 int status=WebRequest("POST",SiteURL+(Colmex?"/.netlify/functions/colmex-market":"/.netlify/functions/atrade-market"),"Content-Type: application/json\r\nAuthorization: Bearer "+WriteToken+"\r\n",8000,data,result,headers);
 Comment("Wyckoff D1 collector: HTTP ",status,". Read only; no broker orders.");
}
