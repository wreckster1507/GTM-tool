import { useEffect, useState } from "react";
import { dealsApi, companiesApi } from "../lib/api";
import type { Deal, Company } from "../types";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { formatCurrency } from "../lib/utils";
import { TrendingUp, Building2, Layers, Trophy } from "lucide-react";

const STAGES = ["discovery","demo","poc","proposal","negotiation","closed_won","closed_lost"];
const HEALTH_COLORS = { green: "#10B981", yellow: "#F59E0B", red: "#EF4444" };

const TOOLTIP_STYLE = {
  contentStyle: { background:"#fff", border:"1px solid #E7E5E4", borderRadius:10, fontSize:12, boxShadow:"0 8px 24px rgba(0,0,0,0.08)", fontFamily:"Inter", padding:"10px 14px" },
  labelStyle: { color:"#1C1917", fontWeight:600, marginBottom:4 },
  itemStyle: { color:"#57534E" },
};

export default function Dashboard() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([dealsApi.list(), companiesApi.list()]).then(([ds, cs]) => {
      setDeals(ds); setCompanies(cs); setLoading(false);
    });
  }, []);

  const pipelineData = STAGES.map((stage) => ({
    stage: stage.replace("closed_", "").replace(/_/g, " "),
    value: deals.filter((d) => d.stage === stage).reduce((s, d) => s + (d.value ?? 0), 0),
  }));

  const healthData = (["green","yellow","red"] as const)
    .map((h) => ({ name: h === "green" ? "Healthy" : h === "yellow" ? "At Risk" : "Critical", value: deals.filter((d) => d.health === h).length, color: HEALTH_COLORS[h] }))
    .filter((h) => h.value > 0);

  const activeDeals = deals.filter((d) => !["closed_won","closed_lost"].includes(d.stage));
  const totalPipeline = activeDeals.reduce((s, d) => s + (d.value ?? 0), 0);
  const wonDeals = deals.filter((d) => d.stage === "closed_won");
  const wonValue = wonDeals.reduce((s, d) => s + (d.value ?? 0), 0);
  const winRate = deals.length ? Math.round((wonDeals.length / deals.length) * 100) : 0;

  const kpis = [
    { label: "Tracked Accounts", value: String(companies.length), sub: "in active segments", icon: Building2 },
    { label: "Open Opportunities", value: String(activeDeals.length), sub: "currently in play", icon: Layers },
    { label: "Open Pipeline", value: formatCurrency(totalPipeline), sub: "forecastable value", icon: TrendingUp },
    { label: "Closed Won", value: formatCurrency(wonValue), sub: `${winRate}% overall win rate`, icon: Trophy },
  ];

  return (
    <div className="crm-page dashboard-page space-y-6">
      {loading ? (
        <div className="crm-panel p-14 text-center crm-muted">Loading revenue analytics...</div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 dashboard-kpi-grid">
            {kpis.map(({ label, value, sub, icon: Icon }, i) => (
              <div
                key={label}
                className="crm-panel px-8 py-8 min-h-48 flex flex-col justify-between dashboard-kpi-card"
                style={{ animationDelay: `${i * 70}ms`, animation: "fade-slide 260ms ease both" }}
              >
                <div className="w-12 h-12 rounded-xl grid place-items-center bg-[#f7f9fd] border border-[#e8edf3] text-[#3f5168]">
                  <Icon size={18} />
                </div>
                <div className="mt-4">
                  <p className="text-[40px] leading-none font-extrabold tracking-tight tabular">{value}</p>
                  <p className="text-[13px] font-bold text-[#3f5168] mt-3">{label}</p>
                  <p className="text-[13px] text-[#728396] mt-1">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 dashboard-chart-grid">
            <div className="crm-panel xl:col-span-3 p-8 dashboard-chart-main">
              <h2 className="text-[16px] font-bold">Pipeline Value by Stage</h2>
              <p className="text-[13px] crm-muted mt-2 mb-4">Snapshot of weighted opportunity value</p>
              <div className="dashboard-responsive-wrap dashboard-responsive-wrap-main">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={pipelineData} margin={{ top: 6, right: 6, left: 6, bottom: 34 }}>
                    <XAxis
                      dataKey="stage"
                      axisLine={false}
                      tickLine={false}
                      angle={-28}
                      textAnchor="end"
                      tick={{ fill: "#6b7c91", fontSize: 11 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#6b7c91", fontSize: 11 }}
                      tickFormatter={(v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
                    />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [formatCurrency(v), "Value"]} />
                    <Bar dataKey="value" fill="#ff6b35" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="crm-panel xl:col-span-2 p-8 dashboard-chart-side">
              <h2 className="text-[16px] font-bold">Deal Health Mix</h2>
              <p className="text-[13px] crm-muted mt-2 mb-4">Live risk distribution of open opportunities</p>
              {healthData.length === 0 ? (
                <div className="grid place-items-center text-sm crm-muted" style={{ height: 280 }}>No active opportunities</div>
              ) : (
                <>
                  <div className="dashboard-responsive-wrap dashboard-responsive-wrap-side">
                    <ResponsiveContainer width="100%" height={236}>
                      <PieChart>
                        <Pie data={healthData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={4}>
                          {healthData.map((segment) => (
                            <Cell key={segment.name} fill={segment.color} />
                          ))}
                        </Pie>
                        <Tooltip {...TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 space-y-2.5">
                    {healthData.map((segment) => (
                      <div key={segment.name} className="flex items-center justify-between text-[14px]">
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                          {segment.name}
                        </span>
                        <span className="font-bold tabular">{segment.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
