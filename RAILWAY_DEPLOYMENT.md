# Railway Deployment Guide for Google Tasks MCP Server

This guide explains how to deploy the Google Tasks MCP Server to Railway.com.

## Prerequisites

1. A Railway account
2. Google Cloud OAuth credentials (from the setup steps in README.md)
3. Google Tasks API enabled in your Google Cloud project

## Authentication Options

This server supports two authentication methods:

### Option 1: Service Account Credentials (Original Method)
- Uses pre-authorized credentials stored as environment variable
- Suitable for server-to-server applications
- No user interaction required after initial setup

### Option 2: OAuth2 Web Flow (New Method)
- Users authenticate via Google OAuth
- Suitable for multi-user applications
- Each user authenticates with their own Google account

## Deployment Steps

### 1. Prepare Your Credentials

First, you need to obtain your Google OAuth credentials:

1. Run the authentication flow locally:
   ```bash
   npm install
   npm run build
   npm run start auth
   ```

2. After completing the authentication, you'll have a `.gtasks-server-credentials.json` file. Open this file and copy its contents.

### 2. Set Up Railway Project

1. Create a new project on Railway
2. Connect your GitHub repository or use Railway CLI

### 3. Configure Environment Variables

Choose your authentication method:

#### For Option 1 (Service Account Credentials):
- `GOOGLE_TASKS_CREDENTIALS`: Paste the entire JSON content from your `.gtasks-server-credentials.json` file

#### For Option 2 (OAuth2 Web Flow):
- `GOOGLE_CLIENT_ID`: Your OAuth Client ID from Google Cloud Console
- `GOOGLE_CLIENT_SECRET`: Your OAuth Client Secret from Google Cloud Console
- `GOOGLE_REDIRECT_URI`: `https://your-app.up.railway.app/auth/google/callback` (optional, auto-detected)

The JSON should look something like:
```json
{
  "access_token": "ya29...",
  "refresh_token": "1//...",
  "scope": "https://www.googleapis.com/auth/tasks",
  "token_type": "Bearer",
  "expiry_date": 1234567890000
}
```

### 4. Deploy to Railway

#### For OAuth2 deployment:
1. Update `railway.json` to use `Dockerfile.railway-oauth`
2. Ensure your Google OAuth redirect URI includes your Railway URL

#### Option A: Using Railway CLI
```bash
railway login
railway link
railway up
```

#### Option B: Using GitHub
1. Push your code to GitHub
2. In Railway, create a new project from your GitHub repository
3. Railway will automatically detect the `railway.json` configuration and use the custom Dockerfile

### 5. Access Your API

Once deployed, Railway will provide you with a URL. Your API endpoints will be available at:

- `GET https://your-app.railway.app/health` - Health check
- `GET https://your-app.railway.app/tasks` - List all tasks
- `GET https://your-app.railway.app/tasks/search?q=query` - Search tasks
- `GET https://your-app.railway.app/tasks/:taskId` - Get a specific task
- `POST https://your-app.railway.app/tasks` - Create a new task
- `PUT https://your-app.railway.app/tasks/:taskId` - Update a task
- `DELETE https://your-app.railway.app/tasks/:taskId` - Delete a task
- `POST https://your-app.railway.app/tasks/clear` - Clear completed tasks

## API Usage Examples

### For OAuth2 Web Flow:

1. First authenticate:
   ```bash
   # Visit in browser
   https://your-app.railway.app/auth/google
   ```

2. After authentication, use the sessionId in your requests:
   ```bash
   curl https://your-app.railway.app/tasks \
     -H "X-Session-ID: your-session-id"
   ```

### For Service Account (Original Method):

### List all tasks
```bash
curl https://your-app.railway.app/tasks
```

### Search for tasks
```bash
curl "https://your-app.railway.app/tasks/search?q=meeting"
```

### Create a new task
```bash
curl -X POST https://your-app.railway.app/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "New Task",
    "notes": "Task description",
    "due": "2024-12-31T23:59:59.000Z"
  }'
```

### Update a task
```bash
curl -X PUT https://your-app.railway.app/tasks/TASK_ID \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Task",
    "status": "completed"
  }'
```

### Delete a task
```bash
curl -X DELETE https://your-app.railway.app/tasks/TASK_ID
```

## Troubleshooting

### Authentication Issues
- Ensure the `GOOGLE_TASKS_CREDENTIALS` environment variable contains valid JSON
- The refresh token should be included to handle token expiration
- Check Railway logs for specific error messages

### Port Issues
- Railway automatically assigns a PORT environment variable
- The HTTP server is configured to use `process.env.PORT || 3000`

### Build Issues
- Ensure all dependencies are listed in package.json
- Check that TypeScript compilation succeeds locally before deploying

## Security Considerations

1. Keep your `GOOGLE_TASKS_CREDENTIALS` secure - don't commit it to version control
2. Consider implementing API authentication for your HTTP endpoints
3. Use HTTPS (Railway provides this automatically)
4. Implement rate limiting for production use

## Differences from MCP Mode

This HTTP server mode differs from the original MCP server:
- Runs as a standalone HTTP API instead of stdio-based MCP server
- Designed for web deployment rather than local Claude Desktop integration
- Provides RESTful endpoints instead of MCP protocol
- Suitable for integration with web applications and services