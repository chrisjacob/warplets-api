/** Self-hosted admin script. All server data is inserted as text, never HTML. */
export const memeAdminScript = String.raw`
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    qa =
      window.__MEME_LOCAL_QA__ === true &&
      location.hostname === "127.0.0.1" &&
      new URLSearchParams(location.search).get("qa") === "seeded";
  let token = "",
    session = "",
    nonce = "",
    tab = "overview",
    state = null,
    draft = [],
    dirty = false,
    busy = false,
    lastCommand = null,
    launchReview = null,
    loadEpoch = 0;
  const label = {
    overview: "Today",
    performance: "Performance",
    comms: "Comms",
    health: "Health",
  };
  function node(tag, text, attrs) {
    const e = document.createElement(tag);
    if (text !== null && text !== undefined) e.textContent = String(text);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key.startsWith("on")) e.addEventListener(key.slice(2), value);
      else if (key === "class") e.className = value;
      else if (key === "disabled") e.disabled = !!value;
      else e.setAttribute(key, String(value));
    }
    return e;
  }
  function group(...children) {
    const e = node("div", null, { class: "stack" });
    e.append(...children.filter(Boolean));
    return e;
  }
  function panel(title, ...children) {
    const e = node("section", null, { class: "panel" });
    e.append(node("h2", title), ...children.filter(Boolean));
    return e;
  }
  function button(text, action, handler, secondary = false) {
    return node("button", text, {
      type: "button",
      class: secondary ? "secondary" : "",
      disabled: busy || (action && state && !state.capabilities?.[action]),
      onclick: handler,
    });
  }
  function field(title, input) {
    const e = node("label", title);
    e.append(input);
    return e;
  }
  function input(value, placeholder, type = "text") {
    const e = node("input", null, { type, placeholder: placeholder || "" });
    e.value = value ?? "";
    return e;
  }
  function select(values, value, handler) {
    const e = node("select");
    for (const [key, title] of values)
      e.append(node("option", title, { value: key }));
    e.value = value;
    e.addEventListener("change", handler);
    return e;
  }
  function when(at) {
    return at
      ? new Date(Number(at)).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }) +
          " · " +
          new Date(Number(at)).toISOString().slice(11, 16) +
          " UTC"
      : "Unavailable";
  }
  function say(message, error = false) {
    $("message").textContent = message;
    $("message").className = error ? "status error" : "status";
  }
  function table(headers, rows) {
    const t = node("table"),
      head = node("thead"),
      tr = node("tr"),
      body = node("tbody");
    headers.forEach((h) => tr.append(node("th", h)));
    head.append(tr);
    for (const row of rows) {
      const r = node("tr");
      row.forEach((value, i) => {
        const cell = node("td", null, { "data-label": headers[i] });
        cell.append(
          value instanceof Node
            ? value
            : document.createTextNode(String(value ?? "—")),
        );
        r.append(cell);
      });
      body.append(r);
    }
    t.append(head, body);
    const wrap = node("div", null, { class: "table-wrap" });
    wrap.append(t);
    return wrap;
  }
  function details(title, data) {
    const e = node("details"),
      pre = node("pre", JSON.stringify(data, null, 2));
    e.append(node("summary", title), pre);
    return e;
  }
  async function api(path, body) {
    const url = qa ? "/__qa/admin/" + path : "/api/admin/meme/" + path;
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(!qa ? { "x-admin-token": token, "x-admin-session": session } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(90000),
    });
    const bytes = await response.text();
    if (bytes.length > 1048576) throw Error("Admin response too large");
    let data;
    try {
      data = JSON.parse(bytes);
    } catch {
      throw Error("Admin service is not connected");
    }
    if (response.status === 401 && !qa) {
      session = "";
      $("login").hidden = false;
      $("workspace").hidden = true;
    }
    if (!response.ok) throw Error(data.error || "Admin request failed");
    return data;
  }
  async function load() {
    const epoch = ++loadEpoch;
    busy = true;
    try {
      const query = new URLSearchParams({
        date: $("date").value,
        range: $("range").value,
      });
      const next = await api(tab + "?" + query);
      if (epoch !== loadEpoch) return;
      state = next;
      $("environment").textContent = qa ? "QA simulation" : state.environment;
      $("freshness").textContent = "Updated " + when(state.asOf);
      $("login").hidden = true;
      $("workspace").hidden = false;
      busy = false;
      render();
    } catch (error) {
      if (epoch === loadEpoch) say(error.message, true);
    } finally {
      if (epoch === loadEpoch) busy = false;
    }
  }
  async function command(action, payload, reason) {
    if (busy) return;
    lastCommand = {
      id: crypto.randomUUID(),
      action,
      expectedVersion: state.version,
      reason: reason || "Operator-reviewed " + action,
      payload,
    };
    return await submitCommand();
  }
  async function submitCommand() {
    busy = true;
    say("Working…");
    try {
      const reply = await api("commands", lastCommand);
      lastCommand = null;
      dirty = false;
      busy = false;
      await load();
      say("Saved.");
      return reply.result;
    } catch (error) {
      busy = false;
      say(
        error.message + " Use Retry same action for an uncertain outcome.",
        true,
      );
      await load();
    } finally {
      busy = false;
    }
  }
  function links(mint) {
    const e = node("div", null, { class: "links" });
    e.append(
      node("a", "GMGN ↗", {
        href: "https://gmgn.ai/sol/token/" + encodeURIComponent(mint),
        target: "_blank",
        rel: "noopener noreferrer",
      }),
      node("a", "DexScreener ↗", {
        href: "https://dexscreener.com/search?q=" + encodeURIComponent(mint),
        target: "_blank",
        rel: "noopener noreferrer",
      }),
      button(
        "Copy mint",
        null,
        () =>
          navigator.clipboard.writeText(mint).then(() => say("Mint copied.")),
        true,
      ),
    );
    return e;
  }
  function today() {
    const r = state.round;
    const heading = panel(
      "Daily round",
      node(
        "p",
        r
          ? r.state.toUpperCase() + " · " + r.id
          : "No committed round for this day",
      ),
      node(
        "p",
        "Opens " +
          when(state.timetable.opensAt) +
          " · closes " +
          when(state.timetable.closesAt),
      ),
      node("p", "Ownership freeze by " + when(state.timetable.freezeBy), {
        class: "muted",
      }),
    );
    const next = button(
      "Next day",
      null,
      () => {
        if (dirty && !confirm("Discard unsaved shortlist changes?")) return;
        const date = new Date($("date").value + "T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + 1);
        $("date").value = date.toISOString().slice(0, 10);
        dirty = false;
        load();
      },
      true,
    );
    heading.append(next);
    if (r) {
      heading.append(
        table(
          ["Token", "Votes", "Review"],
          state.candidates.map((c) => [
            c.name + " / " + c.symbol,
            c.voters,
            links(c.og_mint),
          ]),
        ),
      );
      const reason = input("", "Selection or skip reason"),
        pick = select(
          state.candidates.map((c) => [c.id, c.name]),
          r.selected_candidate || state.candidates[0]?.id,
          () => {},
        );
      const controls = group(
        field("Final selection", pick),
        field("Reason", reason),
      );
      const choose = button("Select candidate", "round.outcome", () => {
        if (!reason.value.trim()) return say("Add a selection reason.", true);
        if (confirm("Confirm the final candidate? Votes remain advisory."))
          command(
            "round.outcome",
            { roundId: r.id, candidateId: pick.value },
            reason.value,
          );
      });
      const skip = button(
        "Skip launch",
        "round.outcome",
        () => {
          if (!reason.value.trim()) return say("Add a skip reason.", true);
          if (confirm("Skip this round’s launch?"))
            command(
              "round.outcome",
              { roundId: r.id, skip: true },
              reason.value,
            );
        },
        true,
      );
      choose.disabled = skip.disabled =
        r.state !== "closed" || !state.capabilities["round.outcome"];
      controls.append(choose, skip);
      heading.append(controls);
    }
    if (!r) {
      if (!dirty) draft = state.draft?.candidates ?? [];
      const list = node("div", null, { class: "stack" }),
        title = node("h3", "Shortlist " + draft.length + "/3");
      function draw() {
        list.replaceChildren();
        title.textContent = "Shortlist " + draft.length + "/3";
        draft.forEach((c, index) => {
          const check = input("", "", "checkbox");
          check.checked = c.reviewed;
          check.addEventListener("change", () => {
            c.reviewed = check.checked;
            dirty = true;
          });
          list.append(
            group(
              node("strong", c.name + " / " + c.symbol),
              node("code", c.ogMint),
              links(c.ogMint),
              field("Manually reviewed", check),
              button(
                "Remove",
                null,
                () => {
                  draft.splice(index, 1);
                  dirty = true;
                  draw();
                },
                true,
              ),
            ),
          );
        });
      }
      draw();
      const mint = input("", "Solana mint"),
        name = input("", "Name"),
        symbol = input("", "Symbol");
      const add = (candidate) => {
        if (draft.length >= 3)
          return say("The shortlist already has three tokens.", true);
        if (draft.some((c) => c.ogMint === candidate.ogMint))
          return say("Mint already shortlisted.", true);
        draft.push(candidate);
        dirty = true;
        draw();
      };
      heading.append(
        title,
        list,
        details("Published shortlists are locked", {
          status: state.draft?.status ?? "draft",
        }),
      );
      const manual = panel(
        "Add a token manually",
        field("Mint", mint),
        field("Name", name),
        field("Symbol", symbol),
        button("Add to shortlist", "draft.save", () => {
          if (!mint.value.trim() || !name.value.trim() || !symbol.value.trim())
            return say("Enter mint, name and symbol.", true);
          add({
            name: name.value.trim(),
            symbol: symbol.value.trim(),
            ogMint: mint.value.trim(),
            origin: "manual",
            reviewed: false,
          });
        }),
      );
      const cycle = select(
        (state.cycles || []).map((c) => [c.id, c.id + " · " + c.start_day]),
        state.cycles?.[0]?.id || "",
        () => {},
      );
      heading.append(
        field("Attribute cycle", cycle),
        button("Save shortlist", "draft.save", () =>
          command("draft.save", { day: $("date").value, candidates: draft }),
        ),
        button("Publish saved shortlist", "round.publish", () => {
          if (dirty) return say("Save the shortlist first.", true);
          if (draft.length !== 3 || draft.some((c) => !c.reviewed))
            return say("Choose and review three tokens.", true);
          if (!cycle.value.trim())
            return say("Select a committed attribute cycle.", true);
          if (confirm("Publish and lock these three candidates?"))
            command("round.publish", {
              day: $("date").value,
              cycleId: cycle.value.trim(),
            });
        }),
      );
      const snapshot = state.gmgn.snapshots.find(
          (s) => s.window === (window.__gmgnWindow || "1h"),
        ),
        windowSelect = select(
          [
            ["1h", "1 hour"],
            ["24h", "24 hours"],
          ],
          window.__gmgnWindow || "1h",
          (e) => {
            window.__gmgnWindow = e.target.value;
            render();
          },
        );
      const gmgn = panel(
        "GMGN trending",
        node(
          "p",
          snapshot
            ? "Cached " +
                when(snapshot.asOf) +
                (snapshot.mode === "simulated" ? " · simulated feed" : "")
            : "No cached feed. Manual entry is available.",
          { class: "muted" },
        ),
        windowSelect,
        button("Refresh GMGN", "gmgn.refresh", () =>
          command("gmgn.refresh", { window: windowSelect.value }),
        ),
      );
      const records = snapshot?.items || [];
      gmgn.append(
        table(
          ["Token", "Change", "Volume / liquidity", "Review", "Shortlist"],
          records
            .slice(0, 50)
            .map((item) => [
              item.symbol + " · #" + item.rank,
              item.changePercent == null ? "—" : item.changePercent + "%",
              (item.volumeUsd ?? "—") + " / " + (item.liquidityUsd ?? "—"),
              links(item.ogMint),
              button("Add", "draft.save", () =>
                add({
                  ...item,
                  origin: "gmgn",
                  reviewed: false,
                  snapshotId: snapshot.id,
                }),
              ),
            ]),
        ),
      );
      if (!state.gmgn.configured)
        gmgn.append(
          node(
            "p",
            "Live feed requires a configured read-only key and allowance.",
            { class: "muted" },
          ),
        );
      return [heading, manual, gmgn, launchPanel()];
    }
    return [heading, launchPanel()];
  }
  function launchPanel() {
    const section = panel(
      "Launch readiness",
      node("p", "One raw OG unit must appear separately in the launch budget."),
    );
    const gates = state.launch.blockers || [];
    section.append(
      group(...gates.map((g) => node("p", "• " + g.replaceAll("-", " ")))),
    );
    const review = button(
      "Prepare launch review",
      "launch.prepare",
      async () => {
        launchReview = await command("launch.prepare", {
          roundId: state.round?.id,
        });
        render();
      },
    );
    review.disabled =
      !qa ||
      !state.round ||
      state.round.state !== "selected" ||
      !state.capabilities["launch.prepare"];
    section.append(
      review,
      node(
        "p",
        qa
          ? "Offline UI simulation. No executable transaction or financial effects."
          : "Financial adapters, economics and actual custody must be configured before signing.",
        { class: "muted" },
      ),
    );
    if (launchReview) {
      section.append(
        details("Launch review · " + launchReview.state, launchReview),
        button("Simulate launch checks", "launch.simulate", async () => {
          launchReview = await command("launch.simulate", {
            roundId: state.round.id,
          });
          render();
        }),
        button(
          "Confirm demo launch",
          "launch.handoff",
          async () => {
            if (
              confirm(
                "Confirm an offline demo launch? No transaction will be signed or sent.",
              )
            ) {
              launchReview = await command("launch.handoff", {
                roundId: state.round.id,
              });
              render();
            }
          },
          true,
        ),
        button(
          "Reconcile demo launch",
          "launch.reconcile",
          async () => {
            launchReview = await command("launch.reconcile", {
              roundId: state.round.id,
            });
            render();
          },
          true,
        ),
      );
    }
    section.append(
      details("Release calendar · next 100 allocations", state.releases || []),
    );
    return section;
  }
  function performance() {
    const overall = state.overall;
    if (!overall)
      return [
        panel(
          "Performance",
          node("p", "Metrics are not materialized yet."),
          button("Refresh metrics", "metrics.refresh", () =>
            command("metrics.refresh", {}),
          ),
        ),
      ];
    const stats = node("div", null, { class: "stats" });
    for (const [title, value] of [
      ["Unique voters", overall.uniqueVoters],
      ["Votes", overall.votes],
      ["Launched editions", overall.launches],
      ["Active campaigns", overall.activeCampaigns],
      ["Funded allocations", overall.fundedAllocations],
      ["Released allocations", overall.releasedAllocations],
      ["Cohort volume · USD", overall.cohortVolumeUsd],
      ["Trading sources", overall.tradingSources],
    ])
      stats.append(
        group(node("strong", value ?? "Unavailable"), node("span", title)),
      );
    let days = state.daily;
    const date = $("date").value,
      range = $("range").value;
    if (range === "day") days = days.filter((d) => d.day === date);
    if (range === "previous") {
      const previous = new Date(date + "T00:00:00Z");
      previous.setUTCDate(previous.getUTCDate() - 1);
      days = days.filter((d) => d.day === previous.toISOString().slice(0, 10));
    }
    if (range === "30d")
      days = days.filter(
        (d) =>
          d.day <= date &&
          d.day >=
            new Date(Date.parse(date + "T00:00:00Z") - 29 * 86400000)
              .toISOString()
              .slice(0, 10),
      );
    const chart = node("div", null, {
      class: "bars",
      "aria-label": "Daily voting participation",
    });
    for (const day of days.slice().reverse()) {
      const row = node("div", null, { class: "bar-row" }),
        bar = node("meter", null, {
          min: 0,
          max: Math.max(1, ...days.map((d) => d.voters)),
          value: day.voters,
        });
      row.append(
        node("span", day.day),
        bar,
        node("span", day.voters + " voters"),
      );
      chart.append(row);
    }
    return [
      panel(
        "Overall",
        stats,
        node("p", "As of " + when(overall.asOf), { class: "muted" }),
        button("Refresh metrics", "metrics.refresh", () =>
          command("metrics.refresh", {}),
        ),
      ),
      panel(
        "Daily performance",
        chart,
        table(
          [
            "UTC day",
            "Voters",
            "Returning",
            "Launches",
            "Skips",
            "Changed vote",
            "Cohort volume · USD",
          ],
          days.map((d) => [
            d.day,
            d.voters,
            d.returningVoters,
            d.launches,
            d.skips,
            d.voteChanges,
            d.cohortVolumeUsd,
          ]),
        ),
      ),
      panel(
        "Reward accounting",
        table(
          [
            "Edition",
            "Allocated raw units",
            "Claimed raw units",
            "Reserve raw units",
          ],
          (overall.rewardsByEdition || []).map((r) => [
            r.symbol,
            r.allocated,
            r.claimed,
            r.reserve,
          ]),
        ),
        details("Coverage and limits", overall.coverage),
        node(
          "p",
          "Assets remain separate. Protocol fees and visitor conversions are unavailable until their evidence/instrumentation is connected.",
          { class: "muted" },
        ),
      ),
    ];
  }
  function comms() {
    const content = panel(
      "Notifications",
      node(
        "p",
        qa
          ? "Fake delivery only · synthetic subscribers"
          : "Registration and real delivery are disabled",
      ),
      table(
        ["Channel", "Queued", "Sent", "Unknown"],
        [
          [
            "Farcaster",
            state.outbox.queued,
            state.outbox.sent,
            state.outbox.unknown,
          ],
          [
            "Base",
            Math.max(
              0,
              state.baseOutbox.total -
                state.baseOutbox.sent -
                state.baseOutbox.unknown,
            ),
            state.baseOutbox.sent,
            state.baseOutbox.unknown,
          ],
        ],
      ),
      button("Refresh event previews", "comms.refresh", () =>
        command("comms.refresh", {}),
      ),
      table(
        ["Priority", "Event", "Subject", "State", "Expires"],
        state.candidates.map((e) => [
          e.priority,
          e.kind,
          e.subject,
          e.state,
          when(e.expires_at),
        ]),
      ),
      node(
        "p",
        "Three distinct events per person per UTC day. Reward notices take priority over milestones.",
        { class: "muted" },
      ),
      button(
        state.notifications?.paused
          ? "Resume notification processing"
          : "Pause notification processing",
        "comms.pause",
        () =>
          command("comms.pause", {
            channel: "notifications",
            paused: !state.notifications?.paused,
          }),
      ),
    );
    const social = panel(
      "Social drafts",
      node(
        "p",
        "Each post requires review. Opening a composer is not a published-post receipt.",
        { class: "muted" },
      ),
      button(
        state.controls?.social_paused
          ? "Resume social composers"
          : "Pause social composers",
        "comms.pause",
        () =>
          command("comms.pause", {
            channel: "social",
            paused: !state.controls?.social_paused,
          }),
      ),
    );
    for (const d of state.drafts) {
      const row = group(
        node("h3", d.title),
        node("p", d.body),
        node("p", d.state + " · " + when(d.updated_at), { class: "muted" }),
      );
      row.append(
        button("Approve draft", "social.approve", () =>
          command("social.approve", { id: d.id, draftVersion: d.version }),
        ),
        button(
          qa ? "Preview social post" : "Open reviewed composer",
          "social.open",
          async () => {
            const result = await command("social.open", {
              id: d.id,
              draftVersion: d.version,
            });
            if (result) {
              const preview = panel(
                qa ? "Simulated social preview" : "Reviewed post",
                node("p", d.body),
                qa
                  ? node("p", "No composer was opened.")
                  : node("a", "Open Farcaster composer ↗", {
                      href: result.composerUrl,
                      target: "_blank",
                      rel: "noopener noreferrer",
                    }),
              );
              $("content").prepend(preview);
              preview.scrollIntoView({ block: "start" });
            }
          },
          true,
        ),
      );
      const edit = button(
        "Edit draft",
        "social.save",
        () => {
          const title = input(d.title),
            body = node("textarea", d.body, { maxlength: 500 }),
            path = input(d.target_path);
          row.append(
            field("Title", title),
            field("Post text", body),
            field("Destination", path),
            button("Save revised draft", "social.save", () =>
              command("social.save", {
                id: d.id,
                draftVersion: d.version,
                title: title.value,
                body: body.value,
                targetPath: path.value,
              }),
            ),
          );
          edit.disabled = true;
        },
        true,
      );
      edit.disabled = !["draft", "approved"].includes(d.state);
      row.append(edit);
      social.append(row);
    }
    const title = input("", "Draft title"),
      body = node("textarea", null, {
        maxlength: 500,
        placeholder: "Social post text",
      }),
      target = input("/", "Launchpad-relative destination");
    social.append(
      field("Title", title),
      field("Post", body),
      field("Destination", target),
      button("Save social draft", "social.save", () =>
        command("social.save", {
          title: title.value,
          body: body.value,
          targetPath: target.value,
        }),
      ),
    );
    const editions = state.editions || [],
      edition = select(
        editions.map((e) => [e.id, e.symbol]),
        editions[0]?.id ?? "",
        () => {},
      ),
      threshold = input("1000000", "USD threshold", "number");
    const milestones = panel(
      "Milestone alerts",
      node(
        "p",
        "Audience: all users who explicitly enable milestones. Verified FDV is required.",
        { class: "muted" },
      ),
      field("Edition", edition),
      field("FDV threshold · USD", threshold),
      button("Save $ threshold rule", "milestone.save", () =>
        command("milestone.save", {
          editionId: edition.value,
          thresholdUsd: threshold.value,
          enabled: true,
          ruleVersion:
            state.rules.find(
              (r) =>
                r.edition_id === edition.value &&
                Number(r.threshold_usd) === Number(threshold.value),
            )?.version ?? 0,
        }),
      ),
      table(
        ["Edition", "Threshold USD", "Enabled", "Control"],
        state.rules.map((r) => [
          r.edition_id,
          r.threshold_usd,
          r.enabled ? "Yes" : "No",
          button(
            r.enabled ? "Disable rule" : "Enable rule",
            "milestone.save",
            () =>
              command("milestone.save", {
                editionId: r.edition_id,
                thresholdUsd: r.threshold_usd,
                enabled: !r.enabled,
                ruleVersion: r.version,
              }),
            true,
          ),
        ]),
      ),
      table(
        ["Edition", "Crossed USD", "Observed"],
        state.milestones.map((m) => [
          m.edition_id,
          m.threshold_usd,
          when(m.at),
        ]),
      ),
    );
    return [content, social, milestones];
  }
  function health() {
    const h = state.health,
      controls = panel(
        "Safety controls",
        node(
          "p",
          "Funded direct on-chain claims cannot be paused by the app.",
          { class: "muted" },
        ),
      );
    for (const c of h.controls) {
      controls.append(
        group(
          node("strong", c.name + " · " + (c.paused ? "paused" : "running")),
          button(
            c.paused ? "Resume " + c.name : "Pause " + c.name,
            "control.set",
            () => {
              const reason = prompt("Reason for changing " + c.name);
              if (reason?.trim())
                command(
                  "control.set",
                  {
                    name: c.name,
                    paused: !c.paused,
                    controlVersion: c.version,
                  },
                  reason,
                );
            },
            true,
          ),
        ),
      );
    }
    return [
      panel(
        "Health · " + h.status,
        ...h.alerts.map((a) =>
          node("p", a.severity.toUpperCase() + " · " + a.code),
        ),
      ),
      controls,
      panel(
        "Sources and allowances",
        table(
          ["Provider", "Used", "Ceiling", "Remaining"],
          h.sources.budgets.map((b) => [
            b.provider,
            b.used,
            b.ceiling,
            b.remaining,
          ]),
        ),
        details("Coverage and growth queues", {
          sources: h.sources,
          growth: h.growth,
        }),
      ),
      panel(
        "Background work",
        table(
          ["Job", "State", "Attempts", "Due", "Recovery"],
          state.jobs.map((j) => [
            j.id,
            j.state,
            j.attempts,
            when(j.due_at),
            j.state === "blocked"
              ? button(
                  "Retry same job",
                  "job.retry",
                  () => command("job.retry", { id: j.id }),
                  "secondary",
                )
              : "—",
          ]),
        ),
      ),
      panel(
        "Security & performance",
        node(
          "p",
          "Runtime errors: " + (state.telemetry.runtimeErrors ?? "Unavailable"),
        ),
        node(
          "p",
          "p95 latency: " + (state.telemetry.latencyP95 ?? "Unavailable"),
        ),
        node("p", state.telemetry.source, { class: "muted" }),
      ),
      panel(
        "Audit and unresolved commands",
        table(
          ["Action", "Actor", "State", "Time"],
          state.commands.map((c) => [
            c.action,
            c.actor,
            c.state,
            when(c.created_at),
          ]),
        ),
      ),
    ];
  }
  function render() {
    if (!state) return;
    $("content").replaceChildren(
      ...{ overview: today, performance, comms, health }[tab](),
    );
    document.querySelectorAll("[data-tab]").forEach((e) => {
      e.setAttribute("aria-selected", String(e.dataset.tab === tab));
      e.tabIndex = e.dataset.tab === tab ? 0 : -1;
    });
  }
  for (const e of document.querySelectorAll("[data-tab]")) {
    e.addEventListener("click", () => {
      tab = e.dataset.tab;
      load();
    });
    e.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll("[data-tab]")],
        index = tabs.indexOf(e),
        next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                tabs.length;
      tabs[next].focus();
      tabs[next].click();
    });
  }
  $("date").value = new Date().toISOString().slice(0, 10);
  $("date").addEventListener("change", () => {
    if (dirty && !confirm("Discard unsaved shortlist changes?")) {
      $("date").value = state.date;
      return;
    }
    dirty = false;
    launchReview = null;
    load();
  });
  $("range").addEventListener("change", load);
  $("refresh").addEventListener("click", load);
  $("retry").addEventListener("click", () =>
    lastCommand ? submitCommand() : load(),
  );
  $("loginBtn").addEventListener("click", async () => {
    try {
      token = $("token").value.trim();
      const response = await fetch("/api/admin/2fa/request", {
          method: "POST",
          headers: { "x-admin-token": token },
        }),
        data = await response.json();
      if (!response.ok) throw Error(data.error || "Could not start 2FA");
      nonce = data.nonce;
      $("codeStep").hidden = false;
      say("Enter the email code.");
    } catch (error) {
      say(error.message, true);
    }
  });
  $("verifyBtn").addEventListener("click", async () => {
    try {
      const response = await fetch("/api/admin/2fa/verify", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify({ nonce, code: $("code").value }),
        }),
        data = await response.json();
      if (!response.ok) throw Error(data.error || "Verification failed");
      session = data.sessionToken;
      $("token").value = "";
      $("code").value = "";
      await load();
    } catch (error) {
      say(error.message, true);
    }
  });
  $("logout").addEventListener("click", () => {
    token = "";
    session = "";
    nonce = "";
    state = null;
    $("content").replaceChildren();
    $("workspace").hidden = true;
    $("login").hidden = false;
    say("Signed out.");
  });
  if (window.__MEME_LOCAL_QA__ === true) {
    $("qaBox").hidden = false;
    $("qaToggle").checked = qa;
    $("qaToggle").addEventListener("change", (e) => {
      const url = new URL(location.href);
      if (e.target.checked) url.searchParams.set("qa", "seeded");
      else url.searchParams.delete("qa");
      location.href = url.href;
    });
  }
  if (qa) {
    $("login").hidden = true;
    fetch("/__qa/context")
      .then((r) => r.json())
      .then((c) => {
        $("date").value = new Date(c.clock).toISOString().slice(0, 10);
        load();
      })
      .catch((e) => say(e.message, true));
  }
})();
`;
