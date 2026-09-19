/**
 * Traduction centralisée et exhaustive des codes techniques du moteur de
 * planification automatique vers des libellés français compréhensibles par le
 * dispatcher.
 *
 * Objectif (correctif fonctionnel §7) :
 *  - aucun code interne ne doit être affiché seul dans l'interface ;
 *  - chaque raison expose un titre court, une explication, sa nature et
 *    l'action corrective adaptée ;
 *  - un code inconnu conserve un libellé générique sûr et son code technique.
 *
 * Les codes internes restent présents dans les réponses API et les journaux :
 * ce module ne fait que produire la couche de présentation. Il ne modifie
 * jamais une décision du moteur.
 */

/**
 * Nature d'une raison : distingue une donnée manquante (résoluble en
 * renseignant une fiche) d'une incompatibilité démontrée (le moteur a prouvé
 * l'impossibilité avec les données connues).
 */
export type ReasonNature =
  | 'MISSING_DATA'
  | 'INCOMPATIBLE'
  | 'TEMPORAL'
  | 'REGULATORY'
  | 'AVAILABILITY'
  | 'DEFERRED'
  | 'INFO'
  | 'UNKNOWN'

/**
 * Gravité fonctionnelle telle qu'affichée dans la checklist / prévisualisation.
 */
export type ReasonSeverity = 'BLOCKING' | 'CONDITIONAL' | 'INFO'

/**
 * Action corrective proposée au dispatcher. Chaque valeur correspond à une
 * surface de saisie réelle de l'interface (fiche chauffeur, camion, remorque,
 * mission, base, adresse, itinéraire) ou à une relance (préparation /
 * simulation).
 */
export type ReasonActionKind =
  | 'EDIT_DRIVER_REGULATORY'
  | 'EDIT_TRUCK_TECHNICAL'
  | 'EDIT_TRAILER_TECHNICAL'
  | 'EDIT_MISSION_SCHEDULE'
  | 'REVIEW_ADDRESS'
  | 'RECOMPUTE_ROUTE'
  | 'CONFIGURE_BASE'
  | 'CHECK_AVAILABILITY'
  | 'RERUN_PREPARATION'
  | 'RERUN_SIMULATION'

export const reasonActionLabels: Record<ReasonActionKind, string> = {
  EDIT_DRIVER_REGULATORY: 'Mettre à jour l’état réglementaire',
  EDIT_TRUCK_TECHNICAL: 'Compléter le camion',
  EDIT_TRAILER_TECHNICAL: 'Compléter la remorque',
  EDIT_MISSION_SCHEDULE: 'Modifier les horaires',
  REVIEW_ADDRESS: 'Examiner l’adresse',
  RECOMPUTE_ROUTE: 'Recalculer l’itinéraire',
  CONFIGURE_BASE: 'Configurer la base',
  CHECK_AVAILABILITY: 'Vérifier la disponibilité',
  RERUN_PREPARATION: 'Relancer la préparation',
  RERUN_SIMULATION: 'Relancer la simulation',
}

export type ReasonLabel = {
  /** Code technique interne, toujours conservé pour les détails / logs. */
  code: string
  /** Titre court affiché en principal. */
  title: string
  /** Explication compréhensible par un dispatcher non technique. */
  explanation: string
  nature: ReasonNature
  severity: ReasonSeverity
  /** Action corrective adaptée (absente si purement informatif). */
  action: ReasonActionKind | null
  /**
   * true lorsque la raison correspond à une incompatibilité démontrée par le
   * moteur (et non à une simple absence de donnée). Permet à l'UI de ne pas
   * présenter une donnée manquante comme une incompatibilité.
   */
  demonstrated: boolean
}

type ReasonDefinition = Omit<ReasonLabel, 'code'>

/**
 * Table exhaustive. Les clés couvrent :
 *  - CompatibilityCode (moteur de compatibilité) ;
 *  - RegulatoryDecisionCode / MissingTemporalDataCode (moteur réglementaire) ;
 *  - UnassignedCategory (catégories de missions non affectées) ;
 *  - les chaînes `missingData` produites par la compatibilité et la
 *    préparation de mission ;
 *  - quelques alias explicitement demandés par le cahier des charges.
 */
const reasonDefinitions: Record<string, ReasonDefinition> = {
  // --- Compatibilité métier -------------------------------------------------
  COMPATIBLE: {
    title: 'Compatibilité confirmée',
    explanation: 'Toutes les contraintes connues sont satisfaites.',
    nature: 'INFO',
    severity: 'INFO',
    action: null,
    demonstrated: true,
  },
  COMPATIBLE_WITH_CONDITION: {
    title: 'À confirmer',
    explanation:
      'La combinaison reste à confirmer une fois les données manquantes renseignées.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: null,
    demonstrated: false,
  },
  DRIVER_UNAVAILABLE: {
    title: 'Chauffeur indisponible',
    explanation:
      'Le chauffeur n’est pas disponible sur la période (congé, absence ou statut inactif).',
    nature: 'AVAILABILITY',
    severity: 'BLOCKING',
    action: 'CHECK_AVAILABILITY',
    demonstrated: true,
  },
  TRUCK_UNAVAILABLE: {
    title: 'Camion indisponible',
    explanation:
      'Le tracteur est en maintenance ou hors service sur la période sélectionnée.',
    nature: 'AVAILABILITY',
    severity: 'BLOCKING',
    action: 'CHECK_AVAILABILITY',
    demonstrated: true,
  },
  TRAILER_UNAVAILABLE: {
    title: 'Remorque indisponible',
    explanation:
      'La remorque est en maintenance ou hors service sur la période sélectionnée.',
    nature: 'AVAILABILITY',
    severity: 'BLOCKING',
    action: 'CHECK_AVAILABILITY',
    demonstrated: true,
  },
  TRUCK_TYPE_MISMATCH: {
    title: 'Catégorie du camion incompatible',
    explanation:
      'La catégorie du tracteur ne correspond pas à celle exigée par la mission.',
    nature: 'INCOMPATIBLE',
    severity: 'BLOCKING',
    action: 'EDIT_TRUCK_TECHNICAL',
    demonstrated: true,
  },
  TRAILER_TYPE_MISMATCH: {
    title: 'Catégorie de remorque incompatible',
    explanation:
      'Le type de remorque ne correspond pas à celui exigé par la mission.',
    nature: 'INCOMPATIBLE',
    severity: 'BLOCKING',
    action: 'EDIT_TRAILER_TECHNICAL',
    demonstrated: true,
  },
  INSUFFICIENT_CAPACITY: {
    title: 'Capacité insuffisante',
    explanation:
      'La capacité renseignée est inférieure à la charge exigée par la mission.',
    nature: 'INCOMPATIBLE',
    severity: 'BLOCKING',
    action: 'EDIT_TRUCK_TECHNICAL',
    demonstrated: true,
  },
  RESOURCE_TIME_CONFLICT: {
    title: 'Créneau déjà occupé',
    explanation:
      'La ressource est déjà utilisée sur ce créneau par une autre mission.',
    nature: 'TEMPORAL',
    severity: 'BLOCKING',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: true,
  },
  REQUIRED_TRAILER_MISSING: {
    title: 'Remorque imposée absente',
    explanation:
      'La mission exige une remorque précise qui n’est pas rattachée au couple.',
    nature: 'MISSING_DATA',
    severity: 'BLOCKING',
    action: 'EDIT_TRAILER_TECHNICAL',
    demonstrated: false,
  },
  TRAILER_POSITION_UNKNOWN: {
    title: 'Position de la remorque inconnue',
    explanation:
      'La position de départ de la remorque n’est pas connue : elle doit être stationnée ou attelée.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_TRAILER_TECHNICAL',
    demonstrated: false,
  },
  MISSION_REQUIREMENTS_UNKNOWN: {
    title: 'Exigences de la mission incomplètes',
    explanation:
      'Les caractéristiques techniques exigées par la mission sont incomplètes.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: false,
  },
  REGULATORY_STATE_UNKNOWN: {
    title: 'État réglementaire du chauffeur non renseigné',
    explanation:
      'L’état réglementaire du chauffeur est incomplet : le contrôle des temps de conduite ne peut aboutir.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: false,
  },
  POSITION_UNCERTAIN: {
    title: 'Position de départ à confirmer',
    explanation:
      'La dernière position GPS récente est absente ; le moteur utilise un repli explicitement identifié.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'CHECK_AVAILABILITY',
    demonstrated: false,
  },
  'position.lastCompletedMission': {
    title: 'Position issue de la dernière mission',
    explanation:
      'La dernière destination terminée est utilisée faute de GPS récent.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'CHECK_AVAILABILITY',
    demonstrated: false,
  },
  'position.operatingBase': {
    title: 'Position estimée à la base',
    explanation:
      'La base d’exploitation est utilisée faute de GPS récent et de mission terminée exploitable.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'CHECK_AVAILABILITY',
    demonstrated: false,
  },
  'position.unknown': {
    title: 'Position de départ inconnue',
    explanation:
      'Aucune position GPS récente, mission terminée ou base exploitable n’est disponible.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'CHECK_AVAILABILITY',
    demonstrated: false,
  },
  TEMPORALLY_INFEASIBLE: {
    title: 'Chronologie impossible',
    explanation:
      'La chronologie de la mission est temporellement impossible avec les données connues.',
    nature: 'TEMPORAL',
    severity: 'BLOCKING',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: true,
  },
  REGULATORILY_INFEASIBLE: {
    title: 'Limite réglementaire dépassée',
    explanation:
      'Une limite réglementaire confirmée serait dépassée par cette affectation.',
    nature: 'REGULATORY',
    severity: 'BLOCKING',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: true,
  },
  MISSING_ROUTE: {
    title: 'Itinéraire manquant',
    explanation:
      'Une transition indispensable ne possède pas d’itinéraire calculé.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'RECOMPUTE_ROUTE',
    demonstrated: false,
  },
  FORCED_PAIR_MISMATCH: {
    title: 'Mission imposée à un autre couple',
    explanation:
      'La mission est déjà imposée à un autre couple chauffeur / camion.',
    nature: 'INFO',
    severity: 'INFO',
    action: null,
    demonstrated: true,
  },

  // --- Réglementaire : décisions favorables --------------------------------
  FEASIBLE: {
    title: 'Réalisable',
    explanation: 'La mission est réalisable dans les limites réglementaires.',
    nature: 'INFO',
    severity: 'INFO',
    action: null,
    demonstrated: true,
  },
  FEASIBLE_WITH_BREAK: {
    title: 'Réalisable avec pause',
    explanation:
      'La mission est réalisable en insérant une pause réglementaire.',
    nature: 'INFO',
    severity: 'INFO',
    action: null,
    demonstrated: true,
  },
  FEASIBLE_WITH_DAILY_EXTENSION: {
    title: 'Réalisable avec extension journalière',
    explanation:
      'La mission est réalisable en utilisant une extension de conduite journalière.',
    nature: 'INFO',
    severity: 'INFO',
    action: null,
    demonstrated: true,
  },
  FEASIBLE_AFTER_DAILY_REST: {
    title: 'Réalisable après repos journalier',
    explanation:
      'La mission est réalisable après un repos journalier inséré dans la chronologie.',
    nature: 'INFO',
    severity: 'INFO',
    action: null,
    demonstrated: true,
  },
  REQUIRES_NEXT_DAY: {
    title: 'Reportée au lendemain',
    explanation:
      'La mission ne peut commencer que le jour suivant compte tenu des temps disponibles.',
    nature: 'TEMPORAL',
    severity: 'INFO',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: true,
  },

  // --- Réglementaire : limites confirmées ----------------------------------
  DRIVING_LIMIT_EXCEEDED: {
    title: 'Temps de conduite continu dépassé',
    explanation:
      'La durée de conduite continue autorisée serait dépassée avant une pause.',
    nature: 'REGULATORY',
    severity: 'BLOCKING',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: true,
  },
  WEEKLY_LIMIT_EXCEEDED: {
    title: 'Limite de conduite hebdomadaire dépassée',
    explanation: 'La limite de conduite hebdomadaire serait dépassée.',
    nature: 'REGULATORY',
    severity: 'BLOCKING',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: true,
  },
  FORTNIGHT_LIMIT_EXCEEDED: {
    title: 'Limite de conduite bi-hebdomadaire dépassée',
    explanation:
      'La limite de conduite sur deux semaines glissantes serait dépassée.',
    nature: 'REGULATORY',
    severity: 'BLOCKING',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: true,
  },
  INSUFFICIENT_DAILY_REST: {
    title: 'Repos journalier insuffisant',
    explanation:
      'Le repos journalier disponible est insuffisant pour poursuivre la mission.',
    nature: 'REGULATORY',
    severity: 'BLOCKING',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: true,
  },
  TOO_MANY_REDUCED_DAILY_RESTS: {
    title: 'Trop de repos journaliers réduits',
    explanation:
      'Le nombre de repos journaliers réduits autorisés entre deux repos hebdomadaires est atteint.',
    nature: 'REGULATORY',
    severity: 'BLOCKING',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: true,
  },
  MISSION_TIME_WINDOW_MISSED: {
    title: 'Fenêtre horaire manquée',
    explanation:
      'La mission ne peut pas être réalisée dans la fenêtre horaire imposée.',
    nature: 'TEMPORAL',
    severity: 'BLOCKING',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: true,
  },
  OVERLAPPING_ACTIVITY: {
    title: 'Activités qui se chevauchent',
    explanation:
      'Deux activités se chevauchent dans la chronologie calculée.',
    nature: 'TEMPORAL',
    severity: 'BLOCKING',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: true,
  },
  INCOHERENT_START_POSITION: {
    title: 'Position de départ incohérente',
    explanation:
      'La position de départ du couple est incohérente avec le point de chargement.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'RERUN_PREPARATION',
    demonstrated: false,
  },
  STALE_DRIVER_STATE: {
    title: 'État réglementaire expiré',
    explanation:
      'La déclaration réglementaire du chauffeur est trop ancienne : elle doit être renouvelée.',
    nature: 'REGULATORY',
    severity: 'CONDITIONAL',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: false,
  },
  MISSING_DRIVER_STATE: {
    title: 'État réglementaire du chauffeur non renseigné',
    explanation:
      'Aucune déclaration réglementaire valide n’est disponible pour ce chauffeur.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: false,
  },
  MISSING_TACHOGRAPH_HISTORY: {
    title: 'Historique de conduite insuffisant',
    explanation:
      'L’historique tachygraphe ou la déclaration du dispatcher est requis pour évaluer les temps.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: false,
  },
  MISSING_WEEKLY_REST_STATE: {
    title: 'Repos hebdomadaire non renseigné',
    explanation:
      'L’état du repos hebdomadaire du chauffeur n’est pas connu.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: false,
  },
  MISSING_ROUTE_DURATION: {
    title: 'Durée d’itinéraire manquante',
    explanation:
      'La durée de l’itinéraire n’est pas calculée pour cette transition.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'RECOMPUTE_ROUTE',
    demonstrated: false,
  },
  MISSING_POSITION: {
    title: 'Position de départ inconnue',
    explanation:
      'La position de départ du couple n’est pas connue : GPS ou base opérationnelle requis.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'RERUN_PREPARATION',
    demonstrated: false,
  },
  MISSING_MISSION_TIME: {
    title: 'Horaire de mission à confirmer',
    explanation:
      'Les horaires (date, fenêtre de chargement ou de livraison) de la mission ne sont pas confirmés.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: false,
  },
  INVALID_SPLIT_BREAK: {
    title: 'Pause fractionnée invalide',
    explanation:
      'La pause fractionnée déclarée ne respecte pas les durées minimales.',
    nature: 'REGULATORY',
    severity: 'CONDITIONAL',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: true,
  },
  INVALID_TIMELINE: {
    title: 'Chronologie invalide',
    explanation:
      'La chronologie calculée est invalide : les données temporelles doivent être vérifiées.',
    nature: 'TEMPORAL',
    severity: 'CONDITIONAL',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: false,
  },

  // --- Catégories de missions non affectées (UnassignedCategory) -----------
  INFEASIBLE: {
    title: 'Mission impossible',
    explanation:
      'Aucune affectation n’est réalisable avec les données démontrées.',
    nature: 'INCOMPATIBLE',
    severity: 'BLOCKING',
    action: null,
    demonstrated: true,
  },
  INDETERMINATE: {
    title: 'Mission à confirmer',
    explanation:
      'Des données manquantes empêchent de trancher : la mission reste conditionnelle.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: null,
    demonstrated: false,
  },
  DEFERRED: {
    title: 'Hors de la période sélectionnée',
    explanation:
      'La mission est située hors de la période sélectionnée pour la simulation.',
    nature: 'DEFERRED',
    severity: 'INFO',
    action: null,
    demonstrated: true,
  },
  LOWER_PRIORITY: {
    title: 'Priorité inférieure',
    explanation:
      'La mission a été écartée au profit d’une combinaison de priorité supérieure.',
    nature: 'INFO',
    severity: 'INFO',
    action: null,
    demonstrated: true,
  },
  NO_COMPATIBLE_PAIR: {
    title: 'Aucun couple compatible',
    explanation:
      'Aucun couple chauffeur / camion compatible n’a été trouvé pour cette mission.',
    nature: 'INCOMPATIBLE',
    severity: 'BLOCKING',
    action: null,
    demonstrated: true,
  },
  NO_COMPATIBLE_TRAILER: {
    title: 'Aucune remorque compatible',
    explanation:
      'Aucune remorque compatible n’est disponible pour cette mission.',
    nature: 'INCOMPATIBLE',
    severity: 'BLOCKING',
    action: 'EDIT_TRAILER_TECHNICAL',
    demonstrated: true,
  },
  TIME_WINDOW_IMPOSSIBLE: {
    title: 'Mission impossible dans la fenêtre horaire',
    explanation:
      'La mission ne peut pas être réalisée dans la fenêtre horaire imposée.',
    nature: 'TEMPORAL',
    severity: 'BLOCKING',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: true,
  },
  REGULATORY_LIMIT: {
    title: 'Limite réglementaire atteinte',
    explanation:
      'Une limite réglementaire confirmée empêche l’affectation de la mission.',
    nature: 'REGULATORY',
    severity: 'BLOCKING',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: true,
  },
  MISSING_REQUIRED_DATA: {
    title: 'Donnée requise manquante',
    explanation:
      'Une donnée indispensable est absente : la mission reste conditionnelle tant qu’elle n’est pas renseignée.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: null,
    demonstrated: false,
  },
  COMPUTATION_LIMIT_REACHED: {
    title: 'Limite de calcul atteinte',
    explanation:
      'La limite de calcul a été atteinte : le résultat est partiel, relancez la simulation.',
    nature: 'INFO',
    severity: 'INFO',
    action: 'RERUN_SIMULATION',
    demonstrated: false,
  },

  // --- Chaînes `missingData` de compatibilité ------------------------------
  truckType: {
    title: 'Ancienne catégorie camion non exploitable',
    explanation:
      'Ce champ historique est déprécié ; renseignez le besoin de remorque sur la mission.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: null,
    demonstrated: false,
  },
  capacity: {
    title: 'Ancienne capacité camion non exploitable',
    explanation:
      'Ce champ historique est déprécié ; la capacité utile appartient à la remorque.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: null,
    demonstrated: false,
  },
  trailerPosition: {
    title: 'Position de la remorque inconnue',
    explanation:
      'La position de départ de la remorque n’est pas connue.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_TRAILER_TECHNICAL',
    demonstrated: false,
  },
  trailerCapacity: {
    title: 'Capacité de la remorque inconnue',
    explanation:
      'La capacité utile de la remorque doit être renseignée pour confirmer la mission.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_TRAILER_TECHNICAL',
    demonstrated: false,
  },
  trailerCargoType: {
    title: 'Compatibilité marchandise inconnue',
    explanation:
      'Le type de marchandise accepté par la remorque n’est pas renseigné.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_TRAILER_TECHNICAL',
    demonstrated: false,
  },
  truckCouplingType: {
    title: 'Attelage du tracteur inconnu',
    explanation:
      'Le système d’attelage du tracteur doit être confirmé.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_TRUCK_TECHNICAL',
    demonstrated: false,
  },
  trailerCouplingType: {
    title: 'Attelage de la remorque inconnu',
    explanation:
      'Le système d’attelage de la remorque doit être confirmé.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_TRAILER_TECHNICAL',
    demonstrated: false,
  },
  requiredTrailerType: {
    title: 'Type de remorque invalide',
    explanation:
      'Le type demandé par la mission ne correspond à aucune valeur supportée.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: false,
  },
  requiredCapacityKg: {
    title: 'Capacité minimale invalide',
    explanation:
      'La capacité minimale demandée doit être un nombre strictement positif.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: false,
  },
  requiredCargoType: {
    title: 'Type de marchandise invalide',
    explanation:
      'Le type de marchandise demandé ne correspond à aucune valeur supportée.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: false,
  },
  regulatoryState: {
    title: 'État réglementaire du chauffeur non renseigné',
    explanation:
      'L’état réglementaire du chauffeur est incomplet.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_DRIVER_REGULATORY',
    demonstrated: false,
  },

  // --- Chaînes `missingData` de préparation de mission ---------------------
  PICKUP_ADDRESS: {
    title: 'Adresse de chargement à résoudre',
    explanation:
      'L’adresse de chargement n’a pas pu être résolue en coordonnées fiables.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'REVIEW_ADDRESS',
    demonstrated: false,
  },
  DELIVERY_ADDRESS: {
    title: 'Adresse de livraison à résoudre',
    explanation:
      'L’adresse de livraison n’a pas pu être résolue en coordonnées fiables.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'REVIEW_ADDRESS',
    demonstrated: false,
  },
  MISSION_ROUTE: {
    title: 'Itinéraire de mission manquant',
    explanation:
      'L’itinéraire chargé de la mission n’a pas été calculé.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'RECOMPUTE_ROUTE',
    demonstrated: false,
  },
  PICKUP_DATE: {
    title: 'Date de chargement manquante',
    explanation:
      'La date de chargement de la mission n’est pas renseignée.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_MISSION_SCHEDULE',
    demonstrated: false,
  },

  // --- Alias explicitement demandés (§7) -----------------------------------
  MISSING_TRUCK_TYPE: {
    title: 'Catégorie du camion non renseignée',
    explanation:
      'La catégorie du tracteur n’est pas renseignée : elle est nécessaire pour vérifier la compatibilité.',
    nature: 'MISSING_DATA',
    severity: 'CONDITIONAL',
    action: 'EDIT_TRUCK_TECHNICAL',
    demonstrated: false,
  },
}

const regulatoryFieldLabels: Record<string, string> = {
  drivingSinceValidBreakSeconds: 'Conduite depuis la dernière pause',
  dailyDrivingSeconds: 'Conduite journalière',
  weeklyDrivingSeconds: 'Conduite hebdomadaire',
  previousWeekDrivingSeconds: 'Conduite de la semaine précédente',
  dailyExtensionsUsedThisWeek: 'Extensions journalières utilisées',
  reducedDailyRestsUsedSinceWeeklyRest: 'Repos journaliers réduits utilisés',
  splitBreakFirstPartSeconds: 'Première partie de pause fractionnée',
  splitDailyRestFirstPartSeconds: 'Première partie de repos fractionné',
  lastValidRestEndedAt: 'Fin du dernier repos valide',
  dutyPeriodStartedAt: 'Début de la période de service',
  currentIsoWeek: 'Semaine réglementaire',
  weeklyRestDueAt: 'Échéance du repos hebdomadaire',
  weeklyRestCompensationDueSeconds: 'Compensation de repos restante',
}

/**
 * Traduit un code technique en libellé français. Un code inconnu retourne un
 * libellé générique sûr tout en conservant le code technique d'origine pour
 * les détails et les journaux.
 */
export function translateReasonCode(code: string): ReasonLabel {
  const definition = reasonDefinitions[code]
  if (definition) {
    return { code, ...definition }
  }
  if (code.startsWith('regulatory.')) {
    const field = code.slice('regulatory.'.length)
    const label = regulatoryFieldLabels[field] ?? 'Donnée réglementaire'
    return {
      code,
      title: `${label} à renseigner`,
      explanation:
        'Cette valeur est inconnue. Les données connues restent prises en compte, mais la proposition nécessite une confirmation.',
      nature: 'MISSING_DATA',
      severity: 'CONDITIONAL',
      action: 'EDIT_DRIVER_REGULATORY',
      demonstrated: false,
    }
  }
  return {
    code,
    title: 'Raison technique non reconnue',
    explanation:
      'Le moteur a renvoyé une raison non reconnue par l’interface. Le code technique est conservé pour analyse.',
    nature: 'UNKNOWN',
    severity: 'CONDITIONAL',
    action: null,
    demonstrated: false,
  }
}

/** Indique si un code est explicitement connu du mapping (hors fallback). */
export function isKnownReasonCode(code: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(reasonDefinitions, code) ||
    code.startsWith('regulatory.')
  )
}

/** Traduit une liste de codes en déduplicant par code. */
export function translateReasonCodes(codes: readonly string[]): ReasonLabel[] {
  const seen = new Set<string>()
  const labels: ReasonLabel[] = []
  for (const code of codes) {
    if (seen.has(code)) continue
    seen.add(code)
    labels.push(translateReasonCode(code))
  }
  return labels
}
