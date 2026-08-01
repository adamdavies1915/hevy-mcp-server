# Hevy MCP Server

A remote Model Context Protocol (MCP) server for the Hevy fitness tracking API, running on Node in Docker.

## Overview

This project provides a remote MCP server that exposes Hevy API functionality as MCP tools,
so AI assistants such as Claude can read and write your workout data.

It runs as a Docker container behind a TLS-terminating reverse proxy. It was
originally built for Cloudflare Workers; the Durable Object and KV dependencies
have been replaced with an in-process session map and a SQLite-backed store so
it runs anywhere Node runs.


## Features

- **OAuth 2.1**: Acts as its own authorization server with dynamic client
  registration, so Claude can connect as a custom connector
- **Multi-user**: Each user signs in with GitHub and stores their own Hevy API
  key, encrypted at rest; a shared key can be supplied by environment instead
- **Remote Access**: Works from any MCP client via streamable-http transport
- **Self-hosted**: Single container plus a volume, no managed services required
- **Future-Proof**: Uses streamable-http transport (SSE is deprecated in MCP spec)

## Available Tools

The server provides comprehensive access to the Hevy API with 18 tools:

### Workouts

#### `get_workouts`
Get a paginated list of workouts with details.
- **Parameters:** `page` (default: 1), `page_size` (default: 10, max: 10)

#### `get_workout`
Get a single workout by ID with full details.
- **Parameters:** `workout_id` (string)

#### `create_workout`
Log a new workout with exercises and sets.
- **Parameters:** `title`, `start_time`, `end_time`, `exercises` (array), `description`, `is_private`
- **Note:** Each exercise requires a `title` field (for display/reference only - not sent to API) and `exercise_template_id`. Order is determined by array position.

#### `update_workout`
Update an existing workout.
- **Parameters:** `workout_id` (string), workout data (same as create_workout)

#### `get_workouts_count`
Get the total number of workouts in your account.
- **Parameters:** None

#### `get_workout_events`
Get workout change events (updates/deletes) since a date for syncing.
- **Parameters:** `since` (ISO 8601 date string)

### Routines

#### `get_routines`
Get a paginated list of workout routines.
- **Parameters:** `page` (default: 1), `page_size` (default: 5, max: 10)

#### `get_routine`
Get a single routine by ID with full exercise details.
- **Parameters:** `routine_id` (string)

#### `create_routine`
Create a new workout routine/program.
- **Parameters:** `title`, `exercises` (array), `folder_id`, `notes`
- **Note:** Exercise structure uses only `exercise_template_id` (no `title` or `index` fields needed). Sets also don't require `index` fields.

#### `update_routine`
Update an existing routine.
- **Parameters:** `routine_id` (string), routine data (same as create_routine)

### Exercise Templates

#### `get_exercise_templates`
Get available exercise templates (both built-in and custom).
- **Parameters:** `page` (default: 1), `page_size` (default: 20, max: 100)

#### `search_exercise_templates`
Find exercise templates by name. The Hevy API has no search parameter, so the
catalogue is fetched once, cached in the KV store for 24 hours per user, and
filtered locally — ranking exact matches first and the user's custom exercises
above built-ins. `create_exercise_template` drops the cache so a new exercise
is findable immediately.
- **Parameters:** `query` (string), `limit` (default: 25), `refresh` (default: false)

#### `get_exercise_template`
Get detailed information about a specific exercise template.
- **Parameters:** `exercise_template_id` (string)

#### `create_exercise_template`
Create a custom exercise template.
- **Parameters:** `title`, `equipment_category`, `primary_muscle_group`, `secondary_muscle_groups`, `is_unilateral`

#### `get_exercise_history`
Get exercise history for tracking progress over time.
- **Parameters:** `exercise_template_id` (string), `start_date`, `end_date`

### Routine Folders

#### `get_routine_folders`
Get routine organization folders.
- **Parameters:** `page` (default: 1), `page_size` (default: 10, max: 10)

#### `get_routine_folder`
Get details of a specific routine folder.
- **Parameters:** `routine_folder_id` (string)

#### `create_routine_folder`
Create a new routine folder.
- **Parameters:** `title`

## Configuration

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GITHUB_CLIENT_ID` | yes | GitHub OAuth App client id |
| `GITHUB_CLIENT_SECRET` | yes | GitHub OAuth App client secret |
| `COOKIE_ENCRYPTION_KEY` | yes | 64-char hex key (`openssl rand -hex 32`); encrypts stored Hevy keys |
| `HEVY_API_KEY` | no | Fallback key used when a signed-in user has not stored their own |
| `ALLOWED_GITHUB_USERS` | required with `HEVY_API_KEY` | Comma-separated GitHub logins allowed to sign in |
| `PORT` | no | Listen port, default `3000` |
| `KV_PATH` | no | SQLite database path, default `/data/hevy-mcp.db` |

The server exits at startup if `HEVY_API_KEY` is set without
`ALLOWED_GITHUB_USERS` — that combination would let any GitHub account use the
deployment's Hevy key.

### Project Structure

```
hevy-mcp-server/
├── src/
│   ├── server.ts            # Node entrypoint: builds Env, serves the app, handles shutdown
│   ├── app.ts               # Hono application with routing & middleware
│   ├── env.ts               # Env interface, isAllowedUser()
│   ├── mcp-server.ts        # createHevyMcpServer() — all 18 tool definitions
│   ├── middleware/
│   │   └── auth.ts          # Bearer token authentication middleware
│   ├── routes/
│   │   ├── mcp.ts           # Streamable HTTP transport + session registry
│   │   └── utility.ts       # Health check, stats, home page
│   └── lib/
│       ├── client.ts        # Hevy API client wrapper
│       ├── kv.ts            # SqliteKV — the KV API over SQLite
│       ├── responses.ts     # Unwraps the API's inconsistent response shapes
│       ├── exercise-search.ts # Local matching and ranking over the catalogue
│       ├── template-cache.ts  # Caches the exercise catalogue in KV
│       ├── schemas.ts       # Zod validation schemas
│       ├── transforms.ts    # Data validation & transformation
│       ├── errors.ts        # Error handling utilities
│       └── key-storage.ts   # Encrypted API key storage
├── test/                    # Vitest suite
├── Dockerfile
├── .env.example
├── api.json                 # Hevy API OpenAPI specification
├── package.json
└── CLAUDE.md                # This file
```

## Local Development

### Prerequisites

- Node.js 22+
- A GitHub OAuth App pointing at `http://localhost:3000/callback`
- Hevy Pro account with an API key

### Setup

1. Install dependencies:
```bash
npm install
```

2. Configure the environment:
```bash
cp .env.example .env
# Fill in GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, COOKIE_ENCRYPTION_KEY
# Set KV_PATH to something local, e.g. ./data/hevy-mcp.db
```

3. Start the development server:
```bash
npm run dev
```

Server runs at http://localhost:3000/mcp (streamable HTTP).

### Testing Locally

**MCP Inspector:**
```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

**Test suite:**
```bash
npm test              # Vitest
npm run type-check    # tsc --noEmit
```

## Deployment

### Build

```bash
npm run build         # tsc -p tsconfig.build.json -> dist/
npm start             # node dist/server.js
```

### Docker

```bash
docker build -t hevy-mcp-server .
docker run -p 3000:3000 --env-file .env -v hevy-data:/data hevy-mcp-server
```

The image is multi-stage: it compiles TypeScript and builds better-sqlite3 in a
build stage, then copies `dist/` and the pruned production `node_modules` into a
slim runtime image running as the `node` user. `/data` must be a mounted volume
or sessions and stored API keys are lost on redeploy.

### Coolify

Deployed as a Dockerfile application with a persistent volume mounted at
`/data`, `ports_exposes` set to `3000`, and the environment variables above set
as application env vars. Traefik terminates TLS and routes the configured
domain to the container.

### Verify Deployment

```bash
curl https://your-domain/health
curl https://your-domain/.well-known/oauth-authorization-server
```

## Connecting to the MCP Server

### Claude on the web

Settings > Connectors > Add custom connector > `https://your-domain/mcp`.
Claude performs dynamic client registration and the OAuth 2.1 authorization
code flow against this server, which in turn authenticates you against GitHub.

### Claude Desktop

```json
{
  "mcpServers": {
    "hevy": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-domain/mcp"]
    }
  }
}
```


## API Reference

This server implements the Hevy API v1. Full API documentation available in `api.json`.

**Base API URL:** https://api.hevyapp.com/v1

**Implemented Endpoints:**
- ✅ `/v1/workouts` - Get/create/update workouts
- ✅ `/v1/workouts/{id}` - Get/update specific workout
- ✅ `/v1/workouts/count` - Get total workout count
- ✅ `/v1/workout_events` - Get workout change events
- ✅ `/v1/routines` - Get/create/update routines
- ✅ `/v1/routines/{id}` - Get/update specific routine
- ✅ `/v1/exercise_templates` - Get/create exercise templates
- ✅ `/v1/exercise_templates/{id}` - Get specific exercise template
- ✅ `/v1/exercise_history/{id}` - Get exercise history
- ✅ `/v1/routine_folders` - Get/create routine folders
- ✅ `/v1/routine_folders/{id}` - Get specific routine folder

## Tech Stack

- **Runtime:** Node.js 22 in Docker
- **Language:** TypeScript (ESM, compiled with tsc)
- **Framework:** Hono v4 with @hono/node-server
- **MCP SDK:** @modelcontextprotocol/sdk v1.30 via @hono/mcp
- **Storage:** better-sqlite3
- **Validation:** Zod
- **Testing:** Vitest

## Architecture

### Application Structure

**Entry Point (`src/server.ts`):**
- Reads configuration from `process.env` and validates it
- Opens the SQLite KV store and assembles the `Env` object the app expects
- Merges that `Env` with the bindings @hono/node-server passes per request
- Handles SIGTERM/SIGINT by closing MCP sessions and the database

**Main Application (`src/app.ts`):**
- Hono app with global CORS middleware
- Error handling middleware
- Route mounting in priority order:
  1. OAuth/API routes (github-handler)
  2. MCP endpoints (/mcp)
  3. Utility routes (/health, /stats, /)

**MCP Server (`src/mcp-server.ts`):**
- `createHevyMcpServer(props, env)` returns an `McpServer` bound to one user
- Resolves that user's Hevy API key: their stored key first, then `HEVY_API_KEY`
- Registers all 18 MCP tools with Zod-validated inputs

### Sessions

MCP sessions are held in a module-level `Map` in `src/routes/mcp.ts`:

- An initialize request with no `mcp-session-id` builds a fresh `McpServer` plus
  `StreamableHTTPTransport`, and the transport's `onsessioninitialized` callback
  registers the pair under its generated session id.
- Subsequent requests look the session up by header. The stored GitHub login is
  compared against the caller's, so a leaked session id is not enough to use
  someone else's connection.
- Sessions are dropped on DELETE, on transport close, and by an idle sweeper
  after an hour.

Because sessions live in process memory, this server is **single-instance**.
Running multiple replicas requires either sticky sessions or moving the session
registry into shared storage.

### Storage

`SqliteKV` (`src/lib/kv.ts`) implements the `get`/`put`/`delete`/`list` subset of
the Cloudflare KV API the OAuth handler was written against, including
`expirationTtl`. Expired rows are filtered on read and swept hourly. This kept
`github-handler.ts`, `middleware/auth.ts` and `lib/key-storage.ts` unchanged.

Key namespaces:
- `session:{token}` — OAuth sessions, 30 day TTL
- `oauth_state:{state}`, `authcode:{code}` — in-flight OAuth, 10 minute TTL
- `approval:{user}:{clientId}` — remembered client approvals, 1 year TTL
- `hevy_key:{user}` — AES-GCM encrypted Hevy API keys, no TTL
- `exercise_templates:{user}` — cached exercise catalogue, 24 hour TTL

### Transport

- **Streamable HTTP at `/mcp`** — the only supported transport
- **`/sse` returns 410** — the SSE transport was Durable Object backed and is
  deprecated in the MCP spec
- **`/health`** — health check used by the container healthcheck
- **`/stats`** — user, session and approval counts

### Security & Authentication

**OAuth 2.1:** The server is its own authorization server, implementing
discovery metadata, dynamic client registration, PKCE, and the authorization
code flow, with GitHub as the upstream identity provider.

**Allowlist:** `ALLOWED_GITHUB_USERS` is enforced in the OAuth callback (before
a session is minted) and again when an MCP server is built.

**Bearer tokens:** MCP endpoints require `Authorization: Bearer <token>`,
validated against `session:` records in the KV store, returning 401 with a
`WWW-Authenticate` header on failure.

**API keys:** Hevy keys are encrypted with AES-GCM under `COOKIE_ENCRYPTION_KEY`
and never returned to clients.


## Development Notes

### Adding New Tools

To add a new Hevy API endpoint:

1. **Add the method to HevyClient** (`src/lib/client.ts`):
```typescript
async getNewEndpoint(options?: { param?: string }): Promise<any> {
  return this.get<any>('/v1/new_endpoint', options as Record<string, string | number | boolean | undefined>);
}
```

2. **Register the tool** in `src/mcp-agent.ts` in the `init()` method:
```typescript
this.server.tool(
  "get_new_endpoint",
  {
    param: z.string().optional().describe("Parameter description"),
  },
  async ({ param }) => {
    try {
      const result = await this.client.getNewEndpoint({ param });

      return {
        content: [
          { type: "text", text: `Result: ${result.count}` },
          { type: "text", text: JSON.stringify(result, null, 2) }
        ],
      };
    } catch (error) {
      return handleError(error);
    }
  }
);
```

3. **Add tests** in `test/integration/mcp-tools.test.ts`:
```typescript
it("should get new endpoint data", async () => {
  const result = await mcpClient.callTool("get_new_endpoint", { param: "test" });
  expect(result).toBeDefined();
});
```

4. Test locally with `npm start`
5. Run tests with `npm test`
6. Run type check with `npm run type-check`
7. Deploy with `npm run deploy`

### Adding New Routes

To add a new HTTP route:

1. **Add to appropriate route file** (`src/routes/utility.ts` or create new):
```typescript
utilityRoutes.get("/new-route", (c) => {
  return c.json({ message: "Hello" });
});
```

2. **Add route tests** in `test/routes/utility.test.ts`:
```typescript
it("should handle new route", async () => {
  const response = await app.fetch(new Request("http://localhost/new-route"));
  expect(response.status).toBe(200);
});
```

3. **Mount route** in `src/app.ts` if creating a new route module

### File Watching

Wrangler automatically reloads on file changes during development.

### Testing

Run the comprehensive test suite:
```bash
npm test                 # Run all tests (272+ tests)
npm run type-check       # TypeScript compilation check
```

Test coverage includes:
- Unit tests for middleware, routes, and utilities
- Integration tests for MCP tools
- Error handling scenarios
- Authentication flows

## Port from Cloudflare Workers

This codebase originally ran on Cloudflare Workers. The port to Node replaced:

| Workers dependency | Replacement |
|--------------------|-------------|
| `McpAgent` Durable Object (`MCP_OBJECT`) | `StreamableHTTPTransport` from `@hono/mcp` with an in-process session map |
| KV namespace (`OAUTH_KV`) | `SqliteKV` over better-sqlite3 |
| `wrangler dev` / `wrangler deploy` | `npm run dev` / Docker image |
| Workers `fetch` export | `@hono/node-server` in `src/server.ts` |
| `wrangler secret` | Environment variables |

Everything above the runtime layer — the tool definitions, Hevy client, Zod
schemas, OAuth handler and encryption — carried over unchanged. `crypto.subtle`,
`btoa`/`atob` and `fetch` are all available as globals in Node 22.

The legacy `/sse` endpoint was dropped rather than ported.


## Troubleshooting

### Server exits immediately on start

It validates configuration first. Check the logs for a missing required
variable, a `COOKIE_ENCRYPTION_KEY` that is not 64 hex characters, or
`HEVY_API_KEY` set without `ALLOWED_GITHUB_USERS`.

### Signed out after every redeploy

`/data` is not on a persistent volume, so the SQLite database is recreated with
the container.

### "Session not found. Reinitialize the connection." (-32001)

The server restarted, or the session was idle for over an hour. Clients should
re-initialize; in Claude, disconnect and reconnect the connector.

### "Hevy API key not configured"

The signed-in user has no stored key and `HEVY_API_KEY` is unset. Visit
`/setup` to store one, or set the environment variable.

### 403 on sign-in

The GitHub login is not in `ALLOWED_GITHUB_USERS`.

### Testing endpoints

```bash
# Health check
curl https://your-domain/health

# OAuth discovery
curl https://your-domain/.well-known/oauth-authorization-server

# MCP without a token should return 401 + WWW-Authenticate
curl -i -X POST https://your-domain/mcp
```


## Resources

- [Hevy API Documentation](https://api.hevyapp.com/docs/) - Public API reference
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Hono Framework Documentation](https://hono.dev/)
- [Hono Node.js Guide](https://hono.dev/docs/getting-started/nodejs)
- [@hono/mcp](https://www.npmjs.com/package/@hono/mcp) - Streamable HTTP transport for Hono
- [mcp-remote adapter](https://www.npmjs.com/package/mcp-remote)

## License

Unlicense - see [LICENSE](LICENSE) file for details.

This project is not affiliated with Hevy. Hevy is a trademark of Hevy Studios Inc.

## Version

3.1.0 - Current Release (Hono Framework Refactor):
- 🎉 **Hono Framework Integration** - Complete refactor to use Hono for routing and middleware
- ✅ **Modular Architecture:**
  - Separated concerns: `app.ts` (routing), `mcp-agent.ts` (tools), `mcp-handlers.ts` (transports)
  - Clean middleware pattern with `src/middleware/auth.ts`
  - Organized routes in `src/routes/` directory
  - Ultra-clean `index.ts` (6 lines vs 670+ lines before)
- ✅ **Enhanced Testing:** 272+ tests across all components
  - Unit tests for middleware and routes
  - Integration tests for MCP tools
  - Comprehensive error handling tests
- ✅ **Better Developer Experience:**
  - Clear separation of concerns
  - Easier to add new routes and middleware
  - Improved type safety with Hono context
  - Factory pattern for dependency injection
- ✅ **Improved Error Handling:** Global error middleware with proper HTTP status codes
- ✅ **Enhanced CORS:** Global CORS middleware with OPTIONS preflight support
- 📝 Updated documentation to reflect new architecture

3.0.0 - Multi-User OAuth Release:
- ✅ **17 total tools** - Full CRUD operations across all Hevy API endpoints
- ✅ **Workouts:** get, get by ID, create, update, count, get events (sync support)
- ✅ **Routines:** get, get by ID, create, update
- ✅ **Exercise Templates:** get, get by ID, create, get history
- ✅ **Routine Folders:** get, get by ID, create
- ✅ **Data Cleaning:** Automatic removal of empty notes and extra fields from API responses
- ✅ **Comprehensive Testing:** Vitest integration with schema transformation tests
- 📝 Updated documentation to reflect complete API coverage

2.1.2 - Bug Fix Release:
- 🐛 Fixed routine creation issue: Removed incorrect `index` and `title` fields from routine exercises/sets
- ✅ Routines now correctly use only `exercise_template_id` without `index` or `title` fields
- 📝 Updated documentation to clarify different requirements for workouts vs routines

2.1.1 - Bug Fix Release:
- 🐛 Fixed missing `index` and `title` fields in create_workout and update_workout
- ✅ Auto-generate `index` fields for exercises and sets based on array position
- ✅ Added required `title` field to workout exercise schema (exercise name from template)

2.1.0 - Streamable HTTP Migration:
- ✅ Migrated from SSE to streamable-http transport (future-proof)
- ✅ Updated to @modelcontextprotocol/sdk@1.20.0
- ✅ Maintained backward compatibility with legacy SSE endpoint
- ✅ Added health check endpoint for monitoring
