-- OPS-04 / SEC-02: the tenant-facing audit trail. One APPEND-ONLY row per
-- repository write made through an owner context (owner edits, and Zale IT
-- edits while impersonating — impersonator_user_id set), recorded by the
-- audit decorator over every mutator. Carries who / what / before / after /
-- request id and a per-scope hash chain (prev_hash -> hash) that makes any
-- later edit or deletion detectable. Never UPDATEd or DELETEd by the app
-- except by the 7-year retention policy; docs/operations.md restricts
-- UPDATE/DELETE at the grant level. Also the per-admin index on
-- admin_activity (SEC-02 item 5).
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"business_id" uuid,
	"org_id" uuid,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"actor_label" text NOT NULL,
	"impersonator_user_id" text,
	"request_id" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"args" jsonb,
	"before" jsonb,
	"after" jsonb,
	"outcome" text NOT NULL,
	"error" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_scope_check" CHECK ("audit_event"."business_id" is not null or "audit_event"."org_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_event_business_seq_idx" ON "audit_event" USING btree ("business_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_event_business_entity_idx" ON "audit_event" USING btree ("business_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_event_org_seq_idx" ON "audit_event" USING btree ("org_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_event_created_idx" ON "audit_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_activity_admin_created_idx" ON "admin_activity" USING btree ("admin_user_id","created_at");
