#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

// Configuration
const CONFIG_FILE = join(homedir(), '.gtasks-mcp-config.json');
const REMOTE_URL = process.env.GTASKS_REMOTE_URL || 'https://gtasks-mcp-production.up.railway.app';

interface Config {
  sessionId?: string;
  remoteUrl: string;
}

// Load or create configuration
function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    // Ignore errors
  }
  return { remoteUrl: REMOTE_URL };
}

function saveConfig(config: Config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Initialize MCP server
const server = new Server(
  {
    name: "gtasks-remote",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

// Helper to make authenticated requests
async function makeRequest(path: string, options: any = {}) {
  const config = loadConfig();
  
  if (!config.sessionId) {
    throw new Error('Not authenticated. Please run the authentication flow first.');
  }
  
  const response = await fetch(`${config.remoteUrl}${path}`, {
    ...options,
    headers: {
      'X-Session-ID': config.sessionId,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }
  
  return response.json();
}

// Authentication flow
async function authenticate() {
  const config = loadConfig();
  
  console.error('\n🔐 Google Tasks Authentication Required\n');
  console.error(`Please visit: ${config.remoteUrl}/auth/google\n`);
  console.error('After authenticating, you will receive a session ID.');
  console.error('Enter your session ID below:\n');
  
  // Open browser automatically if possible
  try {
    const openCommand = process.platform === 'darwin' ? 'open' : 
                       process.platform === 'win32' ? 'start' : 'xdg-open';
    execSync(`${openCommand} ${config.remoteUrl}/auth/google`);
  } catch (e) {
    // Ignore errors - user can open manually
  }
  
  // Read session ID from stdin
  process.stderr.write('Session ID: ');
  
  return new Promise<string>((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
      if (input.includes('\n')) {
        process.stdin.pause();
        resolve(input.trim());
      }
    });
    process.stdin.resume();
  });
}

// List resources handler
server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  try {
    const result: any = await makeRequest('/tasks');
    
    // Transform the response to MCP format
    const tasks = result.content?.[0]?.text ? JSON.parse(result.content[0].text) : [];
    
    return {
      resources: tasks.map((task: any) => ({
        uri: `gtasks:///${task.id}`,
        mimeType: "text/plain",
        name: task.title || "Untitled",
      })),
    };
  } catch (error: any) {
    if (error.message.includes('Not authenticated')) {
      // Trigger authentication
      const sessionId = await authenticate();
      const config = loadConfig();
      config.sessionId = sessionId;
      saveConfig(config);
      console.error('\n✅ Authentication successful! Please retry your request.\n');
      
      // Retry the request
      const retryResult: any = await makeRequest('/tasks');
      const retryTasks = retryResult.content?.[0]?.text ? JSON.parse(retryResult.content[0].text) : [];
      return {
        resources: retryTasks.map((task: any) => ({
          uri: `gtasks:///${task.id}`,
          mimeType: "text/plain",
          name: task.title || "Untitled",
        })),
      };
    }
    throw error;
  }
});

// Read resource handler
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const taskId = request.params.uri.replace('gtasks:///', '');
  const result = await makeRequest(`/tasks/${taskId}`);
  
  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/plain",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
});

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search",
        description: "Search for tasks in Google Tasks",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list",
        description: "List all tasks in Google Tasks",
        inputSchema: {
          type: "object",
          properties: {
            cursor: {
              type: "string",
              description: "Cursor for pagination",
            },
          },
        },
      },
      {
        name: "create",
        description: "Create a new task in Google Tasks",
        inputSchema: {
          type: "object",
          properties: {
            taskListId: {
              type: "string",
              description: "Task list ID",
            },
            title: {
              type: "string",
              description: "Task title",
            },
            notes: {
              type: "string",
              description: "Task notes",
            },
            due: {
              type: "string",
              description: "Due date",
            },
          },
          required: ["title"],
        },
      },
      {
        name: "update",
        description: "Update a task in Google Tasks",
        inputSchema: {
          type: "object",
          properties: {
            taskListId: {
              type: "string",
              description: "Task list ID",
            },
            id: {
              type: "string",
              description: "Task ID",
            },
            uri: {
              type: "string",
              description: "Task URI",
            },
            title: {
              type: "string",
              description: "Task title",
            },
            notes: {
              type: "string",
              description: "Task notes",
            },
            status: {
              type: "string",
              enum: ["needsAction", "completed"],
              description: "Task status (needsAction or completed)",
            },
            due: {
              type: "string",
              description: "Due date",
            },
          },
          required: ["id", "uri"],
        },
      },
      {
        name: "delete",
        description: "Delete a task in Google Tasks",
        inputSchema: {
          type: "object",
          properties: {
            taskListId: {
              type: "string",
              description: "Task list ID",
            },
            id: {
              type: "string",
              description: "Task id",
            },
          },
          required: ["id", "taskListId"],
        },
      },
      {
        name: "clear",
        description: "Clear completed tasks from a Google Tasks task list",
        inputSchema: {
          type: "object",
          properties: {
            taskListId: {
              type: "string",
              description: "Task list ID",
            },
          },
          required: ["taskListId"],
        },
      },
    ],
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    let result;
    
    switch (name) {
      case "search":
        result = await makeRequest(`/tasks/search?q=${encodeURIComponent((args?.query as string) || '')}`);
        break;
        
      case "list":
        const query = args?.cursor ? `?cursor=${args.cursor}` : '';
        result = await makeRequest(`/tasks${query}`);
        break;
        
      case "create":
        result = await makeRequest('/tasks', {
          method: 'POST',
          body: JSON.stringify(args || {}),
        });
        break;
        
      case "update":
        const { id, ...updateData } = args || {};
        result = await makeRequest(`/tasks/${id}`, {
          method: 'PUT',
          body: JSON.stringify(updateData),
        });
        break;
        
      case "delete":
        result = await makeRequest(`/tasks/${args?.id}?taskListId=${args?.taskListId}`, {
          method: 'DELETE',
        });
        break;
        
      case "clear":
        result = await makeRequest('/tasks/clear', {
          method: 'POST',
          body: JSON.stringify(args || {}),
        });
        break;
        
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error: any) {
    if (error.message.includes('Not authenticated')) {
      // Trigger authentication
      const sessionId = await authenticate();
      const config = loadConfig();
      config.sessionId = sessionId;
      saveConfig(config);
      console.error('\n✅ Authentication successful! Please retry your request.\n');
      
      // Just throw error to have user retry
      throw new Error('Authentication completed. Please retry your request.');
    }
    throw error;
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Log to stderr so it doesn't interfere with stdio protocol
  console.error('Google Tasks Remote MCP Proxy started');
  console.error(`Connected to: ${REMOTE_URL}`);
  
  const config = loadConfig();
  if (config.sessionId) {
    console.error('✓ Using existing session');
  } else {
    console.error('! Authentication required on first use');
  }
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});