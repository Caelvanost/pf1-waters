import {MODULE_ID,isPrimaryGM} from "./constants.mjs";
import {getTokenWaterState} from "./water-state.mjs";

const FLAG="breath", CHECK="breathCheck", RESULT="breathResult", DEATH="breathDeath";
const jobs=new Map(), rolling=new Set(), bars=new WeakMap();
const FR={air:"Air",check:"Test de Constitution",dc:"DD",empty:"Réserve d’air épuisée",failed:"Échec : début de la noyade (inconscient, 0 PV).",success:"Réussite : apnée prolongée.",dying:"Noyade : mourant, −1 PV.",death:"Mort par noyade : confirmation du MJ requise.",confirm:"Confirmer la mort",pending:"Test de Constitution en attente : résolvez la carte avant de poursuivre.",unknown:"Résultat du jet de Constitution non reconnu.",error:"Erreur de gestion de l’apnée",noAction:"Action non identifiée : le MJ peut ajuster la réserve manuellement."};
const EN={air:"Air",check:"Constitution Check",dc:"DC",empty:"Air depleted",failed:"Failure: drowning begins (unconscious, 0 HP).",success:"Success: breath held.",dying:"Drowning: dying, −1 HP.",death:"Death by drowning: GM confirmation required.",confirm:"Confirm death",pending:"Constitution check pending: resolve the card before continuing.",unknown:"Constitution roll result not recognized.",error:"Breath tracking error",noAction:"Unidentified action: the GM may adjust the reserve manually."};
const tr=k=>(String(globalThis.game?.i18n?.lang??"en").toLowerCase().split(/[-_]/)[0]==="fr"?FR:EN)[k]??k;
const esc=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const docOf=t=>t?.document??t;
const read=(d,k)=>d?.getFlag?.(MODULE_ID,k)??d?.flags?.[MODULE_ID]?.[k];
const keyOf=t=>t.uuid??t.parent?.id+":"+t.id;
const finite=(v,def)=>v===null||v===undefined||v===""||!Number.isFinite(Number(v))?def:Number(v);
export function isAquaticActor(actor){
 const traits=actor?.system?.traits??{};
 const s=traits.creatureSubtypes??traits.subtypes??traits.creatureType?.subTypes;
 const values=[];
 for(const entry of [s,s?.base,s?.value,s?.names,s?.standard,s?.total,s?.custom]){
  if(Array.isArray(entry)||entry instanceof Set)values.push(...entry);
  else if(typeof entry==="string")values.push(...entry.split(/[,;]+/));
  else if(entry&&typeof entry==="object")values.push(...Object.keys(entry).filter(k=>entry[k]),...Object.values(entry).filter(v=>typeof v==="string"));
 }
 return values.some(v=>["aquatic","aquatique"].includes(String(v).trim().toLowerCase()));
}
export function canBreatheUnderwater(actor){
 const t=actor?.system?.traits;
 return !actor||read(actor,"waterBreathing")===true||read(actor,"noBreathing")===true||
   t?.undead===true||t?.construct===true||isAquaticActor(actor);
}
export function breathCapacity(actor){
 const con=actor?.system?.abilities?.con;
 return Math.max(0,Math.floor(Math.max(0,finite(con?.total,finite(con?.value,0)))*
  Math.max(0,finite(read(actor,"breathMultiplier"),2))+finite(read(actor,"breathBonus"),0)));
}
export function breathStatus(token){
 const d=docOf(token),actor=d?.actor;
 if(!actor||canBreatheUnderwater(actor)||!getTokenWaterState(d).fullySubmerged)return null;
 const max=breathCapacity(actor);
 const stored=read(d,FLAG)??{};
 const spent=Math.max(0,finite(stored.spent,0));
 return {max,remaining:Math.max(0,max-spent),spent,stage:stored.stage??0,checks:stored.checks??0};
}
function empty(){return {spent:0,checks:0,stage:0,pending:null,lastFinished:null,actionKeys:[]};}
const state=d=>({...empty(),...read(d,FLAG)});
const save=(d,s)=>d.setFlag(MODULE_ID,FLAG,s);
function serialize(d,fn){
 const id=keyOf(d);
 const job=(jobs.get(id)??Promise.resolve()).catch(()=>{}).then(fn);
 jobs.set(id,job);void job.finally(()=>{if(jobs.get(id)===job)jobs.delete(id);}).catch(()=>{});
 return job;
}
function report(p){void Promise.resolve(p).catch(e=>console.error(MODULE_ID+" | "+tr("error"),e));}
function recipients(d){
 return [...(game.users??[])].filter(u=>u.isGM||d.actor?.testUserPermission?.(u,"OWNER")).map(u=>u.id);
}
async function say(d,content,flags={}){
 return ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:d.actor,token:d}),whisper:recipients(d),content,flags:{[MODULE_ID]:flags}});
}
function cardContent(data,kind){
 const death=kind===DEATH;
 return '<div class="pf1-waters-breath-card"><h3>'+esc(data.name)+' — '+esc(tr("air"))+'</h3><p>'+esc(tr(death?"death":"empty"))+
 '</p>'+(death?"":'<p>'+esc(tr("dc"))+' <strong>'+data.dc+'</strong></p>')+
 '<button type="button" data-waters-breath="'+kind+'">'+esc(tr(death?"confirm":"check"))+'</button></div>';
}
function locate(data){return game.scenes?.get(data.sceneId)?.tokens?.get(data.tokenId);}
function activeCombat(data){return game.combats?.get(data.combatId)?.started===true;}
function validCheck(d,data){const s=state(d);return activeCombat(data)&&!!breathStatus(d)&&s.pending?.id===data.id&&s.stage===0;}
function validDeath(d,data){const s=state(d);return activeCombat(data)&&!!breathStatus(d)&&s.stage===3&&s.deathId===data.id;}
async function issueCheck(d,s,combat,turnKey){
 if(s.pending)return;
 const data={id:turnKey+":con",sceneId:d.parent.id,tokenId:d.id,combatId:combat.id,name:d.name,dc:10+s.checks};
 s.pending=data;await save(d,s);
 await say(d,cardContent(data,CHECK),{[CHECK]:data});
}
async function hpAtMost(actor,n){
 const hp=Number(actor.system?.attributes?.hp?.value);
 if(Number.isFinite(hp)&&hp>n)await actor.update({"system.attributes.hp.value":n});
}
async function setStatus(actor,id){
 if(!actor.statuses?.has?.(id))await actor.toggleStatusEffect?.(id,{active:true,overlay:id==="dead",interaction:false});
}
export async function beginBreathTurn(combat,combatant,turnKey){
 if(!isPrimaryGM()||!combat?.started||!combatant?.token)return;
 const d=combatant.token;
 return serialize(d,async()=>{
  const view=breathStatus(d);if(!view)return;
  const s=state(d);
  // Unconscious creatures make Constitution checks immediately.
  if(d.actor.statuses?.has?.("unconscious")&&s.stage===0&&view.remaining>0){s.spent=Math.max(s.spent,view.max);await save(d,s);}
  if(s.stage===0&&(s.spent>=view.max)){
   if(s.pending){await say(d,esc(tr("pending")));return;}
   await issueCheck(d,s,combat,turnKey);
  }
 });
}
export async function finishBreathTurn(combat,combatant,turnKey){
 if(!isPrimaryGM()||!combat?.started||!combatant?.token)return;
 const d=combatant.token;
 return serialize(d,async()=>{
  const view=breathStatus(d);if(!view)return;
  const s=state(d);if(s.lastFinished===turnKey)return;
  s.lastFinished=turnKey;
  if(s.stage===1&&s.failedTurn!==turnKey){
   s.stage=2;await save(d,s);await hpAtMost(d.actor,-1);await setStatus(d.actor,"dying");await say(d,esc(tr("dying")));return;
  }
  if(s.stage===2){
   s.stage=3;s.deathId=turnKey+":death";await save(d,s);
   const data={id:s.deathId,sceneId:d.parent.id,tokenId:d.id,combatId:combat.id,name:d.name};
   await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:d.actor,token:d}),whisper:[...game.users].filter(u=>u.isGM).map(u=>u.id),content:cardContent(data,DEATH),flags:{[MODULE_ID]:{[DEATH]:data}}});return;
  }
  if(s.stage===0){
   s.spent+=1;
   if(d.actor.statuses?.has?.("unconscious"))s.spent=Math.max(s.spent,view.max);
  }
  s.actionKeys=[];await save(d,s);
 });
}
export function actionActivation(actor,system){
 const itemId=system?.item?.id,actionId=system?.action?.id;
 const item=actor?.items?.get?.(itemId);
 const actions=item?.actions??item?.system?.actions;
 const action=actions?.get?.(actionId)??(Array.isArray(actions)?actions.find(a=>(a.id??a._id)===actionId):undefined);
 const activation=action?.activation??action?.system?.activation??item?.system?.activation;
 return {id:itemId&&actionId?itemId+":"+actionId:null,type:activation?.type??null};
}
function actionMessage(message){
 if(!isPrimaryGM()||message.type!=="action")return;
 const speaker=message.speaker;
 const combat=[...(game.combats??[])].find(c=>c.started&&c.combatant?.token?.id===speaker?.token&&c.combatant?.token?.parent?.id===speaker?.scene);
 const d=combat?.combatant?.token;
 if(!d||!breathStatus(d))return;
 const {id,type}=actionActivation(d.actor,message.system);
 if(!id||!["standard","full","fullRound"].includes(type))return;
 const turnKey=[combat.id,combat.round,combat.combatant.id].join(":");
 report(serialize(d,async()=>{
  if(!breathStatus(d))return;
  const s=state(d);const key=turnKey+":"+id;
  if(s.actionKeys.includes(key)||s.stage!==0||s.lastFinished===turnKey)return;
  s.actionKeys=[...s.actionKeys,key];s.spent+=1;await save(d,s);
 }));
}
function totalOf(result){
 const r=result?.rolls?.[0]??result?.roll??result?.[0]?.rolls?.[0]??result?.[0]?.roll??result?.[0]??result;
 return typeof r?.total==="number"&&Number.isFinite(r.total)?r.total:null;
}
async function applyResult(message){
 if(!isPrimaryGM())return;
 const data=read(message,RESULT),d=data&&locate(data);
 if(!d)return;
 return serialize(d,async()=>{
  if(!validCheck(d,data))return;
  const user=game.users?.get(message.author?.id??message.user?.id);
  if(!user||!(user.isGM||d.actor.testUserPermission?.(user,"OWNER")))return;
  const s=state(d),dc=s.pending.dc;
  if(!Number.isFinite(data.total))return;
  s.pending=null;s.checks+=1;
  if(data.total>=dc){await save(d,s);await say(d,esc(tr("success"))+" ("+data.total+" / "+dc+")");return;}
  const c=game.combats.get(data.combatId);
  s.stage=1;s.failedTurn=[c.id,c.round,c.combatant?.id].join(":");
  await save(d,s);await hpAtMost(d.actor,0);await setStatus(d.actor,"unconscious");await say(d,esc(tr("failed")));
 });
}
function renderCard(message,html){
 const kind=read(message,CHECK)?CHECK:read(message,DEATH)?DEATH:null;if(!kind)return;
 const data=read(message,kind),d=locate(data),root=html?.querySelector?html:html?.[0];
 const card=root?.querySelector(".pf1-waters-breath-card");
 if(card){const t=document.createElement("template");t.innerHTML=cardContent(data,kind);card.replaceWith(t.content.firstElementChild);}
 const button=root?.querySelector("[data-waters-breath]");if(!button)return;
 const allowed=()=>d&&(kind===DEATH?game.user.isGM&&validDeath(d,data):(game.user.isGM||d.actor.isOwner)&&validCheck(d,data));
 button.disabled=!allowed();
 button.addEventListener("click",async()=>{
  if(!allowed()||rolling.has(data.id))return;rolling.add(data.id);button.disabled=true;
  try{
   if(kind===DEATH){
    const yes=await foundry.applications.api.DialogV2.confirm({window:{title:tr("confirm")},content:esc(data.name)+" — "+esc(tr("death")),rejectClose:false});
    if(yes&&allowed())await serialize(d,async()=>{if(!validDeath(d,data))return;const s=state(d);s.stage=4;await save(d,s);await setStatus(d.actor,"dead");});
   }else{
    const result=await d.actor.rollAbilityTest("con",{skipDialog:false});if(!result)return;
    const total=totalOf(result);if(total===null){ui.notifications.warn(tr("unknown"));return;}
    if(allowed())await say(d,esc(tr("check"))+" : "+total,{[RESULT]:{...data,total}});
   }
  }catch(e){ui.notifications.error(tr("error")+": "+e.message);}finally{rolling.delete(data.id);button.disabled=!allowed();}
 });
}
function resetIfBreathing(d){
 if(!isPrimaryGM()||!d?.actor||!read(d,FLAG)||breathStatus(d))return;
 report(serialize(d,async()=>{if(!breathStatus(d)&&read(d,FLAG))await d.unsetFlag(MODULE_ID,FLAG);}));
}
function drawBar(token){
 if(!token?.document||!globalThis.PIXI)return;
 let container=bars.get(token);
 const d=token.document;
 const view=(game.user?.isGM||d.actor?.isOwner)&&token.visible!==false?breathStatus(d):null;
 if(!view){if(container)container.visible=false;return;}
 if(!container||container.destroyed){
  container=new PIXI.Container();container.eventMode="none";
  container.addChild(new PIXI.Graphics(),new PIXI.Text("",{fontFamily:"Arial",fontSize:11,fill:0xffffff,stroke:0x000000,strokeThickness:2,align:"center"}));
  token.addChild(container);bars.set(token,container);
 }
 container.visible=true;const [g,t]=container.children;
 const w=Math.max(35,token.w*.85),h=Math.max(9,Math.min(15,token.h*.12));
 const ratio=view.max?Math.min(1,view.remaining/view.max):0;
 g.clear().beginFill(0x101b25).lineStyle(1,0x091019).drawRoundedRect(0,0,w,h,3).endFill();
 if(ratio>0)g.lineStyle(0).beginFill(ratio<=.25?0xe59a32:0x459fda).drawRoundedRect(1,1,(w-2)*ratio,h-2,2).endFill();
 else g.lineStyle(0).beginFill(0xb53b3b).drawRoundedRect(1,1,w-2,h-2,2).endFill();
 t.text=tr("air")+" "+view.remaining+"/"+view.max;t.anchor.set(.5);t.position.set(w/2,h/2);
 container.position.set((token.w-w)/2,token.h+Math.max(18,token.h*.18));
}
function refreshScene(){
 for(const token of globalThis.canvas?.tokens?.placeables??[]){resetIfBreathing(token.document);drawBar(token);}
}
export function registerWaterBreathHooks(){
 Hooks.on("createChatMessage",m=>{actionMessage(m);if(read(m,RESULT))report(applyResult(m));});
 Hooks.on("renderChatMessageHTML",renderCard);
 Hooks.on("drawToken",drawBar);Hooks.on("refreshToken",drawBar);
 Hooks.on("destroyToken",token=>{const b=bars.get(token);if(b&&!b.destroyed)b.destroy({children:true});bars.delete(token);});
 Hooks.on("updateToken",d=>{resetIfBreathing(d);if(d.object)drawBar(d.object);});
 for(const event of ["updateActor","createItem","updateItem","deleteItem","createActiveEffect","updateActiveEffect","deleteActiveEffect","updateRegion","updateScene","canvasReady"])Hooks.on(event,refreshScene);
 refreshScene();
}
