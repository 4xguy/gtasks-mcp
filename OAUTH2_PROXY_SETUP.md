# OAuth2 Proxy Setup for Google Tasks MCP

This guide explains how to use OAuth2 Proxy to protect your Google Tasks MCP server on Railway.

## Architecture

```
User → OAuth2 Proxy (:4180) → MCP Backend (:8080)
         ↓                        ↓
    Google OAuth             Google Tasks API
    (user login)             (API access)
```

## Setup Instructions

### 1. Deploy OAuth2 Proxy on Railway

Use the OAuth2 Proxy template and configure these environment variables:

```bash
OAUTH2_PROXY_PROVIDER=google
OAUTH2_PROXY_CLIENT_ID="${{gtasks-mcp.GOOGLE_CLIENT_ID}}"
OAUTH2_PROXY_CLIENT_SECRET="${{gtasks-mcp.GOOGLE_CLIENT_SECRET}}"
OAUTH2_PROXY_COOKIE_SECRET="<generate-a-random-32-char-string>"
OAUTH2_PROXY_EMAIL_DOMAINS="icvida.org"  # Your allowed email domains
OAUTH2_PROXY_HTTP_ADDRESS=":4180"
OAUTH2_PROXY_REDIRECT_URL="https://<your-oauth2-proxy-domain>/oauth2/callback"
OAUTH2_PROXY_UPSTREAMS="http://{{gtasks-mcp.RAILWAY_PRIVATE_DOMAIN}}:8080"

# IMPORTANT: The OAuth2 Proxy domain should be different from your MCP domain
# For example:
# - OAuth2 Proxy: https://gtasks-proxy.railway.app
# - MCP Backend: https://gtasks-mcp.railway.app (but accessed via proxy)
```

### 2. Configure MCP Backend Service

The MCP server is configured to work behind OAuth2 Proxy:

- Listens on port 8080
- Trusts proxy headers
- Uses `x-auth-request-email` header for user identification
- Manages Google API tokens separately per user

Environment variables for the backend:
```bash
PORT=8080
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
OAUTH2_PROXY_EXTERNAL_URL=https://<your-oauth2-proxy-domain>
```

### 3. Google Cloud Console Setup

Add these redirect URIs to your Google OAuth application:
- `https://<your-oauth2-proxy-domain>/oauth2/callback` (for OAuth2 Proxy login)
- `https://<your-oauth2-proxy-domain>/google-api-callback` (for Google Tasks API auth)

### 4. User Flow

1. **First Visit**: User goes to `https://<your-oauth2-proxy-domain>/`
2. **OAuth2 Proxy Login**: Redirected to Google for authentication
3. **Backend Access**: After login, user can access the backend
4. **Google API Setup**: Visit `/setup-google-auth` to authorize Google Tasks access
5. **Use API**: All endpoints now work with both authentications

## API Endpoints

All endpoints require OAuth2 Proxy authentication:

- `GET /` - Status and user info
- `GET /health` - Health check (no auth)
- `GET /setup-google-auth` - Authorize Google Tasks API
- `GET /tasks` - List tasks
- `GET /tasks/search?q=query` - Search tasks
- `GET /tasks/:id` - Get specific task
- `POST /tasks` - Create task
- `PUT /tasks/:id` - Update task
- `DELETE /tasks/:id` - Delete task
- `POST /tasks/clear` - Clear completed tasks

## How It Works

1. **User Authentication**: OAuth2 Proxy handles Google login
2. **Proxy Headers**: Backend receives user email in headers
3. **API Authorization**: Backend manages Google API tokens per user
4. **Token Storage**: Tokens saved to disk (use Redis in production)

## Security Benefits

- No direct access to backend (only through proxy)
- Email domain restrictions via OAuth2 Proxy
- Separate authentication for users vs API access
- No sessions or cookies in backend
- Automatic HTTPS via Railway

## Troubleshooting

### "Not authenticated" error
- Check OAuth2 Proxy is running
- Verify `OAUTH2_PROXY_UPSTREAMS` points to backend

### "Google API not authorized" error
- Visit `/setup-google-auth` to authorize
- Check Google Cloud Console redirect URIs

### Port issues
- Backend must listen on 8080
- OAuth2 Proxy listens on 4180

### Token expiration
- Tokens are refreshed automatically
- If expired, visit `/setup-google-auth` again