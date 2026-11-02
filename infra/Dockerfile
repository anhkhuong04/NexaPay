FROM node:22.18.0-bookworm-slim AS web
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM eclipse-temurin:21-jdk AS backend
WORKDIR /workspace
COPY backend/ backend/
COPY --from=web /workspace/frontend/dist/ frontend/dist/
RUN --mount=type=cache,target=/root/.m2 chmod +x backend/mvnw && cd backend && ./mvnw -B -ntp -Pweb package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN groupadd --system nexapay && useradd --system --gid nexapay nexapay
COPY --from=backend --chown=nexapay:nexapay /workspace/backend/target/nexapay-0.1.0-SNAPSHOT.jar app.jar
USER nexapay
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
