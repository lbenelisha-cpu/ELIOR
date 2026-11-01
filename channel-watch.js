// Read-only display classification. Never participates in order authorization.
(function(root){
 const messages={WAIT_CHANNEL_BREAKOUT:'LONG · תעלה ורגרסיה אושרו; חסרה פריצה תקפה',CHANNEL_VOLUME_LOW:'LONG · פריצה נבדקה; חסר אישור מחזור',WAIT_LOWER_CHANNEL_BREAK:'SHORT · תעלה ורגרסיה אושרו; חסרה שבירה תקפה',SHORT_VOLUME_LOW:'SHORT · שבירה נבדקה; חסר אישור מחזור'};
 function candidate({reason,at,enabled,held=false,stale=false,now=Date.now()}){
  const t=typeof at==='number'?at:Date.parse(at);
  if(!enabled||held||stale||!Number.isFinite(t)||t>now||now-t>=60000||!messages[reason])return null;
  return {text:messages[reason],expiresAt:t+60000};
 }
 root.LEVI_CHANNEL_WATCH={candidate};
 // Stop highlighting even when refresh/network fails or the tab was suspended.
 function expire(){for(const badge of root.document?.querySelectorAll('[data-watch-expires]')||[]){if(Date.now()>=Number(badge.dataset.watchExpires)){badge.closest('tr')?.classList.remove('channel-watch');badge.classList.remove('channel-watch-badge');badge.textContent='מועמד קודם · נדרש עדכון';badge.removeAttribute('data-watch-expires');}}}
 root.setInterval?.(expire,1000);
 root.document?.addEventListener('visibilitychange',expire);
})(typeof window==='undefined'?globalThis:window);
