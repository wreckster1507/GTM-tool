import { useEffect, useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCenter } from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { Filter, Plus } from "lucide-react";
import { dealsApi, companiesApi } from "../lib/api";
import type { Deal } from "../types";
import DealCard from "../components/deal/DealCard";
import { formatCurrency } from "../lib/utils";

const STAGES = [
  { id: "discovery",   label: "Discovery",   dot: "#93C5FD" },
  { id: "demo",        label: "Demo",         dot: "#C4B5FD" },
  { id: "poc",         label: "POC",          dot: "#FCD34D" },
  { id: "proposal",    label: "Proposal",     dot: "#FDBA74" },
  { id: "negotiation", label: "Negotiation",  dot: "#FCA5A5" },
  { id: "closed_won",  label: "Closed Won",   dot: "#6EE7B7" },
  { id: "closed_lost", label: "Closed Lost",  dot: "#CBD5E1" },
];

function Column({ stage, deals, companies }: { stage: typeof STAGES[number]; deals: Deal[]; companies: Record<string, string> }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = deals.reduce((s, d) => s + (d.value ?? 0), 0);

  return (
    <div className="flex flex-col w-84 shrink-0">
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: stage.dot }} />
          <span className="text-[14px] font-semibold text-[#304359]">{stage.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && <span className="text-[12px] text-[#7a8ca1] tabular">{formatCurrency(total)}</span>}
          <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-[#ecf1f7] px-2 text-[11px] font-semibold text-[#48607b] tabular">
            {deals.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 min-h-144 rounded-2xl p-4 space-y-4 transition-all duration-200 border ${
          isOver
            ? "bg-[#fff2ea] border-[#ffc2af]"
            : "bg-[#f9fbfe] border-[#dde6f0]"
        }`}
      >
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} companyName={deal.company_id ? companies[deal.company_id] : undefined} />
        ))}
        {deals.length === 0 && (
          <div className="flex h-32 items-center justify-center rounded-xl border-2 border-dashed border-[#d7e2ef]">
            <span className="text-[12px] text-[#96a7ba]">Drop a deal here</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Pipeline() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([dealsApi.list(), companiesApi.list()]).then(([ds, cs]) => {
      setDeals(ds);
      setCompanies(Object.fromEntries(cs.map((c) => [c.id, c.name])));
      setLoading(false);
    });
  }, []);

  const handleDragStart = (e: DragStartEvent) => setDraggingId(e.active.id as string);

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setDraggingId(null);
    if (!over) return;
    const dealId = active.id as string;
    const newStage = over.id as string;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage === newStage) return;
    setDeals((prev) => prev.map((d) => d.id === dealId ? { ...d, stage: newStage } : d));
    try { await dealsApi.update(dealId, { stage: newStage }); }
    catch { setDeals((prev) => prev.map((d) => d.id === dealId ? { ...d, stage: deal.stage } : d)); }
  };

  const draggingDeal = deals.find((d) => d.id === draggingId);
  const activeCount = deals.filter((d) => !["closed_won","closed_lost"].includes(d.stage)).length;
  const totalValue = deals.filter((d) => !["closed_won","closed_lost"].includes(d.stage)).reduce((s, d) => s + (d.value ?? 0), 0);

  if (loading) return (
    <div className="crm-panel p-14 text-center crm-muted">Loading pipeline...</div>
  );

  return (
    <div className="crm-page pipeline-page space-y-6">
      <div className="crm-panel pipeline-toolbar-shell">
        <div className="crm-toolbar pipeline-toolbar-inner">
          <div className="pipeline-toolbar-left flex items-center gap-3 text-[12px] text-[#5e738b]">
            <span className="crm-chip px-2">
              <span className="font-bold tabular ">{activeCount}</span>
              Active deals
            </span>
            <span className="crm-chip">
              <span className="font-bold tabular">{formatCurrency(totalValue)}</span>
              Open value
            </span>
          </div>
          <div className="crm-toolbar-actions pipeline-toolbar-right">
            <button className="crm-button soft">
              <Filter size={14} />
              Filter
            </button>
            <button className="crm-button primary">
              <Plus size={14} />
              New deal
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-auto pb-4 pipeline-board-wrap">
        <DndContext collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-5 min-w-max pipeline-board-row">
            {STAGES.map((stage) => (
              <Column
                key={stage.id}
                stage={stage}
                deals={deals.filter((d) => d.stage === stage.id)}
                companies={companies}
              />
            ))}
          </div>
          <DragOverlay>
            {draggingDeal && (
              <div className="rotate-1 scale-[1.02] pipeline-drag-overlay">
                <DealCard deal={draggingDeal} companyName={draggingDeal.company_id ? companies[draggingDeal.company_id] : undefined} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
