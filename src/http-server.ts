#!/usr/bin/env node

import express from 'express';
import { authenticate } from "@google-cloud/local-auth";
import { google, tasks_v1 } from "googleapis";
import { TaskActions, TaskResources } from "./Tasks.js";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

const tasks = google.tasks("v1");

// Initialize auth from environment variables or file
async function initializeAuth() {
  let credentials;
  
  // Try to load from environment variable first
  if (process.env.GOOGLE_TASKS_CREDENTIALS) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_TASKS_CREDENTIALS);
    } catch (e) {
      console.error("Failed to parse GOOGLE_TASKS_CREDENTIALS from environment");
      throw e;
    }
  } else {
    // Fallback to file
    const credentialsPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../.gtasks-server-credentials.json",
    );
    
    if (!fs.existsSync(credentialsPath)) {
      throw new Error("No credentials found. Set GOOGLE_TASKS_CREDENTIALS env var or run auth flow.");
    }
    
    credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
  }
  
  const auth = new google.auth.OAuth2();
  auth.setCredentials(credentials);
  google.options({ auth });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gtasks-mcp-server' });
});

// List tasks endpoint
app.get('/tasks', async (req, res) => {
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

// Search tasks endpoint
app.get('/tasks/search', async (req, res) => {
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
app.get('/tasks/:taskId', async (req, res) => {
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
app.post('/tasks', async (req, res) => {
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
app.put('/tasks/:taskId', async (req, res) => {
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
app.delete('/tasks/:taskId', async (req, res) => {
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
app.post('/tasks/clear', async (req, res) => {
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

initializeAuth()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Google Tasks HTTP server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize authentication:', error);
    process.exit(1);
  });