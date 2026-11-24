> **v1.5.4 :** le bouton Corps d’eau ouvre une liste avec actions directes pour chaque corps d’eau et un bouton Nouveau corps d’eau en bas.

> **v1.5.3 :** sélectionnez un corps d’eau puis « Configurer profondeur de lumière » pour ajuster les quatre seuils, ou revenir au calcul automatique.

> **v1.5.2 :** les seuils d’obscurité sont alignés sur les cases de 1,50 m ou 5 ft ; la profondeur physique du fond reste inchangée.

> **v1.5.1 :** les régions natives d’éclairage sont rétablies, automatiquement limitées à quatre par région aquatique (25/50/75/100 %), selon la clarté et la profondeur. Les anciennes notes sont historiques. Les régions manuelles sont conservées. Validation graphique Foundry V13 à effectuer.

> **v1.5.0 :** les tranches d’éclairage décrites dans l’historique ci-dessous sont retirées. Le module nettoie les anciennes régions auxiliaires marquées par PF1 Waters ; aucune nouvelle tranche n’est créée. Le rendu dynamique reste à valider dans Foundry V13.

# PF1 Waters — v1.4.29

Module autonome de gestion des corps d'eau pour **Foundry VTT v13** et **Pathfinder 1 (PF1 v11.11)**. Interface française, sans dépendance obligatoire à Skull & Shackles, Levels, Wall Height ou Better Roofs.

## Installation

Dans Foundry, installer un module par URL de manifeste :
https://raw.githubusercontent.com/Caelvanost/pf1-waters/main/module.json

Activer **PF1 Waters** dans un monde utilisant le système **pf1**.

## Correction du rendu de l'obscurité selon l'élévation (v1.4.26)

L'obscurité sous-marine doit varier **visuellement** avec l'élévation des yeux du token, même lorsque Foundry V13 ne reconstruit pas son rendu de luminosité après la modification locale d'un comportement natif `Adjust Darkness Level`.

**Origine du problème en v1.4.25 :** PF1 Waters installait automatiquement un comportement natif « Obscurité selon profondeur », puis **désactivait son propre calque graphique** dès que ce comportement existait. La mise à jour locale avec `RegionBehavior.system.updateSource()` n'entraîne pas forcément de reconstruction visible de l'éclairage sous Foundry V13.

**Correction :** PF1 Waters applique désormais le **calque d'assombrissement client** suivant la courbe réelle de lumière naturelle, **même en présence** d'un comportement natif, y compris si le MJ a créé des tranches de profondeur. Le calque est défini par les triangles des Regions aquatiques ; il utilise le point de vue actif du joueur, suit les changements de sélection et d'élévation, et disparaît dès que les yeux ressortent de l'eau. Les joueurs possédant la vision dans le noir ne reçoivent pas cet assombrissement graphique. La **distance maximale de vision reste constante** : elle dépend de la transparence du corps d'eau et des capacités PF1, et non du manque de lumière solaire.

**Important :** ce rendu client est une **simulation graphique**, pas une véritable lumière volumétrique. Les torches et les sources lumineuses locales ne sont pas modifiées dans leurs Documents Foundry, mais un voile noir dessiné après le rendu de la scène peut **assombrir aussi leur apparence**. Si des bandes natives fonctionnent effectivement dans votre installation, le voile peut en accentuer l'assombrissement. Une intégration propre au moteur d'illumination de V13 nécessitera une vérification directe des passes graphiques en jeu. Ne pas confondre l'obscurité affichée avec la condition mécanique d'éclairage d'un token.

Pour diagnostiquer en console Foundry (avec un token immergé sélectionné) :

```js
game.modules.get("pf1-waters").api.waterLightingDiagnostics()
```

Vérifier en particulier `regions[].depth`, `regions[].physicalLightPercent`, `regions[].darknessAlpha`, `overlayAttached` et `overlayCount`. Si `overlayCount=0` malgré une obscurité attendue, vérifier **l'éclairage global de la scène**, que la Region appartienne bien à un corps d'eau, et que les yeux du token soient sous la surface.

## Luminosité du champ de vision selon la profondeur (v1.4.29)

**Correctif :** les versions antérieures calculaient correctement la lumière solaire restante mais ne transmettaient pas cette atténuation à la **luminosité native de la vision du token**. Le voile de secours était en outre limité aux scènes avec éclairage global, ce qui pouvait donner l'impression que l'élévation ne changeait rien.

PF1 Waters modifie désormais **`VisionSourceData.brightness`** au moment de construire la source de vision du token avec `Token._getVisionSourceData()`, sans modifier ni enregistrer `TokenDocument.sight`. La correction est recalculée quand le token change de position ou d'élévation, lors de la sélection, des modifications de corps d'eau et lors de l'ouverture du canvas. La source de vision est réinitialisée et le moteur de perception V13 est rafraîchi.

- Le **rayon de vision** reste plafonné par le profil de clarté du corps d'eau et les capacités natives PF1 ; **il ne diminue pas** quand le plongeur descend.
- Un token **sans vision dans le noir** reçoit une correction de luminosité de plus en plus négative en profondeur. Le facteur physique suit Beer-Lambert, avec une correction graphique de perception `lumière^(1/2,2)`.
- Un token avec **vision dans le noir** garde la luminosité de son mode natif et sa portée propre, plafonnée par la transparence de l'eau.
- Si la nouvelle luminosité est effectivement active dans la source de vision, le vieux **voile PIXI** est désactivé pour cette vue, afin d'éviter de cumuler deux assombrissements. Le voile reste disponible en secours lorsque la source native n'a pas été mise à jour.
- Cette correction agit aussi lorsque **l'éclairage global de la scène est désactivé**, car elle s'applique au token et non à la lumière globale.

**Limite technique :** le paramètre `VisionSourceData.brightness` assombrit le champ de vision du token et n'est pas une simulation volumétrique différenciant parfaitement lumière naturelle et lumière artificielle. Les torches, lumières et modes de vision spéciaux doivent être vérifiés en conditions réelles sur Foundry V13 avec PF1 v11.11.

Pour diagnostiquer, sélectionner le token puis lancer dans la console :

```js
game.modules.get("pf1-waters").api.waterVisionDiagnostics()
```

Comparer `limit.depth`, `limit.lightFraction`, `expectedBrightness`, `visionSourceBrightness` et `visionSourceUpdated`. Ce dernier indicateur confirme que la valeur a effectivement atteint la source de vision.

## Visibilité alignée sur les cases de 1,5 m (v1.4.28)

Les **cinq niveaux de clarté** utilisent désormais des portées maximales de visibilité qui sont **toutes des multiples exacts de 1,5 m** (une case de grille métrique PF1) :

| Niveau | Portée maximale | Cases de 1,5 m |
|---|---:|---:|
| Très claire | 40,5 m | 27 |
| Claire | 25,5 m | 17 |
| Légèrement trouble | 12 m | 8 |
| Trouble | 6 m | 4 |
| Vaseuse | 1,5 m | 1 |

Les portées antérieures (40 m, 25 m, 12 m, 6 m et 2 m) ont été **arrondies au multiple de 1,5 m le plus proche**, sans modifier l'ordre des niveaux. Le changement s'applique aussi aux corps d'eau existants qui ont déjà un profil `waterClarity` ; leurs portées sont dérivées de ce profil. Les corps d'eau hérités qui n'ont pas encore de profil continuent de conserver leurs valeurs numériques historiques jusqu'à l'enregistrement d'un niveau de clarté. Les scènes exprimées en pieds conservent leur conversion en unités natives.

La courbe de lumière naturelle de Beer-Lambert (`Kd`) et les règles de vision dans le noir, distance 3D entre tokens et brouillard de guerre restent **inchangées**.

## Nouveau réglage de clarté de l'eau (v1.4.27)

Dans la barre d'outils Foundry, ouvrir **PF1 Waters → Corps d'eau → Créer/Modifier**. L'interface ne demande **plus de valeurs numériques de portée, de profondeur lumineuse ou de coefficient** : elle demande une unique caractéristique de l'eau, sélectionnée dans une liste.

| Clarté sélectionnée | Visibilité indicative | Coefficient solaire Kd (m⁻¹) |
|---|---:|---:|
| Très claire — océan limpide | 40,5 m | 0,035 |
| Claire — mer claire | 25,5 m | 0,070 |
| Légèrement trouble — eau côtière | 12 m | 0,150 |
| Trouble — baie ou estuaire | 6 m | 0,300 |
| Vaseuse — port vaseux | 1,5 m | 0,700 |

Les valeurs ci-dessus sont des **valeurs indicatives de jeu** : la transparence horizontale dépend des particules, de l'éclairage et du contraste, et ne se déduit pas directement d'un coefficient solaire universel. La liste conserve un ordre réaliste : plus l'eau est trouble, moins le plongeur voit loin et moins la lumière pénètre.

Le réglage détermine automatiquement **deux valeurs internes** :

1. **La distance physique maximale** au sein du corps d'eau, indépendante de la profondeur, valable pour la vision normale et la vision dans le noir (sous réserve de la portée native du token et du calcul de visibilité 3D).
2. **La courbe de lumière naturelle selon la profondeur** calculée avec la loi exponentielle de Beer-Lambert : `lumière restante = exp(-Kd × profondeur en mètres)`. Le rendu du ciel sous l'eau s'assombrit progressivement sans ancien seuil de 12 % ni extinction brusque au palier de 20 demi-profondeurs. La vision dans le noir reste exemptée du voile de secours.

**Compatibilité :** les anciens corps d'eau sans `waterClarity` conservent exactement leurs anciennes valeurs `visionRange` et `visionHalfDepth` jusqu'à leur modification par le MJ. Lorsqu'un ancien corps d'eau est ouvert en modification, la liste suggère le profil le plus proche ; **l'enregistrement** applique le profil choisi. Le registre enregistre à la fois le nom du profil `waterClarity` et ses valeurs internes dérivées, afin de rester compatible avec les autres composants. Les unités des scènes en pieds ou mètres sont converties automatiquement.

**Limite graphique connue :** le voile client peut encore assombrir artificiellement des torches et lumières locales puisqu'il s'applique après le rendu de Foundry V13. L'atténuation exponentielle représente la lumière du soleil, pas la pénétration horizontale exacte d'un faisceau lumineux.

## Historique de la portée fixe avant les profils de clarté (v1.4.25)

**La profondeur n'affecte plus le rayon maximal de vision sous l'eau.** Le corps d'eau possède deux réglages complémentaires :

- **Distance maximale de visibilité de l'eau** (`visionRange`) : transparence physique du milieu, indépendante de la profondeur. Elle s'applique à tous les tokens, avec ou sans vision dans le noir, et reste plafonnée par leurs capacités natives PF1. Elle sert également à limiter la visibilité des autres tokens en **3D** (distance horizontale et différence d'élévation).
- **Demi-profondeur d'atténuation lumineuse** (`visionHalfDepth`) : profondeur où la lumière naturelle est réduite de 50 %. L'éclairage naturel passe à 25 % au double, à 5 % à cinq fois cette profondeur, puis s'éteint à vingt fois. **Ce facteur ne raccourcit jamais le rayon de vision** ; il pilote l'obscurité visuelle et les comportements natifs d'éclairage des Regions associées.

La profondeur de l'observateur est calculée à partir de l'élévation de ses yeux sous la surface commune du corps d'eau. Le système utilise les comportements `Adjust Darkness Level` (et les tranches verticales, si le MJ les a activées) pour intégrer l'obscurité à Foundry. Un effet de secours visuel local peut être utilisé quand aucun comportement natif n'est applicable.

**Personnages et sources lumineuses :** la vision dans le noir fonctionne selon PF1 et n'est pas assombrie par l'effet visuel de secours ; la vision ordinaire dépend de la lumière naturelle restante et des lumières locales. La vision nocturne/faible luminosité reste distincte de la vision dans le noir. Les torches et les sorts lumineux ne sont pas désactivés. **Limite connue :** si le rendu de secours par filtre graphique est actif plutôt que l'obscurité native, il peut également assombrir visuellement les lumières locales ; le test en situation réelle sous Foundry V13 reste nécessaire.

**Exemple :** pour une eau avec une portée maximale de **36 m** et une demi-profondeur de **9 m**, un plongeur à **18 m** conserve un rayon géométrique de **36 m**, mais ne reçoit que **25 % de lumière naturelle**. Une vision dans le noir capable de porter à 18 m continue de voir jusqu'à 18 m (sa portée native) ; une capacité de 60 m reste plafonnée à 36 m par la transparence du corps d'eau.

Le réglage se fait exclusivement dans **PF1 Waters → Corps d'eau → Modifier**. La profondeur d'atténuation solaire apparaît en lecture seule dans les paramètres de chaque Region membre, pour garantir une seule courbe lumineuse par corps d'eau.

## Gestion des corps d'eau — bouton principal de la barre d'outils (v1.4.22)

PF1 Waters possède désormais une **entrée principale « PF1 Waters — Corps d'eau »** dans la barre de contrôles de scène, **au même niveau que Tokens, Regions, Tuiles et Levels**. L'icône de vague apparaît pour le **MJ** dès qu'une scène est ouverte.

- **Cliquer sur l'icône principale** ouvre le menu de gestion des corps d'eau de la scène (créer, modifier ou supprimer).
- Lorsque la palette « PF1 Waters » est déjà sélectionnée, cliquer sur **« Ouvrir la gestion des corps d'eau »** (icône de liste) dans ses outils pour ouvrir à nouveau le menu.
- Cette interface fonctionne indépendamment de la couche Regions. Elle n'impose pas de changer de couche pour modifier un corps d'eau existant.
- Les actions qui nécessitent une sélection de formes restent dans les outils natifs **Regions** ; celles qui nécessitent des Tuiles ou Dessins restent dans leurs propres couches.
- Le bouton de gestion redondant dans Regions a été supprimé depuis la v1.4.24.

### Créer et configurer l'eau

1. Cliquer sur l'icône **PF1 Waters** à la racine de la barre d'outils.
2. Créer un corps d'eau de scène avec un **nom**, l'**élévation commune de surface** et les paramètres de **portée de vision sous-marine** (activée, distance maximale, profondeur de demi-visibilité).
3. Sur la couche **Regions**, dessiner une ou plusieurs Regions physiques et les sélectionner.
4. Choisir **« PF1 Waters — Ajouter des Regions à un corps d'eau »**, sélectionner le corps d'eau et renseigner la profondeur locale ou utiliser la limite d'élévation inférieure de chaque Region.
5. Pour régler les autres propriétés d'une Region (visibilité, remous, atténuation solaire, tranches d'obscurité), utiliser l'outil de configuration de Regions. Son altitude de surface commune est **en lecture seule** et provient du corps d'eau.
6. Pour retirer une Region aquatique, utiliser **« Dissocier les Regions »**.

Les corps d'eau sont enregistrés dans `Scene.flags.pf1-waters.waterBodies`, les volumes dans `Region.flags.pf1-waters.waterRegion` (avec `bodyId` et profondeur locale). Une Region non associée à un corps d'eau existant n'est pas aquatique.

### Associer une tuile ou un dessin de surface

1. Sur la couche **Tuiles** ou **Dessins**, sélectionner les visuels devant représenter l'eau.
2. Cliquer **« Définir comme surface d'un corps d'eau »** et choisir le corps d'eau partagé.
3. Conserver **« Aligner sur la surface commune »** pour synchroniser leur élévation et, sur une tuile, **« Ne pas masquer la surface comme une toiture »** pour éviter l'occlusion native de type toiture.
4. Utiliser **« Dissocier la surface d'eau »** pour supprimer le lien visuel sans modifier les Regions.

Chaque tuile/dessin peut couvrir plusieurs Regions associées au **même corps d'eau**. Les liens sont enregistrés dans `TileDocument/ DrawingDocument.flags.pf1-waters.waterSurface.bodyId`. Il n'existe plus de liaison directe par `regionId`.

**Note :** PF1 Waters utilise le mode d'occlusion natif `CONST.OCCLUSION_MODES.NONE` pour les Tuiles configurées afin de ne pas les faire disparaître comme des toits. Les règles de visibilité d'autres modules comme Levels ou Better Roofs peuvent continuer à limiter l'affichage ; leurs paramètres restent indépendants.

## État Nager permanent en immersion (v1.4.5)

Un token **dans l'eau** qui **n'a pas pied** reçoit et conserve l'effet d'état natif PF1 **Nager** (`swim`), même s'il reste immobile ou que son action de déplacement n'est pas `swim` : marche, escalade, vol, fouissage ou mouvement non renseigné. Le déplacement et la nage sont deux informations distinctes :

- L'option `movementAction` détermine toujours le mouvement et les règles de placement automatique à mi-hauteur lors de l'entrée en marchant, inchangées.
- L'état **Nager** se base exclusivement sur l'immersion réelle (`getTokenWaterState(token).inWater`) et l'appui physique sur le fond (`hasFooting`).
- Le statut est retiré quand le token prend pied ou quitte l'eau ; un token volant *dans* le volume d'eau reste considéré en train de nager, mais n'est pas plaqué sur le fond.
- Au chargement d'une scène, à l'ajout d'une Region ou à ses modifications, tous les tokens concernés sont resynchronisés même sans mouvement. La suppression ou modification de l'effet natif Nager déclenche également une resynchronisation de l'acteur pour ses tokens présents sur la scène.
- Les effets Nager appliqués à des personnages qui n'ont **jamais** été dans l'eau ne sont pas supprimés automatiquement par PF1 Waters, afin de ne pas interférer avec d'autres sources.

Cela ne change pas les bonus d'abri de PF1AE, les flags `floating`, `hasFooting` et `waterwalk`, ni l'altitude réelle du token.

## Atténuation de la lumière globale sous l'eau (v1.4.10)

Lorsque l'**éclairage global de la scène** est activé dans Foundry v13, la luminosité ambiante à l'intérieur de la Region d'eau diminue **progressivement avec la profondeur du point de vue immergé**.

La courbe utilise la **demi-profondeur d'atténuation lumineuse du corps d'eau** (9 mètres ou 30 pieds par défaut). Elle est indépendante de la distance maximale de visibilité, qui reste constante avec la profondeur.

| Profondeur sous la surface | Lumière globale visible |
|---|---|
| Surface | 100 % |
| Demi-profondeur de visibilité | 75 % |
| Une profondeur de visibilité | 50 % |
| Une profondeur et demie de visibilité | 37,5 % |
| Deux profondeurs de visibilité | **25 %** |
| Cinq profondeurs de visibilité | **5 %** |
| Vingt profondeurs de visibilité et au-delà | **0 %** |

**Exemple :** pour un corps d'eau dont la demi-profondeur lumineuse vaut 9 m, la lumière naturelle passe à **50 % à 9 m**, **25 % à 18 m**, **5 % à 45 m**, puis **0 % à 180 m et au-delà**. La portée maximale de visibilité de l'eau reste indépendante de ces niveaux lumineux.

**Implémentation :** un assombrissement visuel est appliqué uniquement à la géométrie triangulée de la Region, pour l'observateur dont la ligne de vue se trouve sous la surface. La profondeur de référence est la hauteur de vision du token, ou son sommet physique si nécessaire. Lorsque plusieurs sources immergées partagent la même Region, le point de vue le moins profond prévaut. L'effet est local à l'utilisateur et ne modifie **ni les sources lumineuses locales, ni l'éclairage global enregistré sur la scène**, ni les règles de vision de PF1.

**Limite Foundry v13 :** le Canvas de scène est bidimensionnel. Ce comportement simule la diminution de luminosité à la profondeur de l'observateur : il ne calcule pas une extinction volumétrique différente pour chaque objet à une élévation différente dans la même vue. Le calque graphique est affiché dans la passe d'interface au-dessus de la scène afin de rester visible après les mouvements d'élévation. Il faut vérifier son rendu en jeu, en particulier les autres modules d'éclairage et les lumières locales.

## Vision 3D et brouillard noir pendant l'immersion (v1.4.24)

**Distance de vision entre deux tokens immergés :** le module vérifie maintenant la **distance tridimensionnelle** entre l'observateur et la créature. La distance horizontale est convertie dans les unités de la scène, puis combinée avec l'écart d'élévation vertical entre les yeux de l'observateur et le point le plus proche du corps de la cible. Une cible au même emplacement 2D mais beaucoup plus haut ou plus bas peut donc être **invisible**, même si Foundry retourne `testVisibility=true`. Ce contrôle fonctionne pour plusieurs observateurs actifs : une cible n'est masquée que si elle est hors de portée de **toutes** leurs visions sous-marines.

**Brouillard noir et non persistant :** empêcher `FogManager.commit()` et `save()` ne suffisait pas, car Foundry V13 continue d'afficher la **texture des secteurs déjà explorés**. Tant qu'un observateur actif est immergé, PF1 Waters masque **localement et temporairement** le conteneur `canvas.visibility.explored` et le sprite `canvas.fog.sprite`. La couche `canvas.visibility.vision`, qui représente la vision **actuelle**, reste active : l'utilisateur voit l'intérieur de sa portée de vision actuelle mais le reste de la carte est censé rester **noir**, même s'il avait exploré la zone auparavant. La visibilité de la texture mémorisée est restaurée à la remontée ou au démontage de la scène. Aucune exploration mémorisée n'est supprimée.

Le blocage de l'enregistrement de nouvelles découvertes sous-marines reste actif. En cas de vision combinée surface + immersion dans une même vue Foundry V13, la mémoire de brouillard est temporairement cachée pour cette vue entière, afin de ne pas révéler des données de plongée ; les sources de vision actuelles restent accessibles.

**Commandes simplifiées :** le registre des corps d'eau s'ouvre exclusivement via le **bouton principal PF1 Waters**. Les anciens boutons du sous-menu Regions « Corps d'eau de la scène » et « Retirer la propriété eau » sont supprimés car redondants. Les commandes utiles **Associer des Regions**, **Dissocier des Regions**, **Configurer des Regions** restent présentes, ainsi que les commandes d'association/dissociation des Tuiles et Dessins.

Test de recette conseillé : sélectionner un plongeur, placer une cible directement au-dessus mais au-delà de sa portée **verticale**, vérifier sa disparition ; faire réapparaître la cible en réduisant l'écart d'élévation ; déplacer le plongeur en ayant activé l'exploration du brouillard et vérifier que le fond déjà exploré est toujours noir **hors du champ de vision**.

## Correction des limites de vision et exploration temporaire (v1.4.23)

**Foundry V13 :** une vision limitée sous l'eau doit limiter les distances de *sight* et de *light perception* du Token. Les paramètres de `VisionSourceData` ne comportent pas de champ standard `radius` : la version 1.4.23 plafonne donc les getters natifs `Token.sightRange`, `Token.lightPerceptionRange` et `Token.optimalSightRange`, en complément de `VisionSourceData.lightRadius`. La portée continue à diminuer quelle que soit la profondeur ; aux profondeurs extrêmes, la source reçoit un rayon minimum d'un pixel, et non zéro (qui peut être interprété comme non borné). Le TokenDocument n'est pas modifié.

**Visibilité des créatures :** les tokens immergés ne doivent pas apparaître à travers la visibilité native à une distance supérieure à celle de l'observateur. Lorsqu'un observateur sous l'eau se trouve dans le même corps d'eau, PF1 Waters vérifie maintenant **explicitement la distance en pixels entre les centres** avant d'utiliser le test LOS natif. Si toutes les sources de vision actives sont sous l'eau et que le token cible est au-delà de toutes leurs portées, le module masque localement le token **et ses étiquettes / effets / HUD**, puis restaure leur visibilité quand il revient à portée. Si un second observateur peut réellement le voir, celui-ci reste visible. Les murs, l'éclairage, l'élévation et les règles natives restent nécessaires pour autoriser une visibilité en portée.

**Brouillard de guerre :** les zones vues **pendant une plongée** sont temporaires. PF1 Waters empêche `FogManager.commit()` et `FogManager.save()` d'inscrire ces découvertes dans l'exploration persistante du joueur et utilise `CanvasVisibility.resetExploration()` pour écarter l'exploration temporaire avant de reprendre les commits normaux. Les zones découvertes **avant la plongée** ne sont pas effacées. Si des observateurs de surface et sous-marins sont actifs simultanément, les commits de brouillard sont conservativement suspendus **pour tous** jusqu'à ce qu'il ne reste plus d'observateur immergé (Foundry V13 utilise une texture de brouillard 2D partagée par client). Les zones déjà enregistrées sous l'eau par une version antérieure ne sont pas supprimées rétroactivement.

**Tests recommandés dans Foundry :** descendre à plus de vingt fois la demi-profondeur, vérifier que la vision ne devient pas illimitée ; contrôler un plongeur éloigné d'un autre token immergé, puis rapprocher ce token ; explorer un lieu sous l'eau, le quitter, remonter et revenir observer le brouillard. Les validations automatisées ne remplacent pas ce test graphique sur le moteur V13 réel.

Pour diagnostiquer en console :
```js
game.modules.get("pf1-waters").api.waterVisionDiagnostics()
game.modules.get("pf1-waters").api.waterFogDiagnostics()
```

## Vision sous-marine propre à chaque token (v1.4.21)

Chaque **corps d'eau enregistré dans une scène** possède désormais une configuration de portée de vision **indépendante des autres corps d'eau**. Dans **barre d'outils → PF1 Waters → Modifier un corps d'eau**, régler :

- **Limiter la vision sous-marine :** activation ou désactivation de la limitation pour ce corps d'eau.
- **Distance maximale de visibilité de l'eau :** plafond physique constant, dans les unités de distance de la scène (36 m ou 120 pieds par défaut).
- **Demi-profondeur d'atténuation lumineuse :** profondeur à laquelle la lumière naturelle restante atteint 50 % (9 m ou 30 pieds par défaut), sans diminution du rayon de vision.

**Depuis v1.4.25 :** la portée est désormais **fixe** et vaut le minimum entre la visibilité maximale du corps d'eau et la portée native du token. La courbe 100 / 50 / 25 / 5 / 0 % représente **la lumière naturelle restante**, et non une réduction du rayon.

**Technique :** PF1 Waters enveloppe `Token._getVisionSourceData()` (Foundry V13) sur la classe de Token active et contraint **les rayons de vision et de perception des zones éclairées**, séparément pour chaque source. Le changement intervient côté client, avec réinitialisation de vision sur mouvement horizontal, changement d'élévation, changement de sélection, modification de Region ou du corps d'eau. La visibilité normale, les murs, la lumière et les modes de détection existants continuent de s'appliquer à l'intérieur du rayon permis. Un nageur qui a les yeux hors de l'eau conserve sa vision normale.

**Aucune écriture dans les fiches de tokens :** ni `TokenDocument.sight`, ni les sources de lumière des tokens, ni les lumières ambiantes de la scène ne sont modifiées. Plusieurs tokens contrôlés utilisent leurs propres plafonds de perception. Les modes de détection spéciaux indépendants de la vision normale peuvent conserver leur portée native ; cette version ne modifie pas la luminosité du rendu ni ne crée d'obscurité réelle.

Pour diagnostiquer en console Foundry :
```js
game.modules.get("pf1-waters").api.waterVisionDiagnostics()
```
L'API expose aussi `getTokenUnderwaterVisionLimit(token)`, `waterVisionFraction(depth, halfDepth)` et `refreshWaterVisionSources()`.

## Corps d'eau de la scène — format unique (v1.4.20)

**À partir de la v1.4.20, PF1 Waters ne prend plus en charge les configurations des anciennes versions.** Le système est fondé exclusivement sur les corps d'eau enregistrés dans la scène ; il n'y a ni import des anciens flags `pf1-skull-and-shackles.waterRegion`, ni liaison de tuile/dessin vers une Region isolée.

- **Barre d'outils principale — « PF1 Waters » :** créez, modifiez ou supprimez les corps d'eau, avec leur altitude commune de surface et leurs paramètres de vision. Aucun doublon dans les outils Regions.
- **Regions — « Ajouter des Regions à un corps d'eau » :** sélectionnez les contours aquatiques, puis choisissez leur corps d'eau et leur profondeur locale, éventuellement déduite de la limite native d'élévation inférieure. Une Region non associée n'est plus interprétée comme un volume d'eau, même si elle conserve d'anciens paramètres locaux.
- **Regions — « Paramètres d'eau » :** configurez la profondeur, la visibilité, l'atténuation solaire, les tranches d'obscurité et les remous. La surface de la Region est affichée **en lecture seule**, car elle appartient au corps d'eau enregistré.
- **Regions — « Dissocier » ou « Retirer la propriété eau » :** les Regions cessent de représenter de l'eau, sans suppression de leurs formes 2D.
- **Tuiles / Dessins — « Définir comme surface d'un corps d'eau » :** associez une ou plusieurs surfaces graphiques au corps d'eau entier. Une même image de surface peut recouvrir plusieurs Regions avec des fonds et des coordonnées différents.
- **Tuiles / Dessins — « Dissocier la surface d'eau » :** retirez le lien et restaurez l'ancien réglage d'occlusion de la tuile lorsque PF1 Waters l'avait changé.

**Exemple de plage :** corps d'eau « Baie des Épaves », surface à 0 ; Regions « Plage » (fond −1), « Haut-fond » (fond −3) et « Large » (fond −20). Les mouvements, les conditions « Nager », les attaques traversant l'eau et la visibilité utilisent la profondeur propre à chaque portion. Un plongeur reste dans le même corps d'eau lorsqu'il passe d'une Region à l'autre.

**Format enregistré :** `Scene.flags.pf1-waters.waterBodies` pour les identifiants, noms et surfaces ; `Region.flags.pf1-waters.waterRegion.bodyId` pour l'appartenance et la profondeur ; `Tile/ Drawing.flags.pf1-waters.waterSurface.bodyId` pour les surfaces visuelles. Les anciennes associations `regionId` sur les Tuiles/Dessins et les flags de l'ancien module ne sont plus lus.

Les Regions de lumière auxiliaires (mode « tranches ») sont toujours gérées automatiquement et ne doivent pas être associées à un corps d'eau.

## Obscurité sous-marine par tranches d'élévation (v1.4.17)

**Mode natif alternatif, sans module tiers.** Si « Remplacer l'obscurité » fonctionne lorsqu'il est configuré manuellement dans Foundry mais que l'obscurité dynamique de PF1 Waters ne se met pas à jour, activer **« Obscurité native par tranches d'élévation »** dans la configuration de la Region d'eau.

- Le MJ choisit **4 à 40 tranches** (24 par défaut). Leur répartition suit la variation de luminosité, avec des bandes plus fines lorsque l'atténuation est rapide.
- PF1 Waters crée des **Regions auxiliaires verrouillées** ayant les mêmes formes 2D et trous que la Region d'eau, mais avec des intervalles d'élévation distincts. Chacune possède un comportement Foundry natif **Adjust Darkness Level**, mode **OVERRIDE** (« Remplacer l'obscurité »), et une valeur fixe calculée à partir de la profondeur de son intervalle.
- Les Regions auxiliaires portent exclusivement le flag `flags.pf1-waters.waterDepthLightBand` et **ne sont pas des Regions d'eau**. La nage, le fond, les projectiles, les surfaces visuelles et les limites de visibilité conservent leur Region source.
- **Depuis la v1.4.18, les deux systèmes d'obscurité sont mutuellement exclusifs.** Quand les tranches sont activées, PF1 Waters désactive et enregistre l'état désactivé de son comportement « Obscurité selon profondeur » sur la Region d'eau parente, sans toucher aux comportements créés manuellement par le MJ. Si le comportement est réactivé pendant que les tranches fonctionnent, il est de nouveau désactivé automatiquement lors de la synchronisation. En désactivant les tranches, l'état précédent du comportement parent est restauré, y compris s'il était déjà désactivé avant l'activation. Aucun calque de noirceur graphique secondaire ne se superpose aux tranches.
- La lumière restante suit toujours la courbe solaire existante : 50 % à `sunlightHalfDepth`, 25 % à 2×, 5 % à 5×, extinction à 20×. Les obscurités de tranches tiennent compte de l'obscurité initiale de la scène.
- Toutes les données d'obscurité de ces tranches sont **persistantes**, identiques pour les joueurs, et Foundry utilise leurs limites d'élévation. Ce système ne dépend pas de `RegionBehavior.system.updateSource()`. PF1 Waters désactive l'assombrissement dynamique sur la Region d'eau source lorsque ce mode est activé.
- Le calcul est refait par le MJ après un changement des paramètres de la Region ou de la luminosité de la scène ; la désactivation de l'option et la suppression d'une Region d'eau suppriment les tranches auxiliaires associées. Les Regions existantes ne sont pas modifiées tant que cette option n'est pas activée.
- Une Region peut avoir un fond limité ou illimité. En profondeur illimitée, la dernière bande s'étend vers le bas après extinction complète de la lumière naturelle. Avec une profondeur solaire nulle, une unique tranche obscurcit toute la colonne d'eau.
- **Limite :** l'atténuation devient une succession de paliers, pas une interpolation temporelle parfaitement continue. Les Regions restent des volumes 3D projetés sur un Canvas 2D ; leur rendu réel selon l'élévation du token doit être vérifié dans Foundry V13. La compatibilité avec des modules modifiant l'éclairage, et le comportement de plusieurs observateurs à différentes profondeurs, doivent aussi être testés.

**Diagnostic :** `game.modules.get("pf1-waters").api.waterDepthBandDiagnostics()` retourne les tranches créées, leurs élévations et valeurs d'obscurité. `game.modules.get("pf1-waters").api.syncSceneWaterDepthBands()` force leur resynchronisation depuis la console du MJ.

## Obscurité native de Foundry dans les Regions aquatiques (v1.4.13)

**PF1 Waters utilise maintenant le comportement natif Foundry v13 « Ajuster le niveau d'obscurité » (`adjustDarknessLevel`)** pour que la profondeur du regard ait un véritable impact sur l'éclairage et la perception des tokens, plutôt que de masquer la scène avec un rectangle noir.

- Lorsqu'un MJ configure une Region d'eau, le module lui ajoute automatiquement un comportement natif **neutre** (`mode: DARKEN`, `modifier: 0`). Les Regions existantes sont équipées automatiquement lorsque le MJ ouvre la scène. Les comportements d'obscurité créés manuellement par le MJ ne sont pas modifiés.
- Lorsqu'un joueur observe depuis **l'intérieur de l'eau avec ses yeux sous la surface**, le module utilise les valeurs **Obscurité** et **Illumination globale** de la scène. Il calcule localement l'obscurité de la Region à partir de la profondeur de la ligne de vue. Les changements de profondeur passent uniquement par `RegionBehavior.system.updateSource` **sur ce client** : l'obscurité sauvegardée de la scène n'est **jamais écrasée**, et plusieurs joueurs peuvent observer des profondeurs différentes.
- La courbe solaire existante reste **100 % à la surface**, **50 % à 1×** la visibilité, **25 % à 2×**, **5 % à 5×**, puis **0 % à 20×**. Le niveau d'obscurité appliqué est `obscuritéScène + (1 − obscuritéScène) × (1 − lumièreRestante)`, plafonné entre 0 et 1.
- **Le seuil d'illumination globale de la scène doit être configuré** : lorsque l'obscurité effective de la Region le franchit, Foundry considère cette zone comme mécaniquement non éclairée. Sans ce seuil, une obscurité régionale peut rester essentiellement esthétique. Les torches, murs, vision dans le noir et autres détections sont alors gérés par le moteur de Foundry, sans masque qui couvrirait toutes les sources lumineuses.
- Quand le token quitte l'eau, que sa ligne de vue repasse au-dessus de la surface, que l'éclairage global est coupé, ou que le MJ reprend sa caméra libre, le comportement revient localement à son état neutre. Les autres Regions ne sont pas modifiées.
- Le rendu noir supplémentaire des versions précédentes n'est plus superposé aux Regions disposant du comportement natif actif. Pour les Regions non encore équipées, l'ancien filtre graphique reste un mécanisme de secours.

**Exemple :** obscurité de scène 0,20 et visibilité aquatique 36 m. À 36 m de profondeur, la Region prend une obscurité locale de 0,60 ; à 72 m, 0,80 ; à 180 m, 0,96. Avec un seuil d'illumination globale fixé à 0,80, Foundry désactive l'illumination globale de cette Region à partir de ce seuil, tout en conservant les effets des sources de lumière et modes de vision qu'il autorise.

**Transition progressive (v1.4.15) :** à chaque changement d'élévation de l'observateur, l'obscurité native rejoint sa nouvelle valeur en 450 ms avec une interpolation douce. La perception Foundry est actualisée au plus toutes les 75 ms. L'animation fonctionne si le ticker de scène est disponible, sinon la valeur cible est appliquée immédiatement. La sortie de l'eau restaure immédiatement le comportement neutre. Le champ « Profondeur pour 50 % de lumière naturelle » est indépendant de « Profondeur de visibilité ». Attention au **seuil d'illumination globale** : s'il est inférieur à 1, le basculement mécanique de la lumière globale peut paraître brusque. Un seuil à 1 repousse l'extinction mécanique au noir complet.

**Diagnostic :** `game.modules.get("pf1-waters").api.nativeWaterDarknessDiagnostics()` inclut la valeur de scène, la profondeur du regard, la profondeur de demi-atténuation, la valeur cible et appliquée, et l'état de la transition.

**Compatibilité :** l'actualisation instantanée d'un comportement de Region par `updateSource()` est un ajustement local dont l'effet réel sur les passes de rendu et les seuils de Foundry v13 doit encore être validé dans une scène de jeu. Aucun niveau d'obscurité calculé ne se propage aux autres clients, mais une mise à jour ou un autre module peut réinitialiser le modèle local, auquel cas PF1 Waters le resynchronise.

## Visibilité réelle dans l'obscurité sous-marine (v1.4.12)

La lumière globale conserve la courbe physique demandée : **50 %** à 1× la profondeur de visibilité, **25 %** à 2×, **5 %** à 5× et **0 %** à 20×. La v1.4.12 distingue maintenant la quantité de lumière encore présente et ce qu'un personnage peut **effectivement percevoir** avec ses yeux.

- **Token sans vision dans le noir :** quand la lumière globale restante passe sous **12 %**, l'environnement de la Region devient **visuellement noir** pour ce point de vue. Entre 12 et 20 %, l'image s'assombrit progressivement davantage. Exemple : à −150 m avec une visibilité de 36 m, la courbe physique indique environ **10,6 %** de lumière résiduelle, mais cette quantité est traitée comme insuffisante pour une vision ordinaire.
- **Token ayant une vision dans le noir :** les modes `sight.visionMode` contenant `darkvision` (ou les modes de détection équivalents activés) ne sont pas masqués par ce calque additionnel. Le système PF1/Foundry garde la gestion de sa perception spéciale et de sa portée. La vision nocturne améliorée `lowlight` n'est pas assimilée à la vision dans le noir.
- **Rendu :** le calque de noirceur est maintenant placé **au-dessus des images de tokens et remous** dans la couche d'interface de Foundry, pour qu'il ne soit pas caché derrière ces effets. Le masque reste limité à la triangulation de la Region aquatique. Un avertissement explicite est journalisé si sa géométrie ne peut pas être dessinée.
- **Diagnostic MJ :** dans la console F12, exécuter `game.modules.get("pf1-waters").api.waterLightingDiagnostics()` pour obtenir l'état de l'éclairage global, les yeux du token contrôlé, la lumière physique et perçue, et le nombre de couches graphiques actives.

Cette distinction est une **simulation graphique 2D** : elle ne modifie pas les sources lumineuses locales, les réglages d'éclairage de la scène, les modes de vision ni les documents PF1. À une profondeur où l'environnement devient noir, la couche peut également masquer visuellement des sources lumineuses locales ; leur intégration à une simulation de lumière volumétrique reste une limite à traiter séparément. Il faut confirmer l'affichage dans une scène Foundry réelle.

## Yeux au-dessus de la surface et assombrissement visible (v1.4.11)

**Visibilité :** un token `floating` traverse la surface avec son corps mais peut avoir ses yeux au-dessus de l'eau. La limite de visibilité d'une Region s'applique à lui **comme à tout observateur extérieur** lorsque sa hauteur réelle de ligne de vue (`losHeight`) se situe sur ou au-dessus de la surface. Il ne peut plus voir un token complètement immergé plus profond que `visibilityDepth`, même si les deux sont dans la même Region en 2D ou si son statut `floating` est actif.

- **LOS au-dessus ou à la surface** → règles extérieures : atténuation sur les derniers 30 % de la visibilité autorisée et disparition au-delà de la profondeur maximale.
- **LOS strictement sous la surface** et corps dans la même Region → règles intérieures : pas de limite artificielle entre les tokens de la même Region ; les murs, la lumière native et les conditions de visibilité Foundry restent applicables.
- **`losHeight` absent** → utilise la hauteur physique du sommet du token comme estimation prudente ; un corps partiellement émergé ne devient pas automatiquement un observateur sous-marin.
- La vision du **token contrôlé** prévaut sur les autres sources de vision au moment de déterminer de quel côté de la surface se situe l'observateur.

**Éclairage :** pour résoudre les scènes où le plongeur ne voyait pas la luminosité diminuer, l'effet d'assombrissement utilise maintenant le **groupe InterfaceCanvasGroup**, qui est affiché en continu, plutôt que le `PrimaryCanvasGroup` mis en cache. Le dégradé reste calculé selon la hauteur des yeux de la créature immergée, avec la courbe 100 % → 50 % à 1× → 25 % à 2× → 5 % à 5× → 0 % à 20× la visibilité de la Region. Un `floating` avec les yeux dans l'air ne reçoit aucun assombrissement sous-marin.

**Limites :** il s'agit d'un effet graphique 2D **par client**, délimité par la triangulation de la Region. En étant appliqué après la composition native des effets du Canvas, il peut également assombrir visuellement certaines lumières locales dans la zone, même si leur configuration, leur portée et les règles de vision ne sont pas modifiées. Ce rendu doit être confirmé dans une scène réelle Foundry v13.

## Masquage complet du token hors limite de visibilité aquatique (v1.4.14)

Lorsqu'un observateur depuis la surface regarde une créature **entièrement immergée au-delà de la profondeur de visibilité de la Region**, PF1 Waters masque désormais **le Token placeable entier** à l'aide de `token.visible = false`, plutôt que de réduire seulement `token.mesh.alpha` à zéro. Le nom, le texte d'élévation, les icônes d'effets, les barres et les autres éléments HUD appartenant au token ne doivent donc plus rester visibles isolément.

- Ce masquage est **local au client**, sans écriture de `TokenDocument.hidden` ni changement de permissions, pour que les autres joueurs et le MJ puissent avoir leur propre point de vue.
- Il ne s'applique pas lorsque l'observateur voit réellement la cible depuis l'intérieur de la même Region aquatique, ni lorsque la cible remonte dans la profondeur visible.
- Lorsqu'un token **dépasse la surface**, seule son image native est occultée derrière la tuile : son portrait superposé en premier plan et son HUD restent normalement visibles.
- Les états visuels natifs de Foundry sont restaurés en sortant de l'eau, en changeant d'observateur et lors de la fermeture de la scène.
- Un MJ en caméra libre ne subit pas ce masquage automatique.

L'occultation est évaluée selon **la profondeur du sommet physique du token** et la visibilité de la Region, y compris sur les scènes où la limite par défaut est de **36 m ou 120 pieds**.

## Visibilité entre créatures immergées (v1.4.8)

La limite de visibilité en profondeur définie sur une Region (36 m / 120 pieds par défaut, ou la valeur du MJ) s'applique **uniquement depuis un point de vue extérieur à l'eau**. Elle ne limite **jamais** la visibilité entre deux tokens physiquement immergés dans **la même Region aquatique**.

- **Observateur ayant les yeux sous la surface dans la même Region d'eau que la cible** : aucune atténuation ni disparition imposée par PF1 Waters, même si le sommet de la cible est plus profond que `visibilityDepth`. L'image du token conserve son opacité native et demeure affichée sous la tuile transparente.
- **Observateur extérieur** (sur le pont, sur une berge, au-dessus de l'eau ou dans une autre Region) : la profondeur maximale de visibilité de la Region reste applicable, selon la position du sommet de la cible. Les derniers 30 % de cette distance restent atténués progressivement.
- **Plusieurs sources de vision du même utilisateur** : si un token est contrôlé, sa ligne de vue est prioritaire ; sinon, une source active réellement immergée dans la même Region et capable de voir la cible peut lever la limite externe pour ce client. Les tokens des autres joueurs ne servent pas de sources de vision supplémentaires.
- **Murs, éclairage, brouillard, effets d'invisibilité et tokens cachés** : le traitement de la limite de profondeur ne contourne pas les contrôles de visibilité du moteur Foundry v13. Il vérifie un point à la profondeur réelle de la cible via `canvas.visibility.testVisibility`.
- Lorsque l'observateur sort de l'eau ou change de Region, le prochain rafraîchissement de vision réapplique automatiquement la limite de profondeur extérieure, même si la cible n'a pas bougé.

Cette fonctionnalité est propre au rendu de chaque client et n'affecte ni les caractéristiques du token, ni les états `floating` / `hasFooting`, ni les règles de couverture et de combat de PF1AE.

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
