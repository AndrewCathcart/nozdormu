CREATE TABLE "command_registrations" (
	"application_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"definitions_hash" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_registrations_application_id_guild_id_pk" PRIMARY KEY("application_id","guild_id")
);
