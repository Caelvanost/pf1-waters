## v1.5.4

- Gestionnaire des corps d’eau en liste : Modifier, Configurer profondeur de lumière et Supprimer pour chaque entrée ; Nouveau corps d’eau en bas de fenêtre.
- Retour automatique à la liste après édition ou création.

## v1.5.3

- Bouton « Configurer profondeur de lumière » dans la sélection des corps d’eau.
- Quatre seuils personnalisables, arrondis aux cases ; possibilité de revenir au calcul automatique selon la clarté.

## v1.5.2

- Seuils de profondeur arrondis au multiple de 1,50 m le plus proche (5 ft en scènes impériales), avec une première case claire sauf absorption immédiate totale.
- Suppression des tranches de largeur nulle ; conservation exacte du fond et de la surface.

## v1.5.1

- Retour aux régions natives d’obscurité : quatre tranches maximum, 25/50/75/100 % d’assombrissement relatif. Aucun auxiliaire pour 0 %.
- Quantification au niveau le plus proche ; seuils physiques 12,5/37,5/62,5/87,5 % d’absorption. Fond réel respecté.
- Désactivation des hooks d’obscurité dynamique et du voile PIXI ; luminosité de vision native préservée.
- Validation graphique Foundry V13 à effectuer.

## v1.5.0

- Retrait des régions d’éclairage par tranches et migration des anciennes régions auxiliaires identifiées par leur flag.
- Invalidation du cache d’obscurité native lors des changements de profondeur lorsque l’API est disponible.
- Conservation de l’API historique, des profils optiques et des modes de vision.
- Validation graphique Foundry V13 à effectuer.

# 1.4.29 — Luminosité native de la vision selon la profondeur

- Correction du manque de variation visuelle : PF1 Waters calcule maintenant la luminosité à la profondeur des yeux **dans les données natives `VisionSourceData.brightness`**, plutôt que de s'appuyer uniquement sur une surcouche graphique dépendante de l'éclairage global.
- La valeur est corrigée sur le client, jamais persistée dans `TokenDocument.sight`, et rafraîchie via l'initialisation des sources de vision et les événements de mouvement, élévation, sélection et mise à jour des corps d'eau.
- La courbe exponentielle Beer-Lambert du corps d'eau est conservée. Le profil de clarté fixe toujours la distance maximale, indépendamment de la profondeur ; la vision dans le noir est exemptée de la correction de luminosité.
- Le voile noir graphique de secours ne s'affiche plus quand la luminosité modifiée est déjà appliquée dans la source native du token, afin d'éviter un double assombrissement.
- Diagnostics enrichis : valeur native de luminosité, valeur attendue, valeur réellement initialisée et statut de mise à jour ; réinstallation de la surcharge après initialisation du canvas.
- Nouveaux tests de régression couvrant les scènes sans éclairage global, plusieurs profondeurs, le retour à la surface, la portée constante, les modes de vision dans le noir, la conservation des valeurs personnalisées et l'absence d'écriture persistante.

# 1.4.28 — Visibilité alignée sur les cases de 1,5 m

- Portées maximales des profils de clarté arrondies aux multiples de 1,5 m les plus proches : très claire **40,5 m** (27 cases), claire **25,5 m** (17 cases), légèrement trouble **12 m** (8 cases), trouble **6 m** (4 cases), vaseuse **1,5 m** (1 case).
- La seule configuration MJ reste le choix qualitatif de clarté du corps d'eau. Les portées des corps d'eau avec `waterClarity` enregistré reflètent automatiquement les nouvelles valeurs ; les anciens corps d'eau sans ce champ conservent leurs valeurs numériques.
- Les coefficients physiques `Kd`, l'atténuation solaire de Beer-Lambert, la vision dans le noir, la visibilité 3D, la conversion en pieds et le brouillard temporaire sont inchangés.
- Tests de régression : portées multiples de 1,5 m, nombre de cases, conservation des coefficients `Kd` et conversion métrique/impériale.

# 1.4.27 — Un seul réglage de clarté de l'eau

- Remplacement des entrées numériques de portée et de demi-profondeur dans le gestionnaire de corps d'eau par **une liste unique de cinq niveaux**, de « Très claire » à « Vaseuse ».
- Chaque niveau de clarté affecte automatiquement la portée maximale de visibilité **3D** (constante selon la profondeur, de 40 m à 2 m selon le profil) et l'absorption de la **lumière naturelle** avec la profondeur.
- Remplacement des anciens paliers artificiels par la loi de Beer-Lambert `exp(-Kd × profondeur)` dans le calcul de lumière naturelle, le diagnostic et les régions d'obscurité par tranches. Les valeurs de Kd sont des références indicatives et les portées horizontales demeurent des approximations de jeu.
- Un profil nommé `waterClarity` est conservé par corps d'eau. Les valeurs numériques internes `visionRange` et `visionHalfDepth` sont dérivées du profil et des unités de la scène ; aucun champ numérique n'est exposé au MJ pour ce paramétrage.
- Préservation des anciens corps d'eau et de leurs valeurs existantes jusqu'à leur modification explicite. Un profil proche est suggéré lors de leur première modification.
- Conservation de la vision dans le noir, de la portée géométrique fixe, du contrôle de visibilité 3D et du brouillard sous-marin temporaire.
- Tests de non-régression sur les profils, la conversion des unités, l'UI qualitative, les données existantes, la loi exponentielle et la mise à jour des sources de vision.

# 1.4.26 — Rendu d'obscurité dynamique réellement affiché en fonction de la hauteur

- **Correction principale :** la présence d'un comportement natif `Adjust Darkness Level` créé par PF1 Waters supprimait systématiquement le calque d'assombrissement graphique. Comme une mise à jour locale de `system.updateSource()` ne garantit pas un recalcul du rendu d'éclairage sous Foundry V13, aucune variation n'était visible lors des changements d'élévation.
- Le calque visuel client suit désormais **toujours** le facteur d'atténuation solaire de l'observateur immergé, indépendamment de la présence du comportement natif ou des Regions de lumière par tranches.
- Le changement de hauteur actualise l'alpha du calque sur la Region immergée ; la sortie de l'eau retire le calque. La vision dans le noir reste exemptée du voile ; la portée physique maximale et la distance 3D entre tokens restent inchangées.
- Diagnostic `waterLightingDiagnostics()` enrichi pour identifier le mode de rendu et les Regions concernées.
- Tests ajoutés pour le cas de régression (Region dotée d'un comportement natif), les tranches d'obscurité, plusieurs profondeurs, l'événement de modification d'élévation et la vision dans le noir.
- Limite assumée : le rendu visuel local est superposé **après** l'éclairage de Foundry ; il ne remplace pas une véritable obscurité native et peut également assombrir l'apparence de sources lumineuses locales. Le rendu réel et les éventuels doubles effets des bandes natives doivent être vérifiés dans Foundry V13.

# 1.4.25 — Portée physique fixe et assombrissement selon profondeur

- La profondeur ne réduit plus la portée de vision : `visionRange` est désormais la limite de transparence **constante** du corps d'eau, quel que soit le mode de vision du token. La limite native PF1 et les murs continuent de s'appliquer.
- `visionHalfDepth` pilote exclusivement l'**atténuation de la lumière naturelle** par profondeur (100 %, 50 %, 25 %, 5 %, 0 %). Cette demi-profondeur est maintenant commune à toutes les Regions d'un même corps d'eau, où elle remplace l'ancien paramètre local `sunlightHalfDepth` devenu redondant.
- L'obscurité de Foundry V13 (Region native ou tranches verticales, avec secours graphique local) traite la vision ordinaire, la vision dans le noir et les sources de lumière selon leurs mécanismes respectifs. Le détecteur darkvision est mutualisé dans `water-senses.mjs`.
- Les protections de visibilité 3D entre tokens immergés ainsi que le brouillard noir temporaire restent actives, désormais avec le rayon physique fixe.
- L'interface du gestionnaire des corps d'eau clarifie la distinction « distance de visibilité » / « profondeur de demi-lumière » ; le réglage lumineux redondant de chaque Region devient une valeur affichée en lecture seule.
- Tests de régression révisés pour séparer atténuation lumineuse et rayon de perception, y compris profondeurs extrêmes, vision dans le noir, tranches d'obscurité et visibilité 3D.

# 1.4.24 — Distance de vision 3D, brouillard noir pendant l'immersion, boutons épurés

- Correction du test de visibilité entre tokens immergés : la distance utilise désormais **X, Y et Z**. Le décalage vertical entre les yeux du plongeur et la partie la plus proche de la cible compte dans la portée maximale configurable du corps d'eau.
- Correction du brouillard gris/persistant : lorsqu'un observateur actif est immergé, les objets de rendu `CanvasVisibility.explored` et `FogManager.sprite` sont masqués **localement** (visible et renderable), sans interrompre la vision courante (`CanvasVisibility.vision`). La carte doit rester noire en dehors de la zone actuellement visible. Les états de rendu initiaux sont restaurés à la sortie de l'eau ou au changement de scène.
- La protection précédente contre l'enregistrement des découvertes sous-marines est conservée ; aucune donnée de brouillard déjà sauvegardée n'est effacée.
- Suppression des deux boutons Regions redondants « Corps d'eau de la scène » et « Retirer la propriété eau ». Les actions Associer/Dissocier/Configurer et les outils Tuiles/Dessins restent disponibles.
- Tests ajoutés : cible au même X/Y mais loin en Z, somme des distances horizontales et verticales, masquage du brouillard exploré, conservation de la vision actuelle, restauration après remontée, suppression des commandes obsolètes.

# 1.4.23 — Portée sous-marine réelle et brouillard non persistant

- Correction Foundry V13 : le champ `radius` de `VisionSourceData` n'est pas standard. Plafonnement désormais effectué aussi sur les accesseurs natifs `Token.sightRange`, `Token.lightPerceptionRange` et `Token.optimalSightRange`, en plus de `lightRadius`.
- Correction des profondeurs extrêmes : un rayon inférieur à un pixel est remplacé par un minimum non nul, pour éviter qu'un zéro soit considéré comme illimité par les polygones de vision.
- Les cibles immergées sont vérifiées à la distance réelle de chacun des observateurs avant tout affichage forcé par `testVisibility`; un token au-delà des portées de tous les observateurs sous-marins est caché côté client, étiquettes, effets et HUD compris. La visibilité revient dès qu'une source légitime entre à portée.
- Suppression de l'exploration **persistante** lors de la plongée : les commits et sauvegardes du `FogManager` sont suspendus tant qu'un observateur actif est immergé ; le brouillard temporaire est écarté à la remontée par `CanvasVisibility.resetExploration()`. Les données de brouillard enregistrées auparavant sont préservées.
- Limitation V13 documentée : lorsqu'une vue combine un observateur immergé et un observateur de surface, l'exploration persistante est entièrement suspendue pour cette vue, car Foundry conserve une texture de brouillard commune par client.
- Régressions ajoutées pour les champs de portée Foundry V13, la perte de vision en profondeur extrême, les cibles hors de portée, les observateurs multiples et la suspension/reprise des sauvegardes de brouillard.

# 1.4.22 — Accès principal à la gestion des corps d'eau

- Ajout de « PF1 Waters — Corps d'eau » comme **groupe de contrôles de premier niveau**, à côté des couches de scène et du module Levels, réservé au MJ.
- L'icône principale ouvre directement le menu de création, modification et suppression des corps d'eau, sans obligation de passer par la couche Regions.
- Ajout d'un bouton secondaire « Ouvrir la gestion des corps d'eau » dans la palette PF1 Waters pour rouvrir le menu sans devoir changer de couche.
- Conformité à l'API SceneControls de Foundry V13 : `activeTool` non-bouton valide, `order`, gestion de l'activation/désactivation, contrôle de visibilité MJ, absence de propriété de couche héritée.
- Les actions sur la géométrie des Regions et les liens des Tuiles/Dessins restent dans leurs outils respectifs. Les flags existants et les paramètres de vision de v1.4.21 ne sont pas modifiés.
- Tests ajoutés sur l'entrée de premier niveau, la navigation, le clic, la réouverture et les permissions. Documentation de création réécrite pour refléter exclusivement les corps d'eau de la scène.

# 1.4.21 — Vision sous-marine dynamique par token

- Paramètres de vision configurables dans le registre de chaque corps d'eau : activer/désactiver la limitation, distance maximale de vision à la surface et profondeur de demi-visibilité ; valeurs par défaut adaptées aux scènes métriques ou en pieds.
- Nouvelle courbe de limitation selon la profondeur des yeux, calculée à partir de la surface commune du corps d'eau ; gestion de plusieurs Regions à fonds distincts et de plusieurs corps d'eau par scène.
- Intégration client uniquement sur la classe de Token PF1 active via un wrapper idempotent de `_getVisionSourceData()` ; limitation conjointe de la vision et de la perception des zones éclairées, sans altérer la configuration des Tokens ni les sources lumineuses.
- Actualisation des sources sur déplacement, élévation, changement de sélection, modifications de Region et réglages du corps d'eau. Les yeux hors de l'eau restaurent les paramètres natifs.
- Fonction de diagnostic `waterVisionDiagnostics()` et nouveaux tests de courbe, isolement multi-token, lumière, configuration du registre et absence d'écriture.
- Limite connue : les modes de détection spéciaux possédant leur propre rayon ne sont pas modifiés, et la luminosité des zones visibles n'est pas atténuée par cette fonctionnalité.

# 1.4.20 — Suppression de la compatibilité des anciennes Regions et surfaces

- Le registre des corps d'eau de la scène devient obligatoire : seule une Region rattachée à un identifiant de corps d'eau existant représente de l'eau. La surface ne peut plus être paramétrée indépendamment sur chaque Region.
- Suppression de la migration des flags `pf1-skull-and-shackles.waterRegion`, des lectures d'anciens espaces de flags et des états de mouvement hérités d'un autre module. Le miroir public `world.underwater` est conservé pour les automatismes PF1.
- Les Tuiles/Dessins ne peuvent plus être associés à un identifiant individuel de Region. Suppression de l'ancien bouton « Lier à la surface d'eau » ; seules l'association à un corps d'eau de la scène et la dissociation restent disponibles.
- La fenêtre des paramètres d'une Region affiche l'altitude de surface commune en lecture seule. Une Region dissociée n'est plus un corps d'eau autonome.
- Tests réécrits sur le format unique, notamment nage, éclairage, remous, plages multi-profondeurs, surfaces communes et visibilité entre Regions.

# 1.4.19 — Corps d'eau regroupés à la scène (plusieurs Regions, une surface)

- Nouveau registre par scène pour les corps d'eau : nom, élévation de surface commune, création/modification/suppression avec contrôle des associations.
- Nouveaux boutons dans la couche Regions pour enregistrer les corps d'eau, associer une ou plusieurs Regions et dissocier celles-ci sans retirer leurs paramètres d'eau. Chaque Region conserve son contour et un fond local distinct, obtenu au choix par sa limite inférieure de Foundry ou par une profondeur explicitement saisie.
- Boutons supplémentaires dans les couches Tuiles et Dessins pour relier des surfaces visuelles directement à un corps d'eau, et non plus uniquement à une Region donnée.
- Surface partagée résolue dynamiquement par les calculs de nage, fond, vision et éclairage ; une surface visuelle liée à un corps d'eau peut servir plusieurs Regions.
- Détection d'appartenance horizontale corrigée pour les Regions dont les limites natives d'élévation ne comprennent pas 0 ; observers immergés dans deux Regions du même corps d'eau partageant la vision intérieure (sans contourner Foundry).
- Rafraîchissement sur changement de registre de la scène ; compatibilité préservée avec les Regions et Tiles/Drawings liés directement sans registre.
- Tests couvrant les plages à plusieurs fonds, association des Regions et surfaces, montage 3D, registres, suppression sûre et vision entre membres.

# 1.4.18 — Exclusion mutuelle de l'obscurité de la Region parente et des tranches

- Correction du conflit entre le comportement « PF1 Waters — Obscurité selon profondeur » de la Region parente et les comportements natifs « Remplacer l'obscurité » des tranches d'élévation.
- Lorsque les tranches sont activées, le comportement parent géré par PF1 Waters est désactivé de manière persistante dans Foundry V13. Une réactivation manuelle est automatiquement corrigée par la synchronisation des tranches.
- L'état initial (activé ou désactivé) du comportement parent est sauvegardé puis restauré lorsque les tranches sont désactivées. Les comportements d'obscurité créés manuellement ne sont jamais modifiés.
- Suppression du calque graphique d'obscurité historique pour toute Region utilisant les tranches, afin d'éviter un double assombrissement côté client.
- Tests de non-régression couvrant les Regions préexistantes, nouvellement créées, réactivées manuellement, et le retour à l'état antérieur du comportement parent.

# 1.4.17 — Obscurité sous-marine native par tranches d'élévation

- Ajout du mode facultatif « Obscurité native par tranches d'élévation » sur chaque Region d'eau (4 à 40 tranches, 24 par défaut), pour remplacer l'assombrissement dynamique non fonctionnel sur certaines installations Foundry V13.
- Régions auxiliaires distinctes, avec formes et trous copiés et limites verticales non chevauchantes ; chaque tranche utilise le comportement natif « Remplacer l'obscurité » avec une valeur persistante. Répartition suivant une progression de luminosité régulière plutôt qu'une distance uniforme.
- Respect du fond physique, des eaux sans fond, de l'obscurité de scène et de la courbe d'atténuation solaire. Ni tokens ni mécanique de nage ne sont modifiés par ces Regions d'éclairage.
- Synchronisation au démarrage côté MJ, sur mise à jour de la Region ou de la scène ; nettoyage des tranches à la désactivation ou suppression de la Region source. Le mode dynamique client-local est désactivé pour les Regions en mode statique.
- Tests de planification des intervalles, de géométrie, d'idempotence, de retrait et de non-mutation des Regions d'eau. Validation du rendu et des seuils de vision encore nécessaire dans une vraie scène Foundry V13.

# 1.4.16 — Fenêtre de configuration des Regions aquatiques défilable

- Correction du formulaire « PF1 Waters — Corps d'eau » qui dépassait de l'écran avec ses nouveaux paramètres d'éclairage.
- Hauteur maximale du contenu adaptée au viewport (560 px maximum) et défilement vertical réservé aux champs, sans cacher le titre ou le bouton de validation.
- Largeur maximale adaptée aux petites fenêtres ; champs numériques et sélecteur PNG restent utilisables.
- Conservation du dialogue non modal pour que le navigateur de fichiers natif de Foundry V13 soit accessible.
- Test de non-régression pour la configuration de la fenêtre et ses styles CSS.

# 1.4.15 — Obscurité native progressive et profondeur solaire indépendante

- À chaque changement d'élévation du regard, l'obscurité native d'une Region rejoint sa valeur cible par une interpolation locale douce de 450 ms, avec recalcul de perception toutes les 75 ms au maximum.
- Nouveau réglage « Profondeur pour 50 % de lumière naturelle » indépendant de la profondeur de visibilité des tokens, pour contrôler l'assombrissement selon le type et la profondeur du corps d'eau.
- Les anciennes Regions conservent automatiquement leur courbe solaire d'origine. Courbe 100 % / 50 % / 25 % / 5 % / 0 % et calcul 3D du regard inchangés.
- Diagnostic et tests étendus ; sorties de l'eau et caméra MJ libre conservent le retour immédiat à l'obscurité normale. Aucun changement serveur des valeurs d'obscurité temporaires.

# 1.4.14 — Masquage complet des tokens trop profonds pour la vision extérieure

- Un token entièrement immergé au-delà du seuil de visibilité de sa Region est désormais masqué via **`token.visible = false`** plutôt que seulement `token.mesh.alpha = 0`.
- Le conteneur Token invisible ne laisse plus apparaître le texte d'élévation, le nom, le HUD, les icônes d'effets ou les barres de statut.
- Aucune modification de `TokenDocument.hidden` : le masquage reste propre au client et n'affecte pas les autres joueurs.
- Restauration de la visibilité native au retour sous l'eau de l'observateur, à la remontée du token cible ou à la sortie de la Region.
- Les tokens émergés conservent leur copie graphique au premier plan et les éléments d'interface d'origine.
- Le MJ avec caméra libre n'est pas soumis à cette occultation.
- Tests de régression : observateur à −0,97 m avec les yeux au-dessus de la surface, cible à −49,5 m, élévation et HUD, changement d'observateur, réémergence et caméra MJ.

# 1.4.13 — Obscurité native de Foundry selon la profondeur dans une Region d'eau

- Le calcul de profondeur utilise désormais la **valeur Obscurité de la scène** et un comportement natif `adjustDarknessLevel` associé à chaque Region d'eau.
- L'effet interagit avec le **seuil d'illumination globale** de Foundry v13, permettant à Foundry lui-même de considérer une zone comme non éclairée et de calculer les détections et sources de lumière locales.
- Comportement natif neutre créé **une fois par Region** par le MJ, sans remplacer les comportements d'obscurité manuels.
- Profondeur de la ligne de vue appliquée **uniquement sur le client** du joueur par `updateSource`, sans mise à jour réseau ni changement sauvegardé de l'obscurité de la scène.
- Obscurité calculée : `D = Dscène + (1 − Dscène) × (1 − lumièreRestante)`. Courbe de profondeur inchangée : 50 % à 1×, 25 % à 2×, 5 % à 5×, 0 % à 20×.
- Retour à l'obscurité neutre quand le point de vue quitte la Region, remonte à la surface ou quand l'illumination globale est désactivée.
- Retrait de l'ancien masque PIXI dans les Regions gérées par le système natif ; recours au masque conservé si le comportement natif n'a pas encore pu être créé.
- Abandon du nouveau réglage de pourcentage de masque, qui ne correspondait pas au besoin exprimé.
- Diagnostics et tests sur l'absence de persistance des mises à jour de profondeur, le seuil régional et les modes de vision.
- La synchronisation locale avec les passes de perception de Foundry doit être confirmée en conditions réelles de Foundry v13.

# 1.4.12 — Vision normale aveuglée par la profondeur et calque sombre prioritaire

- Conservation de la courbe de lumière physique : 50 % à 1×, 25 % à 2×, 5 % à 5× et disparition à 20× la profondeur de visibilité.
- Ajout d'un seuil de perception graphique pour les tokens **sans vision dans le noir** : noir à 12 % ou moins de lumière globale restante ; transition progressive entre 12 et 20 %.
- Cas de reproduction : à −150 m dans une Region de visibilité 36 m, il reste environ 10,6 % de lumière physique, mais elle n'est plus suffisante pour voir normalement le terrain.
- Prise en compte de `sight.visionMode` (darkvision) et des modes de détection équivalents. La vision dans le noir n'est pas assombrie par le filtre supplémentaire ; la vision nocturne améliorée ne remplace pas la vision dans le noir.
- Le calque sombre est désormais ajouté au-dessus des copies de tokens émergés et possède une priorité de rendu élevée dans `InterfaceCanvasGroup`.
- Avertissement console en l'absence de triangulation de Region, et nouvelle API de diagnostic `waterLightingDiagnostics()`.
- Limite graphique : l'opacité élevée du filtre peut aussi masquer les lumières locales, même si leurs documents ne sont pas modifiés.
- Tests de régression sur le seuil perceptif, le rendu à −150 m, les modes de vision et l'ordre des couches d'interface.

# 1.4.11 — Floating au-dessus de l’eau : limite extérieure et éclairage sous-marin visible

- Un token `floating` avec la hauteur `losHeight` sur ou au-dessus de la surface utilise désormais **la limite extérieure de visibilité**, même si le corps du token se trouve dans la même Region que la cible.
- La visibilité sans limite artificielle est réservée aux sources de vision réellement **sous la surface**, dans la même Region aquatique.
- Sans hauteur de LOS connue, le sommet physique sert de valeur de repli ; les yeux au-dessus de la surface ne confèrent plus de vision subaquatique illimitée.
- Le token **contrôlé** est prioritaire sur les autres sources de vision, notamment une source restée au niveau du pont, pour éviter de bloquer l'atténuation de lumière du plongeur.
- L'assombrissement global est maintenant dessiné dans le groupe **InterfaceCanvasGroup**, visible à chaque rafraîchissement, plutôt que dans le groupe primaire mis en cache de Foundry v13.
- La courbe reste **100 % → 50 % (1×) → 25 % (2×) → 5 % (5×) → 0 % (20×)**, appliquée seulement aux observateurs dont le regard est immergé.
- L'effet graphique d'interface est susceptible d'assombrir aussi visuellement certaines lumières locales ; leurs caractéristiques et les règles de vision ne sont pas modifiées.
- Tests de régression sur les LOS émergés, immergés, le passage de surface, la priorité du point de vue contrôlé, et l'affichage sur la couche d'interface.

# 1.4.10 — Lumière globale : 5 % à 5× et extinction à 20×

- Conservation des seuils précédents : **50 %** à une profondeur de visibilité, **25 %** à deux profondeurs.
- Ajout des seuils **5 %** à cinq profondeurs de visibilité et **0 %** à vingt profondeurs de visibilité, puis extinction au-delà.
- Courbe d’atténuation continue, interpolée linéairement entre tous les paliers.
- Par défaut (36 m) : seuils à **36, 72, 180 et 720 m** ; pour les scènes à 120 pieds : **120, 240, 600 et 2 400 pieds**.
- Le traitement reste conditionné à l'éclairage global, limité à la Region depuis un observateur immergé. Les lumières locales ne sont pas configurées par ce calcul.
- Tests de régression sur la nouvelle courbe, les limites personnalisées, la composition d'assombrissement et l'extinction totale en eaux profondes.

# 1.4.9 — Lumière globale sous l'eau : 50 %, puis 25 % minimum

- Assombrissement visuel progressif de la Region d'eau lorsque l'éclairage global est activé et que le point de vue du client est immergé.
- Lumière globale préservée à 100 % en surface, 50 % à une profondeur de visibilité, 25 % à deux fois la profondeur de visibilité, **25 % maintenus en dessous**, sans disparition totale.
- Par défaut : 36 m / 120 pieds pour le premier palier et 72 m / 240 pieds pour le second ; respect des paramètres personnalisés de chaque Region.
- Masque de la Region construit à partir de sa triangulation Foundry v13 ; tracé recalculé à la modification de sa géométrie.
- Pas de modification des documents Scene, Region ou des sources de lumière locales ; affichage client uniquement, avec prise en compte des sources de vision actives.
- Rendu 2D au niveau du point de vue : ce n'est pas une simulation photométrique volumétrique.
- Tests de coefficients, paliers, valeurs explicites, géométrie, ouverture/fermeture de scène et mise à jour des observateurs.

# 1.4.8 — Visibilité sans limite artificielle entre tokens dans la même eau

- La profondeur de visibilité des Regions n'est plus appliquée à une cible immergée lorsque le client possède une source de vision immergée dans la **même Region** et que Foundry confirme la ligne de vue vers la cible.
- L'opacité et la visibilité natives sont rétablies en vision intérieure même au-delà de 36 m / 120 pieds (ou d'un seuil personnalisé).
- Les observateurs extérieurs, au-dessus de l'eau ou dans une autre Region conservent le seuil de profondeur, son atténuation finale et la disparition des tokens profonds.
- Réévaluation lorsque les sources de vision se déplacent : passage immédiat de la vision intérieure à la vision extérieure sans mouvement de la cible.
- Maintien des murs, brouillard, restrictions de vision et tokens cachés ; aucun changement à PF1AE ou aux mécaniques de nage.
- Tests de régression : profondeur intérieure illimitée, transition vers l'extérieur, absence de contournement des murs, observateurs en altitude et Regions distinctes.

# 1.4.7 — Ratio de taille des remous par Region d’eau

- Champ « Ratio de taille des remous » dans la configuration de la Region, enregistré dans `flags.pf1-waters.waterRegion.ringScale`.
- **Valeur par défaut 1,5**, rétrocompatible pour les anciennes Regions sans coefficient explicite.
- Le PNG est centré sur le token ; ses dimensions suivent `largeur × ratio` et `hauteur × ratio`. Exemples : token 1×1 → image 1,5×1,5 ; token 2×2 → image 3×3.
- L'affichage reste derrière les tokens émergés ; le masque central évite que l'image superposée au groupe de premier plan couvre un token natif.
- Mise à jour dynamique quand le MJ change le ratio, sans toucher aux positions des tokens ni aux états aquatiques.
- Tests pour le défaut 1,5, la configuration, les proportions rectangulaires et les changements à chaud.

# 1.4.6 — PNG de remous autour et sous les tokens

- Redimensionnement à une case supplémentaire de chaque côté : 1×1 → 3×3, 2×2 → 4×4, y compris tokens non carrés.
- Même centre et suivi de la position animée du token.
- Calque des remous derrière les copies de tokens émergés ; masque PIXI pour rendre transparent le rectangle occupé par le token.
- Le masque et l'image sont détruits ensemble à la sortie de l'eau ; le PNG reste facultatif, sans ellipse automatique.
- Tests de géométrie, position, ordre des calques et nettoyage des masques.

# 1.4.5 — État Nager permanent pour tout token immergé sans appui

- Les tokens immergés sans `hasFooting` reçoivent le statut natif PF1 `Nager` indépendamment de `movementAction` et sans qu'ils aient besoin de bouger.
- Les tokens volant dans le volume d'eau reçoivent également le statut Nager ; le vol conserve son exemption de collision avec le fond et l'absence de placement forcé à mi-hauteur.
- Resynchronisation au chargement, sur modification de Region et en cas de suppression/altération de l'ActiveEffect natif Nager, avec protection contre les boucles de hooks.
- Le statut est retiré quand le token prend pied ou quitte l'eau, sans supprimer les statuts Nager de personnages étrangers aux Regions aquatiques.
- Tests de régression : immobilité, plusieurs modes de déplacement, vol immergé, suppression d'effet, entrée et sortie de Region, prise d'appui sans déplacement.

# 1.4.4 — Sélecteur PNG cliquable dans la configuration de Region

- Le dialogue « PF1 Waters — Corps d'eau » n'est plus modal : le navigateur de fichiers Foundry ouvert par `<file-picker>` reste accessible et peut prendre le focus.
- Le formulaire garde ses valeurs tant que le MJ choisit son PNG ; aucune Region n'est modifiée avant la confirmation.
- Test de régression vérifiant l'option `modal: false` et la présence du sélecteur natif PNG.

# 1.4.3 — Correctif des tokens émergés derrière les tuiles transparentes

- Le recouvrement d'une Tile liée à l'eau est basé sur son rectangle géométrique, et ne dépend plus d'un test alpha des pixels de son PNG.
- Un token dont la base est à −1,05 m et la hauteur à 1,50 m, sous une surface à 0 m, est bien reconnu comme émergé et son portrait s'affiche à pleine opacité devant la Tile.
- Conversion des positions de la copie graphique entre groupes Canvas à partir des transformations mondiales lorsque ces API PIXI sont disponibles.
- Les Drawings gardent leur géométrie réelle et leurs tests de forme ; aucune modification des profondeurs, de l'élévation des tokens ou des règles PF1AE.
- Tests de non-régression : PNG transparent, limites de la Tile, sprite au premier plan et transformation des groupes Canvas.

# 1.4.2 — Seuil par défaut de 120 pieds dans les scènes impériales

- Les Regions aquatiques sans profondeur de visibilité configurée utilisent **120 pieds** si la scène est en `ft`, `feet`, `pieds`, etc., au lieu de la conversion exacte de 36 mètres (~118,11 pieds).
- La valeur par défaut métrique reste **36 mètres**. Il s'agit d'une convention d'arrondi pour Pathfinder, et non d'une équivalence physique exacte.
- Toutes les valeurs définies par le MJ, y compris `0`, restent inchangées.
- Aide du formulaire, documentation et tests de régression actualisés.

# 1.4.1 — Profondeur de visibilité par défaut de 36 mètres

- Une Region d'eau sans seuil `visibilityDepth` défini par le MJ utilise **36 mètres** de visibilité sous la surface, mesurés à partir du sommet des tokens.
- Conversion cohérente avec les unités de la scène : `36 m ≈ 118,11 pieds`, sans arrondir la distance métrique.
- Les valeurs explicitement choisies par le MJ, notamment `0`, sont conservées.
- Ce défaut est appliqué aussi aux anciennes Regions, plutôt que d'hériter des anciens seuils de visibilité des tuiles ou dessins.
- Configuration, aide française et tests de non-régression métriques, impériaux et de profondeur maximale mis à jour.

# 1.4.0 — Visibilité par sommet, limites de Region, floating et hasFooting

- Profondeur maximale de visibilité sous-marine configurable au niveau de chaque Region d'eau ; les réglages des tuiles/dessins anciens sont conservés en repli.
- Le sommet du token, et non sa base seule, détermine si sa silhouette reste visible au travers d'une surface translucide. Le token entièrement immergé demeure sous la tuile avec atténuation progressive dans les derniers 30 % de profondeur.
- Un token qui dépasse de l'eau peut être vu depuis un poste d'observation extérieur plus haut (ex. pont du navire), sous réserve d'une source de vision active et d'un test de ligne de vue par le moteur Foundry v13 au niveau de la surface.
- Nouveau flag token booléen `flags.pf1-waters.floating` lors de la traversée physique de la surface ; renommage de `standing` en `hasFooting` (fond sous les pieds) sur les états et flags aquatiques.
- Rafraîchissement des flags au déplacement, des visuels lors des rafraîchissements de vision et rétablissement de la visibilité native lorsque les conditions cessent.
- Aucun changement d'élévation, d'attributs de combat ou de bonus d'abri PF1AE ; pas de contournement délibéré des murs ou des tokens cachés.
- Tests des seuils par Region, de la vue extérieure, des obstacles, du fond et des flags.

# 1.3.1 — Visibilité de la tuile d’eau depuis le dessus

- La tuile liée à une Region aquatique peut rester visible comme un plan d’eau, plutôt que s’estomper comme une toiture sous l’occlusion native de Foundry v13.
- Option de liaison activée par défaut : `keepVisible`. Applique `CONST.OCCLUSION_MODES.NONE` au champ natif `TileDocument.occlusion.mode` ; restaure l’ancien mode quand la tuile est dissociée ou si l’option est désactivée.
- Traitement rétrocompatible des tuiles déjà liées lors du chargement de la scène, sans modification des Drawings.
- Conservation de `hidden`, `alpha`, de la vision et de l’éclairage natifs, des règles d’immersion/abri et des PNG transparents. Aucune création d’image hors brouillard de guerre.
- Tests de régression : mode d’occlusion, restitution, anciens liens, absence de modification des Regions/Dessins et tuiles cachées.

# 1.3.0 — Surface transparente, profondeur visuelle et remous PNG facultatifs

- Suppression de tous les anneaux géométriques bleus générés automatiquement.
- Ajout dans le dialogue d'une Region d'eau d'un sélecteur de ressource **PNG des remous** ; champ vide par défaut, aucun effet dessiné sans PNG choisi.
- Le PNG facultatif suit la position animée du token qui traverse la surface et disparaît lorsqu'il s'immerge totalement ou sort de l'eau.
- Les tokens émergents disposent d'une copie graphique non interactive au-dessus des tuiles/dessins de surface ; l'image principale est masquée pendant la superposition pour éviter un double affichage.
- Les tokens entièrement immergés restent visibles sous les textures transparentes jusqu'à une profondeur configurable par tuile/dessin, avec atténuation progressive sur les derniers 30 %.
- Préservation du volume de la Region, des élévations réelles, du flag `waterwalk`, des mouvements, des règles de PF1AE et des anciens liens de surfaces.
- Tests automatiques de configuration PNG, absence d'ellipse, déplacement suivi et atténuation graphique.

# 1.2.2 — Exception waterwalk pour les sorts et capacités

- Une créature avec `flags.world.waterwalk === true` ou `flags.pf1-waters.waterwalk === true` n'est pas ajustée à mi-hauteur quand elle marche à l'élévation de la surface.
- La marche sur l'eau n'annule pas les règles de nage ou de fond si le token est déjà immergé ; elle ne téléporte pas les tokens vers le haut.
- La pose et la suppression du flag sur le TokenDocument déclenchent la resynchronisation, sans boucle sur les flags aquatiques existants.
- API `hasWaterWalkFlag(token)`, documentation des scripts et tests de non-régression.

# 1.2.1 — Repositionnement à mi-hauteur uniquement à pied sur la surface

- Le placement automatique `surface − hauteur/2` est désormais limité aux tokens en mode `walk`, dont l'élévation est exactement celle de la surface de leur Region d'eau (tolérance numérique de 0,000001).
- Un token au-dessus de la surface n'est plus ramené dans l'eau.
- Les tokens déjà immergés ou utilisant `swim` / un autre mode de mouvement conservent librement leur altitude, même lorsqu'ils remontent.
- La contrainte physique du fond, l'exemption en vol, le statut natif `Nager` et les flags d'immersion restent pris en charge.
- Correctif : un token dans l'emprise 2D d'une Region mais au-dessus de l'eau ne reçoit plus un état de nage infondé.
- Tests de non-régression pour la marche à la surface, les altitudes hautes, la plongée, les modes de mouvement, le fond et le vol.

# 1.2.0 — Rendu des tokens partiellement immergés

- Les tokens dont `0 < surface - base < hauteur` passent devant les tuiles/dessins liés à la Region d'eau.
- À immersion complète, sortie de l'eau ou vol, le tri natif du token est restauré.
- Modification purement graphique du sprite local `Token.mesh`, sans toucher à l'élévation de jeu ou aux flags aquatiques.
- Vérification d'appartenance à l'emprise du visuel, plusieurs surfaces liées prises en charge.
- Option de réglage activée par défaut, API de diagnostic et tests Node de non-régression.
- Aucune modification dans Skull & Shackles ni PF1 Automation Engine.

# 1.1.0 — Tuiles et dessins comme surfaces visuelles associées

- Les tuiles et dessins peuvent être associés à une Region aquatique existante via des boutons de couche réservés au MJ.
- Le flag `flags.pf1-waters.waterSurface` stocke le lien et l'option d'alignement d'élévation.
- La Region demeure seule responsable du volume d'eau, de la profondeur et de toutes les mécaniques.
- Synchronisation facultative de l'élévation des surfaces visuelles sur le niveau de la Region.
- API publique de consultation des liens et tests de non-régression.

# Changelog — PF1 Waters

## 1.0.0 — 2026-11-22

- Moteur de corps d'eau autonome pour Foundry VTT 13 et PF1 11.11.
- Regions, surface, profondeur facultative, fond physique, chevauchements.
- Volume vertical réel des tokens et classification de l'immersion.
- Nage automatique à 50 % d'immersion, plongée libre, fond et vol respectés.
- Synchronisation de l'état PF1 natif Nager et des flags canoniques/historiques.
- Mesure échantillonnée des projectiles sous l'eau.
- Migration non destructive des anciens flags Skull & Shackles.
- API publique et alias waterAutomation, contrôles français et anneaux indicatifs.
- Suite de tests Node et publication GitHub Actions d'un ZIP installable.
