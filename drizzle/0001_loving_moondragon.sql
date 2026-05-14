CREATE TABLE "chart_points" (
	"symbol" text NOT NULL,
	"t" timestamp with time zone NOT NULL,
	"close" numeric(12, 4) NOT NULL,
	"currency" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chart_points_symbol_t_pk" PRIMARY KEY("symbol","t")
);
--> statement-breakpoint
CREATE INDEX "chart_points_symbol_t_idx" ON "chart_points" USING btree ("symbol","t" DESC NULLS LAST);