// Ported from the reviewed meme/src/shared/canonical.ts at 6dc1b72.
export function canonical(value) {
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) throw Error("Canonical numbers must be safe integers");
        return String(value);
    }
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k)=>JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
    throw Error("Unsupported canonical value");
}
