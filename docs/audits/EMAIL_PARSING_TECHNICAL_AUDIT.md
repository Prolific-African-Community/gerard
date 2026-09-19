# Audit technique — Parsing des e-mails

> Audit statique du dépôt au 28 juillet 2026. Aucun serveur, accès IMAP, accès
> PostgreSQL, commande Prisma, seed, migration ou jeu de données n’a été lancé.

## 1. Résumé exécutif

Le système récupère les derniers messages de l’INBOX par IMAP, transforme leur
MIME en un objet commun, sélectionne un profil client actif, puis applique dans
cet ordre un parseur Fruytier, un parseur Hydro ou un fallback transport
générique. Deux clients disposent d’un traitement dédié :

- **FRUYTIER S.A.** : un ordre structuré correspond normalement à une mission ;
- **HYDRO** : un message peut produire plusieurs missions et quatre formats
  sont effectivement reconnus (voyages détaillés, demandes de capacité,
  prévisions de tonnage, format court).

Le contrat `MissionImportPreview` couvre **60 propriétés typées**, dont les
métadonnées de l’e-mail, les données opérationnelles, les coordonnées, les
exigences, la facturation, la confiance, les lacunes et l’état de doublon.
Cependant, aucune suite automatisée ne teste directement le MIME, la sélection
des parseurs ou leurs extractions. Le dépôt contient seulement un script manuel
de connexion IMAP et une interception UI de démonstration.

Principaux constats :

1. les parseurs sont choisis par règles codées en dur ; `parserHints` n’est que
   partiellement interprété ;
2. le parseur MIME ignore les pièces jointes et certains cas MIME complexes ;
3. le type de remorque extrait (`requiredTrailerType`) n’est pas transmis lors
   de la création depuis le panneau d’import ;
4. la création est directe : il n’existe pas d’étape dédiée de correction de la
   prévisualisation avant écriture ;
5. le contenu texte et HTML de l’e-mail est conservé sans politique de
   rétention ou masquage visible ;
6. la déduplication existe mais repose sur plusieurs identifiants dont
   l’unicité n’est pas uniformément garantie en base ;
7. les dates sans année/heure dépendent de l’année courante ou de l’e-mail et du
   fuseau du processus Node.

## 2. Architecture générale

Flux statique observé :

```text
GET /api/dispatch/mail-imports
  → lecture configuration MAIL_IMPORT_*
  → ImapFlow / INBOX en lecture seule
  → parseRawMessage (MIME → NormalizedMailMessage)
  → profils ClientProfile actifs, triés par nom
  → parseMissionEmails
      → nettoyage
      → profil par domaine/alias
      → rejet du bruit
      → Fruytier | Hydro | fallback
      → normalisation des références et confiance
  → suppression des imports ignorés
  → recherche des missions déjà créées
  → MissionImportPreview[]
  → ImportedMissionsPanel
      → voir l’e-mail | ignorer | créer la mission
  → POST /api/dispatch/create-mission
      → validation/normalisation
      → transaction Mission + MissionEvent + MissionSourceEmail
      → prepareMission
```

Le code métier se répartit entre :

- `lib/mail/imap-client.ts` : configuration, récupération et décodage MIME ;
- `lib/mail/mission-email-parser.ts` : orchestration et priorité ;
- `lib/mail/parser-utils.ts` : nettoyage, références, dates, montants,
  confiance et profils ;
- `lib/mail/parsers/*.ts` : parseurs Fruytier, Hydro et fallback ;
- `lib/dispatch/client-profiles.ts` : contrat et valeurs par défaut des profils ;
- routes `pages/api/dispatch/*` : consultation, ignorance et création ;
- `components/dispatch/*` : prévisualisation, profils et e-mail source.

## 3. Flux IMAP et récupération des messages

### Configuration

Variables lues :

| Variable | Rôle | Défaut |
|---|---|---|
| `MAIL_IMPORT_PROVIDER` | fournisseur activé | `imap` |
| `MAIL_IMPORT_HOST` | hôte IMAP | obligatoire |
| `MAIL_IMPORT_PORT` | port | `993` |
| `MAIL_IMPORT_SECURE` | TLS direct | `true` |
| `MAIL_IMPORT_USER` | utilisateur | obligatoire |
| `MAIL_IMPORT_PASSWORD` | mot de passe | obligatoire |
| `MAIL_IMPORT_LIMIT` | nombre de messages récents | `50` |

`getImapConfig()` retourne `null` si hôte, utilisateur ou mot de passe manque.
La route répond alors HTTP 200 avec `connected: false` et un message
fonctionnel. Tout fournisseur autre que `imap` est déclaré non supporté.

### Récupération et MIME

`fetchRecentImapMessages()` :

- ouvre `INBOX` avec `{ readOnly: true }` ;
- calcule la plage des `limit` derniers numéros de séquence ;
- demande UID, enveloppe, source brute et date interne ;
- analyse les en-têtes repliés, `Message-ID`, sujet, From, To et Cc ;
- décode les encoded words Base64/Quoted-Printable ;
- parcourt récursivement les multipart avec boundary ;
- conserve `text/plain` et `text/html`, et convertit l’HTML en texte si
  aucun texte brut n’est fourni ;
- ignore tout MIME non textuel, donc les pièces jointes ;
- produit un aperçu texte de 220 caractères ;
- trie les messages par date décroissante ;
- ferme la connexion dans `finally`.

L’identifiant est le `Message-ID` sans chevrons, sinon
`imap:<uid-ou-numéro-de-séquence>`. Une date interne absente ou invalide est
remplacée par l’heure courante, ce qui rend alors le résultat non déterministe.

Limites MIME : découpage d’adresses par virgule, prise en charge sommaire des
charsets, aucune extraction de pièce jointe/PDF, aucun traitement explicite des
messages encapsulés `message/rfc822`, et reconstruction manuelle plutôt qu’une
bibliothèque MIME spécialisée.

## 4. Profils clients

### Modèle et administration

`ClientProfile` stocke identité, domaines, contacts, facturation, types
camion/remorque par défaut, pré-annonce, exigences, contacts par défaut, notes,
`parserHints`, activation et timestamps. Les profils actifs sont chargés par
ordre alphabétique.

L’interface `ClientProfilesPanel` permet la création, l’édition et la
désactivation. Elle expose nom, identité, domaines, contacts, valeurs
opérationnelles et seulement quatre familles de hints éditables :
`knownReferencePrefixes`, `subjectPatterns`, `pickupKeywords` et
`deliveryKeywords`.

### Profils fournis par le seed

Le seed définit deux profils :

- **FRUYTIER S.A.** : domaine `fruytier.com`, contacts de facturation,
  exigences de sécurité/chargement, mapping `1OT`/`1CT`, labels de prix et
  coordonnées nulles à ignorer ;
- **HYDRO** : domaine `hydro.com`, alias, mult missions, formats, regex de
  semaine/voyage/tonnage/capacité, sites de chargement et valeurs par défaut.

### Usage réel de `parserHints`

Sont effectivement lus dans le flux de parsing :

- `emailDomains` pour la détection ;
- `clientAliases` pour une recherche textuelle ;
- `defaultPickupSites.Clervaux` par le parseur Hydro.

Les parseurs ne consomment pas dynamiquement la majorité des autres hints
déclarés (`parserType`, `subjectPatterns`, `pickupKeywords`,
`deliveryKeywords`, `referencePatterns`, `formats`, `weekPattern`,
`detailedTripPattern`, `tonnageLinePattern`, `capacityLinePattern`,
`truckTypeMap`, `priceLabels`, etc.). Les regex correspondantes sont
principalement recodées dans les fichiers dédiés. Modifier ces hints dans
l’interface ne modifie donc pas le comportement attendu.

## 5. Détection et sélection des parseurs

### Profil client

`findMatchingClientProfileForEmail()` applique la première correspondance :

1. domaine exact de l’expéditeur contre `emailDomains` du profil et des hints ;
2. sinon présence d’un alias (`name`, `legalName`, `displayName` ou
   `parserHints.clientAliases`) dans sujet + corps.

Les profils étant triés par nom, il n’existe pas de priorité métier explicite.
L’API empêche toutefois les doublons de domaine entre profils actifs.

### Filtre de bruit

Un message générique est ignoré s’il est très court (moins de 80 caractères)
sans au moins deux signaux transport, ou si un transfert ne contient pas au
moins trois lignes significatives et aucun signal transport. Fruytier/Hydro et
les sujets `Possible to load` / `Chargements S<n>` contournent ce filtre.

### Priorité

1. Fruytier si profil exact, domaine, marque dans le sujet ou label
   « Numéro d’expédition » ;
2. Hydro si profil exact, domaine, raison sociale, `Chargements S` ou
   `Possible to load` ; si aucun sous-format Hydro ne produit de résultat,
   poursuite vers le fallback ;
3. fallback transport générique.

Les noms exacts de profil `FRUYTIER S.A.` et `HYDRO` ont donc une importance
fonctionnelle. Il n’existe ni registre de parseurs ni priorité configurable.

## 6. Parseurs par client

### FRUYTIER S.A.

**Reconnaissance.** Profil exact, domaine `fruytier.com`, sujet contenant
`FRUYTIER S.A.` ou corps avec `Numéro d’expédition`.

**Rejets.** Sujet de créneau replanifié, demande de contacter le client,
référence non conforme à `[A-Z]{3}-FR\d{2}-\d{6}-\d+`, absence des blocs
chargement/déchargement, ou blocs adresse vides.

**Extraction.**

- une mission par e-mail ;
- numéro d’expédition comme référence client ;
- sections `DATE DE CHARGEMENT` et `DATE DE DECHARGEMENT(S)` ;
- villes, adresses, dates/heures, contacts, téléphones et coordonnées ;
- code camion `1OT` → camion plateau/remorque plateau ;
- code camion `1CT` → camion bâché/remorque bâchée ;
- prix initial, supplément carburant montant/taux, total à facturer ;
- conditions de paiement et lien de rendez-vous ;
- pré-annonce obligatoire ;
- exigences : sangles, coins, remorque vide, veste, rendez-vous et annonce des
  plaques ;
- facturation Fruytier et adresse dédiée ;
- notes de rendez-vous/livraison.

Les champs critiques signalés sont référence, dates/adresses, type camion et
prix. Les coordonnées de livraison sont seulement facultatives. La confiance
peut être forcée à 0,92 si les données structurantes sont présentes.

### HYDRO

**Reconnaissance.** Profil exact, domaine `hydro.com`, raison sociale dans le
texte, ou sujets `Chargements S` / `Possible to load`.

**Valeurs communes.** Client HYDRO, départ par défaut
`Clervaux / Eselborn`, adresse de Clervaux issue du profil ou constante,
camion/remorque et exigences fournis par le profil.

#### Voyages détaillés

Reconnaît les en-têtes `site (ville):`, un bloc `Adresse de livraison`, puis
une ligne de type `1 camion <jour> pour livraison <jour> <date>: <référence>`.
Extrait jours, date de livraison, date de chargement inférée, référence Hydro,
adresse/ville de livraison et notes d’horaire. L’adresse et le prix manquants
sont signalés.

#### Demandes de capacité

Reconnaît chaque ligne `Nx <destination>`. Produit N prévisualisations avec
référence stable générée, date de sujet si disponible et destination. Adresse,
prix, livraison et référence client officielle sont à compléter.

#### Prévisions hebdomadaires de tonnage

Reconnaît une semaine/année puis chaque ligne `<nombre>-t <destination>`.
Produit une mission prévisionnelle avec tonnage dans `requirements`. Dates,
adresse et prix sont obligatoirement signalés comme manquants.

#### Format court

Reconnaît `1 camion <jour> - <référence Hydro>`, calcule le jour depuis la
semaine ISO du sujet et fixe 08:00. Livraison, adresse et prix restent à
compléter.

L’ordre interne est : détaillé, capacité, tonnage, court. Un seul sous-format
est retenu par message.

## 7. Parseur générique et fallback

Le fallback exige au moins deux mots-signaux parmi transport, chargement,
livraison, camion, remorque, enlèvement, pickup, delivery, prix, ordre,
destination et planning.

Il extrait :

- itinéraire `A -> B`, `A vers B`, `A to B` ou `de A à B` ;
- à défaut, lignes étiquetées chargement/livraison puis une liste codée en dur
  de 19 villes ;
- référence métier générique ou référence stable dérivée du client, sujet et
  date ;
- prix suivi de EUR/€ ;
- type camion par mots-clés (tautliner/bâché, plateau, frigorifique,
  container) ;
- dates de chargement/livraison par labels français/anglais et date du sujet ;
- expéditeur comme contact client ;
- extrait nettoyé de 320 caractères comme note.

Le fallback ne renseigne pas les adresses, contacts opérationnels, quantité,
poids, marchandise, devise autre qu’EUR, exigences détaillées ou pièces
jointes. Les villes sont critiques ; dates et prix sont facultatifs. La
confiance est plafonnée fonctionnellement à un niveau bas (minimum affiché
0,42 après pénalité), ce qui traduit une prévisualisation à confirmer.

## 8. Mapping exhaustif des champs

Le contrat contient 60 propriétés. La matrice suivante regroupe leur origine :

| Groupe | Champs | Source |
|---|---|---|
| Identité preview | `id`, `source`, `provider`, `previewKey` | orchestration |
| Identité e-mail | `sourceEmailId`, `messageId` | Message-ID ou UID/séquence |
| Expéditeur/destinataires | `sourceEmailFrom`, nom, adresse, To, Cc | en-têtes MIME |
| Contenu e-mail | sujet, aperçu, texte nettoyé, texte brut, HTML brut | MIME/nettoyage |
| Temporalité source | `receivedAt` | IMAP `internalDate` |
| Qualité | `confidence`, `missingFields`, `optionalMissingFields` | parseur/helpers |
| Références | `reference`, `referenceSource`, `clientReference` | regex/génération/sujet |
| Présentation | `title`, `shortLabel`, `cleanedSubject` | parseur/nettoyage |
| Client | `clientName` | profil, parseur ou expéditeur |
| Chargement | date, ville, adresse, contact, téléphone, e-mail, lat/lng | parseur |
| Livraison | date, ville, adresse, contact, téléphone, e-mail, lat/lng | parseur |
| Route | `estimatedKm`, distance/durée route | parseur si présent ; généralement absent |
| Matériel | `requiredTruckType`, `requiredTrailerType` | Fruytier/profil/mots-clés |
| Prix | montant, devise, conditions | e-mail/profil |
| Pré-annonce | requise, envoyée, date | parseur/profil |
| Données structurées | `requirements`, `contacts`, `billingInfo` | parseur + profil |
| Notes | `notes` | parseur/profil |
| Déduplication UI | `alreadyCreated`, `createdMissionId` | requête Mission |

Couverture demandée :

- **quantité/poids** : seul le tonnage Hydro est stocké dans
  `requirements.tonnage` ; pas de modèle générique ;
- **marchandise** : non extraite ;
- **contraintes** : riches pour Fruytier, valeurs de profil pour Hydro,
  presque absentes en fallback ;
- **devise** : EUR uniquement dans les parseurs actuels ;
- **pièces jointes** : non extraites et non stockées.

Point de perte : `requiredTrailerType` existe dans la preview et est calculé
pour Fruytier/profil, mais `handleCreateMission()` ne l’inclut pas dans le
payload de création. Le modèle `Mission` ne possède d’ailleurs que
`requiredTruckType`; les exigences remorque modernes semblent portées par
`requirements`, sans conversion ici.

## 9. Normalisation et validation

Le nettoyage retire préfixes RE/FW/FWD/TR, balises simples, CID, signatures et
mentions légales connues, puis normalise espaces/lignes. Les références
supportent le motif Fruytier, le motif Hydro et des labels génériques.

Les montants gèrent espaces, virgule et point. Les coordonnées sont validées
par paire ; `(0,0)` est rejeté lors de la création. Les dates acceptent
jour/mois, année et heure facultatives ; l’heure par défaut est 08:00. Les
dates sont construites en heure locale puis converties en ISO, donc le résultat
dépend du fuseau serveur. Une année absente vient de l’e-mail, de la semaine ou
de l’année courante.

Les valeurs du profil sont fusionnées avant la preview : l’extraction explicite
prime sur les valeurs par défaut, sauf les objets imbriqués fusionnés
superficiellement. La confiance part de 0,35 et valorise référence, dates,
adresses, type camion, prix et pré-annonce, avec pénalité pour champs critiques.

La route de création repasse par `validateAndNormalizeMissionPayload`, contrôle
types, dates, nombres, coordonnées, JSON, statut et exigences remorque. Les
champs minimaux sont référence, client et villes. Une erreur détaillée peut
venir du validateur, mais `parseBody()` retombe sur un message générique pour
plusieurs invalidités.

## 10. Création des missions et idempotence

Avant affichage, la route recherche les missions existantes par :

1. `sourceEmailId` ;
2. `clientReference` ;
3. `reference`, sauf si la référence vient du sujet.

Elle marque alors la preview `alreadyCreated`. Les imports ignorés sont exclus
par leur `previewKey`. Pour un e-mail multi-missions, l’orchestrateur suffixe
l’identifiant avec `#1`, `#2`, etc.

La création utilise une transaction :

- insertion de `Mission` ;
- événement `CREATED` ;
- upsert de `MissionSourceEmail` si un payload source existe.

`Mission.reference` est unique et `MissionSourceEmail.missionId` est unique.
En cas de `P2002`, une recherche retrouve la mission et peut encore rattacher
l’e-mail source, puis renvoie 409. Après commit, `prepareMission()` s’exécute ;
son échec est journalisé mais ne supprime pas la mission.

Limites d’idempotence :

- `Mission.sourceEmailId` est indexé mais non unique ;
- `Mission.clientReference` n’est ni unique ni indexé ;
- `MissionSourceEmail.sourceEmailId` et `messageId` sont indexés mais non
  uniques ;
- le fallback peut changer si date reçue/année ou sujet change ;
- la création et le marquage ignoré sont deux mécanismes distincts ;
- une ignorance est persistante et idempotente par upsert, sans action UI de
  restauration ;
- la route charge tous les `IgnoredMailImport`, sans filtrage fournisseur ou
  période.

## 11. Interface et permissions

`ImportedMissionsPanel` existe en desktop et mobile. Il est rendu seulement si
l’utilisateur possède à la fois `imports.view` et `missions.create`.

Actions :

- **Rafraîchir** : relance la route IMAP ;
- **Voir email** : affiche métadonnées et texte nettoyé/brut ;
- **Ignorer** : POST idempotent et retrait local immédiat ;
- **Créer mission** : création directe depuis la preview ;
- indicateurs de confiance, doublon, lacunes, coordonnées, facturation,
  pré-annonce et exigences.

Il n’existe pas de formulaire intermédiaire de correction manuelle de la
preview : la correction se fait après création via l’édition normale de la
mission. L’échec de l’API d’ignorance est volontairement avalé et l’élément est
quand même masqué localement, donc il peut réapparaître après rafraîchissement.

Permissions fixes :

| Action | Permission serveur | Rôles actuels |
|---|---|---|
| Lire les imports | `imports.view` | ADMIN, DISPATCHER, SECRETARY |
| Ignorer | `imports.manage` | ADMIN, DISPATCHER, SECRETARY |
| Créer | `missions.create` | ADMIN, DISPATCHER, SECRETARY |
| Lire l’e-mail d’une mission | `missions.view` | rôles disposant de cette permission |
| Lire profils | `customers.view` | selon matrice |
| Gérer profils | `customers.manage` | ADMIN, DISPATCHER, SECRETARY |

`PARK_MANAGER` et `DRIVER` n’ont pas accès aux imports. L’interface ne reçoit
pas de rôle comme source d’autorité ; les routes utilisent les helpers centraux.

## 12. Modèle de données

### `ClientProfile`

Référentiel générique en JSON pour domaines, contacts, facturation, exigences
et hints. Nom unique ; indexes nom/activation.

### `Mission`

Stocke les champs opérationnels normalisés et trois colonnes source historiques :
`sourceEmailId`, `sourceEmailFrom`, `sourceEmailSubject`. Référence unique.

### `MissionSourceEmail`

Relation optionnelle un-à-un avec Mission : source, fournisseur, identifiants,
sujet, expéditeur/destinataires, date, aperçu, texte nettoyé, texte brut et HTML
brut. `onDelete: SetNull` conserve potentiellement l’e-mail après suppression
de la mission.

### `IgnoredMailImport`

Stocke identifiants source/message/preview, référence, sujet, expéditeur,
horodatage et utilisateur ayant ignoré. `previewKey` est unique. `ignoredBy`
n’a pas de relation Prisma vers User.

Aucune pièce jointe, nom de fichier, hash de contenu, statut de parsing,
version de parseur ou motif d’erreur n’est persisté.

## 13. Tests existants

### Couverture détectée

- **0 test automatisé dédié** au MIME, à la détection, à Fruytier, à Hydro, au
  fallback, à la déduplication ou à l’UI d’import parmi les 24 fichiers de
  `tests/` ;
- **1 script manuel** `scripts/test-imap-import.ts` : valide configuration,
  connexion et récupération des trois derniers sujets, mais pas le parsing ;
- **1 mock de capture** dans `handoff_captures/take-shots.ts` qui intercepte la
  route des imports pour une démonstration visuelle, sans assertion métier.

### Cas manquants prioritaires

- MIME multipart, HTML seul, encodages, pièces jointes et adresses multiples ;
- ordre/priorité des profils et domaines/alias concurrents ;
- chaque rejet Fruytier et mapping `1OT`/`1CT` ;
- quatre formats Hydro et plusieurs missions par message ;
- fallback positif/négatif, villes et références ;
- dates à la limite d’année/semaine et fuseaux ;
- fusion des valeurs de profil et consommation réelle des hints ;
- stabilité des identifiants, doublons et imports ignorés ;
- préservation du type remorque ;
- permissions 401/403 et erreurs IMAP ;
- persistance puis restitution de l’e-mail source ;
- prévention de fuite de contenu dans les logs.

## 14. Sécurité et confidentialité

Points positifs :

- secret IMAP uniquement par variable d’environnement ;
- mot de passe absent de `.env.example` et jamais journalisé explicitement ;
- boîte ouverte en lecture seule ;
- routes protégées par permissions centralisées ;
- Prisma paramètre les requêtes ;
- HTML affiché dans un `<pre>` texte, pas injecté comme HTML.

Risques :

- logs de connexion/erreur contenant hôte, port, utilisateur, stack, code et
  réponse serveur ; une réponse IMAP pourrait contenir des détails sensibles ;
- script manuel affichant hôte, utilisateur et sujets ;
- stockage durable des adresses, Cc, corps brut/nettoyé et HTML, sans durée de
  rétention, chiffrement applicatif, classification ni mécanisme d’effacement
  visible ;
- copie presse-papiers du contenu source ;
- conservation possible de `MissionSourceEmail` après suppression de Mission ;
- aucune limite explicite de taille du message avant stockage ;
- pièces jointes ignorées, mais leur absence n’est pas signalée à l’opérateur ;
- aucune neutralisation documentée de données personnelles dans les notes
  extraites ;
- la route source-email autorise tout titulaire de `missions.view`, ce qui
  élargit l’accès au contenu complet au-delà de `imports.view`.

## 15. Limites et risques

1. `parserHints` donne une impression de configuration dynamique supérieure à
   son effet réel.
2. La sélection dépend de noms exacts de profils et d’un ordre alphabétique.
3. Aucun test de non-régression ne protège les formats clients.
4. Le parseur MIME maison est fragile face aux e-mails réels complexes.
5. Les pièces jointes et ordres PDF sont invisibles.
6. `requiredTrailerType` est perdu dans le flux de création.
7. La création directe permet des missions incomplètes sans correction
   préalable dédiée.
8. La confiance est heuristique et recalculée par l’orchestrateur sur la preview
   antérieure, ce qui peut écraser certains ajustements locaux du parseur.
9. Les dates par défaut et fuseaux peuvent déplacer une heure ou une journée.
10. La déduplication n’est pas adossée à une clé source unique en base.
11. L’ignorance ne propose ni annulation ni audit relationnel vers User.
12. Les erreurs sont souvent ramenées à un statut HTTP 200 `connected: false`,
    ce qui complique la supervision.
13. Le fallback ne couvre qu’un faible sous-ensemble des champs demandés.
14. Les valeurs « À confirmer » sont de vraies chaînes métier temporaires,
    susceptibles de se propager à la mission.

## 16. Recommandations prioritaires

1. Ajouter des tests unitaires par fixture anonymisée pour MIME, Fruytier,
   chaque format Hydro, fallback, dates et références.
2. Ajouter des tests d’intégration statiquement isolés pour déduplication,
   ignorance, permissions et persistance source.
3. Remplacer le MIME maison par une bibliothèque éprouvée et signaler les
   pièces jointes non traitées.
4. Introduire un registre explicite de parseurs avec priorité, version et motif
   de sélection ; rendre les hints réellement exécutables ou retirer ceux qui
   sont trompeurs.
5. Corriger le transport de `requiredTrailerType` vers le modèle d’exigences
   mission sans dupliquer la sémantique existante.
6. Ajouter une étape de correction/validation avant création et afficher les
   champs critiques avec libellés métier.
7. Définir une clé d’idempotence source robuste et une contrainte adaptée,
   tenant compte des messages multi-missions.
8. Normaliser les dates dans un fuseau métier explicite et tester les semaines
   ISO/années.
9. Définir rétention, accès, purge et minimisation des corps bruts/HTML ;
   réduire les détails sensibles des logs.
10. Ajouter restauration des imports ignorés et retour d’erreur fiable si
    l’ignorance serveur échoue.

### Annexe A — Matrice des parseurs

| Client / format | Détection | Parseur | Champs extraits | Valeurs par défaut | Tests |
|---|---|---|---|---|---|
| Fruytier structuré | profil, `fruytier.com`, raison sociale, numéro d’expédition | `parseFruytierEmail` | référence, départ/arrivée, dates, contacts, coordonnées, matériel, prix/carburant, paiement, RDV, exigences, facturation | pré-annonce, sécurité, facturation/profil | aucun |
| Hydro voyages détaillés | profil/domaine/sujet, puis ligne voyage | `parseDetailedTrips` via `parseHydroEmail` | référence, jours/dates, site de départ, adresse/ville livraison, notes horaires | Clervaux, matériel/exigences/profil | aucun |
| Hydro capacité | ligne `Nx destination` | `parseCapacityRequests` | N références générées, date sujet, destination | Clervaux, matériel/exigences/profil | aucun |
| Hydro tonnage | semaine + ligne `N-t destination` | `parseWeeklyTonnage` | référence générée, destination, tonnage | Clervaux, matériel/exigences/profil | aucun |
| Hydro court | `1 camion jour - REF` | `parseShortFormat` | référence, jour/semaine, date chargement | 08:00, Clervaux, matériel/exigences/profil | aucun |
| Transport générique | au moins deux signaux transport | `parseFallbackTransportEmail` | référence, villes, dates, prix EUR, type camion, expéditeur, note | profil puis « À confirmer » | aucun |

### Annexe B — Matrice des fichiers

| Fichier | Fonction / modèle | Rôle | Spécifique client ou générique |
|---|---|---|---|
| `lib/mail/imap-client.ts` | `getImapConfig`, `fetchRecentImapMessages`, MIME | récupération/normalisation | générique |
| `lib/mail/types.ts` | `NormalizedMailMessage`, `MissionImportPreview` | contrats | générique |
| `lib/mail/mission-email-parser.ts` | `parseMissionEmail(s)` | orchestration/priorité | générique |
| `lib/mail/parser-utils.ts` | nettoyage, références, profil, dates, confiance | helpers | générique |
| `lib/mail/parsers/fruytier-parser.ts` | `canParseFruytierEmail`, `parseFruytierEmail` | ordre structuré | Fruytier |
| `lib/mail/parsers/hydro-parser.ts` | `canParseHydroEmail`, `parseHydroEmail` | quatre formats | Hydro |
| `lib/mail/parsers/fallback-parser.ts` | `parseFallbackTransportEmail` | dernier recours | générique |
| `lib/dispatch/client-profiles.ts` | types, normalisation, valeurs par défaut | profils | générique |
| `pages/api/dispatch/mail-imports.ts` | GET imports | IMAP, parsing, ignorance, doublons | générique |
| `pages/api/dispatch/imports/ignore.ts` | POST ignore | ignorance idempotente | générique |
| `pages/api/dispatch/create-mission.ts` | POST création | validation, transaction, préparation | générique |
| `lib/mail/mission-source-email.ts` | upsert/response | persistance source | générique |
| `pages/api/dispatch/missions/[id]/source-email.ts` | GET source | consultation du mail lié | générique |
| `pages/api/dispatch/client-profiles/index.ts` | GET/POST | liste/création profils | générique |
| `pages/api/dispatch/client-profiles/[id].ts` | GET/PUT/DELETE | lecture/édition/désactivation | générique |
| `components/dispatch/ImportedMissionsPanel.tsx` | panneau et cartes | preview/créer/ignorer/rafraîchir | générique |
| `components/dispatch/SourceEmailModal.tsx` | modal source | lecture/copie brut-nettoyé | générique |
| `components/dispatch/ClientProfilesPanel.tsx` | référentiel UI | édition profils/hints partiels | générique |
| `components/dispatch/WeeklyDispatchBoard.tsx` | intégration desktop | ouverture panneaux | générique |
| `components/dispatch/mobile/MobileDispatchView.tsx` | intégration mobile | ouverture imports | générique |
| `prisma/schema.prisma` | 4 modèles concernés | stockage | générique |
| `prisma/seed.ts` | profils initiaux | Fruytier/Hydro | spécifique |
| migrations `20260603190705`, `20260603200000`, `20260604001441` | tables/index/relation | historique schéma | générique |
| `scripts/test-imap-import.ts` | test manuel connexion | diagnostic | générique |
| `handoff_captures/take-shots.ts` | mock route imports | démonstration UI | générique |

