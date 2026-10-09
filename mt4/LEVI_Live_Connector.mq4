#property strict
#property description "LEVI live account data connector. Executes individually approved user orders only."
input bool AllowUserApprovedOrders=false;
input int ExpectedAccount=639367;
input string ExpectedServer="TGLColmex-Live";
string Q(string s){StringReplace(s,"\\","\\\\");StringReplace(s,"\"","\\\"");StringReplace(s,"\r"," ");StringReplace(s,"\n"," ");StringReplace(s,"\t"," ");return "\""+s+"\"";}
string N(double v){return DoubleToString(v,8);}
int OnInit(){EventSetTimer(5);OnTimer();return INIT_SUCCEEDED;}
void OnDeinit(const int reason){EventKillTimer();}
void OnTimer(){
 if(AccountNumber()!=ExpectedAccount||AccountServer()!=ExpectedServer||AccountCurrency()!="USD"||AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_REAL){Comment("LEVI: expected USD live account 639367 / TGLColmex-Live required");return;}
 ProcessUserOrder();
 string positions="[";int count=0;
 for(int i=0;i<OrdersTotal();i++){
  if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES))continue;
  if(count++>0)positions+=",";
  positions+="{\"ticket\":"+IntegerToString(OrderTicket())+",\"symbol\":"+Q(OrderSymbol())+",\"type\":"+IntegerToString(OrderType())+",\"lots\":"+N(OrderLots())+",\"profit\":"+N(OrderProfit()+OrderSwap()+OrderCommission())+"}";
 }
 positions+="]";
 string symbols="[";int total=SymbolsTotal(true);count=0;
 for(int j=0;j<total&&j<600;j++){
  string s=SymbolName(j,true);if(count++>0)symbols+=","; string bars="["; int offset=(int)MathRound((TimeCurrent()-TimeGMT())/900.0)*900; for(int k=1;k<=27;k++){datetime bt=iTime(s,PERIOD_M5,k);double bc=iClose(s,PERIOD_M5,k);if(bt<=0||bc<=0)break;if(k>1)bars+=",";bars+="{\"time\":"+IntegerToString((int)bt-offset)+",\"close\":"+N(bc)+"}";}bars+="]";
  string daily="[";int written=0;
  for(int d=500;d>=1;d--){datetime dt=iTime(s,PERIOD_D1,d);double dc=iClose(s,PERIOD_D1,d);if(dt<=0||dc<=0)continue;datetime closed=dt+86400-offset-1;if(closed>=TimeGMT())continue;if(written++>0)daily+=",";daily+="{\"closeTime\":"+DoubleToString((double)closed*1000,0)+",\"open\":"+N(iOpen(s,PERIOD_D1,d))+",\"high\":"+N(iHigh(s,PERIOD_D1,d))+",\"low\":"+N(iLow(s,PERIOD_D1,d))+",\"close\":"+N(dc)+"}";}daily+="]";
  symbols+="{\"symbol\":"+Q(s)+",\"description\":"+Q(SymbolInfoString(s,SYMBOL_DESCRIPTION))+",\"bid\":"+N(MarketInfo(s,MODE_BID))+",\"ask\":"+N(MarketInfo(s,MODE_ASK))+",\"contractSize\":"+N(MarketInfo(s,MODE_LOTSIZE))+",\"minLot\":"+N(MarketInfo(s,MODE_MINLOT))+",\"lotStep\":"+N(MarketInfo(s,MODE_LOTSTEP))+",\"tickValue\":"+N(MarketInfo(s,MODE_TICKVALUE))+",\"tickSize\":"+N(MarketInfo(s,MODE_TICKSIZE))+",\"profitMode\":"+N(MarketInfo(s,MODE_PROFITCALCMODE))+",\"profitCurrency\":"+Q(SymbolInfoString(s,SYMBOL_CURRENCY_PROFIT))+",\"tickTime\":"+IntegerToString((int)MarketInfo(s,MODE_TIME)-offset)+",\"bars\":"+bars+",\"dailyBars\":"+daily+"}";
 }
 symbols+="]";
 string body="{\"executionEnabled\":"+(AllowUserApprovedOrders&&IsTradeAllowed()?"true":"false")+",\"version\":1,\"capturedAt\":"+IntegerToString((int)TimeGMT())+",\"connected\":"+(IsConnected()?"true":"false")+",\"account\":{\"login\":"+Q(IntegerToString(AccountNumber()))+",\"server\":"+Q(AccountServer())+",\"type\":\"real\",\"currency\":"+Q(AccountCurrency())+",\"balance\":"+N(AccountBalance())+",\"equity\":"+N(AccountEquity())+",\"profit\":"+N(AccountProfit())+"},\"positions\":"+positions+",\"symbols\":"+symbols+"}";
 int f=FileOpen("LEVI_live_snapshot.tmp",FILE_WRITE|FILE_TXT|FILE_ANSI,0,CP_UTF8);
 if(f==INVALID_HANDLE){Print("LEVI file error: ",GetLastError());return;}
 FileWriteString(f,body);FileFlush(f);FileClose(f);
 if(!FileMove("LEVI_live_snapshot.tmp",0,"LEVI_live_snapshot.json",FILE_REWRITE)){Print("LEVI snapshot move error: ",GetLastError());return;}
 Comment("LEVI account connected. Budget: USD 150. "+(AllowUserApprovedOrders?"User-approved orders enabled.":"Execution disabled."));
}


// Claim each command before executing. Interrupted/ambiguous commands stay blocked for manual reconciliation.
void OrderResult(string id,string status,int ticket,int error,string message){
 string body="{\"id\":"+Q(id)+",\"status\":"+Q(status)+",\"ticket\":"+IntegerToString(ticket)+",\"error\":"+IntegerToString(error)+",\"message\":"+Q(message)+",\"time\":"+IntegerToString((int)TimeGMT())+"}";
 int out=FileOpen("LEVI_order_result.tmp",FILE_WRITE|FILE_TXT|FILE_ANSI,0,CP_UTF8);
 if(out==INVALID_HANDLE)return;FileWriteString(out,body);FileFlush(out);FileClose(out);
 if(!FileMove("LEVI_order_result.tmp",0,"LEVI_order_result.json",FILE_REWRITE))return;
 if(status!="unknown"){FileDelete("LEVI_order_processing.csv");FileDelete("LEVI_order_lock");}
}
void ProcessUserOrder(){
 if(!AllowUserApprovedOrders||!FileIsExist("LEVI_order_command.csv")||FileIsExist("LEVI_order_processing.csv"))return;
 if(!FileMove("LEVI_order_command.csv",0,"LEVI_order_processing.csv",0))return;
 int f=FileOpen("LEVI_order_processing.csv",FILE_READ|FILE_CSV|FILE_ANSI,';');
 if(f==INVALID_HANDLE)return;
 int version=(int)StringToInteger(FileReadString(f));string id=FileReadString(f);datetime issued=(datetime)StringToInteger(FileReadString(f));int account=(int)StringToInteger(FileReadString(f));string symbol=FileReadString(f),side=FileReadString(f);double lots=StringToDouble(FileReadString(f));int ticket=(int)StringToInteger(FileReadString(f));double reference=StringToDouble(FileReadString(f));FileClose(f);
 if(version!=1||StringLen(id)!=32||account!=ExpectedAccount||issued>TimeGMT()+5||TimeGMT()-issued>20){OrderResult(id,"rejected",0,0,"Invalid or expired approval");return;}
 if(!IsConnected()||!IsTradeAllowed()||IsTradeContextBusy()){OrderResult(id,"rejected",0,0,"Trading disabled or terminal busy");return;}
 if(!SymbolSelect(symbol,true)||MarketInfo(symbol,MODE_TRADEALLOWED)==0||MarketInfo(symbol,MODE_PROFITCALCMODE)!=1||MarketInfo(symbol,MODE_LOTSIZE)!=1||SymbolInfoString(symbol,SYMBOL_CURRENCY_PROFIT)!="USD"){OrderResult(id,"rejected",0,0,"Unsupported stock contract");return;}
 double minimum=MarketInfo(symbol,MODE_MINLOT),step=MarketInfo(symbol,MODE_LOTSTEP),maximum=MarketInfo(symbol,MODE_MAXLOT);
 if(step<=0||lots<minimum||lots>maximum||MathAbs(lots/step-MathRound(lots/step))>0.000001){OrderResult(id,"rejected",0,0,"Invalid lot size");return;}
 double price=MarketInfo(symbol,side=="BUY"?MODE_ASK:MODE_BID);
 if(price<=0||reference<=0||MathAbs(price/reference-1)>0.005||TimeCurrent()-MarketInfo(symbol,MODE_TIME)>90){OrderResult(id,"rejected",0,0,"Price expired or moved beyond 0.5 percent");return;}
 ResetLastError();int result=-1;
 if(side=="BUY"&&ticket==0){
  double exposure=lots*price;
  for(int i=0;i<OrdersTotal();i++){
   if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES))continue;
   if(OrderType()!=OP_BUY){OrderResult(id,"rejected",0,0,"Unsupported existing exposure or pending order");return;}
   string held=OrderSymbol();double ask=MarketInfo(held,MODE_ASK);
   if(MarketInfo(held,MODE_LOTSIZE)!=1||SymbolInfoString(held,SYMBOL_CURRENCY_PROFIT)!="USD"||ask<=0||TimeCurrent()-MarketInfo(held,MODE_TIME)>90){OrderResult(id,"rejected",0,0,"Cannot verify existing exposure");return;}
   exposure+=OrderLots()*ask;
  }
  if(exposure>120.0001){OrderResult(id,"rejected",0,0,"Total exposure exceeds USD 120");return;}
  if(AccountFreeMarginCheck(symbol,OP_BUY,lots)<=0){OrderResult(id,"rejected",0,134,"Insufficient free margin");return;}
  result=OrderSend(symbol,OP_BUY,lots,price,0,0,0,"LEVI approved "+StringSubstr(id,0,8),639367,0,clrNONE);
 }else if(side=="CLOSE"&&ticket>0){
  if(!OrderSelect(ticket,SELECT_BY_TICKET)||OrderCloseTime()!=0||OrderSymbol()!=symbol||OrderType()!=OP_BUY||lots>OrderLots()+0.00000001){OrderResult(id,"rejected",ticket,0,"Position changed or does not match approval");return;}
  double remaining=OrderLots()-lots;
  if(remaining>0.00000001&&remaining<minimum-0.00000001){OrderResult(id,"rejected",ticket,0,"Remaining volume below minimum");return;}
  if(OrderClose(ticket,lots,price,0,clrNONE))result=ticket;
 }else{OrderResult(id,"rejected",0,0,"Invalid action; short selling disabled");return;}
 int error=GetLastError();
 if(result>=0)OrderResult(id,"completed",result,0,"Broker confirmed execution");
 else OrderResult(id,error==128?"unknown":"rejected",ticket,error,error==128?"Trade timeout: verify broker history, do not resend":"Broker rejected execution");
}

