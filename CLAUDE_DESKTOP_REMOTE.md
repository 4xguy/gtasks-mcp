# Using Google Tasks MCP with Claude Desktop (Remote)

This guide explains how to connect Claude Desktop to your remote Google Tasks MCP server hosted on Railway.

## How It Works

Claude Desktop only supports stdio (standard input/output) transport, but your Railway server uses HTTP. The MCP proxy bridges this gap:

```
Claude Desktop <--stdio--> MCP Proxy <--HTTP--> Railway Server
```

## Setup Instructions

### 1. Install Dependencies

First, install and build the project locally:

```bash
npm install
npm run build
```

### 2. Configure Claude Desktop

Add the following to your Claude Desktop configuration file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gtasks-remote": {
      "command": "node",
      "args": ["/absolute/path/to/gtasks-mcp/dist/mcp-proxy.js"],
      "env": {
        "GTASKS_REMOTE_URL": "https://gtasks-mcp-production.up.railway.app"
      }
    }
  }
}
```

Replace `/absolute/path/to/gtasks-mcp` with the actual path to this repository.

### 3. First Use - Authentication

1. Restart Claude Desktop after updating the configuration
2. When you first try to use Google Tasks commands, the proxy will:
   - Open your browser to the authentication page
   - Ask you to enter the session ID in the terminal/console
3. Enter your session ID when prompted
4. The proxy saves this session for future use

### 4. Using in Claude Desktop

Once authenticated, you can use commands like:

- "List my Google Tasks"
- "Create a task called 'Buy groceries'"
- "Search for tasks containing 'meeting'"
- "Mark task XYZ as completed"
- "Delete completed tasks"

## How Authentication Works

1. The proxy detects when authentication is needed
2. It opens your browser to `https://your-railway-app.up.railway.app/auth/google`
3. You authenticate with Google
4. You receive a session ID
5. The proxy saves this session ID in `~/.gtasks-mcp-config.json`
6. All future requests use this saved session

## Troubleshooting

### "Not authenticated" errors
- The proxy will automatically prompt for authentication
- Your session ID is saved in `~/.gtasks-mcp-config.json`
- Delete this file to force re-authentication

### Connection issues
- Verify your Railway server is running
- Check the URL in the env configuration
- Look at Claude Desktop logs for detailed errors

### Session expiration
- If your session expires, the proxy will prompt for re-authentication
- Simply follow the authentication flow again

## Advanced Configuration

You can set a custom remote URL:

```json
{
  "mcpServers": {
    "gtasks-remote": {
      "command": "node",
      "args": ["/path/to/dist/mcp-proxy.js"],
      "env": {
        "GTASKS_REMOTE_URL": "https://your-custom-domain.com"
      }
    }
  }
}
```

## Benefits

- ✅ Access Google Tasks from anywhere
- ✅ No local Google credentials needed
- ✅ Automatic authentication flow
- ✅ Session persistence
- ✅ Works with any Railway/cloud deployment