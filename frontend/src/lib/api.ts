import type {
  Company,
  Contact,
  Deal,
  Activity,
  OutreachSequence,
  Signal,
  Meeting,
  Battlecard,
  Paginated,
} from "../types";

/**
 * Fetch a paginated list endpoint and unwrap .items for backward compat.
 * Pages that need total/pages can call requestPaginated() directly.
 */
async function requestList<T>(path: string): Promise<T[]> {
  const res = await request<Paginated<T> | T[]>(path);
  if (Array.isArray(res)) return res;
  return res.items ?? [];
}

async function requestPaginated<T>(path: string): Promise<Paginated<T>> {
  const res = await request<Paginated<T> | T[]>(path);
  if (Array.isArray(res)) {
    return {
      items: res,
      total: res.length,
      page: 1,
      size: res.length,
      pages: 1,
    };
  }
  return res;
}

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const companiesApi = {
  list: (skip = 0, limit = 200) =>
    requestList<Company>(`/api/v1/companies/?skip=${skip}&limit=${limit}`),
  listPaginated: (skip = 0, limit = 50) =>
    requestPaginated<Company>(`/api/v1/companies/?skip=${skip}&limit=${limit}`),
  get: (id: string) => request<Company>(`/api/v1/companies/${id}`),
  getDeals: (id: string) => request<Deal[]>(`/api/v1/companies/${id}/deals`),
  create: (data: Partial<Company>) =>
    request<Company>("/api/v1/companies/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Company>) =>
    request<Company>(`/api/v1/companies/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/api/v1/companies/${id}`, { method: "DELETE" }),
  checkDuplicates: (names: string[], domains: string[]) =>
    request<{ duplicate_names: string[]; duplicate_domains: string[] }>(
      "/api/v1/companies/check-duplicates",
      { method: "POST", body: JSON.stringify({ names, domains }) }
    ),
};

export const contactsApi = {
  list: (skip = 0, limit = 200, companyId?: string) => {
    const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
    if (companyId) params.set("company_id", companyId);
    // Returns Contact[] with company_name populated — no second API call needed
    return requestList<Contact>(`/api/v1/contacts/?${params}`);
  },
  listPaginated: (skip = 0, limit = 50, companyId?: string) => {
    const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
    if (companyId) params.set("company_id", companyId);
    return requestPaginated<Contact>(`/api/v1/contacts/?${params}`);
  },
  get: (id: string) => request<Contact>(`/api/v1/contacts/${id}`),
  enrich: (id: string) =>
    request<{ contact_id: string; status: string; fields_updated: string[]; contact: Contact }>(
      `/api/v1/contacts/${id}/enrich`,
      { method: "POST" }
    ),
  getBrief: (id: string) =>
    request<{
      contact_id: string;
      contact_name: string;
      title?: string;
      linkedin_url?: string;
      brief: string | null;
      scraped?: { headline?: string; summary?: string; error?: string };
    }>(`/api/v1/contacts/${id}/brief`),
  create: (data: Partial<Contact>) =>
    request<Contact>("/api/v1/contacts/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Contact>) =>
    request<Contact>(`/api/v1/contacts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/api/v1/contacts/${id}`, { method: "DELETE" }),
  discover: (companyId: string) =>
    request<Contact[]>(`/api/v1/contacts/discover/${companyId}`, { method: "POST" }),
};

export const dealsApi = {
  list: (skip = 0, limit = 200, companyId?: string, stage?: string) => {
    const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
    if (companyId) params.set("company_id", companyId);
    if (stage) params.set("stage", stage);
    return requestList<Deal>(`/api/v1/deals/?${params}`);
  },
  get: (id: string) => request<Deal>(`/api/v1/deals/${id}`),
  create: (data: Partial<Deal>) =>
    request<Deal>("/api/v1/deals/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Deal>) =>
    request<Deal>(`/api/v1/deals/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/api/v1/deals/${id}`, { method: "DELETE" }),
};

export const enrichmentApi = {
  triggerCompany: (companyId: string) =>
    request<{ status: string; task_id: string; message: string }>(
      `/api/v1/enrichment/company/${companyId}`,
      { method: "POST" }
    ),
  taskStatus: (taskId: string) =>
    request<{ task_id: string; status: string; result: unknown }>(
      `/api/v1/enrichment/task/${taskId}`
    ),
};

export const outreachApi = {
  generate: (contactId: string) =>
    request<OutreachSequence>(`/api/v1/outreach/generate/${contactId}`, {
      method: "POST",
    }),
  getSequence: (contactId: string) =>
    request<OutreachSequence>(`/api/v1/outreach/sequences/${contactId}`),
  bulkGenerate: (companyId: string, personaFilter?: string) => {
    const params = personaFilter ? `?persona_filter=${personaFilter}` : "";
    return request<{ generated: number; skipped_existing: number; sequences: unknown[] }>(
      `/api/v1/outreach/bulk/${companyId}${params}`,
      { method: "POST" }
    );
  },
  getCompanySequences: (companyId: string) =>
    request<
      { sequence_id: string; contact_id: string; contact_name: string; title?: string; persona?: string; status: string; subject_1?: string; email_1_preview?: string }[]
    >(`/api/v1/outreach/company/${companyId}`),
};

export const intelligenceApi = {
  getAccountBrief: (companyId: string) =>
    request<{
      company_id: string;
      company_name: string;
      domain: string;
      scraped: { title?: string; description?: string; body_text?: string; about_text?: string; error?: string };
      news_signals: { title: string; url?: string }[];
      tech_stack: Record<string, string>;
      brief: string | null;
    }>(`/api/v1/intelligence/${companyId}`),
};

export const sendApi = {
  sendEmail: (sequenceId: string, emailNumber: 1 | 2 | 3, toEmail?: string) =>
    request<{ sequence_id: string; email_number: number; to: string; subject?: string; resend_id?: string; status: string }>(
      `/api/v1/outreach/send/${sequenceId}`,
      {
        method: "POST",
        body: JSON.stringify({ email_number: emailNumber, to_email: toEmail ?? "" }),
      }
    ),
};

export const activitiesApi = {
  list: (dealId?: string, contactId?: string) => {
    const params = new URLSearchParams();
    if (dealId) params.set("deal_id", dealId);
    if (contactId) params.set("contact_id", contactId);
    return requestList<Activity>(`/api/v1/activities/?${params}`);
  },
  create: (data: Partial<Activity>) =>
    request<Activity>("/api/v1/activities/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

export const signalsApi = {
  getCompanySignals: (companyId: string) =>
    request<Signal[]>(`/api/v1/signals/company/${companyId}`),
  refreshCompanySignals: (companyId: string) =>
    request<{ company_id: string; signals_created: number }>(
      `/api/v1/signals/company/${companyId}/refresh`,
      { method: "POST" }
    ),
};

export const meetingsApi = {
  list: (skip = 0, limit = 50, companyId?: string, dealId?: string, status?: string) => {
    const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
    if (companyId) params.set("company_id", companyId);
    if (dealId) params.set("deal_id", dealId);
    if (status) params.set("status", status);
    return requestList<Meeting>(`/api/v1/meetings/?${params}`);
  },
  get: (id: string) => request<Meeting>(`/api/v1/meetings/${id}`),
  create: (data: Partial<Meeting>) =>
    request<Meeting>("/api/v1/meetings/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Meeting>) =>
    request<Meeting>(`/api/v1/meetings/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/api/v1/meetings/${id}`, { method: "DELETE" }),
  generatePreBrief: (id: string) =>
    request<{ meeting_id: string; pre_brief: string }>(`/api/v1/meetings/${id}/pre-brief`, {
      method: "POST",
    }),
  runIntelligence: (id: string) =>
    request<{ meeting_id: string; research_data: unknown; demo_strategy: string }>(
      `/api/v1/meetings/${id}/intelligence`,
      { method: "POST" }
    ),
  generateDemoStrategy: (id: string) =>
    request<{ meeting_id: string; demo_strategy: string }>(
      `/api/v1/meetings/${id}/demo-strategy`,
      { method: "POST" }
    ),
  postScore: (id: string, rawNotes: string) =>
    request<{
      meeting_id: string;
      meeting_score?: number;
      what_went_right?: string;
      what_went_wrong?: string;
      next_steps?: string;
      mom_draft?: string;
    }>(`/api/v1/meetings/${id}/post-score`, {
      method: "POST",
      body: JSON.stringify({ raw_notes: rawNotes }),
    }),
};

export const battlecardsApi = {
  list: (category?: string) => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    return request<Battlecard[]>(`/api/v1/battlecards/${qs}`);
  },
  search: (query: string) =>
    request<Battlecard[]>(`/api/v1/battlecards/search?q=${encodeURIComponent(query)}`),
  get: (id: string) => request<Battlecard>(`/api/v1/battlecards/${id}`),
  create: (data: Partial<Battlecard>) =>
    request<Battlecard>("/api/v1/battlecards/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Battlecard>) =>
    request<Battlecard>(`/api/v1/battlecards/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/api/v1/battlecards/${id}`, { method: "DELETE" }),
  seed: () => request<{ seeded: number; message: string }>("/api/v1/battlecards/seed", { method: "POST" }),
};

export interface ProspectingBatch {
  batch_id: string;
  created_at: string;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  companies: Array<{
    domain: string;
    company_id: string;
    task_id: string;
    status: string;
  }>;
  skipped_names?: string[];
  skipped_domains?: string[];
  failed_rows: Array<{ name?: string; domain?: string; error: string }>;
  completed_enrichments?: number;
}

export const prospectingApi = {
  bulkUpload: async (file: File): Promise<ProspectingBatch> => {
    const form = new FormData();
    form.append("file", file);

    const res = await fetch(`${BASE}/api/v1/prospecting/bulk`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? "Bulk upload failed");
    }

    return res.json();
  },

  status: async (batchId: string): Promise<ProspectingBatch> => {
    return request<ProspectingBatch>(`/api/v1/prospecting/status/${batchId}`);
  },
};
