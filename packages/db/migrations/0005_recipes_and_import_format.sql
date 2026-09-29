CREATE TABLE "recipe_reagents" (
	"spell_id" integer NOT NULL,
	"position" integer NOT NULL,
	"item_id" integer NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "recipe_reagents_spell_id_position_pk" PRIMARY KEY("spell_id","position")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"spell_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"professions" text[] NOT NULL,
	"item_id" integer NOT NULL,
	"item_count" integer NOT NULL,
	"yellow_at" integer,
	"grey_at" integer,
	"taught_by" integer[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_builds" ADD COLUMN "import_format" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_reagents" ADD CONSTRAINT "recipe_reagents_spell_id_recipes_spell_id_fk" FOREIGN KEY ("spell_id") REFERENCES "public"."recipes"("spell_id") ON DELETE cascade ON UPDATE no action;