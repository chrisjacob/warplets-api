/** Cross-worker lease for bounded background work; no request state in globals. */
export async function claimStonkletWork(db: D1Database, key: string, seconds: number): Promise<string | null> {
  const owner = crypto.randomUUID();
  const row = await db.prepare(`INSERT INTO notification_job_state (job_key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(job_key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    WHERE julianday(notification_job_state.updated_at) < julianday('now', ?)
    RETURNING value`)
    .bind(`stonklets-work:${key}`, owner, `-${seconds} seconds`).first<{ value: string }>();
  return row?.value === owner ? owner : null;
}

export async function releaseStonkletWork(db: D1Database, key: string, owner: string): Promise<void> {
  await db.prepare("DELETE FROM notification_job_state WHERE job_key = ? AND value = ?")
    .bind(`stonklets-work:${key}`, owner).run();
}
