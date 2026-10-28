import java.sql.DriverManager;

/** Local development bootstrap only; never part of the web application. */
class CreateDatabase {
    public static void main(String[] args) throws Exception {
        String port = System.getenv().getOrDefault("DB_PORT", "5433");
        String password = System.getenv("DB_PASSWORD");
        String adminPassword = System.getenv("LOCAL_DB_ADMIN_PASSWORD");
        if (password == null || password.isBlank() || adminPassword == null || adminPassword.isBlank()) {
            throw new IllegalArgumentException("Database passwords must be set in the environment");
        }
        try (var connection = DriverManager.getConnection("jdbc:postgresql://127.0.0.1:" + port + "/postgres",
                "cp_local_admin", adminPassword); var statement = connection.createStatement()) {
            // Serialize concurrent local helpers without relying on check-then-create races.
            statement.execute("SELECT pg_advisory_lock(6061202601)");
            try (var roles = statement.executeQuery("SELECT 1 FROM pg_roles WHERE rolname='cp_app'")) {
                if (!roles.next()) {
                    try (var create = connection.createStatement()) {
                        create.execute("CREATE ROLE cp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"
                                + password.replace("'", "''") + "'");
                    }
                }
            }
            try (var databases = statement.executeQuery("SELECT 1 FROM pg_database WHERE datname='cp_platform'")) {
                if (!databases.next()) {
                    try (var create = connection.createStatement()) {
                        create.execute("CREATE DATABASE cp_platform OWNER cp_app");
                    }
                }
            }
        }
        System.out.println("Local cp_platform database is ready; start the backend to apply Flyway migrations.");
    }
}
