export const HIGHER_RECOVERY_RULE='SECOND_RECOVERY_HIGHER_V1';
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
// Compare absolute wick highs, not the percentage size of two differently based waves.
// The second recovery is the first confirmed upswing after ST and before Spring.
export function recoveryComparison(setup,at=Infinity){
 const first=setup?.rallyHigh,second=setup?.secondRallyHigh,test=setup?.secondaryTest;
 const firstValid=positive(first?.price)&&positive(first?.time);
 const secondValid=positive(second?.price)&&positive(second?.time)&&positive(second?.confirmedAt)&&
  positive(test?.time)&&firstValid&&first.time<test.time&&test.time<second.time&&
  second.time<second.confirmedAt&&second.confirmedAt<=at&&(!setup.springLow||second.time<setup.springLow.time&&second.confirmedAt<=setup.springLow.time);
 const passed=!!secondValid&&second.price>first.price;
 return {version:HIGHER_RECOVERY_RULE,passed,firstPrice:firstValid?first.price:null,firstAt:firstValid?first.time:null,
  secondPrice:secondValid?second.price:null,secondAt:secondValid?second.time:null,confirmedAt:secondValid?second.confirmedAt:null,
  differencePct:secondValid?(second.price/first.price-1)*100:null,
  reason:passed?'HIGHER_SECOND_RECOVERY':secondValid?'SECOND_RECOVERY_NOT_HIGHER':'WAIT_SECOND_RECOVERY_CONFIRMATION'};
}
export function assertHigherRecovery(setup,at){
 const result=recoveryComparison(setup,at);if(!result.passed)throw Error(result.reason);return result;
}
