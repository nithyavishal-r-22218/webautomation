package core;

import api.ApiRequest;
import com.microsoft.playwright.Page;

import java.util.Map;

/**
 * Shared test state. All fields are thread-scoped so parallel TestNG <test> threads
 * (each running against its own portal/account) never see each other's state.
 */
public class ProjectContext {

    private static final ThreadLocal<State> STATE = ThreadLocal.withInitial(State::new);

    private static final class State {
        ApiRequest apiRequest;
        String projectId;
        String tasklistId;
        String taskId;
        String phaseId;
        String token;
        String apiBaseUrl;
        String webBaseUrl;
        Page page;
        String issueId;
        String portalType;
        String categoryId;
        Map<String, String> apiResponse;
        String forumId;
        String statusId;
        String projectName;
        String eventId;
        String projectTemplateId;
        String projectTemplateName;
        String projectFromTemplateId;
        String tempProjectTlId;
    }

    private static State state() {
        return STATE.get();
    }

    public static ApiRequest getApiRequest() {
        return state().apiRequest;
    }

    public static String getProjectId() {
        return state().projectId;
    }

    public static String getTasklistId() {
        return state().tasklistId;
    }

    public static String getTaskId() {
        return state().taskId;
    }

    public static String getPhaseId() {
        return state().phaseId;
    }

    public static String getToken() {
        return state().token;
    }

    public static String getApiBaseUrl() {
        return state().apiBaseUrl;
    }

    public static String getWebBaseUrl() {
        return state().webBaseUrl;
    }

    public static Page getPage() {
        return state().page;
    }

    public static String getIssueId() {
        return state().issueId;
    }

    public static String getPortalType() {
        return state().portalType;
    }

    public static String getCategoryId() {
        return state().categoryId;
    }

    public static Map<String, String> getApiResponse() {
        return state().apiResponse;
    }

    public static String getForumId() {
        return state().forumId;
    }

    public static String getStatusId() {
        return state().statusId;
    }

    public static String getProjectName() {
        return state().projectName;
    }

    public static String getEventId() {
        return state().eventId;
    }

    public static String getProjectTemplateId() {
        return state().projectTemplateId;
    }

    public static String getProjectTemplateName() {
        return state().projectTemplateName;
    }

    public static String getProjectFromTemplateId() {
        return state().projectFromTemplateId;
    }

    public static String getTempProjectTlId() {
        return state().tempProjectTlId;
    }

    public static void setProjectId(String projectId) {
        state().projectId = projectId;
    }

    public static void setTaskId(String taskId) {
        state().taskId = taskId;
    }

    public static void setTasklistId(String tasklistId) {
        state().tasklistId = tasklistId;
    }

    public static void setPhaseId(String phaseId) {
        state().phaseId = phaseId;
    }

    public static void setToken(String token) {
        state().token = token;
    }

    public static void setApiBaseUrl(String apiBaseUrl) {
        state().apiBaseUrl = apiBaseUrl;
    }

    public static void setWebBaseUrl(String webBaseUrl) {
        state().webBaseUrl = webBaseUrl;
    }

    public static void setPage(Page page) {
        state().page = page;
    }

    public static void setIssueId(String issueId) {
        state().issueId = issueId;
    }

    public static void setPortalType(String portalType) {
        state().portalType = portalType;
    }

    public static void setCategoryId(String categoryId) {
        state().categoryId = categoryId;
    }

    public static void setApiResponse(Map<String, String> apiResponse) {
        state().apiResponse = apiResponse;
    }

    public static void setForumId(String forumId) {
        state().forumId = forumId;
    }

    public static void setStatusId(String statusId) {
        state().statusId = statusId;
    }

    public static void setEventId(String eventId) {
        state().eventId = eventId;
    }

    public static void setApiRequest(ApiRequest apiRequest) {
        state().apiRequest = apiRequest;
    }

    public static void setProjectName(String projectName) {
        state().projectName = projectName;
    }

    public static void setProjectTemplateId(String projectTemplateId) {
        state().projectTemplateId = projectTemplateId;
    }

    public static void setProjectTemplateName(String projectTemplateName) {
        state().projectTemplateName = projectTemplateName;
    }

    public static void setProjectFromTemplateId(String projectFromTemplateId) {
        state().projectFromTemplateId = projectFromTemplateId;
    }

    public static void setTempProjectTlId(String tempProjectTlId) {
        state().tempProjectTlId = tempProjectTlId;
    }
}
