CREATE TABLE "dungeon_quest_rewards" (
	"dungeon" text NOT NULL,
	"quest_position" integer NOT NULL,
	"position" integer NOT NULL,
	"item_id" integer NOT NULL,
	"item_name" text NOT NULL,
	CONSTRAINT "dungeon_quest_rewards_dungeon_quest_position_position_pk" PRIMARY KEY("dungeon","quest_position","position")
);
--> statement-breakpoint
CREATE TABLE "dungeon_quests" (
	"dungeon" text NOT NULL,
	"position" integer NOT NULL,
	"quest_id" integer NOT NULL,
	"name" text NOT NULL,
	"side" text,
	"class_name" text,
	"required_level" integer,
	"xp" integer,
	"objective" text,
	CONSTRAINT "dungeon_quests_dungeon_position_pk" PRIMARY KEY("dungeon","position")
);
--> statement-breakpoint
ALTER TABLE "dungeon_quest_rewards" ADD CONSTRAINT "dungeon_quest_rewards_dungeon_quest_position_dungeon_quests_dungeon_position_fk" FOREIGN KEY ("dungeon","quest_position") REFERENCES "public"."dungeon_quests"("dungeon","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dungeon_quests" ADD CONSTRAINT "dungeon_quests_dungeon_dungeons_name_fk" FOREIGN KEY ("dungeon") REFERENCES "public"."dungeons"("name") ON DELETE cascade ON UPDATE no action;