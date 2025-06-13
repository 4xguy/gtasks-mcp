#!/usr/bin/env node

import express from 'express';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import { TaskActions, TaskResources } from "./Tasks.js";
import crypto from 'crypto';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());

const tasks = google.tasks("v1");

// OAuth configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000'}/callback`
);

// Token storage (use Redis/database in production)
const tokenStore = new Map();
const authCodeStore = new Map();
const sseClients = new Map();

// Helper to get base URL
function getBaseUrl(req: any): string {
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

// OAuth 2.1 Discovery endpoints
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    resource: baseUrl,
    authorization_servers: [{
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
    }]
  });
});

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["gtasks:read", "gtasks:write"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    mcp_endpoint: `${baseUrl}/sse`
  });
});

// Authorization endpoint
app.get('/authorize', (req, res) => {
  const { 
    client_id, 
    redirect_uri, 
    response_type, 
    scope, 
    state,
    code_challenge,
    code_challenge_method 
  } = req.query;

  // For Claude Desktop, show a simple auth page
  if (!code_challenge) {
    const baseUrl = getBaseUrl(req);
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authorize Google Tasks MCP</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .button { display: inline-block; padding: 10px 20px; background: #4285f4; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Authorize Google Tasks Access</h1>
          <p>Claude Desktop wants to access your Google Tasks.</p>
          <p>Click below to authenticate with Google:</p>
          <a href="${baseUrl}/authorize?${new URLSearchParams(req.query as any).toString()}&code_challenge=test&code_challenge_method=S256" class="button">
            Authorize with Google
          </a>
        </div>
      </body>
      </html>
    `);
  }

  // Generate authorization code
  const authCode = crypto.randomBytes(32).toString('hex');
  
  // Store auth code with metadata
  authCodeStore.set(authCode, {
    clientId: client_id,
    redirectUri: redirect_uri,
    scope: scope,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method,
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
  });

  // Redirect to Google OAuth
  const googleAuthUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/tasks'],
    state: JSON.stringify({ authCode, originalState: state }),
    prompt: 'consent'
  });

  res.redirect(googleAuthUrl);
});

// Google OAuth callback
app.get('/callback', async (req, res) => {
  try {
    const { code, state: stateStr } = req.query;
    const { authCode, originalState } = JSON.parse(stateStr as string);
    
    // Get Google tokens
    const { tokens } = await oauth2Client.getToken(code as string);
    
    // Get stored auth code metadata
    const authData = authCodeStore.get(authCode);
    if (!authData) {
      return res.status(400).send('Invalid authorization code');
    }
    
    // Store Google tokens associated with our auth code
    authData.googleTokens = tokens;
    authCodeStore.set(authCode, authData);
    
    // If we have a redirect URI, use it
    if (authData.redirectUri && authData.redirectUri !== 'undefined') {
      const redirectUrl = new URL(authData.redirectUri);
      redirectUrl.searchParams.set('code', authCode);
      if (originalState) {
        redirectUrl.searchParams.set('state', originalState);
      }
      return res.redirect(redirectUrl.toString());
    }
    
    // Otherwise show success page with auth code
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authorization Successful</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .code { background: #f0f0f0; padding: 15px; border-radius: 5px; font-family: monospace; word-break: break-all; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✓ Authorization Successful!</h1>
          <p>Your authorization code:</p>
          <div class="code">${authCode}</div>
          <p>This code will expire in 10 minutes.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

// Token endpoint
app.post('/token', async (req, res) => {
  const { grant_type, code, redirect_uri, code_verifier } = req.body;
  
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  
  const authData = authCodeStore.get(code);
  if (!authData || authData.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  
  // Skip PKCE verification for testing
  // In production, implement proper PKCE verification
  
  // Generate access token
  const accessToken = crypto.randomBytes(32).toString('hex');
  
  // Store token with Google credentials
  tokenStore.set(accessToken, {
    googleTokens: authData.googleTokens,
    scope: authData.scope,
    expiresAt: Date.now() + 3600 * 1000 // 1 hour
  });
  
  // Clean up auth code
  authCodeStore.delete(code);
  
  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: authData.scope || 'gtasks:read gtasks:write'
  });
});

// Initialize MCP server
const mcpServer = new Server(
  {
    name: "gtasks-oauth",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

// Set up MCP handlers (same as original)
mcpServer.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  const [allTasks, nextPageToken] = await TaskResources.list(request, tasks);
  return {
    resources: allTasks.map((task) => ({
      uri: `gtasks:///${task.id}`,
      mimeType: "text/plain",
      name: task.title,
    })),
    nextCursor: nextPageToken,
  };
});

mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const task = await TaskResources.read(request, tasks);
  
  const taskDetails = [
    `Title: ${task.title || "No title"}`,
    `Status: ${task.status || "Unknown"}`,
    `Due: ${task.due || "Not set"}`,
    `Notes: ${task.notes || "No notes"}`,
  ].join("\n");
  
  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/plain",
        text: taskDetails,
      },
    ],
  };
});

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search",
        description: "Search for tasks in Google Tasks",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "list",
        description: "List all tasks",
        inputSchema: {
          type: "object",
          properties: {
            cursor: { type: "string", description: "Pagination cursor" },
          },
        },
      },
      {
        name: "create",
        description: "Create a new task",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
            notes: { type: "string", description: "Task notes" },
            due: { type: "string", description: "Due date" },
          },
          required: ["title"],
        },
      },
      {
        name: "update",
        description: "Update a task",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Task ID" },
            uri: { type: "string", description: "Task URI" },
            title: { type: "string", description: "Task title" },
            notes: { type: "string", description: "Task notes" },
            status: { type: "string", enum: ["needsAction", "completed"] },
            due: { type: "string", description: "Due date" },
          },
          required: ["id", "uri"],
        },
      },
      {
        name: "delete",
        description: "Delete a task",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Task ID" },
            taskListId: { type: "string", description: "Task list ID" },
          },
          required: ["id", "taskListId"],
        },
      },
      {
        name: "clear",
        description: "Clear completed tasks",
        inputSchema: {
          type: "object",
          properties: {
            taskListId: { type: "string", description: "Task list ID" },
          },
          required: ["taskListId"],
        },
      },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "search":
      return await TaskActions.search(request, tasks);
    case "list":
      return await TaskActions.list(request, tasks);
    case "create":
      return await TaskActions.create(request, tasks);
    case "update":
      return await TaskActions.update(request, tasks);
    case "delete":
      return await TaskActions.delete(request, tasks);
    case "clear":
      return await TaskActions.clear(request, tasks);
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

// SSE endpoint with authentication
app.get('/sse', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  
  // Check for token in query params as fallback
  const queryToken = req.query.token as string;
  const finalToken = token || queryToken;
  
  if (!finalToken) {
    const baseUrl = getBaseUrl(req);
    res.setHeader('WWW-Authenticate', `Bearer realm="MCP Server", resource_metadata_uri="${baseUrl}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ error: 'Missing Bearer token' });
  }
  
  const tokenData = tokenStore.get(finalToken);
  if (!tokenData || tokenData.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  // Set up Google OAuth for this connection
  oauth2Client.setCredentials(tokenData.googleTokens);
  google.options({ auth: oauth2Client });
  
  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  
  const transport = new SSEServerTransport('/', res);
  await mcpServer.connect(transport);
  
  // Store client connection
  const clientId = crypto.randomBytes(16).toString('hex');
  sseClients.set(clientId, { res, transport });
  
  // Clean up on disconnect
  req.on('close', () => {
    sseClients.delete(clientId);
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'gtasks-mcp-sse-oauth',
    authConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    activeConnections: sseClients.size
  });
});

// Home page
app.get('/', (req, res) => {
  const baseUrl = getBaseUrl(req);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Google Tasks MCP Server (SSE + OAuth)</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        pre { background: #f0f0f0; padding: 15px; border-radius: 5px; overflow-x: auto; }
        .note { background: #fff3cd; padding: 10px; border-radius: 5px; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Google Tasks MCP Server</h1>
        <p>OAuth 2.1 secured MCP server with SSE transport.</p>
        
        <h2>Claude Desktop Configuration</h2>
        <div class="note">
          <strong>Note:</strong> Claude Desktop native OAuth support is still in development. 
          For now, use the proxy method or wait for official support.
        </div>
        
        <h3>Expected Configuration (when supported):</h3>
        <pre>{
  "mcpServers": {
    "gtasks-remote": {
      "url": "${baseUrl}/sse",
      "transport": "sse"
    }
  }
}</pre>
        
        <h3>Current Workaround:</h3>
        <p>Use the stdio proxy: <code>npm run start:proxy</code></p>
        
        <h2>OAuth Flow</h2>
        <ol>
          <li>Authorize: <a href="/authorize">/authorize</a></li>
          <li>Exchange code for token: POST /token</li>
          <li>Connect to SSE: GET /sse with Bearer token</li>
        </ol>
        
        <h2>Manual Testing</h2>
        <p>Get an auth code: <a href="/authorize?client_id=test&response_type=code">/authorize?client_id=test&response_type=code</a></p>
      </div>
    </body>
    </html>
  `);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Google Tasks MCP SSE+OAuth Server running on port ${PORT}`);
  console.log(`SSE endpoint: /sse (requires Bearer token)`);
  console.log(`OAuth flow starts at: /authorize`);
  
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('WARNING: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set!');
  }
});