#property strict
#property description "LEVI live account data connector. Contains no trading operations."
input int ExpectedAccount=639367;
input string ExpectedServer="TGLColmex-Live";
string Q(string s){StringReplace(s,"\\","\\\\");StringReplace(s,"\"","\\\"");StringReplace(s,"\r"," ");StringReplace(s,"\n"," ");StringReplace(s,"\t"," ");return "\""+s+"\"";}
string N(double v){return DoubleToString(v,8);}
int OnInit(){EventSetTimer(5);OnTimer();return INIT_SUCCEEDED;}
void OnDeinit(const int reason){EventKillTimer();}
void OnTimer(){
 if(AccountNumber()!=ExpectedAccount||AccountServer()!=ExpectedServer||AccountCurrency()!="USD"||AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_REAL){Comment("LEVI: expected USD live account 639367 / TGLColmex-Live required");return;}
 string positions="[";int count=0;
 for(int i=0;i<OrdersTotal();i++){
  if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES))continue;
  if(count++>0)positions+=",";
  positions+="{\"ticket\":"+IntegerToString(OrderTicket())+",\"symbol\":"+Q(OrderSymbol())+",\"type\":"+IntegerToString(OrderType())+",\"lots\":"+N(OrderLots())+",\"profit\":"+N(OrderProfit()+OrderSwap()+OrderCommission())+"}";
 }
 positions+="]";
 string symbols="[";int total=SymbolsTotal(true);count=0;
 for(int j=0;j<total&&j<600;j++){
  string s=SymbolName(j,true);if(count++>0)symbols+=","; string bars="["; int offset=(int)(TimeCurrent()-TimeGMT()); for(int k=1;k<=27;k++){datetime bt=iTime(s,PERIOD_M5,k);double bc=iClose(s,PERIOD_M5,k);if(bt<=0||bc<=0)break;if(k>1)bars+=",";bars+="{\"time\":"+IntegerToString((int)bt-offset)+",\"close\":"+N(bc)+"}";}bars+="]";
  symbols+="{\"symbol\":"+Q(s)+",\"description\":"+Q(SymbolInfoString(s,SYMBOL_DESCRIPTION))+",\"bid\":"+N(MarketInfo(s,MODE_BID))+",\"ask\":"+N(MarketInfo(s,MODE_ASK))+",\"contractSize\":"+N(MarketInfo(s,MODE_LOTSIZE))+",\"minLot\":"+N(MarketInfo(s,MODE_MINLOT))+",\"lotStep\":"+N(MarketInfo(s,MODE_LOTSTEP))+",\"tickValue\":"+N(MarketInfo(s,MODE_TICKVALUE))+",\"tickSize\":"+N(MarketInfo(s,MODE_TICKSIZE))+",\"profitMode\":"+N(MarketInfo(s,MODE_PROFITCALCMODE))+",\"profitCurrency\":"+Q(SymbolInfoString(s,SYMBOL_CURRENCY_PROFIT))+",\"tickTime\":"+IntegerToString((int)MarketInfo(s,MODE_TIME)-offset)+",\"bars\":"+bars+"}";
 }
 symbols+="]";
 string body="{\"version\":1,\"capturedAt\":"+IntegerToString((int)TimeGMT())+",\"connected\":"+(IsConnected()?"true":"false")+",\"account\":{\"login\":"+Q(IntegerToString(AccountNumber()))+",\"server\":"+Q(AccountServer())+",\"type\":\"real\",\"currency\":"+Q(AccountCurrency())+",\"balance\":"+N(AccountBalance())+",\"equity\":"+N(AccountEquity())+",\"profit\":"+N(AccountProfit())+"},\"positions\":"+positions+",\"symbols\":"+symbols+"}";
 int f=FileOpen("LEVI_live_snapshot.tmp",FILE_WRITE|FILE_TXT|FILE_ANSI,0,CP_UTF8);
 if(f==INVALID_HANDLE){Print("LEVI file error: ",GetLastError());return;}
 FileWriteString(f,body);FileFlush(f);FileClose(f);
 if(!FileMove("LEVI_live_snapshot.tmp",0,"LEVI_live_snapshot.json",FILE_REWRITE)){Print("LEVI snapshot move error: ",GetLastError());return;}
 Comment("LEVI account data connected. Budget: USD 150. Execution disabled.");
}

