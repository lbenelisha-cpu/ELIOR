// Freeze geometry at signal time; actual fill determines the percentage distance.
export const CHANNEL_PROTECTION_VERSION='CHANNEL_HALF_TARGET_V1';
export function channelProtectionSnapshot(setup,settings){
 if(settings.channelProfitProtection!==true||setup?.entryMode!=='channel_breakout')return null;
 const width=setup.channelWidth,targetPrice=setup.level+width,fraction=settings.channelActivationFraction??.5;
 if(!(Number.isFinite(width)&&width>0&&Number.isFinite(targetPrice)&&targetPrice>setup.level&&fraction>0&&fraction<1))throw Error('INVALID_CHANNEL_PROTECTION');
 return {version:CHANNEL_PROTECTION_VERSION,width,breakoutPrice:setup.level,targetPrice,activationFraction:fraction,signalTime:setup.signalTime};
}
export function channelProfitLevels(position){
 const plan=position?.setup?.channelProtection;
 if(!plan||plan.version!==CHANNEL_PROTECTION_VERSION)return null;
 const entry=Number(position.entryPrice),target=plan.targetPrice,fraction=plan.activationFraction;
 if(![entry,target,plan.width,plan.breakoutPrice,fraction].every(Number.isFinite)||entry<=0||plan.width<=0||target!==plan.breakoutPrice+plan.width||fraction<=0||fraction>=1)return {status:'INVALID_PLAN'};
 if(target<=entry)return {status:'TARGET_PASSED_AT_FILL',targetPrice:target};
 const targetPct=(target/entry-1)*100,activationPct=targetPct*fraction;
 return {status:'ACTIVE',targetPrice:target,targetPct,activationPct,activationPrice:entry+(target-entry)*fraction,width:plan.width,activationFraction:fraction};
}
export function validateChannelProfitEntry(setup,price,settings){
 if(!setup?.channelProtection)return;
 const levels=channelProfitLevels({entryPrice:price,setup});
 if(levels?.status!=='ACTIVE')throw Error('CHANNEL_TARGET_ALREADY_REACHED');
 if(levels.activationPct>=settings.takeProfitPct)throw Error('CHANNEL_ACTIVATION_ABOVE_TAKE_PROFIT');
}
