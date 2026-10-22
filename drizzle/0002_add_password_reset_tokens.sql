CREATE TABLE `spaceform_password_reset_tokens` (
	`id` varchar(36) NOT NULL,
	`accountId` varchar(36) NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	CONSTRAINT `spaceform_password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `spaceform_password_reset_tokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `spaceform_password_reset_tokens` ADD CONSTRAINT `spaceform_password_reset_tokens_accountId_spaceform_accounts_id_fk` FOREIGN KEY (`accountId`) REFERENCES `spaceform_accounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `spaceform_password_reset_account_created_idx` ON `spaceform_password_reset_tokens` (`accountId`,`createdAt`);