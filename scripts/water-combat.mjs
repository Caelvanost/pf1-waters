import { MODULE_ID } from "./constants.mjs";
import { getTokenWaterState } from "./water-state.mjs";
import { getRegionWaterBody } from "./water-bodies.mjs";

const CARD="swimTurnCard", RESULT="swimTurnResult";
const pending=new Set(), rolling=new Set();
const queues=new Map();
const escape=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
function primaryGM(){
 const active=[...(game.users??[])].filter(u=>u.active&&u.isGM).sort((a,b)=>a.id.localeCompare(b.id));
 return game.user?.isGM && (!active.length||active[0].id===game.user.id);
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
 return {token,actor,body,state,dc,combatant};
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
 tokenId:ctx.token.id,dc:ctx.dc,name:ctx.token.name,body:ctx.body?.name??ctx.state.region?.name??"Eau"};
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
 const roll=message?.rolls?.[0]??message?.roll;
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
 const label={success:"Réussite",failure:"Échec : aucune progression",badFailure:"Échec de 5 ou plus : immersion / flottabilité à résoudre"}[outcome];
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
export function registerWaterCombatHooks(){
 const enqueue=combat=>{
 if(!primaryGM())return;
 const id=combat.id;
 const job=(queues.get(id)??Promise.resolve()).catch(()=>{}).then(()=>postTurnCard(combat));
 queues.set(id,job);
 void job.catch(error=>console.error(MODULE_ID+" | Carte de Natation impossible",error)).finally(()=>{if(queues.get(id)===job)queues.delete(id);});
 };
 Hooks.on("combatStart",enqueue);
 Hooks.on("updateCombat",(combat,changes)=>{if("round" in changes||"turn" in changes)enqueue(combat);});
 Hooks.on("renderChatMessageHTML",renderCard);
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
