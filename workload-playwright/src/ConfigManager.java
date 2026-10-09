package core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class ConfigManager {
  private static final ObjectMapper MAPPER = new ObjectMapper();

  private ConfigManager() {
  }

  public static JsonNode load(String environment) {
    String env = environment == null || environment.isBlank() ? "local" : environment;
    Path path = Path.of("config", "environments", env + ".json");

    try {
      return MAPPER.readTree(Files.readString(path));
    } catch (IOException e) {
      throw new IllegalStateException("Unable to load config file: " + path, e);
    }
  }
}
