package api;

import core.AccountDB;
import core.ProjectContext;

import core.Configuration;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.format.DateTimeFormatter;
import java.io.IOException;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;


public class ApiRequest extends AccountDB {
    private static final Logger LOG = LoggerFactory.getLogger(ApiRequest.class);
    public final Api api = new Api();
    // Extracted-ID maps are thread-scoped so parallel <test> threads on different portals stay isolated.
    private static final ThreadLocal<Map<String, String>> RESULTS = ThreadLocal.withInitial(HashMap::new);
    private static final ThreadLocal<Map<String, String>> CV_IDS = ThreadLocal.withInitial(HashMap::new);
    private static final ThreadLocal<Map<String, String>> CMT_IDS = ThreadLocal.withInitial(HashMap::new);

    public static Map<String, String> results() {
        return RESULTS.get();
    }

    public static void setResults(Map<String, String> values) {
        RESULTS.set(values);
    }

    private String portalType() {
        String portalType = ProjectContext.getPortalType();
        return portalType == null ? "local" : portalType.toLowerCase();
    }
    private static final DateTimeFormatter ISO_OFFSET_DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");

    private String getApiUrl(String path) {
        return ProjectContext.getApiBaseUrl() + path;
    }

    private Map<String, String> getPortalEmails() {
        if (portalType().contains("local")) {
            return Map.of("userdetails", "[{\"email_id\":\"nithyavishal.r+plemployee@zohotest.com\"},{\"email_id\":\"nithyavishal.r+plmanager@zohotest.com\"}]",
                    "notify", "true");
        } else {
            return Map.of("userdetails", "[{\"email_id\":\"nithyavishal.r+idcemployee@zohotest.com\"},{\"email_id\":\"nithyavishal.r+idcmanager@zohotest.com\"}]",
                    "notify", "true");
        }
    }

    public void createProject(String type) throws IOException {
        String url = getApiUrl("/projects");
        LOG.debug(url);
        String projectName = "created from api_" + Configuration.TIMESTAMP;
        String body = type.contains("template") ? "{\"name\": \"" + projectName + "\", \"project_type\": \"template\"}" : "{\"name\": \"" + projectName + "\"}";
        String projectId = api.sendRequest("POST", url, null, 201, "id", body, null, "application/json");
        if (type.contains("template")) {
            ProjectContext.setProjectTemplateId(projectId);
            ProjectContext.setProjectTemplateName(projectName);
        } else {
            ProjectContext.setProjectId(projectId);
            ProjectContext.setProjectName(projectName);
        }
        fetchUserId();
        addUsersToTheProject(projectId);
        LOG.debug("Created Project ID: " + projectId);
    }

    public void fetchUserId() throws IOException {
        String url = getApiUrl("/projects/" + ProjectContext.getProjectId() + "/users");
        LOG.debug(url);

        String response = api.sendRequest("GET", url, null, 200, null, null, null, "application/json");

        String valueToExtract = portalType().contains("local")
                ? "{searchString:nithyavishal.r+plemployee@zohotest.com#id^plEmployeeId,full_name^plFullName}{searchString:nithyavishal.r+plmanager@zohotest.com#id^plManagerId}{searchString:nithyavishal.r+pladmin@zohotest.com#id^plAdminId}{searchString:" + getUserName() + "#id^plPortalOwnerId}"
                : "{searchString:nithyavishal.r+idcemployee@zohotest.com#id^idcEmployeeId,full_name^idcFullName}{searchString:nithyavishal.r+idcmanager@zohotest.com#id^idcManagerId}{searchString:nithyavishal.r+idcadmin@zohotest.com#id^idcAdminId}{searchString:" + getUserName() + "#id^idcPortalOwnerId}";
        RESULTS.set(JsonExtractor.extractionBasedOnValue(response, valueToExtract));
        results().forEach((key, value) -> LOG.debug("{}: {}", key, value));
        ProjectContext.setApiResponse(results());
    }

    public void addUsersToTheProject(String projectId) throws IOException {
        String url = getApiUrl("/projects/" + projectId + "/projectusers");
        LOG.debug(url);

        Map<String, String> formParams = getPortalEmails();

        String response = api.sendRequest("POST", url, formParams, 201, null, null, null, "application/json");
        LOG.debug("Added users to the project: " + response);
    }

    public void createTaskList(String type) throws IOException {
        String url = getApiUrl(type.contains("template") ? "/projects/" + ProjectContext.getProjectTemplateId() + "/tasklists" : "/projects/" + ProjectContext.getProjectId() + "/tasklists");
        LOG.debug(url);
        String body = type.contains("template") ? "{\"name\": \"template TL added from API\"}" : "{\"name\": \"tasklist\"}";
        String tasklistId = api.sendRequest("POST", url, null, 201, "id", body, null, "application/json");
        ProjectContext.setTasklistId(tasklistId);
        LOG.debug("Created Tasklist ID: " + tasklistId);
    }

    public void createTask(String type) throws IOException {
        String url = getApiUrl(type.contains("template") ? "/projects/" + ProjectContext.getProjectTemplateId() + "/tasks" : "/projects/" + ProjectContext.getProjectId() + "/tasks");
        LOG.debug(url);
        String body = "{\"tasklist\":{\"id\":\"" + ProjectContext.getTasklistId() + "\"},\"name\":\"Task added via Api\"}";
        String taskId = api.sendRequest("POST", url, null, 201, "id", body, null, "application/json");
        LOG.debug("Created Task ID: " + taskId);
        ProjectContext.setTaskId(taskId);
    }

    public void createPhase(String type) throws IOException {
        String url = getApiUrl(type.contains("template") ? "/projects/" + ProjectContext.getProjectTemplateId() + "/phases" : "/projects/" + ProjectContext.getProjectId() + "/phases");
        LOG.debug(url);
        String body = "{\"name\": \"Phase\"}";
        String phaseId = api.sendRequest("POST", url, null, 201, "id", body, null, "application/json");

        ProjectContext.setPhaseId(phaseId);

        LOG.debug("Created Phase ID: " + phaseId);
    }

    public void createIssue() throws IOException {
        String url = getApiUrl("/projects/" + ProjectContext.getProjectId() + "/issues");
        LOG.debug(url);
        String body = "{\"name\": \"Bug\"}";
        String issueId = api.sendRequest("POST", url, null, 200, "id", body, null, "application/json");
        ProjectContext.setIssueId(issueId);
        LOG.info("Created Issue ID: " + issueId);
    }

    public void getCategoryId(String type) throws IOException {
        String url = getApiUrl(type.contains("template") ? "/projects/" + ProjectContext.getProjectTemplateId() + "/categories" : "/projects/" + ProjectContext.getProjectId() + "/categories");
        LOG.debug(url);
        String categoryId = api.sendRequest("Get", url, null, 200, "id", null, null, "application/json");
        ProjectContext.setCategoryId(categoryId);
        LOG.info("categoryId : " + categoryId);
    }

    public void createForum(String type) throws IOException {
        getCategoryId(type);
        String url = getApiUrl(type.contains("template") ? "/projects/" + ProjectContext.getProjectTemplateId() + "/forums" : "/projects/" + ProjectContext.getProjectId() + "/forums");
        LOG.debug(url);
        String body = "{"
                + "\"title\":\"test2\","
                + "\"content\":\"cmt\","
                + "\"category_id\":\"" + ProjectContext.getCategoryId() + "\""
                + "}";
        String response = api.sendRequest("POST", url, null, 201, null, body, null, "application/json");

// Parse response and extract forum ID
        JSONObject json = new JSONObject(response);
        JSONArray forums = json.getJSONArray("forums");
        String forumId = forums.getJSONObject(0).getString("id");

        ProjectContext.setForumId(forumId);

        LOG.info("Created forum ID: " + forumId);
    }

    public void postStatus() throws IOException {
        String url = getApiUrl("/projects/" + ProjectContext.getProjectId() + "/status");
        LOG.debug(url);

        String body = "{\"content\": \"New status\",\"flag\": \"external\"}";
        String statusId = api.sendRequest("POST", url, null, 201, "id", body, null, "application/json");

        ProjectContext.setStatusId(statusId);
        LOG.info("Created status ID: " + statusId);
    }

    public void addEvent() throws IOException {
        String url = getApiUrl("/projects/" + ProjectContext.getProjectId() + "/events");
        LOG.debug(url);
        String portalOwnerId = portalType().contains("local") ? results().get("plPortalOwnerId") : results().get("idcPortalOwnerId");
        if (portalOwnerId == null) {
            fetchUserId();
        }
        portalOwnerId = portalType().contains("local") ? results().get("plPortalOwnerId") : results().get("idcPortalOwnerId");
        String adminId = portalType().contains("local") ? results().get("plAdminId") : results().get("idcAdminId");
        String managerId = portalType().contains("local") ? results().get("plManagerId") : results().get("idcManagerId");
        String employeeId = portalType().contains("local") ? results().get("plEmployeeId") : results().get("idcEmployeeId");
        String attendees = String.format("[\"%s\",\"%s\",\"%s\",\"%s\"]",
                portalOwnerId, adminId, managerId, employeeId);

        LocalDateTime nowUtc = LocalDateTime.now(ZoneOffset.UTC);
        String startAt = nowUtc.format(ISO_OFFSET_DATE_TIME);

        LocalDateTime halfHourLaterUtc = nowUtc.plusMinutes(30);
        String endAt = halfHourLaterUtc.format(ISO_OFFSET_DATE_TIME);

        String body = String.format("{\"title\":\"Event added from API\",\"starts_at\":\"%s\",\"ends_at\":\"%s\",\"attendees\":%s}",
                startAt, endAt, attendees);

        String eventId = api.sendRequest("POST", url, null, 201, "id", body, null, "application/json");
        ProjectContext.setEventId(eventId);
        LOG.info("Created event : " + eventId);
    }

    public void trashProject(String projectId) throws IOException {
        String url = getApiUrl("/projects/" + projectId + "/trash");
        LOG.debug(url);
        api.sendRequest("POST", url, null, 204, null, null, null, "application/json");
        LOG.info("Trashed project successfully");
    }

    public void deleteProject(String projectId) throws IOException {
        String url = getApiUrl("/projects/" + projectId);
        LOG.debug(url);
        api.sendRequest("DELETE", url, null, 204, null, null, null, "application/json");
        LOG.info("Deleted project successfully");
    }

    public JSONArray getCreatedWorkloadViews() throws IOException {
        String filter = java.net.URLEncoder.encode("{\"view_type\":\"created_views\"}", java.nio.charset.StandardCharsets.UTF_8);
        String url = getApiUrl("/user-views?module=workload&page=1&per_page=200&filter=" + filter);
        String response = api.sendRequest("GET", url, null, 200, null, null, null, "application/json");
        return new JSONObject(response).getJSONArray("user_views");
    }

    public void deleteWorkloadView(String viewId) throws IOException {
        String url = getApiUrl("/views/" + viewId + "?module=workload");
        api.sendRequest("DELETE", url, null, 204, null, null, null, "application/json");
    }

    public void deleteWorkloadViewByName(String viewName) throws IOException {
        JSONArray views = getCreatedWorkloadViews();
        for (int index = 0; index < views.length(); index++) {
            JSONObject view = views.getJSONObject(index);
            if (viewName.equals(view.optString("name"))) {
                deleteWorkloadView(view.optString("custom_view_id", view.getString("id")));
                return;
            }
        }
    }

    public void deleteWorkloadViewsByNamePrefix(String viewNamePrefix) throws IOException {
        JSONArray views = getCreatedWorkloadViews();
        for (int index = 0; index < views.length(); index++) {
            JSONObject view = views.getJSONObject(index);
            if (view.optString("name").startsWith(viewNamePrefix)) {
                deleteWorkloadView(view.optString("custom_view_id", view.getString("id")));
            }
        }
    }

    public void getAllOpenTasksCvID(String projectId) throws IOException {
        String url = getApiUrl("/projects/" + projectId + "/tasks/customviews");
        LOG.debug(url);
        String allOpenTasksCvId = api.sendRequest("GET", url, null, 200, null, null, null, "application/json");
        String valueToExtract = "{searchString:All Open#id^allOpenTasksCvId}";
        CV_IDS.set(JsonExtractor.extractionBasedOnValue(allOpenTasksCvId, valueToExtract));
        CV_IDS.get().forEach((key, value) -> LOG.debug("{}: {}", key, value));
//        ProjectContext.setAllOpenTasksCvId(results);
    }

    public void getAllOpenIssuesCvId() throws IOException {
        String url = getApiUrl("/projects/" + ProjectContext.getProjectId() + "/issues/customviews");
        LOG.debug(url);
        String allOpenIssuesCvId = api.sendRequest("GET", url, null, 200, null, null, null, "application/json");
        LOG.debug(allOpenIssuesCvId);

//        ProjectContext.setAllOpenIssuesCvId(results);
    }

    public String getAttachments(String projectId, String entityType, String entityId) throws IOException {
        String url = getApiUrl("/projects/" + projectId + "/attachments?entity_type=" + entityType + "&entity_id=" + entityId);
        LOG.debug(url);
        String getAttachments = api.sendRequest("GET", url, null, 200, null, null, null, "application/json");
        LOG.info(getAttachments);
        JsonExtractor.setAttachmentIds(getAttachments, entityType);
        return getAttachments;

    }

    public String getCommentAttachments(String projectId, String entityType, String entityId) throws IOException {
        String path;
        String newEntityType = switch (entityType) {
            case "projects" -> {
                path = "/projects/" + projectId + "/comments";
                yield "project_comment";
            }
            case "issues" -> {
                path = "/projects/" + projectId + "/issues/" + entityId + "/comments";
                yield "bug_comment";
            }
            case "tasklists" -> {
                path = "/projects/" + projectId + "/tasklists/" + entityId + "/comments";
                yield "tasklist_comment";
            }
            case "tasks" -> {
                path = "/projects/" + projectId + "/tasks/" + entityId + "/comments";
                yield "task_comment";
            }
            case "phases" -> {
                path = "/projects/" + projectId + "/phases/" + entityId + "/comments";
                yield "milestone_comment";
            }
            case "forum" -> {
                path = "/projects/" + projectId + "/forums/" + entityId + "/comments";
                yield "forum_comment";
            }
            case "status" -> {
                path = "/projects/" + projectId + "/status/" + entityId + "/comments";
                yield "status_comment";
            }
            case "events" -> {
                path = "/projects/" + projectId + "/events/" + entityId + "/comments";
                yield "event_comment";
            }
            default -> {
                path = "/projects/" + projectId + "/" + entityType + "/" + entityId + "/comments";
                yield entityType;
            }
        };

        String url = getApiUrl(path);
        LOG.debug(url);
        String getCommentId = api.sendRequest("GET", url, null, 200, null, null, null, "application/json");
        LOG.info("getCommentId : " + getCommentId);
        String valueToExtract = "{id^cmtId}";
        CMT_IDS.set(JsonExtractor.extractionBasedOnValue(getCommentId, valueToExtract));
        CMT_IDS.get().forEach((key, value) -> LOG.debug("{}: {}", key, value));
        LOG.info(CMT_IDS.get().get("cmtId_0"));
        String getAttchments = getAttachments(projectId, newEntityType, CMT_IDS.get().get("cmtId_0"));

        return getAttchments;
    }

    public void createProjectFromTemplate() throws IOException {
        String url = getApiUrl("/projects");
        LOG.debug(url);
        String projectName = "Project created from template_" + ProjectContext.getProjectTemplateId();
        String body ="{\"name\": \"" + projectName + "\", \"copy_from\": \""+ProjectContext.getProjectTemplateId()+"\"}";
        String projectId = api.sendRequest("POST", url, null, 201, "id", body, null, "application/json");
            ProjectContext.setProjectFromTemplateId(projectId);

    }

    public void tempProjectTaskListVerify() throws IOException {
        String url = getApiUrl("/projects/"+ProjectContext.getProjectFromTemplateId()+"/tasklists");
        LOG.debug(url);
        String tempPrjTlId = api.sendRequest("GET", url, null, 200, "id", null, null, "application/json");
        ProjectContext.setTempProjectTlId(tempPrjTlId);
        String getAttachment = getCommentAttachments(ProjectContext.getProjectFromTemplateId(),"tasklists",tempPrjTlId);
        LOG.info("tempProjectTaskListVerify : "+getAttachment);
    }
}