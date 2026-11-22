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
