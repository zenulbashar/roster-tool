CREATE TABLE "worker_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
