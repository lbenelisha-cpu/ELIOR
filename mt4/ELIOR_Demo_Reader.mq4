#property strict
input string SiteURL="https://elior-emptying-tracker.netlify.app";
input string WriteToken="";
input int ExpectedAccount=23091074;
input string ExpectedServer="Ava - Demo";
string Quote(string s){StringReplace(s,"\\","\\\\");StringReplace(s,"\"","\\\"");StringReplace(s,"\r"," ");StringReplace(s,"\n"," ");StringReplace(s,"\t"," ");return "\""+s+"\"";}
string Num(double v){return DoubleToString(v,8);}
bool ValidAccount(){return IsConnected()&&AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO&&AccountNumber()==ExpectedAccount&&AccountServer()==ExpectedServer;}
int OnInit(){if(StringLen(WriteToken)<32||StringFind(SiteURL,"https://")!=0){Print("Set HTTPS URL and connection key of at least 32 characters");return INIT_PARAMETERS_INCORRECT;}EventSetTimer(30);return INIT_SUCCEEDED;}
void OnDeinit(const int reason){EventKillTimer();}
void OnTimer(){
 if(!ValidAccount()){Comment("ELIOR: waiting for expected connected DEMO account/server");return;}
 string positions="[";int count=0;
 for(int i=0;i<OrdersTotal();i++){
  if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES))continue;
  if(count>0)positions+=",";
  string side=OrderType()==OP_BUY?"buy":OrderType()==OP_SELL?"sell":"pending";
  positions+="{\"ticket\":"+IntegerToString(OrderTicket())+",\"symbol\":"+Quote(OrderSymbol())+",\"side\":"+Quote(side)+",\"lots\":"+Num(OrderLots())+",\"openPrice\":"+Num(OrderOpenPrice())+",\"profit\":"+Num(OrderProfit())+",\"swap\":"+Num(OrderSwap())+",\"commission\":"+Num(OrderCommission())+"}";count++;
 }
 positions+="]";
 string body="{\"mode\":\"demo\",\"account\":"+Quote(IntegerToString(AccountNumber()))+",\"server\":"+Quote(AccountServer())+",\"currency\":"+Quote(AccountCurrency())+",\"balance\":"+Num(AccountBalance())+",\"equity\":"+Num(AccountEquity())+",\"profit\":"+Num(AccountProfit())+",\"margin\":"+Num(AccountMargin())+",\"freeMargin\":"+Num(AccountFreeMargin())+",\"positions\":"+positions+"}";
 char data[],result[];string headers;int len=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);ArrayResize(data,len-1);
 ResetLastError();int status=WebRequest("POST",SiteURL+"/.netlify/functions/mt4-demo","Content-Type: application/json\r\nAuthorization: Bearer "+WriteToken+"\r\n",8000,data,result,headers);
 if(status==200)Comment("ELIOR demo synced: ",TimeToString(TimeLocal(),TIME_SECONDS));
 else {Comment("ELIOR sync failed. HTTP ",status,"; error ",GetLastError());Print("ELIOR sync HTTP ",status," error ",GetLastError());}
}
