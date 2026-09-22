# Gerard Core feature parity

| Feature | Core | Novotralux | Custom override | Validation |
| --- | --- | --- | --- | --- |
| Auth / Users | oui | activé | aucun | session + memberships |
| Missions / Planning | oui | activé | aucun | compteurs + API |
| Drivers / Trucks / Trailers | oui | activé | aucun | compteurs + API |
| Tracking / Map | oui | activé | aucun | API |
| Fleet / Park | oui | activé | aucun | API |
| Profitability | oui | activé | aucun | API |
| Invoicing / Documents | oui | activé | branding légal tenant | API + URLs historiques |
| Maintenance | oui | activé | provider SL enregistré | API, provider désactivé |
| Mail source | oui | activé | MAIL_INTAKE enregistré | API, provider désactivé |
| Intelligence / Assistant | oui | activé | aucune policy spécifique | tests Core |
| Audit / RouteCache | oui | activé | aucun | tests Core, appels Google interdits |

La référence client reste primaire : le legacy et Gerard Standard ont le même comportement, donc aucun override artificiel n'est appliqué.
