# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Google Tasks MCP (Model Context Protocol) server that enables AI assistants to interact with Google Tasks API. The server is written in TypeScript and uses the MCP SDK with stdio transport.

## Common Development Commands

### Build and Development
- `npm run build` - Compile TypeScript to JavaScript and set executable permissions
- `npm run dev` - Watch mode for development (automatically recompiles on changes)
- `npm run start` - Run the compiled server
- `npm run start auth` - Run authentication flow to obtain Google OAuth credentials

### Authentication Setup
1. Requires `gcp-oauth.keys.json` file with Google OAuth client credentials
2. First-time setup: Run `npm run start auth` to authenticate
3. Credentials are saved to `.gtasks-server-credentials.json`

## Architecture and Code Structure

### Main Components
- **src/index.ts**: Server entry point that:
  - Sets up MCP server with stdio transport
  - Handles authentication flow and credential management
  - Registers all task-related tools and resources
  - Routes requests to appropriate handlers

- **src/Tasks.ts**: Business logic layer containing:
  - `TaskResources`: Handles resource exposure for gtasks:/// URIs
  - `TaskActions`: Implements all task operations (search, list, create, update, delete, clear)
  - Direct integration with Google Tasks API v1

### MCP Tools Exposed
- `search` - Search tasks by query
- `list` - List all tasks with pagination support
- `create` - Create new tasks with title, notes, and due date
- `update` - Update existing tasks (title, notes, status, due date)
- `delete` - Delete tasks by ID
- `clear` - Clear completed tasks from a task list

### Key Technical Details
- TypeScript strict mode enabled
- Targets ES2022 with Node16 module resolution
- Uses Google Cloud local authentication library for OAuth flow
- Supports both Docker deployment and direct Node.js execution
- All task IDs default to the primary task list (@default) if not specified

### Railway Deployment
- `npm run start:railway` - Run HTTP server for Railway deployment
- **src/http-server.ts**: Express-based HTTP API wrapper for Railway/web deployment
- Supports credentials via `GOOGLE_TASKS_CREDENTIALS` environment variable
- See RAILWAY_DEPLOYMENT.md for deployment instructions