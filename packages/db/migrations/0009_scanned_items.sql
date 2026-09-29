CREATE TABLE "scanned_item_stats" (
	"item_id" integer NOT NULL,
	"position" integer NOT NULL,
	"stat" text NOT NULL,
	"value" real NOT NULL,
	CONSTRAINT "scanned_item_stats_item_id_position_pk" PRIMARY KEY("item_id","position")
);
--> statement-breakpoint
CREATE TABLE "scanned_items" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quality" integer NOT NULL,
	"item_level" integer NOT NULL,
	"required_level" integer NOT NULL,
	"item_class" integer NOT NULL,
	"item_subclass" integer NOT NULL,
	"slot" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scanned_item_stats" ADD CONSTRAINT "scanned_item_stats_item_id_scanned_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."scanned_items"("id") ON DELETE cascade ON UPDATE no action;