/**
 * Regression tests for the create_routine / create_routine_folder bug report.
 *
 * Both failures were silent: reading a field off the wrong nesting level gives
 * `undefined`, which formats into a cheerful success message rather than an
 * error. These drive the real tool handlers against the response shapes
 * measured from the live Hevy API and assert the output never contains
 * "undefined".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/key-storage.js", () => ({
	getUserApiKey: vi.fn(async () => "test-key"),
}));

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createHevyMcpServer } from "../../src/mcp-server.js";
import { HevyClient } from "../../src/lib/client.js";

const env = {
	OAUTH_KV: {} as any,
	GITHUB_CLIENT_ID: "id",
	GITHUB_CLIENT_SECRET: "secret",
	COOKIE_ENCRYPTION_KEY: "a".repeat(64),
};

const props = { login: "adamdavies1915", name: "Adam", email: "", accessToken: "t" };

/**
 * Calls a tool over a real MCP connection and returns its text output.
 * Going through the protocol rather than poking at internals also exercises
 * argument validation and schema defaults.
 */
async function callTool(server: any, name: string, args: Record<string, unknown>) {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test", version: "1.0.0" });

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	try {
		const result: any = await client.callTool({ name, arguments: args });
		expect(result.isError, `tool ${name} returned an error: ${JSON.stringify(result.content)}`)
			.toBeFalsy();
		return result.content.map((c: any) => c.text).join("\n");
	} finally {
		await client.close();
	}
}

describe("response formatting against live API shapes", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("should format create_routine from a wrapped array response", async () => {
		// Measured: POST /v1/routines -> { routine: [ { ... } ] }
		const createRoutine = vi.spyOn(HevyClient.prototype, "createRoutine").mockResolvedValue({
			routine: [
				{
					id: "91741aef-5dda-4739-9aea-42206d30c864",
					title: "Leg Day",
					folder_id: null,
					exercises: [{ index: 0, title: "Squat", sets: [] }],
				},
			],
		});

		const server = await createHevyMcpServer(props, env);
		const text = await callTool(server, "create_routine", {
			title: "Leg Day",
			folder_id: null,
			exercises: [
				{ exercise_template_id: "A127DA73", sets: [{ type: "normal", weight_kg: 20, reps: 10 }] },
			],
		});

		expect(text).toContain("Leg Day");
		expect(text).toContain("91741aef-5dda-4739-9aea-42206d30c864");
		expect(text).not.toContain("undefined");

		// And the body sent to the API keeps folder_id as an explicit null.
		const body = createRoutine.mock.calls[0][0] as any;
		expect(Object.hasOwn(body.routine, "folder_id")).toBe(true);
		expect(body.routine.folder_id).toBeNull();
	});

	it("should send folder_id as null when the caller omits it entirely", async () => {
		// The reported failure: omitting folder_id gave
		// "Invalid routine folder id: undefined" from the API. The schema
		// default has to survive the round trip through argument validation.
		const createRoutine = vi.spyOn(HevyClient.prototype, "createRoutine").mockResolvedValue({
			routine: [{ id: "r1", title: "Leg Day", folder_id: null, exercises: [] }],
		});

		const server = await createHevyMcpServer(props, env);
		await callTool(server, "create_routine", {
			title: "Leg Day",
			exercises: [
				{ exercise_template_id: "A127DA73", sets: [{ type: "normal", weight_kg: 20, reps: 10 }] },
			],
		});

		const body = createRoutine.mock.calls[0][0] as any;
		expect(Object.hasOwn(body.routine, "folder_id")).toBe(true);
		expect(body.routine.folder_id).toBeNull();
	});

	it("should pass a real folder id through unchanged", async () => {
		const createRoutine = vi.spyOn(HevyClient.prototype, "createRoutine").mockResolvedValue({
			routine: [{ id: "r1", title: "Leg Day", folder_id: 3343401, exercises: [] }],
		});

		const server = await createHevyMcpServer(props, env);
		await callTool(server, "create_routine", {
			title: "Leg Day",
			folder_id: 3343401,
			exercises: [
				{ exercise_template_id: "A127DA73", sets: [{ type: "normal", weight_kg: 20, reps: 10 }] },
			],
		});

		expect((createRoutine.mock.calls[0][0] as any).routine.folder_id).toBe(3343401);
	});

	it("should format create_routine_folder from a wrapped response", async () => {
		vi.spyOn(HevyClient.prototype, "createRoutineFolder").mockResolvedValue({
			routine_folder: { id: 3343401, index: 0, title: "5-Day Plan" },
		});

		const server = await createHevyMcpServer(props, env);
		const text = await callTool(server, "create_routine_folder", { title: "5-Day Plan" });

		expect(text).toContain("5-Day Plan");
		expect(text).toContain("3343401");
		expect(text).not.toContain("undefined");
	});

	it("should format create_routine_folder from a bare response", async () => {
		// The published spec documents this shape, so handle it too.
		vi.spyOn(HevyClient.prototype, "createRoutineFolder").mockResolvedValue({
			id: 3343401,
			index: 0,
			title: "5-Day Plan",
		});

		const server = await createHevyMcpServer(props, env);
		const text = await callTool(server, "create_routine_folder", { title: "5-Day Plan" });

		expect(text).toContain("3343401");
		expect(text).not.toContain("undefined");
	});

	it("should format get_routine_folder from the bare response the API returns", async () => {
		vi.spyOn(HevyClient.prototype, "getRoutineFolder").mockResolvedValue({
			id: 3343401,
			index: 0,
			title: "5-Day Plan",
		});

		const server = await createHevyMcpServer(props, env);
		const text = await callTool(server, "get_routine_folder", { folder_id: "3343401" });

		expect(text).toContain("5-Day Plan");
		expect(text).not.toContain("undefined");
	});

	it("should format get_routine from the wrapped object the API returns", async () => {
		vi.spyOn(HevyClient.prototype, "getRoutine").mockResolvedValue({
			routine: { id: "r1", title: "Upper Body", exercises: [] },
		});

		const server = await createHevyMcpServer(props, env);
		const text = await callTool(server, "get_routine", { routine_id: "r1" });

		expect(text).toContain("Upper Body");
		expect(text).not.toContain("undefined");
	});

	it("should format get_workout from the bare response the API returns", async () => {
		vi.spyOn(HevyClient.prototype, "getWorkout").mockResolvedValue({
			id: "w1",
			title: "Morning Session",
			exercises: [],
		});

		const server = await createHevyMcpServer(props, env);
		const text = await callTool(server, "get_workout", { workout_id: "w1" });

		expect(text).toContain("Morning Session");
		expect(text).not.toContain("undefined");
	});

	it("should format create_workout whether or not the response is wrapped", async () => {
		for (const response of [
			{ workout: [{ id: "w1", title: "Morning", exercises: [] }] },
			{ id: "w1", title: "Morning", exercises: [] },
		]) {
			vi.spyOn(HevyClient.prototype, "createWorkout").mockResolvedValue(response);

			const server = await createHevyMcpServer(props, env);
			const text = await callTool(server, "create_workout", {
				title: "Morning",
				start_time: "2026-08-01T10:00:00Z",
				end_time: "2026-08-01T11:00:00Z",
				exercises: [
					{
						title: "Squat",
						exercise_template_id: "A127DA73",
						sets: [{ type: "normal", weight_kg: 20, reps: 10 }],
					},
				],
			});

			expect(text).toContain("w1");
			expect(text).not.toContain("undefined");
		}
	});
});
