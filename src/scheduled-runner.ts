export const productionScheduledTaskNames = [
	"legacyOpenSea",
	"marketOpenSea",
	"dune",
	"warpmoji",
	"notifications",
	"emailIdentity",
	"emailOnboarding",
	"emailOnboardingReconciliation",
	"stonkletsMarket",
] as const;

export type ProductionScheduledTaskName = (typeof productionScheduledTaskNames)[number];

export type ScheduledTasks<Env> = Record<
	ProductionScheduledTaskName,
	(env: Env) => Promise<unknown>
>;

export function scheduleTasks<Env>(
	env: Env,
	ctx: ExecutionContext,
	tasks: ScheduledTasks<Env>,
): void {
	for (const taskName of productionScheduledTaskNames) {
		const startedAt = Date.now();
		ctx.waitUntil(
			tasks[taskName](env)
				.then((result) => {
					const durationMs = Date.now() - startedAt;
					if (durationMs >= 60_000) {
						console.warn(JSON.stringify({
							message: "Production scheduled task exceeded one minute",
							task: taskName,
							durationMs,
							result,
						}));
					}
				})
				.catch((error) => {
					console.error(JSON.stringify({
						message: "Production scheduled task failed",
						task: taskName,
						durationMs: Date.now() - startedAt,
						error: error instanceof Error ? error.message : String(error),
					}));
				}),
		);
	}
}
