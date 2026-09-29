CREATE TABLE "game_builds" (
	"version" text PRIMARY KEY NOT NULL,
	"item_count" integer NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quality" integer NOT NULL,
	"item_level" integer NOT NULL,
	"required_level" integer NOT NULL,
	"inventory_type" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "items_name_trigram" ON "items" USING gin ("name" gin_trgm_ops);