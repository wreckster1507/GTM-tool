export type StepChannel = "email" | "call" | "linkedin";

export type CallDispositionOption = {
  value: string;
  label: string;
  sequenceStatus?: "interested" | "replied" | "meeting_booked" | "not_interested";
  suggestedCallStatus?: "attempted" | "connected" | "voicemail" | "callback";
};

export const CALL_OUTCOME_OPTIONS = [
  { value: "attempted", label: "Attempted — no answer" },
  { value: "voicemail", label: "Left voicemail" },
  { value: "connected", label: "Connected — spoke live" },
  { value: "callback", label: "Callback requested" },
] as const;

export const CALL_DISPOSITION_OPTIONS: CallDispositionOption[] = [
  {
    value: "demo_scheduled_booked",
    label: "Demo Scheduled/Booked",
    sequenceStatus: "meeting_booked",
    suggestedCallStatus: "connected",
  },
  {
    value: "interested_follow_up_required",
    label: "Interested/Follow-up Required",
    sequenceStatus: "interested",
    suggestedCallStatus: "connected",
  },
  {
    value: "meeting_confirmed",
    label: "Meeting Confirmed",
    sequenceStatus: "meeting_booked",
    suggestedCallStatus: "connected",
  },
  {
    value: "call_back_later_rescheduled",
    label: "Call Back Later/Rescheduled",
    sequenceStatus: "interested",
    suggestedCallStatus: "callback",
  },
  {
    value: "gatekeeper_connected_to_admin",
    label: "Gatekeeper (connected to admin, not lead)",
    suggestedCallStatus: "connected",
  },
  {
    value: "connected_not_interested",
    label: "Connected - Not Interested",
    sequenceStatus: "not_interested",
    suggestedCallStatus: "connected",
  },
  {
    value: "no_answer_busy_signal",
    label: "No Answer/Busy Signal",
    suggestedCallStatus: "attempted",
  },
  {
    value: "invalid_number_wrong_number",
    label: "Invalid Number/Wrong Number",
    suggestedCallStatus: "attempted",
  },
  {
    value: "do_not_contact_dnc",
    label: "Do Not Contact/DNC",
    sequenceStatus: "not_interested",
    suggestedCallStatus: "connected",
  },
  {
    value: "contact_poor_fit",
    label: "Contact Poor Fit",
    sequenceStatus: "not_interested",
    suggestedCallStatus: "connected",
  },
  {
    value: "redirected_other_icp",
    label: "Redirected to other ICP",
    sequenceStatus: "interested",
    suggestedCallStatus: "connected",
  },
];

const CALL_DISPOSITION_LABELS = new Map(CALL_DISPOSITION_OPTIONS.map((option) => [option.value, option.label]));

export const CALL_DISPOSITION_FILTER_OPTIONS = [
  { value: "unreviewed", label: "Unreviewed" },
  ...CALL_DISPOSITION_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
];

export const CALL_REPLY_DISPOSITIONS = new Set([
  "demo_scheduled_booked",
  "interested_follow_up_required",
  "meeting_confirmed",
  "call_back_later_rescheduled",
  "redirected_other_icp",
]);

export const CALL_MEETING_DISPOSITIONS = new Set([
  "demo_scheduled_booked",
  "meeting_confirmed",
]);

export const CALL_BLOCKED_DISPOSITIONS = new Set([
  "connected_not_interested",
  "do_not_contact_dnc",
  "contact_poor_fit",
]);

export const LINKEDIN_STATUS_OPTIONS = [
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "replied", label: "Replied" },
] as const;

const LINKEDIN_STATUS_LABELS = new Map(LINKEDIN_STATUS_OPTIONS.map((option) => [option.value, option.label]));

export function formatCallDisposition(value?: string | null): string {
  if (!value) return "Unreviewed";
  return CALL_DISPOSITION_LABELS.get(value) ?? value.replace(/_/g, " ");
}

export function formatLinkedinStatus(value?: string | null): string {
  if (!value || value === "none") return "No LinkedIn motion";
  return LINKEDIN_STATUS_LABELS.get(value as "sent" | "accepted" | "replied") ?? value.replace(/_/g, " ");
}

export function deriveSequenceStatusFromCallDisposition(
  disposition?: string | null,
  currentStatus?: string | null,
): string | undefined {
  if (!disposition) return currentStatus ?? undefined;
  const matched = CALL_DISPOSITION_OPTIONS.find((option) => option.value === disposition);
  if (!matched?.sequenceStatus) return currentStatus ?? undefined;
  if (currentStatus === "meeting_booked") return currentStatus;
  if (currentStatus === "not_interested" && matched.sequenceStatus !== "meeting_booked") return currentStatus;
  return matched.sequenceStatus;
}

export function deriveSequenceStatusFromLinkedinStatus(
  linkedinStatus?: string | null,
  currentStatus?: string | null,
): string | undefined {
  if (!linkedinStatus || linkedinStatus === "none") return currentStatus ?? undefined;
  if (linkedinStatus === "replied") return currentStatus === "meeting_booked" ? currentStatus : "replied";
  return currentStatus ?? undefined;
}
