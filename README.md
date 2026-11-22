# PF1 Waters — v1.4.7

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

Les données sont stockées sous le namespace `flags.pf1-waters.waterRegion` : `{ enabled, surface, depth, visibilityDepth, ringPng, ringScale }`. Le PNG des remous est facultatif et n'affecte pas les règles physiques.

Le formulaire **PF1 Waters — Corps d'eau** est désormais **non modal** : lorsque le MJ sélectionne **Image PNG des remous**, le navigateur natif de fichiers Foundry peut être placé au premier plan et reste cliquable. La Region n'est enregistrée qu'après confirmation du formulaire. Le choix du fichier et le champ facultatif `ringPng` ne changent pas.

## Associer une tuile ou un dessin à la surface visuelle de l'eau

La **Region** reste la seule définition du corps d'eau et de son volume : surface, profondeur, fond, collision géométrique, nage et trajectoires sous-marines.

Une **tuile** (image de vagues, plan d'eau transparent, etc.) ou un **dessin** ne représente que l'apparence de la surface :

1. Créer et configurer une Region d'eau sur la couche **Regions**.
2. Placer une tuile ou un dessin où l'eau doit être **visible**.
3. Sélectionner cet objet sur la couche **Tuiles** ou **Dessins**, puis choisir **Lier à la surface d’eau**.
4. Choisir la Region aquatique correspondante dans la liste.
5. Conserver l'option **Aligner l'élévation sur la Region** pour positionner automatiquement l'objet au niveau de surface configuré. La désactiver si la présentation de la scène exige une élévation différente.
6. Utiliser **Dissocier la surface d’eau** pour retirer uniquement le lien visuel, sans toucher au corps d'eau.

**Visibilité depuis la surface (Foundry v13) :** la nouvelle option **Ne pas masquer la surface comme une toiture**, activée par défaut, empêche la tuile liée à l’eau de s’estomper comme un toit sous l’effet de l’occlusion native. Ainsi, un token dont le point de vue est au-dessus de l’eau peut voir la texture de surface lorsque sa vision et l’éclairage de la scène l’y autorisent. Le module utilise le mode officiel `CONST.OCCLUSION_MODES.NONE` de Foundry v13 : il ne modifie ni `hidden`, ni l’opacité `alpha`, ni les obstacles, ni le brouillard de guerre. **La tuile reste également visible depuis le dessous**, comme une surface translucide ; il ne s’agit pas d’une règle de visibilité directionnelle. Désactiver l’option ou dissocier la tuile restaure son ancien mode d’occlusion de toiture. Les dessins ne possèdent pas ce mode de toiture et ne sont pas modifiés.

**Compatibilité Levels / Better Roofs :** si un autre module cache entièrement une tuile à certaines élévations indépendamment de l’occlusion native, PF1 Waters ne désactive pas ces restrictions externes. Il faut alors vérifier les paramètres de niveaux de la tuile dans ce module.

Plusieurs tuiles ou dessins peuvent être associés à une même Region, sans modifier les règles. Les liens survivent à un déplacement/redimensionnement de leur objet. Lorsque la surface d'eau de la Region change, le module aligne les représentations liées qui ont cette option activée. Une Region supprimée ou désactivée laisse les liens inactifs, sans provoquer la création d'une nouvelle zone.

Données de liaison : `flags.pf1-waters.waterSurface = { enabled, regionId, syncElevation, visibilityDepth, keepVisible, previousOcclusionMode }` sur le **TileDocument** ou le **DrawingDocument**. Les Regions conservent leur flag `waterRegion` existant. `visibilityDepth` ne modifie jamais la profondeur physique de la Region.

## État Nager permanent en immersion (v1.4.5)

Un token **dans l'eau** qui **n'a pas pied** reçoit et conserve l'effet d'état natif PF1 **Nager** (`swim`), même s'il reste immobile ou que son action de déplacement n'est pas `swim` : marche, escalade, vol, fouissage ou mouvement non renseigné. Le déplacement et la nage sont deux informations distinctes :

- L'option `movementAction` détermine toujours le mouvement et les règles de placement automatique à mi-hauteur lors de l'entrée en marchant, inchangées.
- L'état **Nager** se base exclusivement sur l'immersion réelle (`getTokenWaterState(token).inWater`) et l'appui physique sur le fond (`hasFooting`).
- Le statut est retiré quand le token prend pied ou quitte l'eau ; un token volant *dans* le volume d'eau reste considéré en train de nager, mais n'est pas plaqué sur le fond.
- Au chargement d'une scène, à l'ajout d'une Region ou à ses modifications, tous les tokens concernés sont resynchronisés même sans mouvement. La suppression ou modification de l'effet natif Nager déclenche également une resynchronisation de l'acteur pour ses tokens présents sur la scène.
- Les effets Nager appliqués à des personnages qui n'ont **jamais** été dans l'eau ne sont pas supprimés automatiquement par PF1 Waters, afin de ne pas interférer avec d'autres sources.

Cela ne change pas les bonus d'abri de PF1AE, les flags `floating`, `hasFooting` et `waterwalk`, ni l'altitude réelle du token.

## Visibilité extérieure et états aquatiques (v1.4.0)

La visibilité des créatures près de la surface tient désormais compte **du sommet réel du token**, même si sa base est sous l'eau. L'évaluation graphique est individuelle pour chaque utilisateur, selon les sources de vision actives de son client.

- **Sommet strictement au-dessus de la surface** : le token est représenté entièrement devant la tuile/dessin d'eau, sans atténuation liée à l'immersion. Un observateur **à l'extérieur, avec un point de vue au niveau de la surface ou au-dessus**, peut le voir depuis un pont ou une berge si le moteur de visibilité de Foundry confirme une ligne de vue vers la surface. L'élévation réelle de la base du token n'est pas modifiée.
- **Sommet entièrement sous la surface** : si sa distance sous la surface est **inférieure** à la profondeur visible configurée dans la Region, le token peut rester visible **derrière** la texture PNG translucide de la tuile. Son opacité diminue progressivement dans les derniers 30 % de cette distance, jusqu'à zéro au seuil.
- **Sommet à une profondeur supérieure ou égale au seuil** : l'image du token disparaît pour cette représentation sous-marine. La vision normale, les autres capacités de détection et les droits de MJ restent gérés par Foundry ; cette fonction ne modifie pas les états mécaniques.
- **Protection de la visibilité** : l'affichage supplémentaire dépend du test officiel `canvas.visibility.testVisibility({x, y, elevation}, {object: token})` et de la présence d'une source de vision extérieure active. Si le mur, la portée ou les modes de détection empêchent l'observation de la surface, PF1 Waters ne force pas l'apparition du token. Les tokens cachés aux joueurs ne sont pas révélés.

**Configurer la profondeur visible :** couche **Regions** → sélectionner le corps d'eau → **PF1 Waters — Corps d'eau** → **Profondeur maximale de visibilité sous la surface**. La valeur est exprimée en unités de scène. **Par défaut, toute Region sans valeur explicitement définie utilise 36 m dans une scène métrique ou 120 pieds dans une scène en pieds.** Ces valeurs sont des arrondis de jeu, et non une conversion physique strictement exacte. Ce seuil s'applique aussi aux anciennes Regions non configurées : leurs anciens seuils de tuile/dessin ne le remplacent plus. Un seuil explicitement choisi par le MJ, y compris `0`, reste prioritaire. La valeur est stockée dans `flags.pf1-waters.waterRegion.visibilityDepth`.

**Nouveaux indicateurs booléens sur le TokenDocument :**

- `flags.pf1-waters.floating` : `true` quand le volume physique du token **traverse réellement la surface** (`base < surface < sommet`). Ce n'est pas une capacité de lévitation ou de vol.
- `flags.pf1-waters.hasFooting` : `true` quand le token immergé **prend appui sur le fond**. En eau peu profonde, `floating` et `hasFooting` peuvent tous deux être vrais.
- `flags.pf1-waters.waterMovement` stocke les mêmes informations dans `floating` et `hasFooting` ; l'ancien champ `standing` n'est plus émis après synchronisation. Les états calculés sont également disponibles via `api.getTokenWaterState(token)`.

Ces flags sont rafraîchis au déplacement, à la plongée et au chargement de scène. Les sorts peuvent continuer à employer `flags.world.waterwalk` ou `flags.pf1-waters.waterwalk`. Aucun bonus d'abri n'est appliqué ici : cela reste du ressort de **PF1AE**.

**Limite technique :** les scènes complexes utilisant Levels ou Better Roofs doivent être vérifiées en jeu. La surimpression reste une représentation graphique ; elle ne change pas la vision native des autres tokens ni les calculs de distance ou d'attaque. La ligne de vue est testée au niveau visible de l'eau pour éviter qu'une base sous-marine ne rende automatiquement invisible une créature émergée.

## Correction des tokens partiellement émergés (v1.4.3)

Les **tuiles transparentes** liées à une Region d'eau sont reconnues selon leur **rectangle géométrique**, et non selon l'opacité du pixel situé sous le centre du token. Dans Foundry v13, une texture presque transparente pouvait faire échouer le test de point de la tuile : le module croyait alors qu'aucune surface visuelle ne recouvrait le token et ne créait pas de copie devant l'eau.

La correction affiche désormais **le token normalement et entièrement devant la surface** lorsque son sommet dépasse réellement de la surface, même si sa base reste sous l'eau. Exemple : base à **−1,05 m**, hauteur physique **1,50 m**, surface **0 m** → sommet **+0,45 m** → **copie opaque devant la tuile**, image native cachée pour éviter un fantôme sous l'eau.

Les Drawings conservent leurs tests de forme pour respecter polygones, ellipses et contours libres. Les coordonnées de la copie graphique sont converties entre groupes Canvas via les transformations PIXI lorsqu'elles sont disponibles, afin d'éviter un décalage de sprite. La vision normale de Foundry, les tokens cachés, le champ `physicalHeight`, le seuil de visibilité sous-marine, les flags `floating` et `hasFooting` et les bonus d'abri de PF1AE ne changent pas.

## PNG de remous à ratio configurable (v1.4.7)

Le PNG de remous facultatif configuré sur la Region est dimensionné par le **ratio de taille des remous**, ajustable dans **Régions → PF1 Waters — Corps d'eau**. Sa valeur par défaut est **1,5**, et l'image garde toujours le centre du token pendant ses déplacements : 1×1 → 1,5×1,5 case ; 2×2 → 3×3 cases ; 2×1 → 3×1,5 case. La dimension de l'image est égale à la taille du token multipliée par le ratio.

Un masque PIXI protège le rectangle central du token : même si le PNG n'est pas transparent au centre, les remous ne recouvrent pas le portrait. Le ratio peut être modifié sans recharger la scène ; une valeur inférieure ou égale à 1 masque pratiquement tout l'effet sous le token. La couche des remous est placée sous les représentations des créatures émergées. Aucun anneau géométrique bleu n'est généré.

Ce rendu est purement visuel. Les flags de nage, les distances, les actions et les bonus d'abri de PF1AE restent inchangés.

## Affichage des tokens et transparence des surfaces (v1.3.0)

- **Token émergé :** lorsque la base du token est sous l'eau, mais que son sommet dépasse, PF1 Waters affiche **une copie graphique non interactive du token devant la surface**, même si Foundry ou un module de niveaux classe la tuile au premier plan. L'image native du token est temporairement masquée pour éviter un double rendu. Son altitude réelle, ses actions, ses collisions et son statut de nage ne changent pas.
- **Token entièrement immergé :** il demeure sous la texture de surface transparente. Son opacité reste normale près de la surface, puis diminue progressivement dans les derniers **30 %** de la distance de visibilité, jusqu'à disparaître lorsque son **sommet** atteint la limite configurée.
- **Distance de visibilité (Regions déjà configurées) :** choisir désormais **PF1 Waters — Corps d'eau** sur la Region. Les anciennes valeurs des tuiles ne remplacent plus le défaut de 36 mètres d'une Region non configurée. Valeur par défaut : **36 mètres** pour les scènes en mètres, ou **120 pieds** pour les scènes en pieds. La valeur `0` masque immédiatement les tokens entièrement immergés.
- **Retrait / déplacement :** la copie graphique disparaît dès qu'un token quitte l'eau, replonge complètement, devient invisible pour le client ou change de scène. L'opacité originale est restaurée.

**Aucun anneau bleu automatique n'est créé.** Les anneaux décoratifs sont désormais des PNG facultatifs, choisis par Region.

### PNG de remous facultatif par Region

1. Ouvrir la couche **Regions**, sélectionner la Region d'eau et cliquer sur **PF1 Waters — Corps d'eau**.
2. Dans **Image PNG des remous (facultatif)**, cliquer sur le sélecteur de fichier intégré à Foundry et choisir son PNG transparent dans les ressources du monde ou d'un module.
3. Enregistrer. Le PNG apparaît autour de tout token visible qui **traverse la surface** de cette Region, suit ses déplacements et disparaît dès qu'il sort de l'eau ou s'immerge complètement.
4. Laisser le champ vide pour ne jamais afficher cet effet. Il n'existe aucun anneau géométrique de secours.

Le chemin du PNG est sauvegardé sur la Region dans `flags.pf1-waters.waterRegion.ringPng`. L'image est une décoration purement graphique, sans effet sur les bonus d'abri gérés par PF1AE. Aucun fichier PNG n'est imposé ou généré par le module ; tu peux sélectionner ton propre visuel.

**Compatibilité :** l'affichage est conçu pour le Canvas Foundry v13. Certains effets de Levels, Better Roofs ou d'autres modules de rendu peuvent imposer un ordre d'affichage différent : vérifier en partie. Un PNG de remous n'affecte jamais la visibilité intrinsèque du token ni sa détection.

## Immersion, nage et mouvement

La hauteur physique vaut par défaut `max(token.width, token.height) × scene.grid.distance`. Il est possible de la personnaliser par `flags.pf1-waters.physicalHeight`, un nombre positif dans les unités de grille. Le module n'utilise pas obligatoirement Wall Height.

**La posture de nage à mi-hauteur est appliquée uniquement si le token est en mode de mouvement natif `walk` (Marche) et si la base du token se trouve exactement à l'élévation de surface de la Region aquatique** (`abs(token.elevation − surface) ≤ 0,000001` unité de scène). À cet instant, sa base est placée à `surface − hauteur/2`, sans dépasser le fond. Un token plus haut que la surface n'est jamais happé vers l'eau ; un token déjà immergé, en nage (`swim`) ou dans un autre mode de mouvement ne subit aucun rabattement vers la mi-hauteur. Une créature qui nage peut remonter ou descendre librement tant qu'elle ne traverse pas le fond physique. Le module ne modifie **jamais directement** `TokenDocument.movementAction` : il respecte le système PF1 et les automatismes tiers. Le statut PF1 natif **Nager** est activé tant que la créature nage sans avoir pied ; il est retiré à la sortie, sur le fond et en vol (si disponible). Le vol (`movementAction = "fly"`) ignore le repositionnement vertical automatique.

### Exception `waterwalk` (marche sur l'eau)

Un sort ou une capacité peut rendre un token insensible au placement automatique dans l'eau en posant **le booléen `true`** sur l'un des flags de **TokenDocument** suivants :

- `flags.world.waterwalk` — conseillé pour les scripts externes et les sorts.
- `flags.pf1-waters.waterwalk` — alias spécifique au module.

Si l'un des deux flags est exactement `true`, un token en mode **Marche** et à l'élévation de la surface **ne descend pas à mi-hauteur**. Il demeure à la surface et ne gagne pas le statut **Nager**. Un token déjà immergé n'est pas téléporté hors de l'eau : il garde sa profondeur et les règles normales de nage et de fond. Une mise à jour du flag est détectée automatiquement par le hook `updateToken`.

Pour activer la marche sur l'eau sur un token, un script externe peut utiliser :

```js
await token.document.setFlag("world", "waterwalk", true);
```

Pour la désactiver :

```js
await token.document.unsetFlag("world", "waterwalk");
```

Dans ces exemples, `token` désigne le Token placé sur le Canvas. Après désactivation, si le token est encore en **Marche**, exactement au niveau de la surface, il rejoint normalement sa posture à mi-hauteur. Les valeurs `false`, `"true"` (chaîne) et les autres valeurs ne confèrent pas l'exception.

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
| `hasWaterWalkFlag(token)` | Exception marche sur l’eau (flags du token) |
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
