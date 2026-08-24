export const productionScheduledTaskNames = [
	"legacyOpenSea",
	"marketOpenSea",
	"dune",
	"warpmoji",
	"notifications",
	"emailIdentity",
	"emailOnboarding",
	"emailOnboardingReconciliation",
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
		ctx.waitUntil(
			tasks[taskName](env).catch((error) => {
				console.error(JSON.stringify({
					message: "Production scheduled task failed",
					task: taskName,
					error: error instanceof Error ? error.message : String(error),
				}));
			}),
		);
	}
}
