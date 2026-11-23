/**
 * PF1 Waters — temporary underwater fog exploration in Foundry V13.
 *
 * v13 CanvasVisibility renders current sight and accumulates explored shapes.
 * FogManager.commit() copies those shapes into the persistent fog texture,
 * while FogManager.save() can write that texture to the user's FogExploration.
 *
 * Underwater vision MUST remain current, but must never be committed/saved.
 * Do not change the Scene's fog setting, erase previously saved exploration,
 * or write to a FogExploration document. Reset ONLY the transient pending
 * exploration shapes on the next visibility refresh or above-water commit.
 */
import { MODULE_ID } from "./constants.mjs";
import { isWaterObserverSubmerged } from "./water-visual-depth.mjs";

const FOG_PATCHED=Symbol.for("pf1-waters.fog-commit-patched");
const VISIBILITY_PATCHED=Symbol.for("pf1-waters.fog-visibility-patched");
const pending=new WeakSet();
const warnings=new Set();
// The V13 explored texture is independent of the currently visible vision
// polygons. Do not display it while an active observer is underwater.
const explorationDisplayState=new Map();

function warnOnce(key,error){
  if(warnings.has(key))return;
  warnings.add(key);
  console.warn(MODULE_ID+" | "+key,error);
}

/** The actual local vision sources, not all tokens elsewhere in the scene. */
export function getActiveFogObservers(canvas=globalThis.canvas){
  if(!canvas?.scene)return [];
  const sources=canvas.effects?.visionSources??canvas.visibility?.visionSources;
  const list=sources?.values?.()??(Array.isArray(sources)?sources:[]);
  const viewers=new Set();
  for(const source of list){
    if(source?.active===false)continue;
    const token=source?.object??source?.token??source?.data?.object;
    if(token?.document?.parent?.id===canvas.scene.id)viewers.add(token);
  }
  if(viewers.size)return [...viewers];
  // The source collection is not always ready during scene initialization.
  return (canvas.tokens?.controlled??[])
    .filter(token=>token?.document?.parent?.id===canvas.scene.id);
}

/**
 * With multiple simultaneous viewers, conservatively suspend ALL automatic
 * fog commits as long as at least one active source is submerged. This avoids
 * saving underwater exploration in a shared V13 2D fog texture; previously
 * explored surface data is not destroyed.
 */
export function hasUnderwaterFogObserver(canvas=globalThis.canvas){
  return getActiveFogObservers(canvas).some(token=>isWaterObserverSubmerged(token));
}

/**
 * Display only *current* LOS while submerged: hide Foundry V13's existing
 * explored-fog texture, which otherwise reveals the map in dim gray despite
 * blocking new commits. This is client-local rendering state, NOT a FogExploration
 * document update or a change to the Scene's exploration setting.
 */
export function syncUnderwaterFogDisplay(canvas=globalThis.canvas){
  const submerged=hasUnderwaterFogObserver(canvas);
  if(!canvas?.visibility)return false;
  const objects=[canvas.visibility.explored,canvas.fog?.sprite]
    .filter(Boolean);
  let changed=false;
  for(const object of objects){
    const original=explorationDisplayState.get(object);
    if(submerged){
      if(!original)explorationDisplayState.set(object,{
        visible:object.visible,renderable:object.renderable
      });
      if(object.visible!==false){object.visible=false;changed=true;}
      if(object.renderable!==false){object.renderable=false;changed=true;}
    }else if(original){
      if(object.visible!==original.visible){object.visible=original.visible;changed=true;}
      if(object.renderable!==original.renderable){
        object.renderable=original.renderable;changed=true;
      }
      explorationDisplayState.delete(object);
    }
  }
  // A scene switch can replace the explored display objects. Keep the map
  // small and avoid leaving stale pixi objects patched.
  for(const [object,original] of explorationDisplayState){
    if(objects.includes(object))continue;
    if(object&&!object.destroyed){
      object.visible=original.visible;
      object.renderable=original.renderable;
    }
    explorationDisplayState.delete(object);
  }
  return changed;
}

/** Restore the native exploration display on teardown (but not its data). */
export function restoreUnderwaterFogDisplay(){
  for(const [object,original] of explorationDisplayState){
    if(object&&!object.destroyed){
      object.visible=original.visible;
      object.renderable=original.renderable;
    }
    explorationDisplayState.delete(object);
  }
}

/** Discard unsaved underwater exploration before resuming native fog commits. */
export function discardUnderwaterFogPending(fog=globalThis.canvas?.fog){
  if(!fog||!pending.has(fog))return false;
  const visibility=globalThis.canvas?.visibility;
  if(typeof visibility?.resetExploration!=="function"){
    // Do not lose the guard when the reset API is unavailable.
    warnOnce("CanvasVisibility.resetExploration indisponible",undefined);
    return false;
  }
  try{
    visibility.resetExploration();
    pending.delete(fog);
    return true;
  }catch(error){
    warnOnce("Réinitialisation du brouillard temporaire impossible",error);
    return false;
  }
}

export function patchWaterFogExploration(
  fogClass=globalThis.foundry?.canvas?.perception?.FogManager,
  visibilityClass=globalThis.foundry?.canvas?.groups?.CanvasVisibility
){
  const fogProto=fogClass?.prototype??
    (globalThis.canvas?.fog?Object.getPrototypeOf(globalThis.canvas.fog):null);
  if(!fogProto||typeof fogProto.commit!=="function"||
    typeof fogProto.save!=="function"){
    warnOnce("FogManager V13 inaccessible, exploration sous-marine non protégée",undefined);
    return false;
  }
  if(!Object.hasOwn(fogProto,FOG_PATCHED)){
    const originalCommit=fogProto.commit;
    const originalSave=fogProto.save;
    fogProto.commit=function(...args){
      syncUnderwaterFogDisplay();
      if(hasUnderwaterFogObserver()){
        pending.add(this);
        return undefined;
      }
      if(pending.has(this)&&!discardUnderwaterFogPending(this)){
        // Never commit pending underwater geometry if it cannot be discarded.
        return undefined;
      }
      return originalCommit.apply(this,args);
    };
    fogProto.save=function(...args){
      syncUnderwaterFogDisplay();
      if(hasUnderwaterFogObserver()){
        // Existing above-water fog may be awaiting its save; defer it until
        // no submerged observer is active, instead of saving mixed pixels.
        return Promise.resolve();
      }
      if(pending.has(this)&&!discardUnderwaterFogPending(this)){
        return Promise.resolve();
      }
      return originalSave.apply(this,args);
    };
    Object.defineProperty(fogProto,FOG_PATCHED,{value:true});
  }

  const visibilityProto=visibilityClass?.prototype??
    (globalThis.canvas?.visibility?
      Object.getPrototypeOf(globalThis.canvas.visibility):null);
  if(visibilityProto&&typeof visibilityProto.refreshVisibility==="function"&&
    !Object.hasOwn(visibilityProto,VISIBILITY_PATCHED)){
    const originalRefresh=visibilityProto.refreshVisibility;
    visibilityProto.refreshVisibility=function(...args){
      // Prevent underwater shapes already revealed during the previous
      // refresh from remaining in the exploration cache as the token moves.
      if(pending.has(globalThis.canvas?.fog)){
        discardUnderwaterFogPending(globalThis.canvas.fog);
      }
      syncUnderwaterFogDisplay();
      const result=originalRefresh.apply(this,args);
      // Foundry may reset exploration sprites while refreshing the vision
      // texture. Reapply the mask after the native refresh as well.
      syncUnderwaterFogDisplay();
      return result;
    };
    Object.defineProperty(visibilityProto,VISIBILITY_PATCHED,{value:true});
  }
  return true;
}

export function waterFogDiagnostics(){
  const canvas=globalThis.canvas;
  return {
    underwaterObservers:getActiveFogObservers(canvas)
      .filter(viewer=>isWaterObserverSubmerged(viewer))
      .map(viewer=>viewer.document.id),
    suspended:hasUnderwaterFogObserver(canvas),
    pendingDiscard:Boolean(canvas?.fog&&pending.has(canvas.fog)),
    exploredHidden:Boolean(canvas?.visibility?.explored &&
      canvas.visibility.explored.visible===false &&
      canvas.visibility.explored.renderable===false),
    fogSpriteHidden:Boolean(canvas?.fog?.sprite &&
      canvas.fog.sprite.visible===false &&
      canvas.fog.sprite.renderable===false),
    fogEnabled:Boolean(canvas?.scene?.fog?.exploration),
    patched: Boolean(canvas?.fog &&
      Object.hasOwn(Object.getPrototypeOf(canvas.fog),FOG_PATCHED))
  };
}

/** Patch classes once, and refresh the scene singleton after canvas rebuilds. */
export function registerWaterFogHooks(){
  patchWaterFogExploration();
  Hooks.on("canvasInit",()=>{
    restoreUnderwaterFogDisplay();
    patchWaterFogExploration();
  });
  Hooks.on("canvasReady",()=>{
    patchWaterFogExploration();
    syncUnderwaterFogDisplay();
  });
  // The engine can replace the active vision source on selection, movement,
  // elevation and light refresh without committing FogExploration.
  for(const event of ["sightRefresh","visibilityRefresh","controlToken",
    "updateToken","createToken","deleteToken"]){
    Hooks.on(event,()=>syncUnderwaterFogDisplay());
  }
  Hooks.on("canvasTearDown",()=>{
    restoreUnderwaterFogDisplay();
    const fog=globalThis.canvas?.fog;
    if(fog&&pending.has(fog))discardUnderwaterFogPending(fog);
  });
}
