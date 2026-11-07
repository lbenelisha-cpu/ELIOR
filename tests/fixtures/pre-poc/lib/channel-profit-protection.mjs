// Geometry is frozen before breakout; the execution price only changes its percentage.
export const LEGACY_CHANNEL_PROTECTION_VERSION='CHANNEL_HALF_TARGET_V1';
export const CHANNEL_PROTECTION_VERSION='CHANNEL_TAKE_PROFIT_V2';
export function channelProtectionSnapshot(setup,settings={}){
 if(setup?.entryMode!=='channel_breakout')return null;
 const width=setup.channelWidth,targetPrice=setup.level+width;
 if(!(Number.isFinite(width)&&width>0&&Number.isFinite(setup.level)&&setup.level>0&&Number.isFinite(targetPrice)&&targetPrice>setup.level))throw Error('INVALID_CHANNEL_PROTECTION');
 return {version:CHANNEL_PROTECTION_VERSION,width,breakoutPrice:setup.level,targetPrice,signalTime:setup.signalTime,
  settingsAtSignal:{stopLossPct:settings.stopLossPct??1,profitActivationPct:settings.profitActivationPct??5,trailingGapPp:settings.trailingGapPp??1}};
}
export function channelProfitLevels(position){
 const plan=position?.setup?.channelProtection;
 if(!plan||![CHANNEL_PROTECTION_VERSION,LEGACY_CHANNEL_PROTECTION_VERSION].includes(plan.version))return null;
 const entry=Number(position.entryPrice),target=plan.targetPrice;
 if(![entry,target,plan.width,plan.breakoutPrice].every(Number.isFinite)||entry<=0||plan.width<=0||plan.breakoutPrice<=0||target!==plan.breakoutPrice+plan.width)return {status:'INVALID_PLAN'};
 const targetPct=(target/entry-1)*100;
 if(plan.version===CHANNEL_PROTECTION_VERSION)return {status:target<=entry?'TARGET_PASSED_AT_FILL':'ACTIVE',mode:'TAKE_PROFIT',targetPrice:target,targetPct,width:plan.width};
 // Existing V1 trades retain their recorded policy. No retroactive migration.
 const fraction=plan.activationFraction;
 if(!Number.isFinite(fraction)||fraction<=0||fraction>=1)return {status:'INVALID_PLAN'};
 if(target<=entry)return {status:'TARGET_PASSED_AT_FILL',targetPrice:target};
 return {status:'ACTIVE',mode:'LEGACY_ACTIVATION',targetPrice:target,targetPct,activationPct:targetPct*fraction,activationPrice:entry+(target-entry)*fraction,width:plan.width,activationFraction:fraction};
}
export function validateChannelProfitEntry(setup,price,settings){
 if(!setup?.channelProtection)return;
 const levels=channelProfitLevels({entryPrice:price,setup});
 if(levels?.status!=='ACTIVE')throw Error('CHANNEL_TARGET_ALREADY_REACHED');
 if(levels.mode==='LEGACY_ACTIVATION'&&levels.activationPct>=settings.takeProfitPct)throw Error('CHANNEL_ACTIVATION_ABOVE_TAKE_PROFIT');
}
