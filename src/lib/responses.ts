/**
 * Response unwrapping for the Hevy API.
 *
 * The API is not consistent about how it returns a single resource, and the
 * published OpenAPI spec does not match observed behaviour (it documents every
 * one of these as a bare object). Shapes measured against the live API:
 *
 *   POST /v1/routines             -> { routine: [ { ... } ] }   wrapped array
 *   GET  /v1/routines/{id}        -> { routine: { ... } }       wrapped object
 *   GET  /v1/routine_folders/{id} -> { ... }                    bare
 *   GET  /v1/workouts/{id}        -> { ... }                    bare
 *
 * Reading a field off the wrong level yields `undefined` rather than an error,
 * which turns into a success message full of "undefined" instead of a failure.
 * unwrapResource() accepts all three shapes so formatters do not have to care.
 */

/**
 * Returns the resource itself, whether the API returned it bare, wrapped under
 * `key`, or wrapped in a single-element array under `key`.
 */
export function unwrapResource<T = any>(data: any, key: string): T {
	if (data === null || data === undefined) {
		return data as T;
	}

	const value = Object.hasOwn(data, key) ? data[key] : data;

	if (Array.isArray(value)) {
		return value[0] as T;
	}

	return value as T;
}
