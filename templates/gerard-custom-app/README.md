# Gerard Custom application template

Ce template consomme une version compatible de `@prolific/gerard-core`; il ne copie jamais le moteur. Adaptez `application.tsx`, le manifest et les extensions, puis fournissez une DB dédiée.

Ordre DB : appliquer les migrations Core fournies par la version du Core, puis les migrations Custom placées dans `prisma/custom-migrations`. Une migration Custom ne modifie jamais destructivement une table Core sans revue explicite et stratégie de compatibilité.

Les secrets restent hors Git. Les intégrations Custom s'enregistrent dans la registry typée et conservent le scope tenant, l'activation et `secretRef` du Core.
