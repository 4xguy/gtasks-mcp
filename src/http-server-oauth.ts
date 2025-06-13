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
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${process.env.RAILWAY_PUBLIC_DOMAIN || 'http://localhost:3000'}/auth/google/callback`
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

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state parameter' });
    }
    
    const { tokens } = await oauth2Client.getToken(code as string);
    authTokens.set(state as string, tokens);
    
    // Redirect to a success page or return JSON
    res.json({
      success: true,
      sessionId: state,
      message: 'Authentication successful! Use the sessionId in your API requests.',
      example: 'Add header: X-Session-ID: ' + state
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

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

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Google Tasks OAuth HTTP server running on port ${PORT}`);
  console.log(`OAuth callback URL: ${process.env.GOOGLE_REDIRECT_URI || 'Not set - will use default'}`);
  
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('WARNING: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set!');
  }
});