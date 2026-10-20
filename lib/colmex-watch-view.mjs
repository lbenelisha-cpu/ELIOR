// Keep rows and focus/scroll stable while individual quote values arrive.
const views=new WeakMap();
export function syncWatchRows(container,symbols,{selected,describe,onSelect,createElement}){
 let view=views.get(container);
 const key=symbols.join(':');
 if(!view||view.key!==key){
  const rows=new Map();
  for(const symbol of symbols){
   const button=createElement('button'),name=createElement('b'),price=createElement('span');
   button.type='button';name.textContent=symbol;button.append(name,price);button.onclick=()=>onSelect(symbol);
   rows.set(symbol,{button,price});
  }
  container.replaceChildren(...[...rows.values()].map(r=>r.button));view={key,rows};views.set(container,view);
 }
 for(const symbol of symbols){
  const {button,price}=view.rows.get(symbol),quote=describe(symbol);
  button.className='watch-row'+(symbol===selected?' active':'');button.setAttribute('aria-pressed',symbol===selected?'true':'false');
  if(price.textContent!==quote.text)price.textContent=quote.text;
  price.title=quote.title||'';
 }
}
