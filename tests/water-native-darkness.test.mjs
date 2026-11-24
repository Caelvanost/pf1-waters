import test from "node:test";
import assert from "node:assert/strict";
import {
  getNativeWaterDarknessBehavior,ensureNativeWaterDarknessBehavior,
  ensureSceneNativeWaterDarkness,getNativeWaterDarknessTargets,
  calculateNativeWaterDarkness,applyNativeWaterDarkness,
  refreshNativeWaterDarkness,resetNativeWaterDarkness,
  nativeWaterDarknessDiagnostics,registerNativeWaterDarknessHooks,
  syncNativeWaterDarknessBandExclusivity
} from "../scripts/water-native-darkness.mjs";

const calls=[];
globalThis.game={user:{id:"GM",isGM:true}};
globalThis.Hooks={on:(name,cb)=>calls.push([name,cb])};
function makeRegion({distance=36,sunlightHalfDepth=null,water=true,depth=1000}={}) {
  const scene={id:"sc",environment:{darknessLevel:.2,globalLight:{enabled:true,darkness:{max:.8}}},
    grid:{size:100,distance:1.5,units:"m"},regions:[],tokens:[],
    flags:{"pf1-waters":{waterBodies:[{id:"body",name:"Lac",surface:0,visionHalfDepth:sunlightHalfDepth??distance}]}},
    getFlag(ns,key){return this.flags?.[ns]?.[key];}
  };
  const region={id:"r1",parent:scene,behaviors:[],elevation:0,
    flags:{"pf1-waters":{waterRegion:{enabled:water,bodyId:"body",depth,visibilityDepth:distance,
      ...(sunlightHalfDepth===null?{}:{sunlightHalfDepth})}}},
    getFlag(ns,key){return this.flags?.[ns]?.[key];},
    testPoint({x,y}){return x>=0&&x<100&&y>=0&&y<100;},
    async createEmbeddedDocuments(type,defs){
      assert.equal(type,"RegionBehavior");calls.push(["createBehavior",defs]);
      const entries=defs.map((data,i)=>{
        const system={...data.system,updateSource(value){
          Object.assign(this,value);calls.push(["localUpdate",value]);
        }};
        return {...data,id:"managed-"+i,system,
          getFlag(ns,key){return this.flags?.[ns]?.[key];}};
      });
      this.behaviors.push(...entries);
      return entries;
    }
  };
  scene.regions.push(region);
  const observer={
    document:{id:"viewer",parent:scene,x:0,y:0,width:1,height:1,
      elevation:-37.5,sight:{visionMode:"basic"},getFlag(){return undefined;}},
    losHeight:-36
  };
  const perception={update(opts){calls.push(["perception",opts]);}};
  globalThis.canvas={ready:true,scene,
    tokens:{controlled:[observer]},effects:{visionSources:new Map()},
    perception
  };
  return {scene,region,observer,perception};
}
function clean(){resetNativeWaterDarkness();calls.length=0;game.user.isGM=true;}
test("calculation is anchored to the Scene darkness and the sunlight knots",()=>{
  assert.equal(calculateNativeWaterDarkness(0,1),0);
  assert.equal(calculateNativeWaterDarkness(0,.5),.5);
  assert.ok(Math.abs(calculateNativeWaterDarkness(.2,.5)-.6)<1e-12);
  assert.ok(Math.abs(calculateNativeWaterDarkness(.2,.25)-.8)<1e-12);
  assert.equal(calculateNativeWaterDarkness(.2,0),1);
  assert.equal(calculateNativeWaterDarkness(.7,1),.7);
  assert.equal(calculateNativeWaterDarkness(1,.5),1);
});
test("automatic native bands disable parent behavior",async()=>{
 clean();const {region,scene,observer}=makeRegion();
 const b=await ensureNativeWaterDarknessBehavior(region);
 assert.equal(b.disabled,true);
 assert.equal(b.getFlag("pf1-waters","nativeWaterDepth"),true);
 assert.equal(getNativeWaterDarknessTargets(scene,[observer]).size,0);
 assert.equal(await ensureNativeWaterDarknessBehavior(region),b);
 clean();
});
test("players do not create behaviors",async()=>{
 clean();const {region}=makeRegion();game.user.isGM=false;
 assert.equal(await ensureNativeWaterDarknessBehavior(region),null);clean();
});
