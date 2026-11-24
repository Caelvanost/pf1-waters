import test from "node:test";
import assert from "node:assert/strict";
import {breathCapacity,canBreatheUnderwater,isAquaticActor,actionActivation} from "../scripts/water-breath.mjs";
test("prepared Constitution wins over base",()=>assert.equal(breathCapacity({system:{abilities:{con:{value:9,total:8}}}}),16));
test("breath modifiers apply",()=>assert.equal(breathCapacity({system:{abilities:{con:{total:8}}},getFlag:(_s,k)=>({breathMultiplier:4,breathBonus:2})[k]}),34));
test("PF1 creature subtype and nonbreathing traits",()=>{
 assert.equal(isAquaticActor({system:{traits:{creatureSubtypes:{names:["Aquatique"]}}}}),true);
 assert.equal(canBreatheUnderwater({system:{traits:{undead:true}}}),true);
 assert.equal(canBreatheUnderwater({system:{traits:{construct:true}}}),true);
 assert.equal(canBreatheUnderwater({system:{attributes:{speed:{swim:{total:30}}}}}),false);
 assert.equal(canBreatheUnderwater({getFlag:(_s,k)=>k==="waterBreathing"}),true);
});
test("action references resolve prepared activation",()=>{
 const actor={items:new Map([["item",{actions:new Map([["action",{activation:{type:"standard"}}]])}]])};
 assert.deepEqual(actionActivation(actor,{item:{id:"item"},action:{id:"action"}}),{id:"item:action",type:"standard"});
});
