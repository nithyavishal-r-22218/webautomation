package core;

import core.ApiTokenGenerator;

import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.WaitForSelectorState;
import locators.LoginLocators;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class SessionLogin extends AccountDB {
    private static final Logger LOG = LoggerFactory.getLogger(SessionLogin.class);

    private static String credentialsTable() {
        return PORTAL_TYPE.equalsIgnoreCase("local") ? "portalcredslocal" : "portalcredsidc";
    }

    /**
     * Loads the portal account from the credentials DB and sets the web/API base URLs in
     * {@link ProjectContext}. The OAuth token is fetched lazily by {@link #ensureToken()} on
     * the first API call, so UI-only tests never pay for a token refresh.
     */
    public static void accountCreds(String portalName, String portalRole, String portalType) {
        AccountDB.getAccountDetails(credentialsTable(), portalName, portalRole);

        ProjectContext.setPortalType(portalType);
        ProjectContext.setWebBaseUrl(PORTAL_URL + "/portal/" + portalName);
        ProjectContext.setApiBaseUrl(PORTAL_URL + "/api/v3/portal/" + getPortalID());
        ProjectContext.setToken(null);
    }

    /** Returns the cached OAuth access token for the current thread, generating it on first use. */
    public static String ensureToken() {
        String token = ProjectContext.getToken();
        if (token == null || token.isBlank()) {
            String portalType = ProjectContext.getPortalType();
            token = ApiTokenGenerator.getToken(portalType == null ? PORTAL_TYPE : portalType);
            ProjectContext.setToken(token);
        }
        return token;
    }

    /**
     * After the password step the accounts service sometimes shows an interstitial (e.g. "Review your account
     * details" under /announcement/...) instead of redirecting; the session is already established, so continue to
     * the portal directly. Nothing is confirmed or accepted on that page.
     */
    private static void skipAccountsAnnouncement(Page page) {
        try {
            page.waitForURL(url -> !url.contains("accounts.") || url.contains("/announcement"), new Page.WaitForURLOptions().setTimeout(15_000));
        } catch (RuntimeException stillOnAccounts) {
            // fall through: the sign-out widget wait below reports the real state
        }
        if (page.url().contains("accounts.") && page.url().contains("/announcement")) {
            LOG.info("Accounts announcement page shown after login ({}); continuing to the portal", page.url());
            page.navigate(ProjectContext.getWebBaseUrl());
            page.waitForLoadState();
        }
    }

    // Performs the Zoho accounts UI login in the given page.
    public static void accountLogin(BrowserContext context, Page page, String portalType, String portalRole, String portalName) {
        AccountDB.getAccountDetails(credentialsTable(), portalName, portalRole);

        String serviceUrl = URLEncoder.encode(PORTAL_URL, StandardCharsets.UTF_8);
        String signupUrl = URLEncoder.encode("https://www.zoho.com/projects/signup.html", StandardCharsets.UTF_8);

        String loginUrl = portalType.toLowerCase().contains("local")
            ? "https://accounts.localzoho.com/signin?servicename=ZohoProjects&serviceurl=" + serviceUrl
            : "https://accounts.zoho.com/signin?servicename=ZohoProjects&serviceurl=" + serviceUrl + "&signupurl=" + signupUrl;
        LOG.info("Navigating to login page: {}", loginUrl);
        page.navigate(loginUrl);

        page.locator(LoginLocators.ACCOUNTS_EMAIL).fill(getUserName());
        page.locator(LoginLocators.ACCOUNTS_NEXT).click();

        page.locator(LoginLocators.ACCOUNTS_PASSWORD).waitFor();
        page.locator(LoginLocators.ACCOUNTS_PASSWORD).fill(getPassword());
        page.locator(LoginLocators.ACCOUNTS_NEXT).click();

        page.waitForLoadState();
        skipAccountsAnnouncement(page);
        page.locator(LoginLocators.SIGN_OUT_WIDGET).waitFor(
                new Locator.WaitForOptions().setTimeout(20_000).setState(WaitForSelectorState.VISIBLE));
        LOG.info("Login successful for portal '{}' role '{}'", portalName, portalRole);
    }
}
