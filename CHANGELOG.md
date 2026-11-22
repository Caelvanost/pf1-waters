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
