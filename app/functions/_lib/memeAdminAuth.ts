import { readAdminKeys, type SecurityEnv } from "./security";
export function adminCapabilities(
  env: SecurityEnv,
  request: Request,
  keyId: string,
) {
  const token = request.headers.get("x-admin-token")?.trim();
  return (
    readAdminKeys(env)
      .find(
        (record) =>
          record.id === keyId &&
          record.active !== false &&
          record.key === token,
      )
      ?.scopes.filter((scope) => scope === "*" || scope.startsWith("meme:")) ??
    []
  );
}
