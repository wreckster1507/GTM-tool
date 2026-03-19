import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { companiesApi, contactsApi } from "../lib/api";
import type { Company, Contact } from "../types";
import { Search, Users, CheckCircle2, XCircle, Sparkles, Trash2 } from "lucide-react";
import { avatarColor, getInitials } from "../lib/utils";
import OutreachDrawer from "../components/outreach/OutreachDrawer";

const PERSONA_STYLE: Record<string, CSSProperties> = {
  economic_buyer: { color: "#7b3a1d", background: "#ffe8de", border: "1px solid #ffc8b4" },
  champion: { color: "#1b6f53", background: "#e4fbf3", border: "1px solid #b8efd8" },
  technical_evaluator: { color: "#24567e", background: "#eaf4ff", border: "1px solid #c9e0f8" },
  unknown: { color: "#546679", background: "#edf3f9", border: "1px solid #d7e1eb" },
};
const PERSONA_LABEL: Record<string, string> = {
  economic_buyer: "Economic Buyer", champion: "Champion", technical_evaluator: "Tech Eval", unknown: "Unknown",
};

export default function Contacts() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companyNameById, setCompanyNameById] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  useEffect(() => {
    Promise.all([contactsApi.list(), companiesApi.list()]).then(([cs, co]) => {
      setContacts(cs);
      setCompanyNameById(Object.fromEntries(co.map((c: Company) => [c.id, c.name])));
      setLoading(false);
    });
  }, []);

  const filtered = contacts.filter((c) =>
    `${c.first_name} ${c.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.title?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div className="crm-page contacts-page space-y-6">
        <div className="crm-panel px-8 py-6 crm-toolbar contacts-toolbar">
          <div className="flex items-center gap-2">
            <span className="crm-chip">
              <span className="font-bold tabular">{contacts.length}</span>
              Contacts
            </span>
            <span className="crm-chip">Persona-aware outreach</span>
          </div>
          <div className="crm-toolbar-actions">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8094a8] pointer-events-none" />
              <input
                className="h-12 w-84 max-w-[78vw] rounded-xl border border-[#d7e2ee] bg-white pl-10 pr-4 text-[14px] placeholder-[#92a4b8] outline-none focus:border-[#c2d3e5]"
                placeholder="Search people, title, email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="crm-panel p-14 text-center crm-muted">Loading contacts...</div>
        ) : filtered.length === 0 ? (
          <div className="crm-panel p-14 text-center text-[#6f8297]">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
            No contacts match your search.
          </div>
        ) : (
          <div className="crm-panel overflow-hidden contacts-table-panel">
            <div className="overflow-x-auto">
              <table className="crm-table" style={{ minWidth: 1080 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Title</th>
                    <th>Email</th>
                    <th>Persona</th>
                    <th>Verified</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/contacts/${c.id}`)}>
                      <td>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold ${avatarColor(c.first_name + c.last_name)}`}>
                            {getInitials(`${c.first_name} ${c.last_name}`)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-[#25384d] truncate">{c.first_name} {c.last_name}</p>
                            <p className="text-[13px] text-[#7a8ea4] mt-0.5">{c.seniority ?? "-"}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        {c.company_name || (c.company_id ? companyNameById[c.company_id] : undefined) ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/companies/${c.company_id}`); }}
                            className="text-[#2b6cb0] font-semibold text-[13px] hover:underline"
                          >
                            {c.company_name ?? (c.company_id ? companyNameById[c.company_id] : "")}
                          </button>
                        ) : (
                          <span className="text-[#96a7ba]">-</span>
                        )}
                      </td>
                      <td>{c.title ?? <span className="text-[#96a7ba]">-</span>}</td>
                      <td>{c.email ?? <span className="text-[#96a7ba]">-</span>}</td>
                      <td>
                        {c.persona ? (
                          <span
                            className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold"
                            style={PERSONA_STYLE[c.persona] ?? PERSONA_STYLE.unknown}
                          >
                            {PERSONA_LABEL[c.persona] ?? c.persona}
                          </span>
                        ) : (
                          <span className="text-[#96a7ba]">-</span>
                        )}
                      </td>
                      <td>
                        {c.email_verified ? (
                          <span className="inline-flex items-center gap-1 text-[#24966f] font-semibold text-[12px]">
                            <CheckCircle2 className="h-4 w-4" />
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#9caabd] font-semibold text-[12px]">
                            <XCircle className="h-4 w-4" />
                            No
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedContact(c);
                            }}
                            className="crm-button soft h-12 px-4 text-[13px]"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            Outreach
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!window.confirm(`Delete "${c.first_name} ${c.last_name}"?`)) return;
                              await contactsApi.delete(c.id);
                              setContacts((prev) => prev.filter((x) => x.id !== c.id));
                            }}
                            className="flex items-center justify-center h-12 w-12 rounded-xl text-[#9eb0c3] hover:text-[#c0392b] hover:bg-[#fff0f0] transition-colors"
                            title="Delete contact"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <OutreachDrawer contact={selectedContact} onClose={() => setSelectedContact(null)} />
    </>
  );
}
