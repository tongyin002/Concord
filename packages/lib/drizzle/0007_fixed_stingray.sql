CREATE TABLE "node" (
	"doc_id" uuid NOT NULL,
	"loro_id" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "node_doc_id_loro_id_pk" PRIMARY KEY("doc_id","loro_id")
);
--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "node_doc_id_doc_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."doc"("id") ON DELETE cascade ON UPDATE no action;