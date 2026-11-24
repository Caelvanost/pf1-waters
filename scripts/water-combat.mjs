import { MODULE_ID, isPrimaryGM } from "./constants.mjs";
import { getWaterLightDepthStep } from "./water-optics.mjs";
import { syncTokenWaterMovement, syncTokenUnderwaterFlag } from "./water-movement.mjs";
import { getTokenWaterState } from "./water-state.mjs";
import { getRegionWaterBody } from "./water-bodies.mjs";

const CARD="swimTurnCard", RESULT="swimTurnResult";
const pending=new Set(), rolling=new Set();
const queues=new Map(), turns=new Map();
const MOMENTUM="combatBuoyancy", BUOYANCY="buoyancy";
const STATES={swiftlySinking:-1,sinking:-1,neutral:0,rising:1,swiftlyRising:1};
const LABELS={swiftlySinking:"Coule rapidement",sinking:"Coule",neutral:"Neutre",rising:"Flotte",swiftlyRising:"Flotte rapidement"};
const escape=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
function primaryGM(){return isPrimaryGM();}
export function getBuoyancy(token){
 const value=token?.getFlag?.(MODULE_ID,BUOYANCY);
 return Object.hasOwn(STATES,value)?value:"sinking";
}
// Signed speed in units of 10 ft per round. Momentum continues on a
// minor failure once underway; success stops it.
export function nextBuoyancySpeed(previous,buoyancy,outcome){
 const v=Math.max(-3,Math.min(3,Math.trunc(Number(previous)||0)));
 if(outcome==="success")return 0;
 const direction=STATES[buoyancy]??-1;
 if(!v&&outcome==="failure")return 0;
 if(!direction)return v-Math.sign(v);
 return Math.max(-3,Math.min(3,v+direction));
}
export function buoyancyDestination(state,speed,step){
 const surfaceLimit=Math.max(state.bottom??-Infinity,state.surface-state.tokenHeight/2);
 let z=state.elevation+speed*step;
 if(speed<0)z=Math.max(state.bottom??-Infinity,z);
 if(speed>0)z=Math.min(Math.max(state.elevation,surfaceLimit),z);
 const stopped=(speed<0&&state.bottom!==null&&z<=state.bottom+1e-6)||
   (speed>0&&z>=surfaceLimit-1e-6);
 return {elevation:z,speed:stopped?0:speed};
}
export function hasSwimSpeed(actor){
 const speed=actor?.system?.attributes?.speed?.swim;
 return [speed?.total,speed?.base,speed?.value,typeof speed==="number"?speed:0].some(v=>Number(v)>0);
}
export function getSwimTurnContext(combat,combatant=combat?.combatant){
 if(!combat?.started||!combatant||combatant.defeated)return null;
 const token=combatant.token;
 const actor=combatant.actor??token?.actor;
 if(!token||!actor||hasSwimSpeed(actor))return null;
 const state=getTokenWaterState(token);
 if(!state.inWater||state.hasFooting)return null;
 const body=getRegionWaterBody(state.region);
 const dc=body?.swimDC??10;
 if(!Number.isInteger(dc)||dc<=0)return null;
 const buoyancy=getBuoyancy(token);
 return {token,actor,body,state,dc,buoyancy,combatant};
}
export function swimTurnKey(combat,combatant=combat?.combatant){
 return [combat.id,combat.round,combatant?.id].join(":");
}
function flag(message,key){return message.getFlag?.(MODULE_ID,key)??message.flags?.[MODULE_ID]?.[key];}
function findCard(key){return [...game.messages].find(m=>flag(m,CARD)?.key===key);}
function findResult(key){return [...game.messages].find(m=>flag(m,RESULT)?.key===key);}
function cardContent(data,done=false){
 return '<div class="pf1-waters-swim-card"><h3><i class="fa-solid fa-water"></i> '+escape(data.name)+' — Natation</h3>'+
 '<p>'+escape(data.body)+' · Round '+escape(data.round)+' · DD <strong>'+escape(data.dc)+'</strong></p>'+
 '<p>Flottabilité : '+escape(LABELS[data.buoyancy]??LABELS.sinking)+'</p>'+
 '<button type="button" data-pf1-waters-swim '+(done?'disabled':'')+'><i class="fa-solid fa-dice-d20"></i> Test de Natation</button>'+
 '<p class="hint">Une action de mouvement est nécessaire pour tenter de contrôler sa flottabilité.</p></div>';
}
async function postTurnCard(combat){
 if(!primaryGM()||!combat?.started)return;
 const ctx=getSwimTurnContext(combat);
 if(!ctx)return;
 const key=swimTurnKey(combat);
 if(pending.has(key)||findCard(key))return;
 pending.add(key);
 try{
 const data={key,combatId:combat.id,combatantId:ctx.combatant.id,round:combat.round,
 tokenId:ctx.token.id,dc:ctx.dc,buoyancy:ctx.buoyancy,name:ctx.token.name,body:ctx.body?.name??ctx.state.region?.name??"Eau"};
 await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:ctx.actor,token:ctx.token}),content:cardContent(data),
 flags:{[MODULE_ID]:{[CARD]:data}}});
 }finally{pending.delete(key);}
}
function currentContext(data){
 const combat=game.combats?.get(data.combatId);
 if(!combat?.started||swimTurnKey(combat)!==data.key||combat.combatant?.id!==data.combatantId)return null;
 return getSwimTurnContext(combat);
}
export function swimOutcome(total,dc){
 return total>=dc?"success":total<=dc-5?"badFailure":"failure";
}
function messageTotal(message){
 const roll=message?.rolls?.[0]??message?.roll??message?.[0]?.rolls?.[0]??message?.[0]?.roll??message?.[0]??message;
 const total=roll?.total;
 return typeof total==="number"&&Number.isFinite(total)?total:null;
}
async function rollFromCard(message,button){
 const data=flag(message,CARD);
 if(!data||rolling.has(data.key)||findResult(data.key))return;
 const ctx=currentContext(data);
 if(!ctx||!(game.user.isGM||ctx.actor.isOwner))return;
 rolling.add(data.key);button.disabled=true;
 try{
 const result=await ctx.actor.rollSkill("swm",{skipDialog:false});
 if(!result)return;
 const total=messageTotal(result);
 if(total===null){ui.notifications.warn("PF1 Waters : résultat du jet natif non reconnu.");return;}
 if(!currentContext(data)||findResult(data.key))return;
 const outcome=swimOutcome(total,data.dc);
 const label={success:"Réussite",failure:"Échec : aucune progression",badFailure:"Échec de 5 ou plus : flottabilité résolue en fin de tour"}[outcome];
 await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:ctx.actor,token:ctx.token}),
 content:'<div class="pf1-waters-swim-result"><strong>'+escape(label)+'</strong> — '+total+' / DD '+data.dc+'</div>',
 flags:{[MODULE_ID]:{[RESULT]:{key:data.key,total,dc:data.dc,outcome,rollMessageId:result.id??null}}}});
 }finally{rolling.delete(data.key);button.disabled=Boolean(findResult(data.key)||!currentContext(data));}
}
function renderCard(message,html){
 const data=flag(message,CARD);
 if(!data)return;
 const root=html?.querySelector?html:html?.[0];
 const button=root?.querySelector("[data-pf1-waters-swim]");
 if(!button)return;
 const ctx=currentContext(data);
 button.disabled=!ctx||!(game.user.isGM||ctx.actor.isOwner)||Boolean(findResult(data.key));
 button.addEventListener("click",()=>void rollFromCard(message,button).catch(error=>{
 console.error(MODULE_ID+" | Test de Natation impossible",error);
 ui.notifications.error("Test de Natation impossible : "+error.message);
 }));
}
// Snapshot turn identity before asynchronous work; persist the last resolved
// key per combatant so a reload or duplicated hook cannot apply it twice.
function snapshot(combat){
 if(!combat?.started||!combat.combatant)return null;
 return {key:swimTurnKey(combat),id:combat.combatant.id,round:combat.round,turn:combat.turn};
}
async function finishTurn(combat,previous){
 const combatant=combat.combatants?.get(previous.id);
 if(!combatant)return;
 const stored=combatant.getFlag(MODULE_ID,MOMENTUM)??{};
 if(stored.key===previous.key)return;
 const ctx=getSwimTurnContext(combat,combatant);
 if(!ctx){
  await combatant.setFlag(MODULE_ID,MOMENTUM,{key:previous.key,speed:0});return;
 }
 const card=findCard(previous.key);
 // Only automate turns for which a prompt was actually issued.
 if(!card){
  await combatant.setFlag(MODULE_ID,MOMENTUM,{key:previous.key,speed:0});return;
 }
 const result=flag(findResult(previous.key)??{},RESULT);
 const outcome=result?.outcome??"unattempted";
 const prior=stored.round===previous.round-1?stored.speed:0;
 const speed=nextBuoyancySpeed(prior,ctx.buoyancy,outcome);
 const step=2*getWaterLightDepthStep(ctx.token.parent);
 let dest=buoyancyDestination(ctx.state,speed,step);
 // A bad check at the surface also forces immersion, including neutral
 // swimmers. Use the creature height to put its top under the surface.
 if(outcome==="badFailure"&&ctx.state.intersectsSurface&&speed<=0&&
    dest.elevation+ctx.state.tokenHeight>ctx.state.surface){
  dest.elevation=Math.max(ctx.state.bottom??-Infinity,ctx.state.surface-ctx.state.tokenHeight);
  if(dest.elevation===ctx.state.bottom)dest.speed=0;
 }
 await combatant.setFlag(MODULE_ID,MOMENTUM,{key:previous.key,round:previous.round,speed:dest.speed});
 if(Math.abs(dest.elevation-ctx.state.elevation)<1e-6)return;
 await ctx.token.update({elevation:dest.elevation});
 await syncTokenWaterMovement(ctx.token);
 await syncTokenUnderwaterFlag(ctx.token);
 const distance=Math.abs(dest.elevation-ctx.state.elevation);
 const unit=escape(ctx.token.parent?.grid?.units??"m");
 const direction=dest.elevation<ctx.state.elevation?"coule":"remonte";
 await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:ctx.actor,token:ctx.token}),
  content:'<div class="pf1-waters-swim-result"><strong>'+escape(ctx.token.name)+' '+direction+' de '+escape(Number(distance.toFixed(3)))+' '+unit+'</strong><p>Élévation : '+escape(ctx.state.elevation)+' → '+escape(dest.elevation)+' '+unit+'. '+(dest.speed?'Dérive : déséquilibre aquatique et attaques d’opportunité à résoudre par le MJ.':'Limite physique atteinte ou dérive arrêtée.')+'</p></div>'});
}
export function registerWaterCombatHooks(){
 // Prime snapshots when joining/reloading an already started encounter.
 for(const combat of game.combats??[]){const s=snapshot(combat);if(s)turns.set(combat.id,s);}
 const enqueue=combat=>{
  if(!primaryGM())return;
  const id=combat.id,current=snapshot(combat),previous=turns.get(id);
  if(!current)return;
  turns.set(id,current);
  const forward=previous&&(current.round>previous.round||
   (current.round===previous.round&&current.turn>previous.turn));
  const job=(queues.get(id)??Promise.resolve()).catch(()=>{}).then(async()=>{
   if(forward&&previous.key!==current.key&&combat.started)await finishTurn(combat,previous);
   if(snapshot(combat)?.key===current.key)await postTurnCard(combat);
  });
  queues.set(id,job);
  void job.catch(error=>console.error(MODULE_ID+" | Natation en combat impossible",error)).finally(()=>{if(queues.get(id)===job)queues.delete(id);});
 };
 Hooks.on("combatStart",enqueue);
 Hooks.on("updateCombat",(combat,changes)=>{if("round" in changes||"turn" in changes)enqueue(combat);});
 Hooks.on("deleteCombat",combat=>turns.delete(combat.id));
 Hooks.on("renderTokenConfig",(app,html)=>{
  if(!game.user?.isGM)return;
  const root=html?.querySelector?html:html?.[0];
  const form=root?.matches?.("form")?root:root?.querySelector?.("form")??root;
  if(!form||form.querySelector('[name="flags.pf1-waters.buoyancy"]'))return;
  const token=app.document??app.object;
  const field=document.createElement("div");
  field.className="form-group";
  field.innerHTML='<label>PF1 Waters — Flottabilité</label><div class="form-fields"><select name="flags.pf1-waters.buoyancy">'+Object.entries(LABELS).map(([value,label])=>'<option value="'+value+'"'+(getBuoyancy(token)===value?' selected':'')+'>'+label+'</option>').join("")+'</select></div>';
  const tab=form.querySelector('[data-tab="identity"].tab')??form.querySelector('.tab')??form;
  tab.append(field);
 });
 Hooks.on("renderChatMessageHTML",renderCard);
 // Invalidate outstanding cards immediately when the current swimmer reaches
 // the bottom, and on subsequent turns. The click handler also revalidates.
 const refreshButtons=()=>{
  if(typeof document==="undefined")return;
  for(const button of document.querySelectorAll("[data-pf1-waters-swim]")){
   const id=button.closest("[data-message-id]")?.dataset.messageId;
   const message=game.messages?.get(id);
   const data=message&&flag(message,CARD);
   if(!data)continue;
   const ctx=currentContext(data);
   button.disabled=!ctx||!(game.user.isGM||ctx.actor.isOwner)||rolling.has(data.key)||Boolean(findResult(data.key));
  }
 };
 Hooks.on("updateToken",refreshButtons);
 Hooks.on("updateCombat",refreshButtons);
 Hooks.on("deleteCombat",refreshButtons);
 Hooks.on("createChatMessage",message=>{
 const result=flag(message,RESULT);
 if(!result)return;
 const card=findCard(result.key);
 // Re-render on each client; do not grant players write access to GM messages.
 card?.render?.(false);
 const data=card&&flag(card,CARD);
 if(data&&typeof document!=="undefined")for(const el of document.querySelectorAll('[data-message-id="'+card.id+'"] [data-pf1-waters-swim]'))el.disabled=true;
 });
}
