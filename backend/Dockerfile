FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:17-jre-jammy
RUN groupadd --system cp && useradd --system --gid cp cp
WORKDIR /app
COPY --from=build --chown=cp:cp /build/target/cp-backend-0.1.0-SNAPSHOT.jar app.jar
USER cp
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
