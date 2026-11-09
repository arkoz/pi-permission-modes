import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { approvalMessage, freshApprovalMessage, latestPlanHandoff, readablePlanHash, DEFAULT_APPROVE_MESSAGE, restorePendingPlan, showPlanSucceeded, shownPlanPath } from "./plan-approval.ts";

test("approvalMessage: default template, {path} everywhere, empty template falls back", () => {
  assert.equal(approvalMessage(undefined, "plan/x.md"), "The plan in `plan/x.md` is approved. Implement it now.");
  assert.equal(approvalMessage("  ", "plan/x.md"), approvalMessage(DEFAULT_APPROVE_MESSAGE, "plan/x.md"));
  assert.equal(approvalMessage("Do {path}; file: {path}", "p.md"), "Do p.md; file: p.md");
  assert.equal(approvalMessage("No placeholder", "p.md"), "No placeholder");
});

test("freshApprovalMessage: preserves custom templates and always names the plan and guidance", () => {
  for (const template of [undefined, "", "Go implement", "Do {path}, then check {path}"]) {
    const message = freshApprovalMessage(template, "plan/x.md");
    assert.ok(message.startsWith(approvalMessage(template, "plan/x.md")));
    assert.match(message, /read the saved plan in `plan\/x.md`/);
    assert.match(message, /AGENTS\.md and any instructions it references/);
    assert.match(message, /no planning conversation or summary was transferred/);
  }
});

test("readablePlanHash: missing, unsafe, traversal and symlink escape fail closed", () => {
  const root = mkdtempSync(path.join(tmpdir(), "perm-plan-"));
  try {
    mkdirSync(path.join(root, "plan"));
    writeFileSync(path.join(root, "plan/x.md"), "# Plan");
    writeFileSync(path.join(root, "outside.md"), "# Outside");
    assert.match(readablePlanHash(root, "plan/x.md") ?? "", /^[a-f0-9]{64}$/);
    for (const p of ["plan/missing.md", "../outside.md", "plan/../outside.md", "plan/x`y.md", "outside.md"]) assert.equal(readablePlanHash(root, p), undefined);
    if (process.platform !== "win32") {
      symlinkSync(path.join(root, "outside.md"), path.join(root, "plan/link.md"));
      assert.equal(readablePlanHash(root, "plan/link.md"), undefined);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("latestPlanHandoff: only validated, latest handoff metadata is restored", () => {
  const data = { id: "id", path: "plan/x.md", sha: "sha", mode: "build", ready: true,
    parentSession: "/sessions/parent.jsonl", parentLeafId: "leaf", kickoff: "Implement the plan", started: true };
  assert.equal(latestPlanHandoff([]), undefined);
  assert.deepEqual(latestPlanHandoff([{ type: "custom", customType: "perm-plan-handoff", data }]), data);
  assert.equal(latestPlanHandoff([{ type: "custom", customType: "perm-plan-handoff", data: { id: "x" } }]), undefined);
});

test("restorePendingPlan: the latest perm-plan entry wins; an approval entry clears it", () => {
  const shown = (p: string) => ({ type: "custom", customType: "perm-plan", data: { path: p } });
  const approved = { type: "custom", customType: "perm-plan", data: {} };
  assert.equal(restorePendingPlan([]), undefined);
  assert.deepEqual(restorePendingPlan([shown("a.md")]), { path: "a.md", declined: false });
  assert.deepEqual(restorePendingPlan([shown("a.md"), shown("b.md")]), { path: "b.md", declined: false });
  assert.equal(restorePendingPlan([shown("a.md"), approved]), undefined);
  assert.deepEqual(restorePendingPlan([shown("a.md"), approved, shown("c.md")]), { path: "c.md", declined: false });
  // Other entries and malformed data are ignored.
  assert.equal(restorePendingPlan([{ type: "custom", customType: "perm-mode", data: { mode: "plan" } }]), undefined);
  assert.equal(restorePendingPlan([{ type: "custom", customType: "perm-plan", data: { path: 5 } }]), undefined);
  assert.equal(restorePendingPlan([{ type: "message", customType: "perm-plan", data: { path: "x" } }]), undefined);
});

test("showPlanSucceeded / shownPlanPath: tool-reported errors count as failure; the reported path wins", () => {
  assert.equal(showPlanSucceeded(false, { details: { path: "plan/x.md", markdown: "# x" } }), true);
  assert.equal(showPlanSucceeded(false, { details: { error: "not under plan/" } }), false);
  assert.equal(showPlanSucceeded(true, { details: { path: "plan/x.md" } }), false);
  assert.equal(showPlanSucceeded(false, undefined), true); // a renderer-less result still rendered
  assert.equal(shownPlanPath({ details: { path: "plan/real.md" } }, "plan/req.md"), "plan/real.md");
  assert.equal(shownPlanPath({ details: {} }, "plan/req.md"), "plan/req.md");
  assert.equal(shownPlanPath(undefined, "plan/req.md"), "plan/req.md");
});
