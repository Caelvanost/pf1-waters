# PF1 Waters — v1.2.0

Module autonome de gestion des corps d'eau pour **Foundry VTT v13** et **Pathfinder 1 (PF1 v11.11)**. Interface française, sans dépendance obligatoire à Skull & Shackles, Levels, Wall Height ou Better Roofs.

## Installation

Dans Foundry, installer un module par URL de manifeste :
https://raw.githubusercontent.com/Caelvanost/pf1-waters/main/module.json

Activer **PF1 Waters** dans un monde utilisant le système **pf1**.

## Création d'un corps d'eau

1. Sur la couche **Regions** de la scène, dessiner une Region et la sélectionner.
2. Utiliser l'outil **PF1 Waters — Corps d'eau**.
3. Entrer l'élévation de la **surface**, puis une **profondeur** facultative dans les unités de grille.
4. Le **fond** est automatiquement égal à surface − profondeur. Une profondeur vide signifie « fond non limité ».
5. L'outil « Retirer la propriété eau » désactive la Region aquatique.

Les données sont stockées sous le namespace `flags.pf1-waters.waterRegion` : `{ enabled, surface, depth }`.

## Associer une tuile ou un dessin à la surface visuelle de l'eau

La **Region** reste la seule définition du corps d'eau et de son volume : surface, profondeur, fond, collision géométrique, nage et trajectoires sous-marines.

Une **tuile** (image de vagues, plan d'eau transparent, etc.) ou un **dessin** ne représente que l'apparence de la surface :

1. Créer et configurer une Region d'eau sur la couche **Regions**.
2. Placer une tuile ou un dessin où l'eau doit être **visible**.
3. Sélectionner cet objet sur la couche **Tuiles** ou **Dessins**, puis choisir **Lier à la surface d’eau**.
4. Choisir la Region aquatique correspondante dans la liste.
5. Conserver l'option **Aligner l'élévation sur la Region** pour positionner automatiquement l'objet au niveau de surface configuré. La désactiver si la présentation de la scène exige une élévation différente.
6. Utiliser **Dissocier la surface d’eau** pour retirer uniquement le lien visuel, sans toucher au corps d'eau.

Plusieurs tuiles ou dessins peuvent être associés à une même Region, sans modifier les règles. Les liens survivent à un déplacement/redimensionnement de leur objet. Lorsque la surface d'eau de la Region change, le module aligne les représentations liées qui ont cette option activée. Une Region supprimée ou désactivée laisse les liens inactifs, sans provoquer la création d'une nouvelle zone.

Données de liaison : `flags.pf1-waters.waterSurface = { enabled, regionId, syncElevation }` sur le **TileDocument** ou le **DrawingDocument**. Les Regions conservent leur flag `waterRegion` existant. Le visuel est rendu par Foundry et ses modules de niveaux habituels ; PF1 Waters ne modifie ni l'ordre des couches, ni le découpage des tokens.

## Profondeur visuelle des tokens (v1.2.0)

**Option activée par défaut :** paramètres du module, **PF1 Waters — Tri de rendu des tokens partiellement immergés**.

Lorsque la **base** d'un token est sous la surface d'une Region et que son **sommet** dépasse encore cette surface, il est affiché **devant** une tuile ou un dessin lié à cette même Region, à condition que le centre du token se situe sur ce visuel. À immersion complète, il repasse derrière. En quittant la Region ou en passant en vol, son tri natif est rétabli.

- Formule : profondeur immergée `d = surface - token.elevation`, hauteur physique `h = getTokenPhysicalHeight(token)`. La priorité de rendu est appliquée si `0 < d < h`.
- Foundry v13 trie ses sprites de token, tuiles et formes de dessin dans le groupe primaire. Le module modifie **uniquement l'élévation graphique de `Token.mesh` sur le client**, jamais `TokenDocument.elevation` ni les propriétés de la tuile/dessin.
- La modification est temporaire et se recalcule quand le token bouge/plonge, quand les surfaces changent, ou au chargement de scène. Aucun autre token n'est déplacé.
- La règle ne s'applique pas en l'absence de surface visuelle liée, ni si cette surface est hors de l'emprise du token. Plusieurs visuels d'une même Region sont pris en charge.
- **Limite :** il s'agit d'un tri complet du sprite, pas d'un masque pixel par pixel de la partie immergée. Des modules personnalisant la profondeur, la visibilité, les effets graphiques ou les couches Canvas (notamment Levels/Better Roofs) peuvent imposer un rendu différent : valider en jeu.

## Immersion, nage et mouvement

La hauteur physique vaut par défaut `max(token.width, token.height) × scene.grid.distance`. Il est possible de la personnaliser par `flags.pf1-waters.physicalHeight`, un nombre positif dans les unités de grille. Le module n'utilise pas obligatoirement Wall Height.

Une créature non volante entrant dans un corps d'eau descend à `surface − hauteur/2`, sans franchir le fond. Plus profonde, elle conserve son altitude. La tentative de remontée au-dessus de cette posture de nage est limitée. Le module ne modifie **jamais directement** `TokenDocument.movementAction` : il respecte le système PF1 et les automatismes tiers. Le statut PF1 natif **Nager** est activé tant que la créature nage sans avoir pied ; il est retiré à la sortie, sur le fond et en vol (si disponible). Le vol (`movementAction = "fly"`) ignore le repositionnement vertical automatique.

L'état géométrique distingue :
- `ABOVE_WATER` : base du token au niveau de la surface ou au-dessus ;
- `INTERSECTING_SURFACE` : la surface traverse son volume ;
- `UNDERWATER` : sommet au niveau de la surface ou en dessous ;
- `BELOW_BOTTOM` ou `OUTSIDE_WATER` si aucun volume d'eau n'est occupé.

Le drapeau canonique `flags.pf1-waters.underwater` n'est vrai que si le token est **entièrement immergé**. Le drapeau `flags.world.underwater` est maintenu en miroir pour les macros anciennes. Attention : sa sémantique antérieure (« pieds sous la surface ») change volontairement.

## API publique

Utilisable après `init` via `game.modules.get("pf1-waters")?.api`.

| Méthode | Rôle |
|---|---|
| `getWaterRegionData(region)` | Configuration d'une Region |
| `getWaterSurfaceData(tileOrDrawing)` | Liaison visuelle (sans mécanique) |
| `resolveWaterSurfaceRegion(tileOrDrawing)` | Region aquatique associée, ou null |
| `getWaterSurfacesForRegion(region)` | Tuiles et dessins liés à une Region |
| `configureSelectedWaterSurfaces(type)` | Liaison d'une sélection de Tiles ou Drawings |
| `clearSelectedWaterSurfaces(type)` | Dissociation sans toucher au volume d'eau |
| `getTokenWaterVisualElevation(token)` | Élévation de rendu souhaitée (ou null) |
| `refreshTokenWaterVisualDepth(token)` | Met à jour localement le tri graphique du token |
| `refreshSceneWaterVisualDepth()` | Resynchronise le tri graphique de la scène |
| `getTokenWaterState(token)` | Source de vérité géométrique, avec région, surface, fond, base/sommet/hauteur, immersion, `standing`, `flying`, classification |
| `isTokenUnderwater(token)` | Immersion complète réelle |
| `getTokenPhysicalHeight(token)` | Hauteur physique |
| `getWaterBottomElevation(region)` | Fond ou null |
| `getTokenSwimElevation(token, region)` | Hauteur de nage |
| `tokenHasFooting(token, region, elevation?)` | Pied sur le fond |
| `syncTokenWaterMovement(token)` | Synchronisation de nage |
| `measureProjectileWaterDistance({source,target,samplesPerGrid?})` | Longueur 3D approximative dans le volume d'eau, avec ratio et Regions traversées |
| `syncTokenUnderwaterFlag(token)` | Mise à jour des flags canonique et historique |
| `syncSceneUnderwaterFlags(scene?)` | Synchronisation de scène |
| `configureSelectedWaterRegions()` | Dialogue MJ de configuration |
| `clearSelectedWaterRegions()` | Désactivation MJ |

L'alias `api.waterAutomation` reproduit les noms historiques de Skull & Shackles (getState, getSwimElevation, measureProjectileWaterDistance, etc.). Si Skull & Shackles est actif, son ancien `api.waterAutomation` sert de pont transitoire vers ce module.

## Migration depuis Skull & Shackles

Un MJ actif détecte les anciennes Regions `flags.pf1-skull-and-shackles.waterRegion` sur les scènes du monde et **copie** les valeurs `enabled`, `surface` et `depth` vers le nouveau namespace si celui-ci n'existe pas. Les anciens flags sont conservés ; si la migration d'écriture échoue, la lecture de secours continue de fonctionner. Une désactivation dans PF1 Waters prime sur l'ancien flag. Les états historiques de nage sont également lus lors du premier passage.

## Rendu 2D et modules de niveaux

Foundry v13 et PIXI 7 ne permettent pas de garantir, via une API publique universelle, le découpage correct d'une texture de token devant/derrière une tuile selon la hauteur réelle. **PF1 Waters ne déplace donc pas les tuiles ni les tokens entre couches** et n'applique aucun patch du moteur de rendu. Il propose, en option, un discret **anneau de surface** dans la couche d'interface pour signaler les tokens partiellement immergés qui sont visibles par le client. Cet anneau n'est pas un véritable masque de demi-immersion et peut ne pas suivre les masquages de tuiles particuliers de Levels / Better Roofs ; ces modules restent maîtres de leurs couches et de leur occlusion.

Levels, Wall Height et Better Roofs sont **facultatifs**, sans interaction profonde imposée. Les distances des projectiles sont échantillonnées sur une ligne 3D entre les élévations de base des tokens ; cette approximation est documentée et ne remplace pas une simulation balistique, un lancer de dé ou le traitement des obstacles.

## Vérifications

Les tests Node accompagnant le dépôt couvrent classification de l'immersion, posture de nage, fond, chevauchements, vol, géométrie et anciens flags. Un essai dans une scène Foundry 13/PF1 11.11 réelle reste nécessaire pour valider le rendu et les interactions propres aux autres modules.

## Licence et contribution

Code maintenu pour l'écosystème Pathfinder 1 / Foundry VTT. Signaler les anomalies sur https://github.com/Caelvanost/pf1-waters/issues.
