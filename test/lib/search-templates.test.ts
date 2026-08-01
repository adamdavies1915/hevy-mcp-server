import { describe, it, expect, vi, beforeEach } from "vitest";
import { HevyClient } from "../../src/lib/client.js";
import { filterExerciseTemplates } from "../../src/lib/exercise-search.js";

const t = (id: string, title: string, extra: Record<string, any> = {}) => ({
	id,
	title,
	type: "weight_reps",
	primary_muscle_group: "chest",
	equipment: "barbell",
	is_custom: false,
	...extra,
});

describe("filterExerciseTemplates", () => {
	it("should match titles case-insensitively on a substring", () => {
		const { results } = filterExerciseTemplates(
			[t("1", "Bench Press"), t("2", "Squat"), t("3", "Incline Bench Press")],
			"bench",
		);

		expect(results.map((r) => r.title)).toEqual(["Bench Press", "Incline Bench Press"]);
	});

	it("should rank exact matches above prefix above substring", () => {
		const { results } = filterExerciseTemplates(
			[t("1", "Squat Row"), t("2", "Goblet Squat"), t("3", "Squat")],
			"squat",
		);

		expect(results.map((r) => r.title)).toEqual(["Squat", "Squat Row", "Goblet Squat"]);
	});

	it("should rank a custom exercise above a built-in of equal match quality", () => {
		const { results } = filterExerciseTemplates(
			[t("1", "Squat"), t("2", "Squat", { is_custom: true })],
			"squat",
		);

		expect(results[0].is_custom).toBe(true);
	});

	it("should cap results at the limit and flag truncation", () => {
		const templates = Array.from({ length: 30 }, (_, i) => t(String(i), `Curl ${i}`));

		const { results, truncated } = filterExerciseTemplates(templates, "curl", 5);

		expect(results).toHaveLength(5);
		expect(truncated).toBe(true);
	});

	it("should return no results for a term that matches nothing", () => {
		const { results, truncated } = filterExerciseTemplates([t("1", "Squat")], "kayaking");

		expect(results).toEqual([]);
		expect(truncated).toBe(false);
	});

	it("should report how many templates were scanned", () => {
		const { scanned } = filterExerciseTemplates([t("1", "A"), t("2", "B")], "a");

		expect(scanned).toBe(2);
	});
});

describe("HevyClient.getAllExerciseTemplates", () => {
	let client: HevyClient;

	beforeEach(() => {
		client = new HevyClient({ apiKey: "test" });
	});

	it("should page through the whole catalogue", async () => {
		const spy = vi
			.spyOn(client, "getExerciseTemplates")
			.mockResolvedValueOnce({ page_count: 3, exercise_templates: [t("1", "Ab Wheel")] })
			.mockResolvedValueOnce({ page_count: 3, exercise_templates: [t("2", "Bench Press")] })
			.mockResolvedValueOnce({ page_count: 3, exercise_templates: [t("3", "Bench Dip")] });

		const templates = await client.getAllExerciseTemplates();

		expect(spy).toHaveBeenCalledTimes(3);
		expect(templates).toHaveLength(3);
		expect(spy).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
	});

	it("should stop at maxPages rather than paging forever", async () => {
		const spy = vi
			.spyOn(client, "getExerciseTemplates")
			.mockResolvedValue({ page_count: 999, exercise_templates: [t("1", "X")] });

		await client.getAllExerciseTemplates({ maxPages: 4 });

		expect(spy).toHaveBeenCalledTimes(4);
	});

	it("should tolerate a page with no templates key", async () => {
		vi.spyOn(client, "getExerciseTemplates").mockResolvedValue({ page_count: 1 });

		expect(await client.getAllExerciseTemplates()).toEqual([]);
	});
});
