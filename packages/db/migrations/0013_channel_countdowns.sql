CREATE TABLE "channel_countdowns" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"original_name" text NOT NULL,
	"shown_name" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
