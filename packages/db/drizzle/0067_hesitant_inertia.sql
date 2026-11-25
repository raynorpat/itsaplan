CREATE TABLE "issue_import_source" (
	"team_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"import_id" uuid,
	"imported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_import_source_team_id_source_key_pk" PRIMARY KEY("team_id","source_key"),
	CONSTRAINT "issue_import_source_issue_id_unique" UNIQUE("issue_id")
);
--> statement-breakpoint
ALTER TABLE "issue_import_source" ADD CONSTRAINT "issue_import_source_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_import_source" ADD CONSTRAINT "issue_import_source_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_import_source" ADD CONSTRAINT "issue_import_source_import_id_issue_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."issue_import"("id") ON DELETE set null ON UPDATE no action;