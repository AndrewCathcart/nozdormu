CREATE TABLE "class_spells" (
	"class_id" integer NOT NULL,
	"spell_id" integer NOT NULL,
	"level" integer NOT NULL,
	"name" text NOT NULL,
	"rank" integer,
	"races" text[] NOT NULL,
	CONSTRAINT "class_spells_class_id_spell_id_pk" PRIMARY KEY("class_id","spell_id")
);
--> statement-breakpoint
CREATE INDEX "class_spells_class_level" ON "class_spells" USING btree ("class_id","level");