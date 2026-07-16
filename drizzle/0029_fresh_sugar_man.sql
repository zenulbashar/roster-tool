ALTER TABLE "shift_template" ADD COLUMN "required_staff" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shift" ADD COLUMN "required_staff" integer DEFAULT 1 NOT NULL;