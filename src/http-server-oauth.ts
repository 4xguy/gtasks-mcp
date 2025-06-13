#!/usr/bin/env node

import express from 'express';
import { google } from "googleapis";
import { TaskActions, TaskResources } from "./Tasks.js";
import path from "path";
import { URL } from 'url';

const app = express();
app.use(express.json());

const tasks = google.tasks("v1");

// OAuth2 configuration
// Support multiple redirect URI patterns
const getRedirectUri = () => {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
    : 'http://localhost:3000';
  return `${baseUrl}/callback`; // Use /callback as default to match Google's redirect
};

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  getRedirectUri()
);

// Store auth tokens in memory (use Redis/database in production)
const authTokens = new Map();

// Middleware to check authentication
function requireAuth(req: any, res: any, next: any) {
  const sessionId = req.headers['x-session-id'] || req.query.sessionId;
  
  if (!sessionId || !authTokens.has(sessionId)) {
    return res.status(401).json({ 
      error: 'Not authenticated',
      authUrl: `/auth/google?sessionId=${sessionId || 'new'}`
    });
  }
  
  const tokens = authTokens.get(sessionId);
  oauth2Client.setCredentials(tokens);
  google.options({ auth: oauth2Client });
  
  next();
}

// Root endpoint - landing page
app.get('/', (req, res) => {
  const baseUrl = `https://${req.get('host')}`;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Google Tasks API Server</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background-color: #f5f5f5;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #333; }
        .auth-button {
          display: inline-block;
          padding: 10px 20px;
          background-color: #4285f4;
          color: white;
          text-decoration: none;
          border-radius: 5px;
          margin-top: 20px;
        }
        .auth-button:hover {
          background-color: #357ae8;
        }
        code {
          background: #f0f0f0;
          padding: 2px 5px;
          border-radius: 3px;
        }
        pre {
          background: #f0f0f0;
          padding: 15px;
          border-radius: 5px;
          overflow-x: auto;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Google Tasks API Server</h1>
        <p>This server provides REST API access to Google Tasks.</p>
        
        <h2>Getting Started</h2>
        <ol>
          <li>Click the button below to authenticate with Google</li>
          <li>After authentication, you'll receive a session ID</li>
          <li>Use the session ID in your API requests</li>
        </ol>
        
        <a href="/auth/google" class="auth-button">Authenticate with Google</a>
        
        <h2>API Endpoints</h2>
        <ul>
          <li><code>GET /tasks</code> - List all tasks</li>
          <li><code>GET /tasks/search?q=query</code> - Search tasks</li>
          <li><code>GET /tasks/:id</code> - Get a specific task</li>
          <li><code>POST /tasks</code> - Create a new task</li>
          <li><code>PUT /tasks/:id</code> - Update a task</li>
          <li><code>DELETE /tasks/:id</code> - Delete a task</li>
          <li><code>POST /tasks/clear</code> - Clear completed tasks</li>
        </ul>
        
        <h2>Authentication</h2>
        <p>After authenticating, include your session ID in requests:</p>
        <pre>curl ${baseUrl}/tasks \\
  -H "X-Session-ID: your-session-id"</pre>
        
        <h2>Status</h2>
        <p>Service Status: <a href="/health">/health</a></p>
      </div>
    </body>
    </html>
  `);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'gtasks-mcp-server',
    authConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  });
});

// OAuth routes
app.get('/auth/google', (req, res) => {
  const sessionId = req.query.sessionId || Math.random().toString(36).substring(7);
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/tasks'],
    state: sessionId as string,
    prompt: 'consent' // Force to get refresh token
  });
  
  res.redirect(authUrl);
});

// Support multiple callback paths for flexibility
const handleOAuthCallback = async (req: any, res: any) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state parameter' });
    }
    
    const { tokens } = await oauth2Client.getToken(code as string);
    authTokens.set(state as string, tokens);
    
    // Return a nice HTML page with the session ID
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background-color: #f5f5f5;
          }
          .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .success {
            color: #4caf50;
            font-size: 24px;
            margin-bottom: 20px;
          }
          .session-id {
            background: #f0f0f0;
            padding: 15px;
            border-radius: 5px;
            font-family: monospace;
            word-break: break-all;
          }
          pre {
            background: #f0f0f0;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
          }
          .back-link {
            display: inline-block;
            margin-top: 20px;
            color: #4285f4;
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success">✓ Authentication Successful!</div>
          
          <h2>Your Session ID</h2>
          <div class="session-id">${state}</div>
          
          <h2>How to Use</h2>
          <p>Include this session ID in your API requests using the <code>X-Session-ID</code> header:</p>
          
          <h3>Example: List Tasks</h3>
          <pre>curl https://${req.get('host')}/tasks \\
  -H "X-Session-ID: ${state}"</pre>
          
          <h3>Example: Create a Task</h3>
          <pre>curl -X POST https://${req.get('host')}/tasks \\
  -H "X-Session-ID: ${state}" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "New Task", "notes": "Task description"}'</pre>
          
          <a href="/" class="back-link">← Back to Home</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Register multiple callback routes to handle different configurations
app.get('/auth/google/callback', handleOAuthCallback);
app.get('/callback', handleOAuthCallback);  // Support root-level callback
app.get('/oauth2/callback', handleOAuthCallback);  // Support oauth2-proxy style

// Protected routes (same as before but with auth middleware)
app.get('/tasks', requireAuth, async (req, res) => {
  try {
    const cursor = req.query.cursor as string | undefined;
    const request = {
      params: {
        name: 'list',
        arguments: cursor ? { cursor } : {}
      }
    };
    const result = await TaskActions.list(request as any, tasks);
    res.json(result);
  } catch (error) {
    console.error('Error listing tasks:', error);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

app.get('/tasks/search', requireAuth, async (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    
    const request = {
      params: {
        name: 'search',
        arguments: { query }
      }
    };
    const result = await TaskActions.search(request as any, tasks);
    res.json(result);
  } catch (error) {
    console.error('Error searching tasks:', error);
    res.status(500).json({ error: 'Failed to search tasks' });
  }
});

app.get('/tasks/:taskId', requireAuth, async (req, res) => {
  try {
    const request = {
      params: {
        uri: `gtasks:///${req.params.taskId}`
      }
    };
    const task = await TaskResources.read(request as any, tasks);
    res.json(task);
  } catch (error) {
    console.error('Error reading task:', error);
    res.status(500).json({ error: 'Failed to read task' });
  }
});

app.post('/tasks', requireAuth, async (req, res) => {
  try {
    const { title, notes, due, taskListId } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    const request = {
      params: {
        name: 'create',
        arguments: {
          title,
          notes,
          due,
          taskListId: taskListId || '@default'
        }
      }
    };
    const result = await TaskActions.create(request as any, tasks);
    res.json(result);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.put('/tasks/:taskId', requireAuth, async (req, res) => {
  try {
    const { title, notes, status, due, taskListId } = req.body;
    const request = {
      params: {
        name: 'update',
        arguments: {
          id: req.params.taskId,
          uri: `gtasks:///${req.params.taskId}`,
          title,
          notes,
          status,
          due,
          taskListId: taskListId || '@default'
        }
      }
    };
    const result = await TaskActions.update(request as any, tasks);
    res.json(result);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/tasks/:taskId', requireAuth, async (req, res) => {
  try {
    const taskListId = req.query.taskListId as string || '@default';
    const request = {
      params: {
        name: 'delete',
        arguments: {
          id: req.params.taskId,
          taskListId
        }
      }
    };
    const result = await TaskActions.delete(request as any, tasks);
    res.json(result);
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

app.post('/tasks/clear', requireAuth, async (req, res) => {
  try {
    const { taskListId } = req.body;
    if (!taskListId) {
      return res.status(400).json({ error: 'taskListId is required' });
    }
    
    const request = {
      params: {
        name: 'clear',
        arguments: { taskListId }
      }
    };
    const result = await TaskActions.clear(request as any, tasks);
    res.json(result);
  } catch (error) {
    console.error('Error clearing tasks:', error);
    res.status(500).json({ error: 'Failed to clear tasks' });
  }
});

// Catch-all route for debugging
app.get('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    availableRoutes: [
      '/',
      '/health',
      '/auth/google',
      '/callback',
      '/auth/google/callback',
      '/oauth2/callback',
      '/tasks',
      '/tasks/search',
      '/tasks/:id'
    ]
  });
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Google Tasks OAuth HTTP server running on port ${PORT}`);
  console.log(`OAuth redirect URI: ${getRedirectUri()}`);
  console.log(`Accepting callbacks on: /callback, /auth/google/callback, /oauth2/callback`);
  
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('WARNING: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set!');
  }
  
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log(`Railway domain detected: ${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  }
});