-- Recipes are imported with a build's items. Forgetting the imported build, and when the build check
-- last ran, makes the next start import the current build again, recipes included.
DELETE FROM "game_builds";
--> statement-breakpoint
DELETE FROM "job_runs" WHERE "job_name" = 'gamedata.check_build';
