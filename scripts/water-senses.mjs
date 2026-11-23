/**
 * PF1 Waters — shared sensory capabilities for Foundry V13 / PF1 v11.11.
 *
 * Detection is based on the token's actual configured vision/detection mode;
 * low-light vision is intentionally not treated as darkvision.
 * The PF1 system remains responsible for the native maximum darkvision range
 * and rules requiring line of sight.
 */
export function hasWaterDarkvision(token) {
  const doc=token?.document??token;
  const mode=String(doc?.sight?.visionMode ??
    token?.vision?.visionMode?.id ?? "").toLowerCase();
  if(mode.includes("darkvision"))return true;
  const detection=doc?.detectionModes??[];
  return [...detection].some(item=>{
    const id=String(item?.id??"").toLowerCase();
    return id.includes("darkvision")&&item.enabled!==false&&
      (item.range===undefined||Number(item.range)>0);
  });
}
