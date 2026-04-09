import { useState } from "react";
import { contactsApi } from "../../lib/api";
import type { Contact } from "../../types";
import {
  EMPTY_ADD_PROSPECT_FORM,
  type AddProspectFormState,
} from "./types";

type AddProspectModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export default function AddProspectModal({
  open,
  onClose,
  onCreated,
}: AddProspectModalProps) {
  const [form, setForm] = useState<AddProspectFormState>(EMPTY_ADD_PROSPECT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const updateField = (field: keyof AddProspectFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const reset = () => {
    setForm(EMPTY_ADD_PROSPECT_FORM);
    setError("");
    setSaving(false);
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!form.first_name.trim() && !form.last_name.trim()) {
      setError("First or last name is required");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await contactsApi.create({
        first_name: form.first_name.trim() || undefined,
        last_name: form.last_name.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        title: form.title.trim() || undefined,
        linkedin_url: form.linkedin_url.trim() || undefined,
      } as Partial<Contact>);
      reset();
      onClose();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create prospect");
      setSaving(false);
    }
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.25)", zIndex: 40 }} onClick={handleClose} />
      <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 480, borderRadius: 20, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1d2b3c" }}>Add Prospect</h3>
            <button type="button" onClick={handleClose} style={{ background: "none", border: "none", cursor: saving ? "default" : "pointer", color: "#7f8fa5", fontSize: 18 }}>
              x
            </button>
          </div>
          {error && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12, fontWeight: 600 }}>{error}</div>}
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>First Name</label>
                <input value={form.first_name} onChange={(e) => updateField("first_name", e.target.value)} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="Jane" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>Last Name</label>
                <input value={form.last_name} onChange={(e) => updateField("last_name", e.target.value)} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="Smith" />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>Email</label>
              <input value={form.email} onChange={(e) => updateField("email", e.target.value)} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="jane@company.com" type="email" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>Phone</label>
              <input value={form.phone} onChange={(e) => updateField("phone", e.target.value)} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="+1 555 123 4567" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>Job Title</label>
              <input value={form.title} onChange={(e) => updateField("title", e.target.value)} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="VP Engineering" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#5e738b", marginBottom: 6, display: "block" }}>LinkedIn URL</label>
              <input value={form.linkedin_url} onChange={(e) => updateField("linkedin_url", e.target.value)} style={{ width: "100%", height: 38, border: "1px solid #d9e1ec", borderRadius: 10, padding: "0 12px", fontSize: 13 }} placeholder="https://linkedin.com/in/..." />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button type="button" onClick={handleClose} disabled={saving} style={{ height: 38, padding: "0 16px", borderRadius: 10, border: "1px solid #d9e1ec", background: "#fff", color: "#5e738b", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer" }}>Cancel</button>
            <button type="button" disabled={saving} onClick={() => void handleSubmit()} style={{ height: 38, padding: "0 16px", borderRadius: 10, border: "none", background: "#175089", color: "#fff", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer" }}>
              {saving ? "Creating..." : "Add Prospect"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
