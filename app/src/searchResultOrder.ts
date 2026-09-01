export type SearchOrderDirection = "asc" | "desc";

export type SearchOrderCandidate = {
  id: number;
  value: number | null;
  fallbackIndex: number;
  tieBreakTimestamp?: number | null;
};

export function orderSearchCandidates(
  candidates: SearchOrderCandidate[],
  direction: SearchOrderDirection,
  excludeMissing = false,
): SearchOrderCandidate[] {
  const multiplier = direction === "asc" ? 1 : -1;
  const ordered = excludeMissing
    ? candidates.filter((candidate) => candidate.value != null && Number.isFinite(candidate.value))
    : [...candidates];

  return ordered.sort((left, right) => {
    const leftMissing = left.value == null || !Number.isFinite(left.value);
    const rightMissing = right.value == null || !Number.isFinite(right.value);
    if (leftMissing && rightMissing) return left.fallbackIndex - right.fallbackIndex || left.id - right.id;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    if (left.value !== right.value) return (left.value! - right.value!) * multiplier;

    const leftTimestampMissing = left.tieBreakTimestamp == null || !Number.isFinite(left.tieBreakTimestamp);
    const rightTimestampMissing = right.tieBreakTimestamp == null || !Number.isFinite(right.tieBreakTimestamp);
    if (!leftTimestampMissing || !rightTimestampMissing) {
      if (leftTimestampMissing) return 1;
      if (rightTimestampMissing) return -1;
      if (left.tieBreakTimestamp !== right.tieBreakTimestamp) {
        return right.tieBreakTimestamp! - left.tieBreakTimestamp!;
      }
    }

    return ((left.fallbackIndex - right.fallbackIndex) || (left.id - right.id)) * multiplier;
  });
}
