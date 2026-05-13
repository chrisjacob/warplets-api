import { jsonSecure } from "../_lib/security.js";

export const onRequest: PagesFunction = () => {
  return jsonSecure({ error: "Not found" }, { status: 404 });
};
