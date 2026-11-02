# Backend instructions

Follow root AGENTS.md. Java 21/Spring Boot 3.5, Maven Wrapper, PostgreSQL/Flyway.
Package by feature under vn.nexapay; controllers call application APIs, never other
modules' repositories. Constructor injection, validated DTOs, no entity responses.
Use one registration transaction across identity/profile/wallet/ledger/audit.
Hash passwords outside that transaction. P0-01 provisions zero only; P0-02 funding
posts through MoneyPostingService in the same transaction as quota/command/audit.
Account row locks use the restricted DB capability; never grant runtime direct balance edits.
Use PostgreSQL Testcontainers for integration, failure injection and concurrency.
From backend: `./mvnw verify` (Windows `./mvnw.cmd verify`), `./mvnw spotless:apply`,
`./mvnw spring-boot:run -Dspring-boot.run.profiles=local`.
Runtime DB role is restricted; migrations use a separate owner. Never skip tests
or widen DB permissions to conceal a failure. Keep OpenAPI and tests aligned.
