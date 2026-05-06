import type { TaskItem } from "../../types";

type SystemTaskGuidance = {
  intro: string;
  steps: string[];
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getSystemTaskGuidance(task: TaskItem): SystemTaskGuidance | null {
  if (task.task_type !== "system" || !task.recommended_action) {
    return null;
  }

  const payload = task.action_payload ?? {};
  const meetingTitle = asString(payload.meeting_title);
  const followUpDraft = asString(payload.follow_up_email_draft);

  const byAction: Record<string, SystemTaskGuidance> = {
    move_deal_stage: {
      intro: "If accepted, Beacon will update the deal record for you.",
      steps: [
        "Read the latest buyer signal and confirm the recommended stage change.",
        "Move the deal to the new stage in the pipeline.",
        "Log the stage movement in the deal activity timeline.",
      ],
    },
    convert_contact_to_deal: {
      intro: "If accepted, Beacon will convert this prospect into a tracked deal.",
      steps: [
        "Create a new deal from the accepted prospect.",
        "Carry over the linked company and core context.",
        "Attach the prospect to the new deal so follow-up stays connected.",
      ],
    },
    attach_contact_to_deal: {
      intro: "If accepted, Beacon will clean up stakeholder mapping on this deal.",
      steps: [
        "Find the existing contact Beacon matched from recent activity.",
        "Attach that contact to the deal as a stakeholder.",
        "Update the deal timeline so the team sees the added stakeholder.",
      ],
    },
    create_contact_and_attach_to_deal: {
      intro: "If accepted, Beacon will add the new stakeholder into the CRM for you.",
      steps: [
        "Create a new contact from the detected participant.",
        "Attach the contact to the current deal.",
        "Keep the stakeholder map and activity history aligned.",
      ],
    },
    re_enrich_company: {
      intro: "If accepted, Beacon will refresh the company record in the background.",
      steps: [
        "Queue a fresh company enrichment run.",
        "Pull updated firmographic and research signals into the account.",
        "Leave the enriched data on the company for the team to review.",
      ],
    },
    refresh_icp_research: {
      intro: "If accepted, Beacon will refresh fit and messaging context for this account.",
      steps: [
        "Queue a new ICP research pass for the account.",
        "Re-evaluate fit, timing, and likely outreach angle.",
        "Save the refreshed research back onto the account record.",
      ],
    },
    re_enrich_contact: {
      intro: "If accepted, Beacon will refresh the contact profile in the background.",
      steps: [
        "Queue contact enrichment for the selected stakeholder.",
        "Pull updated role, title, and context signals.",
        "Save the refreshed contact data back into Beacon.",
      ],
    },
    send_pricing_package: {
      intro: "If accepted, Beacon will complete the CRM-side pricing follow-up step.",
      steps: [
        "Use the latest buyer signal to mark the pricing follow-up as handled.",
        "Update the deal's follow-up status in Beacon.",
        "Record the action in the activity timeline so the team has context.",
      ],
    },
    book_workshop_session: {
      intro: "If accepted, Beacon will mark the workshop motion forward in the CRM.",
      steps: [
        "Use the recent buyer signal to advance the workshop follow-up.",
        "Update the relevant deal follow-up state.",
        "Log the workshop action in the activity timeline.",
      ],
    },
    retry_deal_call: {
      intro: "If accepted, Beacon will mark the buyer call retry action as completed in Beacon.",
      steps: [
        "Take the missed-call recommendation forward.",
        "Update the CRM task state to show the retry action was handled.",
        "Leave an activity trail for the team to reference.",
      ],
    },
    follow_up_deal_voicemail: {
      intro: "If accepted, Beacon will record the voicemail follow-up action in the CRM.",
      steps: [
        "Use the voicemail signal to mark the follow-up motion complete.",
        "Update the deal activity record.",
        "Keep the timeline current so the next rep sees the latest action.",
      ],
    },
    send_deal_call_recap: {
      intro: "If accepted, Beacon will record the call recap action on the deal.",
      steps: [
        "Use the recent call context to mark the recap as handled.",
        "Update the deal follow-up state in Beacon.",
        "Write the recap action to the activity timeline.",
      ],
    },
    send_meeting_follow_up: {
      intro: "If accepted, Beacon will use the meeting context Beacon already prepared.",
      steps: [
        meetingTitle ? `Use the summary and notes from ${meetingTitle}.` : "Use the latest meeting summary and transcript context.",
        followUpDraft ? "Apply the drafted follow-up Beacon already prepared." : "Prepare the meeting follow-up from the captured discussion.",
        "Mark the recommendation as handled and record the action in the deal timeline.",
      ],
    },
    follow_up_buyer_thread: {
      intro: "If accepted, Beacon will complete the buyer follow-up step in the CRM.",
      steps: [
        "Use the latest buyer thread context Beacon detected.",
        "Advance the follow-up action for the deal.",
        "Record that movement in the timeline so the team sees it immediately.",
      ],
    },
    retry_contact_call: {
      intro: "If accepted, Beacon will update the prospect call-follow-up action for you.",
      steps: [
        "Mark the recommended retry action as handled.",
        "Update the prospect task state in Beacon.",
        "Leave an audit trail in the activity timeline.",
      ],
    },
    follow_up_voicemail: {
      intro: "If accepted, Beacon will log the voicemail follow-up action in Beacon.",
      steps: [
        "Take the voicemail-based recommendation forward.",
        "Update the prospect follow-up state.",
        "Record the action so the owner has a clean activity trail.",
      ],
    },
    send_contact_call_recap: {
      intro: "If accepted, Beacon will complete the contact recap step in the CRM.",
      steps: [
        "Use the call context already captured.",
        "Mark the recap recommendation as handled.",
        "Write the update into the prospect timeline.",
      ],
    },
    draft_reply_follow_up: {
      intro: "If accepted, Beacon will move the drafted-reply workflow forward in Beacon.",
      steps: [
        "Use the existing conversation context Beacon has on the prospect.",
        "Mark the draft-reply recommendation as handled.",
        "Update the timeline so the next owner sees the motion clearly.",
      ],
    },
    draft_open_follow_up: {
      intro: "If accepted, Beacon will move the open follow-up workflow forward in Beacon.",
      steps: [
        "Use the open thread context Beacon already captured.",
        "Advance the follow-up recommendation in the CRM.",
        "Record the action for clean pipeline visibility.",
      ],
    },
    book_call_from_interest: {
      intro: "If accepted, Beacon will update the prospect state from interest to booked-call motion.",
      steps: [
        "Use the positive buyer signal on the prospect.",
        "Update the contact status to reflect the booked-call intent.",
        "Log the change in Beacon so the team sees the progression.",
      ],
    },
    mark_contact_unsubscribed: {
      intro: "If accepted, Beacon will update the prospect's contactability state.",
      steps: [
        "Mark the contact as unsubscribed in Beacon.",
        "Keep future outreach from re-queuing incorrectly.",
        "Record the hygiene update in the CRM timeline.",
      ],
    },
    close_not_interested_contact: {
      intro: "If accepted, Beacon will close out the prospect as not interested.",
      steps: [
        "Update the prospect status to not interested.",
        "Remove it from the active follow-up queue.",
        "Leave a clear activity record explaining the change.",
      ],
    },
  };

  return byAction[task.recommended_action] ?? {
    intro: "If accepted, Beacon will complete the recommended CRM action for this item.",
    steps: [
      "Use the latest synced activity and task context.",
      "Apply the recommended change in Beacon.",
      "Record the action in the timeline so the team can follow what happened.",
    ],
  };
}

