#!/usr/bin/env node

import express from 'express';
import { google, tasks_v1 } from "googleapis";
import { TaskActions, TaskResources } from "./Tasks.js";
import fs from "fs";
import path from "path";
import cors from 'cors';

const app = express();
app.use(express.json());
app.set('trust proxy', true); // Trust OAuth2 Proxy headers

// Enable CORS for Railway private network
app.use(cors({
  origin: [
    'http://oauth2-proxy.railway.internal',
    'https://oauth2-proxy-production-9eaf.up.railway.app',
    'http://localhost:4180'
  ],
  credentials: true
}));

const tasks = google.tasks("v1");

// Storage for user tokens (use Redis/database in production)
const userTokenStore = new Map<string, any>();

// Helper to get storage path for user tokens
function getUserTokenPath(email: string): string {
  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
  return path.join(
    path.dirname(new URL(import.meta.url).pathname),
    `../.gtasks-tokens-${safeEmail}.json`
  );
}

// Load user tokens from file if exists
function loadUserTokens(email: string): any {
  try {
    const tokenPath = getUserTokenPath(email);
    if (fs.existsSync(tokenPath)) {
      return JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
    }
  } catch (e) {
    console.error(`Failed to load tokens for ${email}:`, e);
  }
  return null;
}

// Save user tokens to file
function saveUserTokens(email: string, tokens: any) {
  try {
    const tokenPath = getUserTokenPath(email);
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    userTokenStore.set(email, tokens);
  } catch (e) {
    console.error(`Failed to save tokens for ${email}:`, e);
  }
}

// Extend Express Request type
interface AuthenticatedRequest extends express.Request {
  userEmail?: string;
  userName?: string;
  hasGoogleAuth?: boolean;
}

// Middleware to extract user from OAuth2 Proxy headers
function requireProxyAuth(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  const userEmail = req.headers['x-auth-request-email'] || req.headers['x-forwarded-email'];
  const userName = req.headers['x-auth-request-user'] || req.headers['x-forwarded-user'];
  
  if (!userEmail) {
    return res.status(401).json({ 
      error: 'Not authenticated',
      message: 'No user email found in proxy headers'
    });
  }
  
  req.userEmail = userEmail as string;
  req.userName = userName as string;
  
  // Load or get user tokens
  let tokens = userTokenStore.get(req.userEmail) || loadUserTokens(req.userEmail);
  
  if (tokens) {
    // Set up Google OAuth client with user's tokens
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.OAUTH2_PROXY_EXTERNAL_URL || 'http://localhost:4180'}/google-api-callback`
    );
    oauth2Client.setCredentials(tokens);
    google.options({ auth: oauth2Client });
    req.hasGoogleAuth = true;
  } else {
    req.hasGoogleAuth = false;
  }
  
  next();
}

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'gtasks-mcp-behind-proxy',
    port: process.env.PORT || 8080,
    proxyTrust: app.get('trust proxy')
  });
});

// Root endpoint - show status
app.get('/', requireProxyAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    service: 'Google Tasks MCP Server',
    user: req.userEmail,
    googleApiAuthorized: req.hasGoogleAuth,
    setupUrl: req.hasGoogleAuth ? null : '/setup-google-auth'
  });
});

// Google API authorization setup
app.get('/setup-google-auth', requireProxyAuth, (req: AuthenticatedRequest, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.OAUTH2_PROXY_EXTERNAL_URL || 'http://localhost:4180'}/google-api-callback`
  );
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/tasks'],
    state: req.userEmail, // Pass email in state
    prompt: 'consent'
  });
  
  res.redirect(authUrl);
});

// Google API callback
app.get('/google-api-callback', async (req, res) => {
  try {
    const { code, state: userEmail } = req.query;
    
    if (!code || !userEmail) {
      return res.status(400).send('Missing code or state');
    }
    
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.OAUTH2_PROXY_EXTERNAL_URL || 'http://localhost:4180'}/google-api-callback`
    );
    
    const { tokens } = await oauth2Client.getToken(code as string);
    saveUserTokens(userEmail as string, tokens);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google API Authorization Complete</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .success { color: #4caf50; font-size: 24px; }
        </style>
      </head>
      <body>
        <div class="success">✓ Google Tasks API Authorized!</div>
        <p>You can now use the Google Tasks API.</p>
        <p><a href="/">Return to Home</a></p>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Google API callback error:', error);
    res.status(500).send('Failed to authorize Google API');
  }
});

// List tasks endpoint
app.get('/tasks', requireProxyAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.hasGoogleAuth) {
    return res.status(401).json({
      error: 'Google API not authorized',
      message: 'Please authorize Google API access first',
      setupUrl: '/setup-google-auth'
    });
  }
  
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
  } catch (error: any) {
    console.error('Error listing tasks:', error);
    if (error.code === 401) {
      // Token expired, clear it
      userTokenStore.delete(req.userEmail!);
      try {
        fs.unlinkSync(getUserTokenPath(req.userEmail!));
      } catch (e) {
        // Ignore if file doesn't exist
      }
      return res.status(401).json({
        error: 'Google API token expired',
        message: 'Please re-authorize',
        setupUrl: '/setup-google-auth'
      });
    }
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// Search tasks endpoint
app.get('/tasks/search', requireProxyAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.hasGoogleAuth) {
    return res.status(401).json({
      error: 'Google API not authorized',
      setupUrl: '/setup-google-auth'
    });
  }
  
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

// Get single task endpoint
app.get('/tasks/:taskId', requireProxyAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.hasGoogleAuth) {
    return res.status(401).json({
      error: 'Google API not authorized',
      setupUrl: '/setup-google-auth'
    });
  }
  
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

// Create task endpoint
app.post('/tasks', requireProxyAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.hasGoogleAuth) {
    return res.status(401).json({
      error: 'Google API not authorized',
      setupUrl: '/setup-google-auth'
    });
  }
  
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

// Update task endpoint
app.put('/tasks/:taskId', requireProxyAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.hasGoogleAuth) {
    return res.status(401).json({
      error: 'Google API not authorized',
      setupUrl: '/setup-google-auth'
    });
  }
  
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

// Delete task endpoint
app.delete('/tasks/:taskId', requireProxyAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.hasGoogleAuth) {
    return res.status(401).json({
      error: 'Google API not authorized',
      setupUrl: '/setup-google-auth'
    });
  }
  
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

// Clear completed tasks endpoint
app.post('/tasks/clear', requireProxyAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.hasGoogleAuth) {
    return res.status(401).json({
      error: 'Google API not authorized',
      setupUrl: '/setup-google-auth'
    });
  }
  
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

// Start server on port 8080 (OAuth2 Proxy expects this)
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '::'; // Bind to IPv6 for Railway private networking

app.listen(PORT, HOST, () => {
  console.log(`Google Tasks HTTP server (behind proxy) running on [${HOST}]:${PORT}`);
  console.log('Expecting OAuth2 Proxy headers: x-auth-request-email, x-auth-request-user');
  console.log(`External URL: ${process.env.OAUTH2_PROXY_EXTERNAL_URL || 'Not set'}`);
  console.log('Listening on IPv6 for Railway private networking');
  
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('WARNING: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set!');
  }
});