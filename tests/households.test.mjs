import test from "node:test";
import assert from "node:assert/strict";
import { createHouseholdStore } from "../households.mjs";
test("households enforce membership, one-use invites, revision conflicts and revocation", () => {
  const store = createHouseholdStore(":memory:");
  try {
    const owner = store.handle("POST", "/api/households", {
        name: "Home",
        memberName: "Owner",
      }),
      path = "/api/households/" + owner.id,
      secret = owner.credential;
    const invited = store.handle(
        "POST",
        path + "/invite",
        { confirmed: true },
        secret,
      ),
      invite = invited.invite.split(".")[1];
    const member = store.handle("POST", path + "/join", {
      invite,
      memberName: "Second person",
    });
    assert.equal(member.members.length, 2);
    assert.notEqual(member.credential, secret);
    assert.throws(
      () =>
        store.handle("POST", path + "/join", {
          invite,
          memberName: "Third person",
        }),
      /used/,
    );
    assert.throws(
      () =>
        store.handle(
          "POST",
          path + "/invite",
          { confirmed: true },
          member.credential,
        ),
      /owner/,
    );
    assert.throws(
      () => store.handle("GET", path, {}, "x".repeat(43)),
      /revoked/,
    );
    const document = {
      schemaVersion: 1,
      name: "Shared",
      currency: "PHP",
      products: [
        { price: "1", amount: "1", unit: "item", pack: "1" },
        { price: "2", amount: "1", unit: "item", pack: "1" },
      ],
      options: {},
    };
    const saved = store.handle(
      "PUT",
      path,
      { version: 0, confirmed: true, document },
      member.credential,
    );
    assert.equal(saved.version, 1);
    assert.equal(store.handle("GET", path, {}, secret).document.name, "Shared");
    assert.throws(
      () =>
        store.handle(
          "PUT",
          path,
          { version: 0, confirmed: true, document },
          secret,
        ),
      /changed/,
    );
    const foreign = store.handle("POST", "/api/households", {
      name: "Other",
      memberName: "Someone",
    });
    assert.throws(
      () => store.handle("GET", path, {}, foreign.credential),
      /revoked/,
    );
    store.handle(
      "DELETE",
      path + "/members/" + member.currentMember,
      { confirmed: true },
      secret,
    );
    assert.throws(
      () => store.handle("GET", path, {}, member.credential),
      /revoked/,
    );
    assert.ok(
      !JSON.stringify(store.handle("GET", path, {}, secret)).includes(secret),
    );
    store.handle("DELETE", path, { confirmed: true }, secret);
    assert.throws(() => store.handle("GET", path, {}, secret));
  } finally {
    store.close();
  }
});
