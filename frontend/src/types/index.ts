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
  assigned_to_id?: string;
  assigned_to_name?: string;
  assigned_rep_email?: string;
  outreach_lane?: string;
  sequence_status?: string;
  instantly_status?: string;
  instantly_campaign_id?: string;
  warm_intro_strength?: number;
  warm_intro_path?: Record<string, unknown>;
  conversation_starter?: string;
  personalization_notes?: string;
  talking_points?: string[];
  created_at: string;
  updated_at: string;
}

export interface SourcingBatch {
  id: string;
  filename: string;
  status: string; // pending | processing | completed | failed
  total_rows: number;
  processed_rows: number;
  created_companies: number;
  skipped_rows: number;
  failed_rows: number;
  error_log?: Array<{ name?: string; error?: string }>;
  created_at: string;
  updated_at: string;
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
  name: string;
  stage: string;
  value?: number;
  close_date_est?: string;
  health: string;
  health_score?: number;
  qualification?: Record<string, unknown>;
  days_in_stage: number;
  stage_entered_at?: string;
  last_activity_at?: string;
  stakeholder_count: number;
  owner_id?: string;
  created_at: string;
  updated_at: string;
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

export interface Activity {
  id: string;
  deal_id?: string;
  contact_id?: string;
  type: string;
  source?: string;
  content?: string;
  ai_summary?: string;
  event_metadata?: Record<string, unknown>;
  created_at: string;
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

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role: "admin" | "sales_rep";
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
