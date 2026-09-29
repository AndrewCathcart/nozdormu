CREATE TABLE "blue_post_feeds" (
	"feed" text PRIMARY KEY NOT NULL,
	"first_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"baseline_created_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blue_posts" (
	"feed" text NOT NULL,
	"post_id" integer NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blue_posts_feed_post_id_pk" PRIMARY KEY("feed","post_id")
);
