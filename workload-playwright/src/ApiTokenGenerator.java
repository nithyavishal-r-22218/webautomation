package core;

import okhttp3.FormBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

public class ApiTokenGenerator extends SessionLogin {
    private static final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .build();

    public static String getToken(String portalType) {
        String tokenUrl = portalType.toLowerCase().contains("local")
                ? "https://accounts.localzoho.com/oauth/v2/token"
                : "https://accounts.zoho.com/oauth/v2/token";

        // Credentials go in the POST body, never the query string, so they stay out of proxy and access logs.
        FormBody body = new FormBody.Builder()
                .add("refresh_token", getRefreshToken())
                .add("client_id", getClientId())
                .add("client_secret", getClientSecret())
                .add("grant_type", "refresh_token")
                .build();

        Request request = new Request.Builder().url(tokenUrl).post(body).build();

        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException("Failed to get access token. Response Code: " + response.code());
            }
            JSONObject json = new JSONObject(response.body().string());
            if (!json.has("access_token")) {
                // Typically an error code such as access_denied or a rate limit; the body carries no secrets.
                throw new IOException("OAuth token refresh returned no access_token: " + json);
            }
            return json.getString("access_token");
        } catch (IOException e) {
            throw new RuntimeException("OAuth token refresh failed: " + e.getMessage(), e);
        }
    }
}
