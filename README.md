# Hevy Fitness MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with access to the [Hevy](https://www.hevyapp.com/) fitness tracking API. This allows you to log workouts, manage routines, browse exercises, and track your fitness progress directly through AI chat interfaces.

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/tomtorggler/hevy-mcp-server)

## 🏋️ Features

This MCP server provides comprehensive access to Hevy's fitness tracking capabilities:

### Workouts
- **`get_workouts`** - Browse your workout history (paginated)
- **`get_workout`** - Get detailed information about a specific workout
- **`create_workout`** - Log a new workout with exercises, sets, weights, and reps
- **`update_workout`** - Update an existing workout
- **`get_workouts_count`** - Get total number of workouts logged
- **`get_workout_events`** - Get workout change events (updates/deletes) since a date for syncing

### Routines
- **`get_routines`** - List your workout routines
- **`get_routine`** - Get details of a specific routine
- **`create_routine`** - Create a new workout routine template
- **`update_routine`** - Update an existing routine

### Exercises
- **`get_exercise_templates`** - Browse available exercises (includes both Hevy's library and your custom exercises)
- **`search_exercise_templates`** - Find exercises by name, e.g. "bench press"
- **`get_exercise_template`** - Get detailed information about a specific exercise template
- **`create_exercise_template`** - Create a custom exercise template
- **`get_exercise_history`** - View your performance history for a specific exercise

### Organization
- **`get_routine_folders`** - List your routine folders for organization
- **`get_routine_folder`** - Get details of a specific routine folder
- **`create_routine_folder`** - Create a new routine folder

## 🚀 Quick Start

### Prerequisites

1. **Hevy Pro subscription** - The Hevy API is only available to Pro users
2. **Hevy API Key** - Get yours at https://hevy.com/settings?developer
3. **A GitHub OAuth App** - Used to sign in to the server
4. **Docker host** - Anything that can run a container (Coolify, Fly, a VPS)

### Deploy with Docker

1. Clone this repository:
```bash
git clone https://github.com/adamdavies1915/hevy-mcp-server.git
cd hevy-mcp-server
```

2. Create a GitHub OAuth App at https://github.com/settings/developers with:
   - Homepage URL: `https://your-domain`
   - Authorization callback URL: `https://your-domain/callback`

3. Configure the environment (see `.env.example` for the full list):
```bash
cp .env.example .env
openssl rand -hex 32   # use this for COOKIE_ENCRYPTION_KEY
```

4. Build and run:
```bash
docker build -t hevy-mcp-server .
docker run -p 3000:3000 --env-file .env -v hevy-data:/data hevy-mcp-server
```

Put a TLS-terminating reverse proxy in front of it, and your MCP server is
available at `https://your-domain/mcp`.

**Persistence:** OAuth sessions and encrypted API keys live in a SQLite
database at `KV_PATH` (default `/data/hevy-mcp.db`). Mount `/data` on a volume
or every redeploy will sign you out.

### API keys: per-user or shared

Two ways to supply the Hevy API key:

- **Per-user (default)** - Each user signs in with GitHub, then visits `/setup`
  to store their own key. Keys are encrypted with `COOKIE_ENCRYPTION_KEY`.
- **Single-user** - Set `HEVY_API_KEY` in the environment and it is used for
  any signed-in user who has not stored one of their own. This requires
  `ALLOWED_GITHUB_USERS`, since otherwise anyone with a GitHub account could
  sign in and use your Hevy account. The server refuses to start without it.

### Local Development

```bash
npm install
cp .env.example .env    # fill in the GitHub OAuth credentials
npm run dev
```

The server will be available at `http://localhost:3000/mcp`.

Run the test suite and type checks with:
```bash
npm test
npm run type-check
```

## 🔌 Connect to AI Clients

### Claude on the web

1. Go to Settings > Connectors > Add custom connector
2. Enter your server URL: `https://your-domain/mcp`
3. Click Connect and sign in with GitHub when prompted

The server implements OAuth 2.1 with dynamic client registration, so Claude
handles the authorization flow itself.

### Claude Desktop

Add the remote server to your config file (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "hevy": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-domain/mcp"
      ]
    }
  }
}
```

Restart Claude Desktop and you'll see the Hevy tools available.

### Other MCP clients

The server speaks streamable HTTP at `/mcp`. The deprecated SSE transport is
not supported; `/sse` returns 410.

## 📖 Usage Examples

### Creating a Workout

Once connected, you can ask your AI assistant to log workouts:

> "Log a workout from today at 10am to 11am. I did bench press: 3 sets of 100kg for 10 reps, and squats: 4 sets of 120kg for 8 reps."

The assistant will:
1. Use `search_exercise_templates` to find the exercise IDs
2. Call `create_workout` with the proper structure
3. Confirm the workout was logged successfully

### Viewing Progress

> "Show me my last 5 workouts"

> "What's my exercise history for deadlifts?"

> "Get all workout changes since January 1st, 2024"

The assistant will use `get_workout_events` to sync recent changes.

### Managing Routines

> "Create a new Push Day routine with bench press (4 sets of 8-12 reps at 100kg) and overhead press (3 sets of 10 reps at 60kg)"

The assistant will use the `repRange` field for exercises with rep ranges like "8-12 reps".

> "Update my Upper Body routine to add pull-ups"

The assistant will use `update_routine` to modify existing routines.

### Creating Custom Exercises

> "Create a custom exercise called 'Tom's Special Cable Flyes' for chest using the cable machine"

The assistant will use `create_exercise_template` with the appropriate muscle groups and equipment category.

### Organizing Routines

> "Create a new folder called 'Summer 2024 Programs'"

The assistant will use `create_routine_folder` to organize your routines.

## 🔧 API Details

### Workout Structure

When creating workouts, you can specify:
- `title` - Name of the workout (required)
- `startTime` - When the workout started (required, ISO 8601 format)
- `endTime` - When the workout ended (required, ISO 8601 format)
- `routineId` - Optional routine ID this workout belongs to
- `description` - Optional workout description
- `isPrivate` - Whether the workout is private (optional, default: false)
- `exercises` - Array of exercises, each with:
  - `title` - Exercise name from the template (required)
  - `exerciseTemplateId` - Get this from `get_exercise_templates` (required)
  - `supersetId` - Optional superset ID (null if not in a superset)
  - `notes` - Optional notes for this exercise
  - `sets` - Array of set data with:
    - `type` - "warmup", "normal", "failure", or "dropset" (optional)
    - `weightKg` - Weight in kilograms (optional)
    - `reps` - Number of repetitions (optional)
    - `distanceMeters` - For cardio exercises (optional)
    - `durationSeconds` - For timed exercises (optional)
    - `customMetric` - Custom metric for steps/floors (optional)
    - `rpe` - Rating of Perceived Exertion, 6-10 (optional)

**Note:** The `index` field for exercises and sets is automatically generated based on their position in the array.

### Routine Structure

When creating routines, you can specify:
- `title` - Name of the routine (required)
- `folderId` - Optional folder ID (null for default "My Routines" folder)
- `notes` - Optional notes for the routine
- `exercises` - Array of exercises, each with:
  - `exerciseTemplateId` - Get this from `get_exercise_templates` (required)
  - `supersetId` - Optional superset ID (null if not in a superset)
  - `restSeconds` - Rest time in seconds between sets (optional)
  - `notes` - Optional notes for this exercise
  - `sets` - Array of set data with:
    - `type` - "warmup", "normal", "failure", or "dropset" (optional)
    - `weightKg` - Weight in kilograms (optional)
    - `reps` - Number of repetitions (optional)
    - `repRange` - Rep range object with `start` and `end` (optional, e.g., 8-12 reps)
    - `distanceMeters` - For cardio exercises (optional)
    - `durationSeconds` - For timed exercises (optional)
    - `customMetric` - Custom metric for steps/floors (optional)

**Important:** Unlike workouts, routines do NOT use `index` or `title` fields in exercises/sets. These are generated by the API.

### Time Format

All timestamps use ISO 8601 format:
```
2024-10-15T10:00:00Z
```

## 📚 Resources

- [Hevy API Documentation](https://api.hevyapp.com/docs) - Official API docs
- [MCP Documentation](https://modelcontextprotocol.io/) - Learn about Model Context Protocol
- [Hevy App](https://www.hevyapp.com/) - The Hevy fitness tracking app

## 🛠️ Development

### Project Structure

```
hevy-mcp-server/
├── src/
│   ├── server.ts         # Node entrypoint: builds bindings, starts HTTP server
│   ├── app.ts            # Hono app and route mounting
│   ├── env.ts            # Runtime bindings and the sign-in allowlist
│   ├── mcp-server.ts     # MCP tool definitions
│   ├── github-handler.ts # OAuth 2.1 endpoints and the /setup page
│   ├── middleware/
│   │   └── auth.ts       # Bearer token authentication
│   ├── routes/
│   │   ├── mcp.ts        # Streamable HTTP transport and session handling
│   │   └── utility.ts    # Health check, stats, home page
│   └── lib/
│       ├── client.ts     # Hevy API client wrapper
│       ├── kv.ts         # SQLite-backed key/value store
│       └── key-storage.ts# Encrypted API key storage
├── Dockerfile
├── api.json              # OpenAPI specification for Hevy API
└── package.json
```

### Adding New Tools

To add new Hevy API capabilities:

1. Add the API method to `src/lib/client.ts`
2. Register the tool in `src/mcp-server.ts` inside `createHevyMcpServer()`
3. Use Zod for input validation
4. Handle errors gracefully

Example:
```typescript
server.tool(
  "tool_name",
  {
    param: z.string().describe("Parameter description"),
  },
  async ({ param }) => {
    try {
      const result = await client.someMethod(param);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      return handleError(error);
    }
  }
);
```

## 🤝 Contributing

Contributions are welcome!

### How to Contribute

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** - add features, fix bugs, or improve documentation
3. **Test your changes** - run `npm test` and `npm run type-check`
4. **Follow the code style** - run `npm run format` and `npm run lint:fix`
5. **Submit a Pull Request** with a clear description of your changes

### Development Setup

```bash
# Clone your fork
git clone https://github.com/tomtorggler/hevy-mcp-server.git
cd hevy-mcp-server

# Install dependencies
npm install

# Copy environment variables template
cp .dev.vars.example .dev.vars
# Add your Hevy API key to .dev.vars

# Start development server
npm start

# Run tests
npm test
```

### Areas for Contribution

- Add more Hevy API endpoints
- Improve error handling and validation
- Add more comprehensive tests
- Improve documentation and examples
- Report bugs or suggest features via Issues

## 📝 License

Unlicense - see [LICENSE](LICENSE) file for details.

This project is not affiliated with Hevy. Hevy is a trademark of Hevy Studios Inc.
