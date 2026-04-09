export interface Company {
  id: string;
  name: string;
  domain: string;
  industry?: string;
  vertical?: string;
  employee_count?: number;
  arr_estimate?: number;
  funding_stage?: string;
  tech_stack?: Record<string, unknown>;
  region?: string;
  headquarters?: string;
  has_dap: boolean;
  dap_tool?: string;
  icp_score?: number;
  icp_tier?: string;
  enrichment_sources?: Record<string, unknown>;
  enriched_at?: string;
  description?: string;
  intent_signals?: Record<string, unknown>;
  sourcing_batch_id?: string;
  enrichment_cache?: Record<string, unknown>;
  assigned_to_id?: string;
  assigned_to_name?: string;
  assigned_rep?: string;
  assigned_rep_email?: string;
  assigned_rep_name?: string;
  sdr_id?: string;
  sdr_email?: string;
  sdr_name?: string;
  outreach_status?: string;
  disposition?: string;
  rep_feedback?: string;
  account_thesis?: string;
  why_now?: string;
  beacon_angle?: string;
  recommended_outreach_lane?: string;
  instantly_campaign_id?: string;
  prospecting_profile?: Record<string, unknown>;
  outreach_plan?: Record<string, unknown>;
  last_outreach_at?: string;
  ownership_stage?: string;
  pe_investors?: string;
  vc_investors?: string;
  strategic_investors?: string;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  company_id?: string;
  company_name?: string; // populated via SQL JOIN — no second API call needed
  first_name: string;
  last_name: string;
  email?: string;
  email_verified: boolean;
  phone?: string;
  title?: string;
  seniority?: string;
  linkedin_url?: string;
  persona?: string;
  enriched_at?: string;
  enrichment_data?: Record<string, unknown>;
  persona_type?: string; // champion | buyer | evaluator | blocker
  assigned_to_id?: string;   // AE
  assigned_to_name?: string;
  assigned_rep_email?: string;
  sdr_id?: string;            // SDR
  sdr_name?: string;
  outreach_lane?: string;
  sequence_status?: string;
  instantly_status?: string;
  instantly_campaign_id?: string;
  warm_intro_strength?: number;
  warm_intro_path?: Record<string, unknown>;
  conversation_starter?: string;
  personalization_notes?: string;
  talking_points?: string[];
  tracking_stage?: string;
  tracking_summary?: string;
  tracking_score?: number;
  tracking_label?: string;
  tracking_last_activity_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SourcingBatch {
  id: string;
  filename: string;
  status: string; // pending | awaiting_confirmation | processing | completed | failed | cancelled
  total_rows: number;
  processed_rows: number;
  created_companies: number;
  skipped_rows: number;
  failed_rows: number;
  created_by_id?: string;
  created_by_name?: string;
  created_by_email?: string;
  meta?: Record<string, unknown>;
  error_log?: Array<{ name?: string; error?: string }>;
  current_stage?: string;
  progress_message?: string;
  eta_seconds?: number | null;
  contacts_found?: number | null;
  verdict_summary?: Record<string, unknown>;
  requires_confirmation?: boolean;
  auto_started?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountSourcingSummary {
  total_companies: number;
  hot_count: number;
  warm_count: number;
  high_priority_count: number;
  engaged_count: number;
  unresolved_count: number;
  unenriched_count: number;
  researched_count: number;
  target_verdict_count: number;
  watch_verdict_count: number;
  enriched_count: number;
  total_contacts: number;
}

/** Standard paginated list wrapper returned by all GET list endpoints. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface Deal {
  id: string;
  company_id?: string;
  assigned_to_id?: string;
  email_cc_alias?: string;
  name: string;
  pipeline_type: string;
  stage: string;
  priority: string;
  value?: number;
  close_date_est?: string;
  health: string;
  health_score?: number;
  qualification?: Record<string, unknown>;
  tags: string[];
  department?: string;
  geography?: string;
  source?: string;
  description?: string;
  next_step?: string;
  days_in_stage: number;
  stage_entered_at?: string;
  last_activity_at?: string;
  stakeholder_count: number;
  owner_id?: string;
  created_at: string;
  updated_at: string;
  // Joined fields from board/detail queries
  company_name?: string;
  assigned_rep_name?: string;
  contact_count?: number;
  meddpicc_score?: number;
}

export interface DealContact {
  deal_id: string;
  contact_id: string;
  role?: string;
  added_at: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  title?: string;
  persona?: string;
}

export interface OutreachSequence {
  id: string;
  contact_id: string;
  company_id: string;
  persona?: string;
  status: "draft" | "approved" | "launched" | "replied" | "completed" | "paused" | "sent" | "skipped" | "meeting_booked";
  email_1?: string;
  email_2?: string;
  email_3?: string;
  linkedin_message?: string;
  subject_1?: string;
  subject_2?: string;
  subject_3?: string;
  instantly_campaign_id?: string;
  instantly_campaign_status?: string;
  generation_context?: Record<string, unknown>;
  generated_at?: string;
  launched_at?: string;
  created_at: string;
  updated_at: string;
}

export interface OutreachStep {
  id: string;
  sequence_id: string;
  step_number: number;
  subject?: string;
  body: string;
  delay_value: number;
  delay_unit: string;
  variants?: Array<Record<string, unknown>> | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  deal_id?: string;
  contact_id?: string;
  type: string;
  source?: string;
  medium?: string; // email, call, linkedin, whatsapp, in_person, sms, other
  content?: string;
  ai_summary?: string;
  event_metadata?: Record<string, unknown>;
  created_at: string;
  created_by_id?: string;
  user_name?: string;
  call_id?: string;
  call_duration?: number;
  call_outcome?: string;
  recording_url?: string;
  aircall_user_name?: string;
  email_message_id?: string;
  email_subject?: string;
  email_from?: string;
  email_to?: string;
  email_cc?: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  body: string;
  created_by_id?: string;
  created_by_name?: string;
  created_at: string;
}

export interface TaskItem {
  id: string;
  entity_type: "company" | "contact" | "deal";
  entity_id: string;
  task_type: "manual" | "system";
  title: string;
  description?: string;
  status: "open" | "completed" | "dismissed";
  priority: "low" | "medium" | "high";
  source?: string;
  recommended_action?: string;
  due_at?: string;
  action_payload?: Record<string, unknown>;
  system_key?: string;
  created_by_id?: string;
  created_by_name?: string;
  assigned_role?: "admin" | "ae" | "sdr";
  assigned_to_id?: string;
  assigned_to_name?: string;
  accepted_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  comments: TaskComment[];
}

export interface TaskWorkspaceItem extends TaskItem {
  entity_name: string;
  entity_subtitle?: string;
  entity_link: string;
}

export interface CrmImportResponse {
  replace: {
    deals_deleted: number;
    deal_contacts_deleted: number;
    deal_tasks_deleted: number;
    activities_deleted: number;
    companies_deleted: number;
  };
  import: {
    top_level_tasks_seen: number;
    subtasks_seen: number;
    companies_created: number;
    companies_reused: number;
    deals_created: number;
    deals_updated: number;
    tasks_created: number;
    tasks_updated: number;
    activities_created: number;
    activities_reused: number;
    unmatched_assignees: string[];
    fields_loaded: number;
  };
}

export interface ProspectImportMissingCompany {
  name: string;
  domain?: string;
  contacts_count: number;
}

export interface ProspectImportResponse {
  imported_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  missing_company_count: number;
  missing_companies: ProspectImportMissingCompany[];
  message: string;
}

export interface Reminder {
  id: string;
  contact_id: string;
  company_id?: string;
  created_by_id?: string;
  assigned_to_id?: string;
  note: string;
  due_at: string;
  status: "pending" | "completed" | "dismissed";
  created_at: string;
  completed_at?: string;
  contact_name?: string;
  company_name?: string;
  assigned_to_name?: string;
}

export interface AssignmentUpdate {
  id: string;
  entity_type: "company" | "contact" | "deal";
  entity_id: string;
  assignment_role: "owner" | "ae" | "sdr";
  assignee_id?: string;
  created_by_id?: string;
  entity_name_snapshot?: string;
  company_name_snapshot?: string;
  assignee_name_snapshot?: string;
  assignee_email_snapshot?: string;
  progress_state: "new" | "working" | "waiting_on_buyer" | "meeting_booked" | "qualified" | "deal_created" | "blocked" | "closed";
  confidence: "low" | "medium" | "high";
  buyer_signal: "none" | "replied" | "interested" | "champion_identified" | "meeting_requested" | "commercial_discussion" | "verbal_yes";
  blocker_type: "none" | "no_response" | "wrong_person" | "timing" | "budget" | "competition" | "internal_dependency" | "legal_security" | "other";
  last_touch_type: "none" | "email" | "call" | "linkedin" | "meeting" | "research" | "internal";
  summary: string;
  next_step: string;
  next_step_due_date?: string;
  blocker_detail?: string;
  created_by_name?: string;
  created_at: string;
}

export interface ExecutionTrackerItem {
  entity_type: "company" | "contact" | "deal";
  entity_id: string;
  entity_name: string;
  entity_subtitle?: string;
  entity_link: string;
  company_name?: string;
  assignee_id: string;
  assignee_name?: string;
  assignment_role: "owner" | "ae" | "sdr";
  system_status?: string;
  entity_updated_at: string;
  needs_update: boolean;
  next_step_overdue: boolean;
  latest_update?: AssignmentUpdate | null;
}

export interface ExecutionTrackerSummary {
  total_items: number;
  no_update_items: number;
  needs_update_items: number;
  blocked_items: number;
  overdue_next_steps: number;
  positive_momentum_items: number;
}

export interface Signal {
  id: string;
  company_id: string;
  signal_type: string;
  source: string;
  title: string;
  url?: string;
  summary?: string;
  published_at?: string;
  relevance_score?: number;
  created_at: string;
}

export interface Meeting {
  id: string;
  title: string;
  company_id?: string;
  deal_id?: string;
  scheduled_at?: string;
  status: string;
  meeting_type: string;
  pre_brief?: string;
  demo_strategy?: string;
  research_data?: unknown;
  attendees?: unknown;
  raw_notes?: string;
  ai_summary?: string;
  mom_draft?: string;
  meeting_score?: number;
  what_went_right?: string;
  what_went_wrong?: string;
  next_steps?: string;
  created_at: string;
  updated_at: string;
}

export interface SalesResource {
  id: string;
  title: string;
  category: string;
  description?: string;
  content: string;
  filename?: string;
  file_size?: number;
  tags: string[];
  modules: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GlobalSearchItem {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  meta?: string;
  link: string;
}

export interface GlobalSearchSection {
  key: string;
  label: string;
  items: GlobalSearchItem[];
}

export interface GlobalSearchResponse {
  query: string;
  sections: GlobalSearchSection[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role: "admin" | "ae" | "sdr";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GmailSyncSettings {
  configured: boolean;
  inbox?: string;
  connected_email?: string;
  connected_at?: string;
  interval_seconds: number;
  last_sync_epoch?: number | null;
  last_error?: string | null;
}

export interface DealStageSetting {
  id: string;
  label: string;
  group: "active" | "closed";
  color: string;
}

export interface DealStageSettings {
  stages: DealStageSetting[];
}

export interface ProspectStageSettings {
  stages: DealStageSetting[];
}

export interface OutreachTemplateStep {
  step_number: number;
  label: string;
  goal: string;
  subject_hint?: string | null;
  body_template?: string | null;
  prompt_hint?: string | null;
}

export interface OutreachContentSettings {
  general_prompt: string;
  linkedin_prompt: string;
  step_templates: OutreachTemplateStep[];
}

export interface StageBucketSettings {
  active: string[];
  inactive: string[];
  tofu: string[];
  mofu: string[];
  bofu: string[];
}

export interface PipelineSummarySettings {
  deal: StageBucketSettings;
  prospect: StageBucketSettings;
}

export interface RolePermissionFlags {
  crm_import: boolean;
  prospect_migration: boolean;
  manage_team: boolean;
  run_pre_meeting_intel: boolean;
}

export interface RolePermissionsSettings {
  ae: RolePermissionFlags;
  sdr: RolePermissionFlags;
}

export interface PreMeetingAutomationSettings {
  enabled: boolean;
  send_hours_before: number;
  auto_generate_if_missing: boolean;
}

export interface SyncScheduleSettings {
  tldv_sync_enabled: boolean;
  tldv_sync_interval_minutes: number;
  tldv_page_size: number;
  tldv_max_pages: number;
  tldv_last_synced_at?: string | null;
  email_sync_interval_seconds: number;
  deal_health_hour: number;
}

export interface ClickUpCrmSettings {
  team_id?: string | null;
  space_id?: string | null;
  deals_list_id?: string | null;
}

export interface AngelInvestor {
  id: string;
  name: string;
  current_role?: string;
  current_company?: string;
  linkedin_url?: string;
  career_history?: string;
  networks?: string;
  pe_vc_connections?: string;
  sectors?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface AngelMapping {
  id: string;
  contact_id: string;
  company_id?: string;
  angel_investor_id: string;
  strength: number;
  rank: number;
  connection_path?: string;
  why_it_works?: string;
  recommended_strategy?: string;
  // Joined fields
  contact_name?: string;
  contact_title?: string;
  contact_linkedin?: string;
  company_name?: string;
  angel_name?: string;
  angel_current_role?: string;
  angel_current_company?: string;
  created_at: string;
  updated_at: string;
}

export interface Battlecard {
  id: string;
  category: string;
  title: string;
  trigger: string;
  response: string;
  competitor?: string;
  tags?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
