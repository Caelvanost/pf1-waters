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
