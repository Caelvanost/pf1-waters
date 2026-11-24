import test from "node:test";
import assert from "node:assert/strict";
import {hasSwimSpeed,swimOutcome,swimTurnKey,getSwimTurnContext} from "../scripts/water-combat.mjs";
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
