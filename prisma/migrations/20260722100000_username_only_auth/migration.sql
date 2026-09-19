-- Email is retained only as optional compatibility data.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- Remove only explicitly authorized test accounts, and fail if they acquired real links/history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "User" u
    WHERE (u."username" IN (
      'run1.admin.test@novotralux.local', 'consolidation_admin',
      'consolidation_dispatcher', 'consolidation_secretary', 'consolidation_park'
    ) OR u."email" IN (
      'run1.admin.test@novotralux.local', 'consolidation.admin.test@novotralux.local',
      'consolidation.dispatcher.test@novotralux.local', 'consolidation.secretary.test@novotralux.local',
      'consolidation.park.test@novotralux.local'
    ))
    AND (u."driverId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "MissionEvent" e WHERE e."actorId" = u."id")
      OR EXISTS (SELECT 1 FROM "TruckEvent" e WHERE e."actorId" = u."id"))
  ) THEN
    RAISE EXCEPTION 'Refusing to delete a test-labelled account linked to business data';
  END IF;
END $$;

DELETE FROM "User"
WHERE "username" IN (
  'run1.admin.test@novotralux.local', 'consolidation_admin',
  'consolidation_dispatcher', 'consolidation_secretary', 'consolidation_park'
)
OR "email" IN (
  'run1.admin.test@novotralux.local', 'consolidation.admin.test@novotralux.local',
  'consolidation.dispatcher.test@novotralux.local', 'consolidation.secretary.test@novotralux.local',
  'consolidation.park.test@novotralux.local'
);

-- Abort rather than guessing if retained legacy data violates the target username rules.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "User"
    WHERE "username" IS NULL
       OR "username" <> lower(trim("username"))
       OR "username" !~ '^[a-z0-9][a-z0-9._-]*$'
  ) THEN
    RAISE EXCEPTION 'Invalid legacy username: migration requires manual resolution';
  END IF;
END $$;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_lower_key" ON "User" (lower("username"));
ALTER TABLE "User" ADD CONSTRAINT "User_username_simple_check"
CHECK ("username" = lower(trim("username")) AND "username" ~ '^[a-z0-9][a-z0-9._-]*$');

-- These addresses were generated only to satisfy the former required column.
UPDATE "User"
SET "email" = NULL
WHERE lower("email") LIKE '%@novotralux.local'
   OR lower("email") LIKE '%@novotralux.driver.local'
   OR lower("email") LIKE '%@novotralux.com';
