CREATE TYPE "public"."form_channel" AS ENUM('public', 'internal');--> statement-breakpoint
CREATE TABLE "form_rate_limit" (
	"bucket_key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_response_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"field_id" uuid,
	"field_label" text NOT NULL,
	"field_type" "form_field_type" NOT NULL,
	"value_text" text,
	"value_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_response_answer_one_value" CHECK (num_nonnulls("form_response_answer"."value_text", "form_response_answer"."value_number") = 1)
);
--> statement-breakpoint
CREATE TABLE "form_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"channel" "form_channel" DEFAULT 'public' NOT NULL,
	"source" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_response_answer" ADD CONSTRAINT "form_response_answer_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_answer" ADD CONSTRAINT "form_response_answer_response_id_form_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_response"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response_answer" ADD CONSTRAINT "form_response_answer_field_id_form_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."form_field"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response" ADD CONSTRAINT "form_response_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_response" ADD CONSTRAINT "form_response_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_response_answer_response_idx" ON "form_response_answer" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "form_response_answer_business_field_idx" ON "form_response_answer" USING btree ("business_id","field_id");--> statement-breakpoint
CREATE INDEX "form_response_business_form_idx" ON "form_response" USING btree ("business_id","form_id");--> statement-breakpoint
CREATE INDEX "form_response_form_submitted_idx" ON "form_response" USING btree ("form_id","submitted_at");