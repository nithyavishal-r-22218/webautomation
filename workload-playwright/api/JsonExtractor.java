package api;

import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class JsonExtractor {
    private static final Logger LOG = LoggerFactory.getLogger(JsonExtractor.class);

    /**
     * Extracts values from a JSON response based on the extractionDirective.
     * The JSON array to iterate over is specified by arrayFieldName.
     *
     * @param jsonResponse      the JSON string response
     * @param extractionDirective string in the format {searchString:<search>#key1^var1,key2^var2}...
     * @return map of extracted variable names to their values
     */

    public static Map<String, String> attachmentMap = new ConcurrentHashMap<>();

    public static Map<String, String> extractionBasedOnValue(String jsonResponse, String extractionDirective) {
        Map<String, String> extractedValues = new HashMap<>();
        try {
            JSONObject responseObj = new JSONObject(jsonResponse);

            // Pattern for searchString directives: {searchString:<string>#jsonKey^var}
            Pattern searchPattern = Pattern.compile("\\{searchString:([^#}]*)#([^}]*)}");
            // Pattern for simple key mapping: {jsonKey^var}
            Pattern simplePattern = Pattern.compile("\\{([^\\^{}]+)\\^([^\\^{}]+)}");

            Matcher searchMatcher = searchPattern.matcher(extractionDirective);
            Matcher simpleMatcher = simplePattern.matcher(extractionDirective);

            boolean matched = false;

            while (searchMatcher.find()) {
                matched = true;
                String searchString = searchMatcher.group(1).trim();
                String[] mappings = searchMatcher.group(2).split(",");
                for (String key : responseObj.keySet()) {
                    if (responseObj.get(key) instanceof JSONArray) {
                        JSONArray jsonArray = responseObj.getJSONArray(key);
                        for (int i = 0; i < jsonArray.length(); i++) {
                            JSONObject item = jsonArray.getJSONObject(i);
                            boolean toProcess =
                                    searchString.isEmpty()
                                            || (item.has("comment")
                                            && item.optString("comment", "").replace("\\/", "/").contains(searchString))
                                            || item.toString().replace("\\/", "/").contains(searchString);

                            if (toProcess) {
                                for (String map : mappings) {
                                    String[] parts = map.split("\\^");
                                    if (parts.length == 2) {
                                        String jsonKey = parts[0].trim();
                                        String variableName = parts[1].trim();
                                        String value = item.optString(jsonKey, null);
                                        if (value != null) {
                                            extractedValues.put(variableName + (searchString.isEmpty() ? ("_" + i) : ""), value);
                                        }
                                    }
                                }
                                if (!searchString.isEmpty()) break;
                            }
                        }
                    }
                }
            }
            // Fallback: if no searchString used, use simple mapping
            if (!matched) {
                while (simpleMatcher.find()) {
                    String jsonKey = simpleMatcher.group(1).trim();
                    String variableName = simpleMatcher.group(2).trim();
                    for (String key : responseObj.keySet()) {
                        if (responseObj.get(key) instanceof JSONArray) {
                            JSONArray jsonArray = responseObj.getJSONArray(key);
                            for (int i = 0; i < jsonArray.length(); i++) {
                                JSONObject item = jsonArray.getJSONObject(i);
                                String value = item.optString(jsonKey, null);
                                if (value != null) {
                                    extractedValues.put(variableName + "_" + i, value);
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            LOG.warn("Error during extraction: {}", e.getMessage(), e);
        }
        return extractedValues;
    }

    public static void setAttachmentIds(String responseBody, String module) {

        JSONObject jsonObject = new JSONObject(responseBody);

        if (jsonObject.has("comments")) {
            JSONArray commentsArray = jsonObject.getJSONArray("comments");
            for (int j = 0; j < commentsArray.length(); j++) {
                JSONObject comment = commentsArray.getJSONObject(j);
                if (comment.has("attachments")) {
                    processAttachments(comment.getJSONArray("attachments"));
                }
            }
            int attachmentCount = jsonObject.getJSONObject("page_info").getInt("count");
            LOG.debug("Comment Count: {}", attachmentCount);
        } if (jsonObject.has("attachments")) {
            processAttachments(jsonObject.getJSONArray("attachments"));
        }
        if (jsonObject.has("attachment")) {
            processAttachments(jsonObject.getJSONArray("attachment"));
        }


    }

    private static void processAttachments(JSONArray attachments) {
        for (int i = 0; i < attachments.length(); i++) {
            JSONObject attachment = attachments.getJSONObject(i);
            String originalName = attachment.getString("name");
            String cleanedName = originalName.replaceAll("^(\\d+).*?(\\.\\w+)$", "$1$2");
            String attachmentId = attachment.getString("attachment_id");
            String entityType = attachment.getString("entity_type");
            String uploadedZpuid = attachment.optString("uploadedZpuid", "Unknown");
            String key = entityType + "_" + uploadedZpuid + "_" + cleanedName;
            attachmentMap.put(key, attachmentId);
            LOG.debug("{} : {}", key, attachmentId);
        }
    }

}
