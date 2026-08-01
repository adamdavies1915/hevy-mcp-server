import { describe, it, expect } from "vitest";
import { unwrapResource } from "../../src/lib/responses.js";

describe("unwrapResource", () => {
	it("should unwrap a single-element array, as POST /v1/routines returns", () => {
		const response = { routine: [{ id: "abc", title: "Leg Day" }] };

		expect(unwrapResource(response, "routine")).toEqual({ id: "abc", title: "Leg Day" });
	});

	it("should unwrap a wrapped object, as GET /v1/routines/{id} returns", () => {
		const response = { routine: { id: "abc", title: "Leg Day" } };

		expect(unwrapResource(response, "routine")).toEqual({ id: "abc", title: "Leg Day" });
	});

	it("should pass through a bare object, as GET /v1/routine_folders/{id} returns", () => {
		const response = { id: 3343401, title: "5-Day Plan", index: 0 };

		expect(unwrapResource(response, "routine_folder")).toEqual(response);
	});

	it("should not mistake a resource field for the wrapper", () => {
		// A workout carries a routine_id, but no "workout" key of its own.
		const workout = { id: "w1", title: "Morning", routine_id: "r1" };

		expect(unwrapResource(workout, "workout")).toEqual(workout);
	});

	it("should return undefined for an empty wrapped array rather than throwing", () => {
		expect(unwrapResource({ routine: [] }, "routine")).toBeUndefined();
	});

	it("should tolerate null and undefined responses", () => {
		expect(unwrapResource(null, "routine")).toBeNull();
		expect(unwrapResource(undefined, "routine")).toBeUndefined();
	});

	it("should unwrap an explicitly null wrapped value", () => {
		expect(unwrapResource({ routine: null }, "routine")).toBeNull();
	});
});
