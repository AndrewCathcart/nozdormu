CREATE TABLE "dungeon_bosses" (
	"dungeon" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "dungeon_bosses_dungeon_position_pk" PRIMARY KEY("dungeon","position")
);
--> statement-breakpoint
CREATE TABLE "dungeon_loot" (
	"dungeon" text NOT NULL,
	"boss_position" integer NOT NULL,
	"position" integer NOT NULL,
	"item_id" integer NOT NULL,
	"item_name" text NOT NULL,
	CONSTRAINT "dungeon_loot_dungeon_boss_position_position_pk" PRIMARY KEY("dungeon","boss_position","position")
);
--> statement-breakpoint
CREATE TABLE "dungeons" (
	"name" text PRIMARY KEY NOT NULL,
	"min_level" integer NOT NULL,
	"max_level" integer NOT NULL,
	"required_level" integer,
	"source_build" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dungeon_bosses" ADD CONSTRAINT "dungeon_bosses_dungeon_dungeons_name_fk" FOREIGN KEY ("dungeon") REFERENCES "public"."dungeons"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dungeon_loot" ADD CONSTRAINT "dungeon_loot_dungeon_boss_position_dungeon_bosses_dungeon_position_fk" FOREIGN KEY ("dungeon","boss_position") REFERENCES "public"."dungeon_bosses"("dungeon","position") ON DELETE cascade ON UPDATE no action;