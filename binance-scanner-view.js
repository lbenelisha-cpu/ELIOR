// Preserve cells (and their animation phase, focus and scroll) during live updates.
(()=>{
 window.LEVI_SCANNER_VIEW={update(body,rows,onSelect){
  const existing=new Map([...body.children].map(row=>[row.dataset.symbol,row]));
  rows.forEach((data,index)=>{
   let row=existing.get(data.symbol);
   if(!row){row=document.createElement('tr');row.dataset.symbol=data.symbol;for(const cell of data.cells)row.append(document.createElement('td'));}
   existing.delete(data.symbol);
   if(row.className!==data.className)row.className=data.className;
   data.cells.forEach((data,i)=>{
    const cell=row.children[i],className=data.className||'';
    if(cell.className!==className)cell.className=className;
    if(cell.innerHTML!==data.html)cell.innerHTML=data.html;
   });
   row.onclick=()=>onSelect(data.symbol,row);
   if(body.children[index]!==row)body.insertBefore(row,body.children[index]||null);
  });
  for(const row of existing.values())row.remove();
 }};
})();
