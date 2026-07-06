CREATE TABLE "google_drive_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"google_account_email" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"token_expiry" timestamp with time zone NOT NULL,
	"root_folder_id" text,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_drive_connection_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "staff_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"doc_type" text,
	"drive_file_id" text NOT NULL,
	"drive_web_link" text NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_drive_connection" ADD CONSTRAINT "google_drive_connection_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_document" ADD CONSTRAINT "staff_document_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_document" ADD CONSTRAINT "staff_document_staff_member_id_staff_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_drive_connection_business_idx" ON "google_drive_connection" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "staff_document_business_idx" ON "staff_document" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "staff_document_business_staff_idx" ON "staff_document" USING btree ("business_id","staff_member_id");