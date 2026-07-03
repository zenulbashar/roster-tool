CREATE TABLE "sso_consumed_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sso_consumed_tokens_seen_at_idx" ON "sso_consumed_tokens" USING btree ("seen_at");