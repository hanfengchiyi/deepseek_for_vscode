import React from "react";
import { send } from "../messages/client";
import { useChatStore } from "../state/store";

/**
 * Inline approval card for a mutating tool call paused by the
 * permission gate (workspace-write preset). Allow runs the call once;
 * Reject turns it into a failed tool result the model can see. The
 * call's arguments are visible on the tool card just above.
 */
export const ApprovalCard: React.FC = () => {
  const approval = useChatStore((s) => s.approval);
  if (!approval) return null;

  const decide = (allow: boolean) => {
    send({ v: 1, type: "approval.answer", approvalId: approval.approvalId, allow });
    useChatStore.getState().setApproval(null);
  };

  return (
    <div className="dsh-question dsh-approval" role="dialog" aria-label="Tool approval request">
      <div className="dsh-question-text">
        Allow <code className="dsh-approval-tool">{approval.toolName}</code> to run?
        {approval.reason ? <span className="dsh-approval-reason"> {approval.reason}</span> : null}
      </div>
      <div className="dsh-question-options">
        <button className="dsh-question-option dsh-approval-allow" onClick={() => decide(true)}>
          Allow once
        </button>
        <button className="dsh-question-option dsh-approval-reject" onClick={() => decide(false)}>
          Reject
        </button>
      </div>
    </div>
  );
};
