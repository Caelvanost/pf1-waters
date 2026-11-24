import test from "node:test";
import assert from "node:assert/strict";
import {hasSwimSpeed,swimOutcome,swimTurnKey,getSwimTurnContext,nextBuoyancySpeed,buoyancyDestination,getBuoyancy} from "../scripts/water-combat.mjs";
test("native swim speed exempts a combatant",()=>{
 assert.equal(hasSwimSpeed({system:{attributes:{speed:{swim:{total:15}}}}}),true);
 assert.equal(hasSwimSpeed({system:{attributes:{speed:{swim:{total:0}}}}}),false);
});
test("ordinary PF1 swim margins",()=>{
 assert.equal(swimOutcome(15,15),"success");assert.equal(swimOutcome(11,15),"failure");assert.equal(swimOutcome(10,15),"badFailure");
});
test("turn key is stable across updates and unique per combatant and round",()=>{
 const c={id:"c",round:1,combatant:{id:"a"}};assert.equal(swimTurnKey(c),"c:1:a");
 c.round=2;assert.equal(swimTurnKey(c),"c:2:a");
});
test("no out-of-combat prompts",()=>assert.equal(getSwimTurnContext({started:false}),null));

test("sinking acceleration and cap, including failed attempt to stop",()=>{
 let v=0;for(const expected of [-1,-2,-3,-3]){v=nextBuoyancySpeed(v,"sinking","unattempted");assert.equal(v,expected);}
 assert.equal(nextBuoyancySpeed(v,"sinking","failure"),-3);
 assert.equal(nextBuoyancySpeed(v,"sinking","success"),0);
 assert.equal(nextBuoyancySpeed(0,"sinking","failure"),0);
 assert.equal(nextBuoyancySpeed(0,"sinking","badFailure"),-1);
});
test("rising, neutral and reversal of buoyancy",()=>{
 assert.equal(nextBuoyancySpeed(0,"rising","unattempted"),1);
 assert.equal(nextBuoyancySpeed(0,"neutral","badFailure"),0);
 assert.equal(nextBuoyancySpeed(-3,"rising","unattempted"),-2);
 assert.equal(nextBuoyancySpeed(-1,"neutral","unattempted"),0);
 assert.equal(getBuoyancy({}),"sinking");
});
test("vertical motion respects local bottom and floating posture",()=>{
 const s={surface:0,bottom:-10,elevation:-8,tokenHeight:1.5};
 assert.deepEqual(buoyancyDestination(s,-3,3),{elevation:-10,speed:0});
 assert.deepEqual(buoyancyDestination(s,1,3),{elevation:-5,speed:1});
 assert.deepEqual(buoyancyDestination({...s,elevation:-2},2,3),{elevation:-.75,speed:0});
});

import {combatLabel} from "../scripts/water-combat.mjs";
test("buoyancy labels use French or English fallback without module prefix",()=>{
 assert.equal(combatLabel("sinking","fr"),"Coule");assert.equal(combatLabel("swiftlySinking","fr-FR"),"Coule rapidement");assert.equal(combatLabel("sinking","de"),"Sinking");assert.equal(combatLabel("swiftlyRising","en"),"Swiftly Rising");
});
