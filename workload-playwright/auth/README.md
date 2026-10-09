Saved logins go here. They are created on your machine, never shared:

    npm run auth                          # sign in as Admin (Vishal workload)  -> auth/admin.json
    ZP_AUTH_TARGETS=cp npm run auth       # sign in as Vishal customprofile (CP) -> auth/wl.cp.json

A headed browser opens; you sign in yourself; only the resulting session is saved.
Treat these files like passwords: they let anyone act as that user until the session expires.
