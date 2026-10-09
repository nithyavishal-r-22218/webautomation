package api;

import core.ProjectContext;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Profile permissions for the report modules, as Setup > Profiles manages them (shapes supplied from the web app,
 * 2026-10-06):
 * <pre>
 *   GET  /profiles                                                   -> {"profiles":[{"id","name",...}]}
 *   GET  /profiles/{scope}/permissions?profile_ids=a,b              -> {"<profileId>":[{"module","actions":[...]}]}
 *   PATCH /profiles/{id}/{scope}/permissions/grant                   body [{"module","actions":[...],"type":scope,"operation":"grant"}]
 *   PATCH /profiles/{id}/{scope}/permissions/revoke                  body [... "operation":"revoke"]
 * </pre>
 * scope is {@code globalreport} (module {@code workloadreport}, {@code customreports}) or {@code projectreport}
 * (module {@code projectworkloadreport}, {@code projectcustomreports}); actions are view, manage, delete (export for
 * custom reports). Changing a profile's permissions affects every user with that profile: callers restore what they changed.
 */
public class ProfilePermissionsApi {
  public static final String GLOBAL = "globalreport";
  public static final String PROJECT = "projectreport";
  public static final String GLOBAL_WORKLOAD = "workloadreport";
  public static final String PROJECT_WORKLOAD = "projectworkloadreport";

  private final Api api = new Api();

  /** Profile id by name (case-insensitive), or null. */
  public String profileId(String name) throws IOException {
    JSONArray profiles = new JSONObject(get("/profiles")).getJSONArray("profiles");
    for (int i = 0; i < profiles.length(); i++) {
      if (name.equalsIgnoreCase(profiles.getJSONObject(i).optString("name"))) return profiles.getJSONObject(i).getString("id");
    }
    return null;
  }

  /** Actions a profile holds on a module within a scope. */
  public Set<String> actions(String profileId, String scope, String module) throws IOException {
    JSONObject response = new JSONObject(get("/profiles/" + scope + "/permissions?profile_ids=" + profileId));
    JSONArray modules = response.optJSONArray(profileId);
    Set<String> actions = new LinkedHashSet<>();
    for (int i = 0; modules != null && i < modules.length(); i++) {
      if (!module.equals(modules.getJSONObject(i).optString("module"))) continue;
      JSONArray list = modules.getJSONObject(i).optJSONArray("actions");
      for (int j = 0; list != null && j < list.length(); j++) actions.add(list.getString(j));
    }
    return actions;
  }

  public void grant(String profileId, String scope, String module, List<String> actions) throws IOException {
    change(profileId, scope, module, actions, "grant");
  }

  public void revoke(String profileId, String scope, String module, List<String> actions) throws IOException {
    change(profileId, scope, module, actions, "revoke");
  }

  /** Grants or revokes so that the module ends up with exactly {@code wanted} among the given candidate actions. */
  public void set(String profileId, String scope, String module, List<String> candidates, Set<String> wanted) throws IOException {
    Set<String> current = actions(profileId, scope, module);
    List<String> toGrant = candidates.stream().filter(a -> wanted.contains(a) && !current.contains(a)).toList();
    List<String> toRevoke = candidates.stream().filter(a -> !wanted.contains(a) && current.contains(a)).toList();
    if (!toGrant.isEmpty()) grant(profileId, scope, module, toGrant);
    if (!toRevoke.isEmpty()) revoke(profileId, scope, module, toRevoke);
  }

  private void change(String profileId, String scope, String module, List<String> actions, String operation) throws IOException {
    JSONArray body = new JSONArray().put(new JSONObject().put("module", module).put("actions", new JSONArray(actions)).put("type", scope).put("operation", operation));
    String url = ProjectContext.getApiBaseUrl() + "/profiles/" + profileId + "/" + scope + "/permissions/" + operation;
    try {
      api.sendRequest("PATCH", url, null, 200, null, body.toString(), null, "application/json");
    } catch (IOException notOk) {
      if (!notOk.getMessage().contains("code 204")) throw notOk;
    }
  }

  /** The profile (id, name) a portal user currently has, read from GET /users. */
  public JSONObject userProfile(String email) throws IOException {
    JSONArray users = new JSONObject(get("/users?per_page=200")).getJSONArray("users");
    for (int i = 0; i < users.length(); i++) {
      JSONObject u = users.getJSONObject(i);
      if (email.equalsIgnoreCase(u.optString("email"))) {
        JSONObject profile = u.optJSONObject("profile") != null ? u.optJSONObject("profile") : u.optJSONObject("portal_profile");
        return new JSONObject().put("zpuid", u.getString("id")).put("profile", profile == null ? new JSONObject() : profile);
      }
    }
    throw new IOException("No portal user with email " + email);
  }

  /** Assigns a profile to a user: v3.1 user PATCH with {"portal_profile":{"id"}} (a "profile" key is accepted but ignored). */
  public void assignProfile(String zpuid, String profileId) throws IOException {
    String base = ProjectContext.getApiBaseUrl().replace("/api/v3/", "/api/v3.1/");
    api.sendRequest("PATCH", base + "/users/" + zpuid, null, 204, null, new JSONObject().put("portal_profile", new JSONObject().put("id", profileId)).toString(), null, "application/json");
  }

  private String get(String path) throws IOException {
    return api.sendRequest("GET", ProjectContext.getApiBaseUrl() + path, null, 200, null, null, null, "application/json");
  }
}
