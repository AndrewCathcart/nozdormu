CREATE TABLE "youtube_channels" (
	"youtube_channel_id" text PRIMARY KEY NOT NULL,
	"first_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"baseline_published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "youtube_videos" (
	"youtube_channel_id" text NOT NULL,
	"video_id" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_videos_youtube_channel_id_video_id_pk" PRIMARY KEY("youtube_channel_id","video_id")
);
