import { describe, expect, it } from "vitest";
import {
  DRAFT_STORAGE_KEY,
  MAX_DRAFTS,
  MAX_DRAFT_CHARS,
  createDraftStore,
  decideDraftAction,
  notifyDraftSent,
  shouldEmptyRestoredField,
  subscribeDraftSent,
  draftScope,
  type DraftStorage,
} from "@/lib/guest-messages/composer-draft";

function fakeStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

function storeOn(storage: DraftStorage, now?: () => number) {
  return createDraftStore(() => storage, now);
}

describe("composer draft store", () => {
  it("restores a saved draft for the same conversation, also through a fresh store (reload)", () => {
    const storage = fakeStorage();
    const a = createDraftStore(() => storage);
    a.set(draftScope("org1", "c1"), "안녕하세요");
    const b = createDraftStore(() => storage);
    expect(b.get(draftScope("org1", "c1"))).toBe("안녕하세요");
  });

  it("keeps conversations and organizations separate", () => {
    const store = storeOn(fakeStorage());
    store.set(draftScope("org1", "c1"), "one");
    store.set(draftScope("org1", "c2"), "two");
    expect(store.get(draftScope("org1", "c1"))).toBe("one");
    expect(store.get(draftScope("org1", "c2"))).toBe("two");
    expect(store.get(draftScope("org2", "c1"))).toBeNull();
  });

  it("clears when the text is emptied or after an accepted send; keeps it when nothing clears (failed send)", () => {
    const store = storeOn(fakeStorage());
    const scope = draftScope("o", "c");
    store.set(scope, "draft");
    // failed send: caller does nothing -> still there
    expect(store.get(scope)).toBe("draft");
    // accepted send / user empties the field -> text "" -> cleared
    store.set(scope, "");
    expect(store.get(scope)).toBeNull();
    store.set(scope, "again");
    store.set(scope, "   ");
    expect(store.get(scope)).toBeNull();
    store.clear(scope);
    expect(store.get(scope)).toBeNull();
  });

  it("does not break when storage throws, and falls back to memory", () => {
    const boom: DraftStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    const store = createDraftStore(() => boom);
    expect(() => store.set("s", "text")).not.toThrow();
    expect(store.get("s")).toBe("text");
    expect(() => store.clear("s")).not.toThrow();
    expect(store.get("s")).toBeNull();
    const none = createDraftStore(() => {
      throw new Error("no storage");
    });
    expect(() => none.set("s", "x")).not.toThrow();
    expect(none.get("s")).toBe("x");
  });

  it("ignores corrupted stored data", () => {
    const storage = fakeStorage();
    storage.data.set(DRAFT_STORAGE_KEY, "{not json");
    const store = createDraftStore(() => storage);
    expect(store.get("s")).toBeNull();
    store.set("s", "ok");
    expect(store.get("s")).toBe("ok");
    storage.data.set(DRAFT_STORAGE_KEY, JSON.stringify({ s: { t: 5 }, arr: [] }));
    expect(store.get("s")).toBeNull();
  });

  it("keeps only the most recent drafts", () => {
    let clock = 0;
    const store = storeOn(fakeStorage(), () => (clock += 1));
    for (let i = 0; i < MAX_DRAFTS + 5; i += 1) store.set(`c${i}`, `t${i}`);
    expect(store.get("c0")).toBeNull();
    expect(store.get("c4")).toBeNull();
    expect(store.get("c5")).toBe("t5");
    expect(store.get(`c${MAX_DRAFTS + 4}`)).toBe(`t${MAX_DRAFTS + 4}`);
  });

  it("caps one draft's length", () => {
    const store = storeOn(fakeStorage());
    store.set("s", "가".repeat(MAX_DRAFT_CHARS + 50));
    expect(Array.from(store.get("s") ?? "").length).toBe(MAX_DRAFT_CHARS);
  });

  it("keeps the draft coherent when only setItem throws (quota)", () => {
    const storage = fakeStorage();
    const store = storeOn(storage);
    store.set("a", "first");
    let full = true;
    const flaky: DraftStorage = {
      getItem: (k) => storage.getItem(k),
      setItem: (k, v) => {
        if (full) throw new Error("quota");
        storage.setItem(k, v);
      },
    };
    const store2 = storeOn(flaky);
    store2.set("b", "second"); // write fails -> memory becomes the source
    expect(store2.get("b")).toBe("second");
    expect(store2.get("a")).toBe("first");
    store2.set("c", "third"); // starts from the memory bundle, not the stale storage copy
    expect(store2.get("b")).toBe("second");
    expect(store2.get("c")).toBe("third");
    store2.clear("b");
    expect(store2.get("b")).toBeNull();
    full = false; // storage recovers -> next write persists the whole bundle
    store2.set("d", "fourth");
    const fresh = storeOn(storage);
    expect(fresh.get("a")).toBe("first");
    expect(fresh.get("c")).toBe("third");
    expect(fresh.get("d")).toBe("fourth");
    expect(fresh.get("b")).toBeNull();
  });
});

describe("decideDraftAction", () => {
  const base = { text: "hello", enabled: true, restoring: false, untouchedAuto: false };

  it("saves what the user wrote or edited", () => {
    expect(decideDraftAction(base)).toBe("save");
  });

  it("does not save an untouched auto draft (resolved / AI), but saves it once edited", () => {
    expect(decideDraftAction({ ...base, untouchedAuto: true })).toBe("clear");
    expect(decideDraftAction({ ...base, text: "hello!", untouchedAuto: false })).toBe("save");
  });

  it("clears when the field is emptied", () => {
    expect(decideDraftAction({ ...base, text: "" })).toBe("clear");
    expect(decideDraftAction({ ...base, text: "  \n" })).toBe("clear");
  });

  it("never touches the reply draft in note mode", () => {
    expect(decideDraftAction({ ...base, enabled: false })).toBe("skip");
    expect(decideDraftAction({ ...base, enabled: false, text: "" })).toBe("skip");
  });

  it("skips while restoring so a stale empty field cannot erase the saved draft", () => {
    expect(decideDraftAction({ ...base, text: "", restoring: true })).toBe("skip");
  });
});

describe("send ordering", () => {
  it("an accepted send clears storage even after the unmount flush wrote the sent text", () => {
    const store = storeOn(fakeStorage());
    const scope = draftScope("o", "c");
    store.set(scope, "sent text"); // unmount / pagehide flush while the send was in flight
    store.clear(scope); // success branch clears by scope, not via state
    expect(store.get(scope)).toBeNull();
  });

  it("a failed send leaves the flushed text recoverable", () => {
    const store = storeOn(fakeStorage());
    const scope = draftScope("o", "c");
    store.set(scope, "sent text");
    expect(store.get(scope)).toBe("sent text");
  });
});

describe("accepted send while a restored copy is open", () => {
  it("empties the restored field only if unedited and equal to the sent text", () => {
    const base = { restoredText: "hello", currentText: "hello", sentText: "hello" };
    expect(shouldEmptyRestoredField(base)).toBe(true);
    expect(shouldEmptyRestoredField({ ...base, sentText: "  hello \n" })).toBe(true);
    expect(shouldEmptyRestoredField({ ...base, currentText: "hello!" })).toBe(false); // edited since restore
    expect(shouldEmptyRestoredField({ ...base, restoredText: null })).toBe(false); // nothing restored
    expect(shouldEmptyRestoredField({ ...base, sentText: "other" })).toBe(false);
  });

  it("notifies other listeners of the scope, not the sender, and not after unsubscribe", () => {
    const sender = {};
    const calls: string[] = [];
    const off = subscribeDraftSent("s1", (text, source) => {
      if (source !== sender) calls.push(text);
    });
    subscribeDraftSent("s2", () => calls.push("wrong scope"))();
    notifyDraftSent("s1", "hi", sender); // own notification filtered by source
    notifyDraftSent("s1", "hi", {});
    expect(calls).toEqual(["hi"]);
    off();
    notifyDraftSent("s1", "again", {});
    expect(calls).toEqual(["hi"]);
  });

  it("an ordinary clear does not notify", () => {
    const store = storeOn(fakeStorage());
    const calls: string[] = [];
    const off = subscribeDraftSent("s", (t) => calls.push(t));
    store.set("s", "x");
    store.clear("s");
    expect(calls).toEqual([]);
    off();
  });
});

describe("note send vs stored reply draft", () => {
  it("clears the stored reply draft only when it equals the note just sent", () => {
    const store = storeOn(fakeStorage());
    store.set("s", "A");
    expect(store.clearIfSame("s", " A ")).toBe(true);
    expect(store.get("s")).toBeNull();
    store.set("s", "A");
    expect(store.clearIfSame("s", "B")).toBe(false);
    expect(store.get("s")).toBe("A");
    expect(store.clearIfSame("none", "A")).toBe(false);
  });
});
