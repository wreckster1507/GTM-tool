import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, ChevronDown, Loader2, Search } from "lucide-react";
import { accountSourcingApi } from "../lib/api";
import type { Company } from "../types";

type SearchableCompanySelectProps = {
  value?: string;
  companies?: Company[];
  onChange: (companyId?: string) => void;
  placeholder?: string;
  noneLabel?: string;
  allowNone?: boolean;
  disabled?: boolean;
};

export default function SearchableCompanySelect({
  value,
  companies = [],
  onChange,
  placeholder = "Select company",
  noneLabel = "No company",
  allowNone = true,
  disabled = false,
}: SearchableCompanySelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const selectedCompany = useMemo(
    () => [...results, ...companies].find((company) => company.id === value),
    [companies, results, value],
  );

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(async () => {
      try {
        const response = await accountSourcingApi.listCompaniesPaginated({
          skip: 0,
          limit: 40,
          q: search.trim() || undefined,
        });
        let next = response.items;
        if (selectedCompany && !next.some((company) => company.id === selectedCompany.id)) {
          next = [selectedCompany, ...next];
        }
        if (!cancelled) {
          setResults(next);
        }
      } catch {
        if (!cancelled) {
          const needle = search.trim().toLowerCase();
          const fallback = companies
            .filter((company) => !needle || company.name.toLowerCase().includes(needle))
            .slice(0, 40);
          setResults(
            selectedCompany && !fallback.some((company) => company.id === selectedCompany.id)
              ? [selectedCompany, ...fallback]
              : fallback,
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [companies, open, search, selectedCompany]);

  return (
    <div
      ref={ref}
      style={{ position: "relative" }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (disabled) return;
          setOpen((current) => !current);
        }}
        style={{
          width: "100%",
          minHeight: 42,
          borderRadius: 12,
          border: "1px solid #d7e2ee",
          background: disabled ? "#f8fafc" : "#fff",
          padding: "0 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 14,
          color: selectedCompany ? "#1f2d3d" : "#94a3b8",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
          <Building2 size={14} color="#7a96b0" />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selectedCompany?.name ?? placeholder}
          </span>
        </span>
        <ChevronDown size={14} color="#7a96b0" />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            borderRadius: 14,
            border: "1px solid #dbe6f2",
            background: "#fff",
            boxShadow: "0 18px 36px rgba(15,23,42,0.14)",
            zIndex: 40,
            overflow: "hidden",
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
        >
          <div style={{ padding: 8, borderBottom: "1px solid #edf2f7" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f8fafc", borderRadius: 10, padding: "0 10px" }}>
              <Search size={13} color="#94a3b8" />
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search companies..."
                style={{
                  width: "100%",
                  height: 34,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {allowNone && (
              <button
                type="button"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                  setSearch("");
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: !value ? "#f0f6ff" : "transparent",
                  color: !value ? "#175089" : "#60758b",
                  fontSize: 13,
                  fontWeight: !value ? 700 : 500,
                  cursor: "pointer",
                }}
              >
                {noneLabel}
              </button>
            )}

            {loading ? (
              <div style={{ padding: "12px 14px", fontSize: 13, color: "#7a96b0", display: "flex", alignItems: "center", gap: 8 }}>
                <Loader2 size={14} className="animate-spin" />
                Searching companies...
              </div>
            ) : results.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 13, color: "#7a96b0" }}>
                No matching companies found.
              </div>
            ) : (
              results.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => {
                    onChange(company.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    background: value === company.id ? "#f0f6ff" : "transparent",
                    color: value === company.id ? "#175089" : "#1f2d3d",
                    fontSize: 13,
                    fontWeight: value === company.id ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  {company.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
