package core;

import core.ConfigManager;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class Configuration {
  public static final String PORTAL_TYPE = read("portalType", "PORTAL_TYPE", "local");
  public static final String PORTAL_URL = read(
      "portalUrl",
      "PORTAL_URL",
      configPortalUrlOrDefault()
  );

  public static final String DB_URL = read("dbUrl", "DB_URL", "jdbc:mysql://127.0.0.1:3306/webautomation");
  public static final String DB_USER = read("dbUser", "DB_USER", "root");
  public static final String DB_PASSWORD = read("dbPassword", "DB_PASSWORD", "");

  public static final String TIMESTAMP = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss"));

  private static String read(String propertyKey, String envKey, String defaultValue) {
    String prop = System.getProperty(propertyKey);
    if (prop != null && !prop.isBlank()) {
      return prop;
    }

    String env = System.getenv(envKey);
    if (env != null && !env.isBlank()) {
      return env;
    }

    return defaultValue;
  }

  private static String configPortalUrlOrDefault() {
    String env = System.getProperty("env", "local");
    String fallback = PORTAL_TYPE.equalsIgnoreCase("local")
        ? "https://projects.localzoho.com"
        : "https://projects.zoho.com";

    try {
      String portalUrl = ConfigManager.load(env).path("portal.url").asText("").trim();
      if (!portalUrl.isEmpty()) {
        return portalUrl;
      }

      String baseUrl = ConfigManager.load(env).path("baseUrl").asText("").trim();
      if (!baseUrl.isEmpty()) {
        return baseUrl;
      }
    } catch (Exception ignored) {
    }

    return fallback;
  }
}
