CREATE TABLE "awareness" (
	"peer_id" text NOT NULL,
	"doc_id" text NOT NULL,
	"awareness" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "awareness_peer_id_doc_id_pk" PRIMARY KEY("peer_id","doc_id")
);
--> statement-breakpoint
ALTER TABLE "awareness" ADD CONSTRAINT "awareness_doc_id_doc_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."doc"("id") ON DELETE cascade ON UPDATE no action;