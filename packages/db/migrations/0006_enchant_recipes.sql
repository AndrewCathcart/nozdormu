ALTER TABLE "recipes" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ALTER COLUMN "item_count" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_item_and_count" CHECK (("recipes"."item_id" is null) = ("recipes"."item_count" is null));--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_skill_levels" CHECK (("recipes"."yellow_at" is null) = ("recipes"."grey_at" is null));