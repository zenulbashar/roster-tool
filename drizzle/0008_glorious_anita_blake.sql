CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku_code" text,
	"unit" text,
	"supplier_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"delivery_days" integer[] DEFAULT '{}' NOT NULL,
	"order_cutoff_days_before" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_business_idx" ON "item" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "item_business_supplier_idx" ON "item" USING btree ("business_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_business_idx" ON "supplier" USING btree ("business_id");