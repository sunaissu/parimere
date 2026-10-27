export function householdPanel(api) {
  const node = (tag, text) => {
      const el = document.createElement(tag);
      if (text) el.textContent = text;
      return el;
    },
    root = node("details"),
    controls = node("div"),
    result = node("div");
  let session = null,
    state = null,
    pending = false,
    membershipEpoch = 0;
  const shareDialogs = new Set();
  try {
    const value = JSON.parse(sessionStorage.getItem("parimere:membership"));
    if (
      value &&
      /^[a-f0-9-]{36}$/.test(value.id) &&
      /^[A-Za-z0-9_-]{43}$/.test(value.credential)
    )
      session = value;
  } catch {}
  const field = (label) => {
    const el = node("input");
    el.maxLength = 120;
    el.setAttribute("aria-label", label);
    el.placeholder = label;
    controls.append(el);
    return el;
  };
  root.className = "workspace-panel";
  root.append(
    node("summary", "Optional household sharing"),
    node(
      "p",
      "Local comparisons stay private until you explicitly share a reviewed copy. Members can read and replace the shared comparison. Invitations are single-use and expire after a day. Membership expires after 90 days. The server must enable household sync; this browser session holds your access key.",
    ),
    controls,
    result,
  );
  const memberName = field("Your visible member name"),
    houseName = field("Household name"),
    invite = field("Invitation code");
  invite.autocomplete = "off";
  const button = (text, action) => {
    const b = node("button", text);
    b.type = "button";
    b.onclick = async () => {
      if (pending) return;
      pending = true;
      for (const item of root.querySelectorAll("button")) item.disabled = true;
      try {
        await action();
      } catch (error) {
        api.message(error.message);
      } finally {
        pending = false;
        for (const item of root.querySelectorAll("button"))
          item.disabled = false;
      }
    };
    return b;
  };
  async function request(path, method = "GET", body) {
    const requestedSession = session,
      requestedEpoch = membershipEpoch,
      controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("/api/households" + path, {
        method,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: "Bearer " + session.credential } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (Number(response.headers.get("content-length")) > 250000)
        throw new Error("Shared response exceeds its limit.");
      const reader = response.body.getReader(),
        parts = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 250000) {
          await reader.cancel();
          throw new Error("Shared response exceeds its limit.");
        }
        parts.push(value);
      }
      const all = new Uint8Array(bytes);
      let at = 0;
      for (const p of parts) {
        all.set(p, at);
        at += p.length;
      }
      const data = JSON.parse(new TextDecoder().decode(all));
      if (requestedSession !== session || requestedEpoch !== membershipEpoch)
        throw new Error("Membership changed. Reload the shared revision.");
      if (!response.ok) {
        if (response.status === 401) {
          session = null;
          state = null;
          sessionStorage.removeItem("parimere:membership");
          draw();
        }
        throw new Error(data.error || "Sharing failed.");
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
  function connect(data) {
    if (typeof data.credential !== "string")
      throw new Error("Missing membership credential.");
    session = { id: data.id, credential: data.credential };
    sessionStorage.setItem("parimere:membership", JSON.stringify(session));
    state = data;
    draw();
  }
  async function refresh() {
    if (!session) throw new Error("Create or join a household first.");
    state = await request("/" + session.id);
    draw();
  }
  function draw() {
    result.replaceChildren();
    if (!session) {
      result.append(node("p", "Not connected."));
      return;
    }
    result.append(
      node(
        "p",
        state
          ? state.name +
              " · Shared revision " +
              state.version +
              " · Updated " +
              state.updated
          : "Membership available. Reload to see the shared revision.",
      ),
    );
    if (!state) return;
    result.append(
      button("Review shared comparison", () => {
        if (!state.document)
          throw new Error("No comparison has been shared yet.");
        api.preview(state.document);
      }),
      button("Review and share current comparison", () => {
        const doc = api.current(),
          dialog = node("dialog"),
          pre = node("pre", JSON.stringify(doc, null, 2));
        dialog.className = "transfer-dialog";
        dialog.append(
          node("h2", "Share this exact copy with every household member?"),
          node(
            "p",
            "Names, prices, costs, stores, barcodes, notes and quality criteria below will be sent to the household server.",
          ),
          pre,
          button("Cancel", () => {
            dialog.close();
            dialog.remove();
          }),
          button("Share reviewed copy", async () => {
            state = await request("/" + session.id, "PUT", {
              version: state.version,
              confirmed: true,
              document: doc,
            });
            dialog.close();
            dialog.remove();
            draw();
            api.message(
              "Shared comparison saved. Local future edits remain private until shared again.",
            );
          }),
        );
        shareDialogs.add(dialog);
        dialog.addEventListener("close", () => {
          shareDialogs.delete(dialog);
          dialog.remove();
        });
        document.body.append(dialog);
        if (api.showDialog) api.showDialog(dialog);
        else dialog.showModal();
      }),
    );
    if (state.owner)
      result.append(
        button("Create one-use invitation", async () => {
          if (
            !confirm(
              "Create an invitation granting read and edit access to this household?",
            )
          )
            return;
          const response = await request("/" + session.id + "/invite", "POST", {
            confirmed: true,
          });
          const code = node("input");
          code.value = response.invite;
          code.readOnly = true;
          code.setAttribute("aria-label", "Private invitation code");
          result.append(
            node("p", "Copy privately. Expires " + response.expires),
            code,
          );
          code.select();
        }),
      );
    for (const member of state.members) {
      const row = node(
        "p",
        member.name +
          (member.owner ? " · Owner" : "") +
          (member.id === state.currentMember ? " · You" : ""),
      );
      if (!member.owner && (state.owner || member.id === state.currentMember))
        row.append(
          button(
            member.id === state.currentMember
              ? "Leave household"
              : "Revoke member",
            async () => {
              if (
                !confirm(
                  "Remove this member’s access? Copies already downloaded cannot be recalled.",
                )
              )
                return;
              await request(
                "/" + session.id + "/members/" + member.id,
                "DELETE",
                { confirmed: true },
              );
              if (member.id === state.currentMember) {
                session = null;
                state = null;
                sessionStorage.removeItem("parimere:membership");
                draw();
              } else await refresh();
            },
          ),
        );
      result.append(row);
    }
    if (state.owner)
      result.append(
        button("Delete shared household", async () => {
          if (
            !confirm(
              "Delete the household, all memberships and its server comparison? Local saved copies remain.",
            )
          )
            return;
          await request("/" + session.id, "DELETE", { confirmed: true });
          session = null;
          state = null;
          sessionStorage.removeItem("parimere:membership");
          draw();
        }),
      );
  }
  const recovery = node("input");
  recovery.type = "file";
  recovery.accept = ".json,application/json";
  recovery.setAttribute("aria-label", "Reconnect with a private access key");
  recovery.onchange = async () => {
    const file = recovery.files[0];
    recovery.value = "";
    if (!file || pending) return;
    const requestedEpoch = membershipEpoch;
    try {
      if (file.size > 2048) throw new Error("Invalid access key file.");
      const key = JSON.parse(await file.text());
      if (requestedEpoch !== membershipEpoch) return;
      if (
        key.schemaVersion !== 1 ||
        key.origin !== location.origin ||
        !/^[a-f0-9-]{36}$/.test(key.id) ||
        !/^[A-Za-z0-9_-]{43}$/.test(key.credential)
      )
        throw new Error("Use a valid access key for this exact server.");
      if (!confirm("Reconnect using this private membership key?")) return;
      session = { id: key.id, credential: key.credential };
      sessionStorage.setItem("parimere:membership", JSON.stringify(session));
      await refresh();
    } catch (error) {
      api.message(error.message);
    }
  };
  controls.append(
    button("Create household", async () => {
      if (session) throw new Error("Disconnect the current membership first.");
      if (
        confirm(
          "Create an empty household on this server? No comparison is uploaded yet.",
        )
      )
        connect(
          await request("", "POST", {
            name: houseName.value,
            memberName: memberName.value,
          }),
        );
    }),
    button("Join by invitation", async () => {
      if (session) throw new Error("Disconnect the current membership first.");
      const parts = invite.value.trim().split(".");
      if (parts.length !== 2 || !/^[a-f0-9-]{36}$/.test(parts[0]))
        throw new Error("Enter a complete household invitation.");
      if (confirm("Join this household using your visible name?")) {
        connect(
          await request("/" + parts[0] + "/join", "POST", {
            invite: parts[1],
            memberName: memberName.value,
          }),
        );
        invite.value = "";
      }
    }),
    button("Reload shared revision", refresh),
    button("Download my private access key", () => {
      if (!session) throw new Error("Create or join a household first.");
      if (
        !confirm(
          "Download a private key that grants your household access until revoked or expired? Keep it private. It is separate from a comparison export.",
        )
      )
        return;
      const url = URL.createObjectURL(
          new Blob(
            [
              JSON.stringify({
                schemaVersion: 1,
                origin: location.origin,
                ...session,
              }),
            ],
            { type: "application/json" },
          ),
        ),
        a = node("a");
      a.href = url;
      a.download = "parimere-private-access-key.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
    recovery,
    button("Disconnect this browser", () => {
      session = null;
      state = null;
      sessionStorage.removeItem("parimere:membership");
      draw();
      api.message(
        "Browser disconnected. Membership remains until revoked or expired.",
      );
    }),
  );
  window.addEventListener("parimere:erase-data", () => {
    membershipEpoch++;
    session = null;
    state = null;
    try {
      sessionStorage.removeItem("parimere:membership");
    } catch {}
    memberName.value = "";
    houseName.value = "";
    invite.value = "";
    recovery.value = "";
    for (const dialog of shareDialogs) {
      dialog.close();
      dialog.remove();
    }
    shareDialogs.clear();
    draw();
  });
  draw();
  return root;
}
