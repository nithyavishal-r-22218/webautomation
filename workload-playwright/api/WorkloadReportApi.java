package api;

import core.ProjectContext;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The Workload Report endpoints the web app itself uses, callable with the OAuth token (confirmed on
 * plautomation, 2026-10-06):
 * <pre>
 *   GET  /user-views?module=workload&filter={"view_type":"predefined_views"}   predefined view ids (i18n names)
 *   GET  /views/{id}?module=workload                view definition: determiner, view_period, group_by, report_preference
 *   GET  /reports/workload/meta?project_id=0&view_id=..&filter={}  resolved period (chart_details.start_date/end_date/range)
 *   GET  /reports/workload?project_id=0&from_date&to_date&time_period&report_based_on&index&range&filter={}&view_id=..
 *        -> owners[] {name, id, is_resource, work{overall_allocation, total_work, total_availability}, count{users_count, entity_count}}
 *   GET  /reports/workload/groups?...&group_by={"field_name":"profiles|roles","sort_by":"asc","module":"workload"}  -> parents[]
 *   GET  /reports/workload/groups/owners?...&group_ids=[{"id","count"}]  -> parents_with_owners[] {parent_id, owners[]}
 *   PUT  /reports/custom-workload  {name, determiner:{pattern:"1", criteria:[{field_name, condition, value:[..]}]}, ...}  -> 201 {id}
 *   DELETE /views/{id}?module=workload
 * </pre>
 * Criteria field keys are the editor's option values (status, priority, allocation, teams, tags, name,
 * completion_percentage, owner, created_by, billing_type, resource_type, role, skill_set and the custom fields' api
 * names) except for the dotted ones, which the API wants as project_id, project_group, project_status and tasklist
 * (tasklist_id also works); conditions are is, is_not,
 * contains, not_contains, starts_with, ends_with, all_open, all_closed, is_empty, equal, less_than, greater_than,
 * less_than_or_equal, greater_than_or_equal, between, direct_reports_of, subordinates_of.
 * A task criterion keeps every user in the result and zeroes the work of the ones without matching tasks;
 * allocation and user criteria (resource type, role, skill set) remove users from the result.
 */
public class WorkloadReportApi {
  /** i18n key of each predefined view (as listed by /user-views) -> display name in the view picker. */
  public static final Map<String, String> PREDEFINED_VIEWS = new LinkedHashMap<>();
  static {
    PREDEFINED_VIEWS.put("zp.workload.customview.allusers", "All Users");
    PREDEFINED_VIEWS.put("zp.workload.customview.taskassociatedtoteams", "Associated Teams");
    PREDEFINED_VIEWS.put("zp.workload.customview.myteammembers", "My Team Members");
    PREDEFINED_VIEWS.put("zp.workload.customview.mydirectreports", "My Direct Reports");
    PREDEFINED_VIEWS.put("zp.workload.customview.mysubordinates", "My Subordinates");
    PREDEFINED_VIEWS.put("zp.workload.customview.usersbyprofile", "Users by Profile");
    PREDEFINED_VIEWS.put("zp.workload.customview.usersbyrole", "Users by Role");
    PREDEFINED_VIEWS.put("zp.workload.customview.unallocatedusers", "Unallocated Users");
    PREDEFINED_VIEWS.put("zp.workload.customview.underallocatedusers", "Under-Allocated Users");
    PREDEFINED_VIEWS.put("zp.workload.customview.optimalallocatedusers", "Optimally-Allocated Users");
    PREDEFINED_VIEWS.put("zp.workload.customview.overallocatedusers", "Over-Allocated Users");
  }

  /** The portal allows 100 calls per API per 2 minutes; creating one view per criteria row needs pacing. */
  private static final long MIN_CREATE_INTERVAL_MS = Long.getLong("workloadCreateIntervalMs", 1500);
  private static long lastCreate;

  private final Api api = new Api();

  /** Display name -> view id for the portal's predefined Workload views. */
  public Map<String, String> predefinedViewIds() throws IOException {
    JSONArray views = new JSONObject(get("/user-views?module=workload&page=1&per_page=200&filter=" + enc("{\"view_type\":\"predefined_views\"}"))).getJSONArray("user_views");
    Map<String, String> ids = new LinkedHashMap<>();
    for (int i = 0; i < views.length(); i++) {
      JSONObject view = views.getJSONObject(i);
      String display = PREDEFINED_VIEWS.getOrDefault(view.optString("name"), view.optString("name"));
      ids.put(display, view.getString("id"));
    }
    return ids;
  }

  public JSONObject view(String viewId) throws IOException {
    return new JSONObject(get("/views/" + viewId + "?module=workload"));
  }

  public JSONObject meta(String viewId) throws IOException {
    return new JSONObject(get("/reports/workload/meta?project_id=0&view_id=" + viewId + "&filter=" + enc("{}")));
  }

  /** Every owner row of the view for its own resolved period (all pages). */
  public JSONArray owners(String viewId) throws IOException {
    return owners(viewId, null);
  }

  /**
   * Owner rows of the view with extra criteria applied through the report's filter parameter, e.g.
   * {@code {"pattern":"1 AND 2","criteria":[...]}} (several criteria are combined with upper-case AND / OR, no
   * parentheses; a criterion may carry several values). The view itself is left untouched.
   */
  public JSONArray owners(String viewId, JSONObject filter) throws IOException {
    JSONObject meta = meta(viewId);
    JSONArray all = new JSONArray();
    int index = 1;
    String filterParam = enc(filter == null ? "{}" : filter.toString());
    while (true) {
      JSONObject page = new JSONObject(get("/reports/workload?" + period(meta) + "&report_based_on=" + meta.optString("report_based_on", "users")
          + "&index=" + index + "&range=50&filter=" + filterParam + "&view_id=" + viewId + "&sort_order=asc&fetch_unassignee=false"));
      JSONArray owners = page.optJSONArray("owners");
      for (int i = 0; owners != null && i < owners.length(); i++) all.put(owners.getJSONObject(i));
      JSONObject info = page.optJSONObject("page_info");
      if (info == null || !info.optBoolean("has_next", false) || owners == null || owners.isEmpty()) return all;
      index += info.optInt("range", 50);
    }
  }

  /**
   * The "Unassigned User" row of a view (tasks without owners), which the web app fetches with a second call carrying
   * fetch_unassignee=true; null when the view has none. Unowned tasks book no work, so the row is always "free".
   */
  public JSONObject unassignedRow(String viewId) throws IOException {
    JSONObject meta = meta(viewId);
    JSONObject page = new JSONObject(get("/reports/workload?" + period(meta) + "&report_based_on=" + meta.optString("report_based_on", "users")
        + "&index=1&range=50&filter=" + enc("{}") + "&view_id=" + viewId + "&sort_order=asc&fetch_unassignee=true"));
    JSONArray owners = page.optJSONArray("owners");
    for (int i = 0; owners != null && i < owners.length(); i++) {
      if ("0".equals(owners.getJSONObject(i).optString("secondary_id")) || owners.getJSONObject(i).optString("name").toLowerCase().startsWith("unassigned")) {
        return owners.getJSONObject(i);
      }
    }
    return null;
  }

  /** All portal teams (name, id, lead, users) as GET /teams lists them. */
  public JSONArray teams() throws IOException {
    return new JSONObject(get("/teams?page=1&per_page=200")).getJSONArray("teams");
  }

  /**
   * Names of the teams whose lead is this user. The predefined "My Team Members" view lists the members of exactly
   * these teams (confirmed on plautomation 2026-10-06; membership alone or the reporting line play no part). The
   * team list does not expose members, so callers take them from the fixture definition.
   */
  public java.util.Set<String> teamsLedBy(String zpuid) throws IOException {
    java.util.Set<String> names = new java.util.LinkedHashSet<>();
    JSONArray teams = teams();
    for (int i = 0; i < teams.length(); i++) {
      JSONObject team = teams.getJSONObject(i);
      JSONObject lead = team.optJSONObject("lead");
      String leadId = lead != null ? lead.optString("zpuid", lead.optString("id")) : team.optString("lead");
      if (zpuid.equals(leadId)) names.add(team.optString("name"));
    }
    return names;
  }

  /**
   * Hours of availability the report counts for the given month: the default business hours' working_day_availability
   * (minutes per day of week, 1 = Monday ... 7 = Sunday) summed over the month's dates, minus holidays.
   */
  public long monthAvailabilityHours(java.time.YearMonth month) throws IOException {
    String anyView = predefinedViewIds().values().iterator().next();
    JSONObject details = meta(anyView).getJSONObject("default_business_hours_details");
    JSONObject perDay = details.getJSONObject("working_day_availability");
    java.util.Set<String> holidays = new java.util.HashSet<>();
    JSONArray list = details.optJSONArray("holidays");
    for (int i = 0; list != null && i < list.length(); i++) holidays.add(String.valueOf(list.get(i)).replace("-", "").substring(0, Math.min(8, String.valueOf(list.get(i)).replace("-", "").length())));
    long minutes = 0;
    for (int day = 1; day <= month.lengthOfMonth(); day++) {
      java.time.LocalDate date = month.atDay(day);
      if (holidays.contains(date.format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE))) continue;
      int key = date.getDayOfWeek().getValue(); // Monday = 1 ... Sunday = 7 (verified: 22 working days in October 2026)
      minutes += perDay.optInt(String.valueOf(key), 0);
    }
    return minutes / 60;
  }

  /** Number of working days (non-zero availability, not a holiday) in the month. */
  public int workingDays(java.time.YearMonth month) throws IOException {
    String anyView = predefinedViewIds().values().iterator().next();
    JSONObject details = meta(anyView).getJSONObject("default_business_hours_details");
    JSONObject perDay = details.getJSONObject("working_day_availability");
    int days = 0;
    for (int day = 1; day <= month.lengthOfMonth(); day++) {
      int key = month.atDay(day).getDayOfWeek().getValue();
      if (perDay.optInt(String.valueOf(key), 0) > 0) days++;
    }
    return days;
  }

  /** Group rows (profiles or roles, per the view's group_by) with their user counts. */
  public JSONArray groups(String viewId) throws IOException {
    JSONObject meta = meta(viewId);
    return new JSONObject(get("/reports/workload/groups?" + period(meta) + "&group_by=" + enc(groupBy(meta)) + "&index=1&range=50&filter=" + enc("{}") + "&view_id=" + viewId)).getJSONArray("parents");
  }

  /** Owners of each group: parents_with_owners[] {parent_id, owners[]}. */
  public JSONArray groupOwners(String viewId, JSONArray parents) throws IOException {
    JSONObject meta = meta(viewId);
    JSONArray groupIds = new JSONArray();
    for (int i = 0; i < parents.length(); i++) {
      JSONObject parent = parents.getJSONObject(i);
      groupIds.put(new JSONObject().put("id", parent.getString("id")).put("count", parent.optInt("associated_user_count", 0)));
    }
    return new JSONObject(get("/reports/workload/groups/owners?" + period(meta) + "&group_by=" + enc(groupBy(meta)) + "&filter=" + enc("{}") + "&view_id=" + viewId + "&group_ids=" + enc(groupIds.toString()))).getJSONArray("parents_with_owners");
  }

  /** Creates a private custom view (current month, by users, heatmap) with the given determiner; returns its id. */
  public String createView(String name, JSONObject determiner) throws IOException {
    return createView(name, determiner, false);
  }

  /** As above; {@code shared} makes it public to every user and every project (what other users see and may edit or delete). */
  public String createView(String name, JSONObject determiner, boolean shared) throws IOException {
    JSONObject body = new JSONObject()
        .put("name", name).put("description", "").put("view_access_type", shared ? "public" : "only_to_me").put("shared_users", new JSONArray())
        .put("project_access_type", shared ? "all_projects" : "specific_project").put("shared_projects", new JSONArray())
        .put("report_preference", new JSONObject().put("report_based_on", "users").put("bar_type", "gantt").put("legend", "nolegend").put("view_type", "heatmap"))
        .put("view_period", new JSONObject().put("time_period", "days").put("time_period_type", "relative").put("relative_time_period", "current_month"))
        .put("determiner", determiner).put("module", "workload").put("is_globally_accessible", true)
        .put("group_by", new JSONArray().put(new JSONObject().put("field_name", "users").put("sort_by", "asc").put("module", "workload")));
    pace();
    return new JSONObject(withThrottleRetry(() -> api.sendRequest("PUT", url("/reports/custom-workload"), null, 201, null, body.toString(), null, "application/json"))).getString("id");
  }

  public void deleteView(String viewId) throws IOException {
    withThrottleRetry(() -> api.sendRequest("DELETE", url("/views/" + viewId + "?module=workload"), null, 204, null, null, null, "application/json"));
  }

  private static synchronized void pace() {
    long wait = lastCreate + MIN_CREATE_INTERVAL_MS - System.currentTimeMillis();
    if (wait > 0) {
      try {
        Thread.sleep(wait);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
    lastCreate = System.currentTimeMillis();
  }

  private interface Call {
    String run() throws IOException;
  }

  /** Retries a call that hit URL_ROLLING_THROTTLES_LIMIT_EXCEEDED (30 s pause) or a transient proxy failure (5 s), up to four times. */
  private static String withThrottleRetry(Call call) throws IOException {
    IOException last = null;
    for (int attempt = 0; attempt < 4; attempt++) {
      try {
        return call.run();
      } catch (IOException e) {
        String message = String.valueOf(e.getMessage());
        boolean transientFailure = message.contains("CONNECT: 503") || message.contains("timed out") || message.contains("code 502") || message.contains("code 504");
        if (!message.contains("THROTTLES_LIMIT_EXCEEDED") && !transientFailure) throw e;
        last = e;
        try {
          Thread.sleep(transientFailure ? 5_000 : 30_000);
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          throw e;
        }
      }
    }
    throw last;
  }

  /**
   * Builds one criterion. The value-less operators are stored with the placeholder the web app sends
   * ({@code ${ALL_OPEN}}, {@code ${ALL_CLOSED}}, {@code ${IS_EMPTY}}); an empty value array saves but the report
   * then rejects the view's filter.
   */
  public static JSONObject criterion(String field, String condition, List<String> values) {
    List<String> stored = values;
    if (values.isEmpty()) {
      switch (condition) {
        case "all_open" -> stored = List.of("${ALL_OPEN}");
        case "all_closed" -> stored = List.of("${ALL_CLOSED}");
        case "is_empty" -> stored = List.of("${IS_EMPTY}");
        default -> stored = values;
      }
    }
    return new JSONObject().put("field_name", field).put("condition", condition).put("value", new JSONArray(stored));
  }

  public static JSONObject determiner(JSONObject criterion) {
    return new JSONObject().put("pattern", "1").put("criteria", new JSONArray().put(criterion));
  }

  /** Several criteria combined with AND ("1 AND 2 AND 3"). */
  public static JSONObject determinerAnd(JSONObject... criteria) {
    StringBuilder pattern = new StringBuilder();
    JSONArray list = new JSONArray();
    for (int i = 0; i < criteria.length; i++) {
      if (i > 0) pattern.append(" AND ");
      pattern.append(i + 1);
      list.put(criteria[i]);
    }
    return new JSONObject().put("pattern", pattern.toString()).put("criteria", list);
  }

  private static String groupBy(JSONObject meta) {
    JSONObject groupBy = meta.optJSONObject("group_by");
    String field = groupBy == null ? "users" : groupBy.optString("field_name", "users");
    return new JSONObject().put("field_name", field).put("sort_by", "asc").put("module", "workload").toString();
  }

  private static String period(JSONObject meta) {
    JSONObject chart = meta.getJSONObject("chart_details");
    return "project_id=0&from_date=" + enc(isoDate(chart.getString("start_date")) + "T00:00:00.000Z")
        + "&to_date=" + enc(isoDate(chart.getString("end_date")) + "T23:59:59.999Z")
        + "&time_period=" + chart.optString("range", "days");
  }

  /** "20261001" -> "2026-10-01". */
  private static String isoDate(String yyyymmdd) {
    return yyyymmdd.substring(0, 4) + "-" + yyyymmdd.substring(4, 6) + "-" + yyyymmdd.substring(6, 8);
  }

  private String get(String path) throws IOException {
    return withThrottleRetry(() -> api.sendRequest("GET", url(path), null, 200, null, null, null, "application/json"));
  }

  private static String url(String path) {
    return ProjectContext.getApiBaseUrl() + path;
  }

  private static String enc(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }
}
