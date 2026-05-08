#!/usr/bin/env node

const baseUrl = (process.argv[2] || "http://127.0.0.1:8789").replace(/\/+$/, "");

async function expectStatus(name, response, expectedStatuses) {
  if (!expectedStatuses.includes(response.status)) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `${name}: expected status ${expectedStatuses.join(" or ")}, got ${response.status}. body=${text.slice(0, 280)}`
    );
  }
  console.log(`ok  ${name} -> ${response.status}`);
}

async function main() {
  console.log(`Running security smoke checks against ${baseUrl}`);

  const homepage = await fetch(`${baseUrl}/`);
  await expectStatus("homepage", homepage, [200]);
  if (!homepage.headers.get("x-content-type-options")) {
    throw new Error("homepage: missing x-content-type-options header");
  }
  if (!homepage.headers.get("referrer-policy")) {
    throw new Error("homepage: missing referrer-policy header");
  }
  console.log("ok  homepage security headers present");

  const securityStatsNoAuth = await fetch(`${baseUrl}/api/security/stats`);
  await expectStatus("security stats without auth", securityStatsNoAuth, [401]);

  const forgedAction = await fetch(`${baseUrl}/api/actions-complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fid: 1129138,
      actionSlug: "drop-cast",
      verification: "https://farcaster.xyz/any/0xdeadbeef",
    }),
  });
  await expectStatus("actions-complete forged fid without session", forgedAction, [401]);

  const forgedNotificationOpen = await fetch(`${baseUrl}/api/notifications/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      notificationId: "smoke-test",
      fid: 1129138,
      appSlug: "drop",
    }),
  });
  await expectStatus("notification-open forged fid without session", forgedNotificationOpen, [200, 400]);

  console.log("Security smoke checks completed.");
}

main().catch((error) => {
  console.error("Security smoke checks failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

