import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { documentData } from "./dist/storage.mjs";
const digest = (value) => createHash("sha256").update(value).digest("hex"),
  token = () => randomBytes(32).toString("base64url");
const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
const name = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 80)
    fail(400, "Names must contain 1–80 characters.");
  return value.trim();
};
export function createHouseholdStore(path) {
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS household(id TEXT PRIMARY KEY,name TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0,document TEXT,updated TEXT NOT NULL); CREATE TABLE IF NOT EXISTS member(id TEXT PRIMARY KEY,household TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,name TEXT NOT NULL,owner INTEGER NOT NULL,token TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS invite(token TEXT PRIMARY KEY,household TEXT NOT NULL REFERENCES household(id) ON DELETE CASCADE,expires INTEGER NOT NULL);",
  );
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const member = (id, credential) => {
    if (
      typeof credential !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(credential)
    )
      fail(401, "Join this household again.");
    const actor = db
      .prepare(
        "SELECT * FROM member WHERE household=? AND token=? AND expires>?",
      )
      .get(id, digest(credential), Date.now());
    if (!actor) fail(401, "Membership was revoked or expired.");
    return actor;
  };
  const view = (id, actor) => {
    const h = db.prepare("SELECT * FROM household WHERE id=?").get(id);
    if (!h) fail(404, "Household not found.");
    return {
      id,
      name: h.name,
      version: h.version,
      updated: h.updated,
      document: h.document ? JSON.parse(h.document) : null,
      currentMember: actor.id,
      owner: !!actor.owner,
      members: db
        .prepare(
          "SELECT id,name,owner,expires FROM member WHERE household=? AND expires>?",
        )
        .all(id, Date.now()),
    };
  };
  return {
    close: () => db.close(),
    handle(method, path, body, credential) {
      db.prepare("DELETE FROM invite WHERE expires<=?").run(Date.now());
      db.prepare(
        "DELETE FROM household WHERE NOT EXISTS(SELECT 1 FROM member WHERE member.household=household.id AND expires>?)",
      ).run(Date.now());
      if (method === "POST" && path === "/api/households")
        return tx(() => {
          if (db.prepare("SELECT count(*) n FROM household").get().n >= 100)
            fail(429, "This server has reached its household limit.");
          const id = randomUUID(),
            secret = token(),
            actor = { id: randomUUID(), owner: 1 };
          db.prepare(
            "INSERT INTO household(id,name,updated) VALUES(?,?,?)",
          ).run(id, name(body.name), new Date().toISOString());
          db.prepare("INSERT INTO member VALUES(?,?,?,?,?,?)").run(
            actor.id,
            id,
            name(body.memberName),
            1,
            digest(secret),
            Date.now() + 90 * 86400000,
          );
          return { ...view(id, actor), credential: secret };
        });
      const match = path.match(
        /^\/api\/households\/([a-f0-9-]{36})(?:\/(join|invite|members)(?:\/([a-f0-9-]{36}))?)?$/,
      );
      if (!match) fail(404, "Unknown household action.");
      const [, id, action, target] = match;
      if (method === "POST" && action === "join")
        return tx(() => {
          if (
            typeof body.invite !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/.test(body.invite)
          )
            fail(400, "Use a valid invitation.");
          const invite = db
            .prepare(
              "DELETE FROM invite WHERE token=? AND household=? AND expires>? RETURNING household",
            )
            .get(digest(body.invite), id, Date.now());
          if (!invite) fail(403, "Invitation expired or was already used.");
          if (
            db
              .prepare(
                "SELECT count(*) n FROM member WHERE household=? AND expires>?",
              )
              .get(id, Date.now()).n >= 12
          )
            fail(409, "Households support up to 12 active members.");
          const secret = token(),
            actor = { id: randomUUID(), owner: 0 };
          db.prepare("INSERT INTO member VALUES(?,?,?,?,?,?)").run(
            actor.id,
            id,
            name(body.memberName),
            0,
            digest(secret),
            Date.now() + 90 * 86400000,
          );
          return { ...view(id, actor), credential: secret };
        });
      const actor = member(id, credential);
      if (method === "GET" && !action) return view(id, actor);
      if (method === "POST" && action === "invite") {
        if (!actor.owner) fail(403, "Only the owner can invite members.");
        if (body.confirmed !== true) fail(400, "Confirm the invitation.");
        if (
          db.prepare("SELECT count(*) n FROM invite WHERE household=?").get(id)
            .n >= 12
        )
          fail(429, "Use or wait for existing invitations to expire.");
        const invite = token();
        db.prepare("INSERT INTO invite VALUES(?,?,?)").run(
          digest(invite),
          id,
          Date.now() + 86400000,
        );
        return {
          invite: id + "." + invite,
          expires: new Date(Date.now() + 86400000).toISOString(),
        };
      }
      if (method === "DELETE" && action === "members" && target) {
        if (!actor.owner && target !== actor.id)
          fail(403, "Only the owner can remove another member.");
        const victim = db
          .prepare("SELECT owner FROM member WHERE id=? AND household=?")
          .get(target, id);
        if (!victim) fail(404, "Member not found.");
        if (victim.owner)
          fail(409, "The owner must delete the household instead.");
        if (body.confirmed !== true) fail(400, "Confirm membership removal.");
        db.prepare("DELETE FROM member WHERE id=? AND household=?").run(
          target,
          id,
        );
        return { removed: true };
      }
      if (method === "PUT" && !action) {
        if (
          body.confirmed !== true ||
          !Number.isSafeInteger(body.version) ||
          body.version < 0
        )
          fail(400, "Confirm the expected shared revision.");
        let doc;
        try {
          doc = documentData(body.document);
        } catch (error) {
          fail(400, error.message);
        }
        const text = JSON.stringify(doc);
        if (Buffer.byteLength(text) > 200000)
          fail(413, "Comparison exceeds 200 KB.");
        const changed = db
          .prepare(
            "UPDATE household SET document=?,version=version+1,updated=? WHERE id=? AND version=?",
          )
          .run(text, new Date().toISOString(), id, body.version);
        if (!changed.changes)
          fail(
            409,
            "Another member changed the comparison. Reload and review before sharing again.",
          );
        return view(id, actor);
      }
      if (method === "DELETE" && !action) {
        if (!actor.owner) fail(403, "Only the owner can delete a household.");
        if (body.confirmed !== true) fail(400, "Confirm household deletion.");
        db.prepare("DELETE FROM household WHERE id=?").run(id);
        return { deleted: true };
      }
      fail(405, "Method not allowed.");
    },
  };
}
export function openConfiguredStore() {
  if (process.env.PARIMERE_SYNC !== "1") return null;
  const dir = new URL("./data/", import.meta.url);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return createHouseholdStore(new URL("households.sqlite", dir));
}
