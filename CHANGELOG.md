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
