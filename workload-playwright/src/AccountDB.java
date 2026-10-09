package core;

import core.Configuration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.*;

public class AccountDB extends Configuration {
    private static final Logger LOG = LoggerFactory.getLogger(AccountDB.class);

    private static final String dbURL = DB_URL;
    private static final String dbUSER = DB_USER;
    private static final String dbPASSWORD = DB_PASSWORD;

    // Account state is thread-scoped so parallel TestNG <test> threads can use different portals.
    private static final ThreadLocal<Account> ACCOUNT = ThreadLocal.withInitial(Account::new);

    private static final class Account {
        String portalID = "";
        String userName = "";
        String password = "";
        String clientId = "";
        String clientSecret = "";
        String refreshToken = "";
    }

    public static String getPortalID() {
        return ACCOUNT.get().portalID;
    }

    public static String getUserName() {
        return ACCOUNT.get().userName;
    }

    public static String getPassword() {
        return ACCOUNT.get().password;
    }

    public static String getClientId() {
        return ACCOUNT.get().clientId;
    }

    public static String getClientSecret() {
        return ACCOUNT.get().clientSecret;
    }

    public static String getRefreshToken() {
        return ACCOUNT.get().refreshToken;
    }

    public static void setOauthCredentials(String clientId, String clientSecret, String refreshToken) {
        Account account = ACCOUNT.get();
        account.clientId = clientId;
        account.clientSecret = clientSecret;
        account.refreshToken = refreshToken;
    }

    public static void getAccountDetails(String tableName, String portalName, String portalRole) {
        String query = "SELECT * FROM " + tableName + " WHERE portalName = ? AND portalRole = ?";

        try (Connection conn = DriverManager.getConnection(dbURL, dbUSER, dbPASSWORD);
             PreparedStatement ps = conn.prepareStatement(query)) {

            ps.setString(1, portalName);
            ps.setString(2, portalRole);

            ResultSet rs = ps.executeQuery();

            if (rs.next()) {
                Account account = ACCOUNT.get();
                account.portalID = rs.getString("portalID");
                account.userName = rs.getString("userName");
                account.password = rs.getString("password");
                account.clientId = rs.getString("clientId");
                account.clientSecret = rs.getString("clientSecret");
                account.refreshToken = rs.getString("refreshToken");

                LOG.info("Loaded credentials for portal '{}' role '{}' (portal ID {})", portalName, portalRole, account.portalID);
            } else {
                throw new RuntimeException(
                        "No account found in DB for portalName='" + portalName + "', role='" + portalRole + "'");
            }

        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("DB error retrieving account for portalName='"
                    + portalName + "', role='" + portalRole + "': " + e.getMessage(), e);
        }
    }
}
