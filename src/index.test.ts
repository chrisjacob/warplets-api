import assert from "node:assert/strict";
import test from "node:test";
import {
	productionScheduledTaskNames,
	scheduleTasks,
	type ScheduledTasks,
} from "./scheduled-runner";

type TestEnv = Record<string, never>;

test("the root scheduled handler starts every production job, including notifications", async () => {
	const calls: string[] = [];
	const pending: Promise<unknown>[] = [];
	const taskNames = [...productionScheduledTaskNames];
	const tasks: ScheduledTasks<TestEnv> = {
		legacyOpenSea: async () => { calls.push("legacyOpenSea"); },
		marketOpenSea: async () => { calls.push("marketOpenSea"); },
		dune: async () => { calls.push("dune"); },
		warpmoji: async () => { calls.push("warpmoji"); },
		notifications: async () => { calls.push("notifications"); },
		emailIdentity: async () => { calls.push("emailIdentity"); },
		emailOnboarding: async () => { calls.push("emailOnboarding"); },
		emailOnboardingReconciliation: async () => { calls.push("emailOnboardingReconciliation"); },
	};
	const context = {
		waitUntil(promise: Promise<unknown>) { pending.push(promise); },
		passThroughOnException() {},
		props: {},
	} as ExecutionContext;

	scheduleTasks({}, context, tasks);
	await Promise.all(pending);

	assert.deepEqual(calls.sort(), [...taskNames].sort());
	assert.equal(calls.includes("notifications"), true);
});

test("one scheduled job failure does not prevent the other jobs", async () => {
	const calls: string[] = [];
	const pending: Promise<unknown>[] = [];
	const task = (name: string) => async () => { calls.push(name); };
	const tasks: ScheduledTasks<TestEnv> = {
		legacyOpenSea: async () => { calls.push("legacyOpenSea"); throw new Error("expected"); },
		marketOpenSea: task("marketOpenSea"),
		dune: task("dune"),
		warpmoji: task("warpmoji"),
		notifications: task("notifications"),
		emailIdentity: task("emailIdentity"),
		emailOnboarding: task("emailOnboarding"),
		emailOnboardingReconciliation: task("emailOnboardingReconciliation"),
	};
	const context = {
		waitUntil(promise: Promise<unknown>) { pending.push(promise); },
		passThroughOnException() {},
		props: {},
	} as ExecutionContext;

	scheduleTasks({}, context, tasks);
	await Promise.all(pending);

	assert.equal(calls.length, 8);
});
