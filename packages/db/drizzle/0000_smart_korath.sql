-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
CREATE TABLE "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "user_email_key" UNIQUE ("email")
);

--> statement-breakpoint
CREATE TABLE "session" (
  "id" text PRIMARY KEY NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "token" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL,
  CONSTRAINT "session_token_key" UNIQUE ("token")
);

--> statement-breakpoint
CREATE TABLE "account" (
  "id" text PRIMARY KEY NOT NULL,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp with time zone,
  "refreshTokenExpiresAt" timestamp with time zone,
  "scope" text,
  "password" text,
  "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp with time zone NOT NULL
);

--> statement-breakpoint
CREATE TABLE "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--> statement-breakpoint
CREATE TABLE "jwks" (
  "id" text PRIMARY KEY NOT NULL,
  "publicKey" text NOT NULL,
  "privateKey" text NOT NULL,
  "createdAt" timestamp with time zone NOT NULL,
  "expiresAt" timestamp with time zone
);

--> statement-breakpoint
ALTER TABLE "session"
ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

--> statement-breakpoint
ALTER TABLE "account"
ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId" text_ops);

--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId" text_ops);

--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier" text_ops);
