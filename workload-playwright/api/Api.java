package api;

import core.ProjectContext;
import core.SessionLogin;
import okhttp3.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public class Api {
    private static final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS)
            .build();
    private static final Logger LOG = LoggerFactory.getLogger(Api.class);

    /**
     * The portal throttles each API (method + path shape) to a fixed number of calls per two minutes and then blocks
     * it for about half an hour, so every call is paced through a sliding window per API. Defaults stay under the
     * limit; tune with -DapiRateLimit (calls per window) and -DapiRateWindowMs.
     */
    private static final int RATE_LIMIT = Integer.getInteger("apiRateLimit", 80);
    private static final long RATE_WINDOW_MS = Long.getLong("apiRateWindowMs", 120_000);
    private static final Map<String, Deque<Long>> CALL_TIMES = new HashMap<>();
    private static final ThreadLocal<Boolean> retriedAfterTokenRefresh = ThreadLocal.withInitial(() -> false);

    /** Blocks until another call to this API fits in the window; the key ignores ids and query strings. */
    private static void pace(String method, String url) {
        String key = method.toUpperCase() + " " + url.replaceAll("\\?.*$", "").replaceAll("/\\d{6,}", "/{id}");
        synchronized (CALL_TIMES) {
            Deque<Long> times = CALL_TIMES.computeIfAbsent(key, k -> new ArrayDeque<>());
            while (true) {
                long now = System.currentTimeMillis();
                while (!times.isEmpty() && now - times.peekFirst() > RATE_WINDOW_MS) {
                    times.pollFirst();
                }
                if (times.size() < RATE_LIMIT) {
                    times.addLast(now);
                    return;
                }
                long wait = RATE_WINDOW_MS - (now - times.peekFirst()) + 100;
                LOG.info("Pacing {}: {} calls in the last {} s, waiting {} ms", key, times.size(), RATE_WINDOW_MS / 1000, wait);
                try {
                    CALL_TIMES.wait(wait);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    private String getToken() {
        if (ProjectContext.getPortalType() == null) {
            throw new IllegalStateException("Portal context is not initialised — call SessionLogin.accountCreds() before making API requests");
        }
        return SessionLogin.ensureToken();
    }
    // ---- path-relative helpers (paths are appended to the portal's API base URL)

    public String get(String path) throws IOException {
        return sendRequest("GET", ProjectContext.getApiBaseUrl() + path, null, 200, null, null, null, "application/json");
    }

    public String post(String path, String jsonBody, int expectedCode) throws IOException {
        return sendRequest("POST", ProjectContext.getApiBaseUrl() + path, null, expectedCode, null, jsonBody, null, "application/json");
    }

    public String patch(String path, String jsonBody, int expectedCode) throws IOException {
        return sendRequest("PATCH", ProjectContext.getApiBaseUrl() + path, null, expectedCode, null, jsonBody, null, "application/json");
    }

    public String put(String path, String jsonBody, int expectedCode) throws IOException {
        return sendRequest("PUT", ProjectContext.getApiBaseUrl() + path, null, expectedCode, null, jsonBody, null, "application/json");
    }

    public void delete(String path, int expectedCode) throws IOException {
        sendRequest("DELETE", ProjectContext.getApiBaseUrl() + path, null, expectedCode, null, null, null, "application/json");
    }

    public String sendRequest(String method, String url, Map<String, String> parameters, int expectedResponseCode, String valueToExtract, String rawBody, byte[] binaryData, String contentType) throws IOException {
        Request request;
        LOG.debug("{} {}", method.toUpperCase(), url);
        pace(method, url);
        // Prepare request body based on input type
        RequestBody requestBody = null;
        if (rawBody != null && !rawBody.isEmpty()) {
            requestBody = RequestBody.create(rawBody, MediaType.parse(contentType != null ? contentType : "application/json"));
        } else if (binaryData != null) {
            requestBody = RequestBody.create(binaryData, MediaType.parse(contentType != null ? contentType : "application/octet-stream"));
        } else if (parameters != null && !parameters.isEmpty()) {
            FormBody.Builder formBuilder = new FormBody.Builder();
            for (Map.Entry<String, String> entry : parameters.entrySet()) {
                formBuilder.add(entry.getKey(), entry.getValue());
            }
            requestBody = formBuilder.build();
        }

        // Create request based on the method type
        request = switch (method.toUpperCase()) {
            case "POST" -> new Request.Builder()
                    .url(url)
                    .post(requestBody != null ? requestBody : RequestBody.create(new byte[0], null))
                    .addHeader("Authorization", "Bearer " + getToken())
                    .build();
            case "PATCH" -> new Request.Builder()
                    .url(url)
                    .patch(requestBody != null ? requestBody : RequestBody.create(new byte[0], null))
                    .addHeader("Authorization", "Bearer " + getToken())
                    .build();
            case "PUT" -> new Request.Builder()
                    .url(url)
                    .put(requestBody != null ? requestBody : RequestBody.create(new byte[0], null))
                    .addHeader("Authorization", "Bearer " + getToken())
                    .build();
            case "DELETE" -> new Request.Builder()
                    .url(url)
                    .delete(requestBody != null ? requestBody : RequestBody.create(new byte[0], null))
                    .addHeader("Authorization", "Bearer " + getToken())
                    .build();
            default -> new Request.Builder()
                    .url(url)
                    .get()
                    .addHeader("Authorization", "Bearer " + getToken())
                    .build();
        };


        try (Response response = client.newCall(request).execute()) {

            int responseCode = response.code();
            String responseBody = response.body().string();
            LOG.trace("Response : {}", responseBody);

            if (responseCode == 401 && responseBody.contains("INVALID_OAUTHTOKEN") && !retriedAfterTokenRefresh.get()) {
                // The access token lives about an hour; long runs refresh it once and repeat the call.
                LOG.info("Access token rejected; refreshing and retrying {} {}", method.toUpperCase(), url);
                ProjectContext.setToken(null);
                retriedAfterTokenRefresh.set(true);
                try {
                    return sendRequest(method, url, parameters, expectedResponseCode, valueToExtract, rawBody, binaryData, contentType);
                } finally {
                    retriedAfterTokenRefresh.set(false);
                }
            }
            if (responseCode != expectedResponseCode) {

                throw new IOException("Unexpected response code " + responseCode + " for " + method.toUpperCase() + " " + url
                        + (responseBody.isEmpty() ? "" : ": " + responseBody));
            }

            if (!responseBody.isEmpty() && valueToExtract != null && !valueToExtract.isEmpty()) {
                try {
                    if (responseBody.trim().startsWith("[")) {
                        List<String> values = extractIdsFromArrayResponse(responseBody, valueToExtract);
                        return String.join(",", values); // return all IDs as a comma-separated string
                    } else {
                        JSONObject jsonObject = new JSONObject(responseBody);
                        return jsonObject.optString(valueToExtract, "Key not found in response");
                    }
                } catch (Exception e) {
                    throw new IOException("Failed to extract value: " + e.getMessage(), e);
                }
            }


            return responseBody; // Return the whole response if no extraction key provided
        }

    }


    public static List<String> extractIdsFromArrayResponse(String responseBody, String key) {
        List<String> ids = new ArrayList<>();
        JSONArray jsonArray = new JSONArray(responseBody);

        for (int i = 0; i < jsonArray.length(); i++) {
            JSONObject obj = jsonArray.getJSONObject(i);
            if (obj.has(key)) {
                ids.add(obj.getString(key));
            }
        }

        return ids;
    }

}


