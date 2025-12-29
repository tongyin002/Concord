CREATE TABLE "doc_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"operation" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doc_operation" ADD CONSTRAINT "doc_operation_doc_id_doc_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."doc"("id") ON DELETE cascade ON UPDATE no action;