"use client";

import { useState } from "react";
import { X, Save, AlertCircle } from "lucide-react";
import * as api from "@/lib/api";

type JobModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

const defaultForm = {
  name: "",
  cronExpression: "",
  callbackUrl: "",
  timezone: "UTC",
  maxRetries: 3,
  backoffMs: 1000,
  callbackTimeoutMs: 30000,
};

export default function JobModal({ isOpen, onClose, onSuccess }: JobModalProps) {
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      await api.createJob({
        name: form.name.trim(),
        cronExpression: form.cronExpression.trim(),
        callbackUrl: form.callbackUrl.trim(),
        timezone: form.timezone.trim() || "UTC",
        retryPolicy: {
          maxRetries: form.maxRetries,
          backoffMs: form.backoffMs,
        },
        callbackTimeoutMs: form.callbackTimeoutMs,
        enabled: true,
        paused: false,
      });
      setForm(defaultForm);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Register New Job</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--error)', color: 'var(--error)', marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Job Name</label>
            <input 
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Daily Inventory Update"
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div className="form-group">
              <label>Cron Expression</label>
              <input 
                className="mono"
                value={form.cronExpression}
                onChange={(e) => setForm({ ...form, cronExpression: e.target.value })}
                placeholder="e.g. * * * * *"
                required
              />
            </div>
            <div className="form-group">
              <label>Timezone</label>
              <input 
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                placeholder="UTC"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Callback URL</label>
            <input 
              className="mono"
              type="url"
              value={form.callbackUrl}
              onChange={(e) => setForm({ ...form, callbackUrl: e.target.value })}
              placeholder="https://your-api.com/callback"
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label>Max Retries</label>
              <input 
                type="number"
                min={0}
                max={50}
                value={form.maxRetries}
                onChange={(e) => setForm({ ...form, maxRetries: parseInt(e.target.value) })}
              />
            </div>
            <div className="form-group">
              <label>Backoff (ms)</label>
              <input 
                type="number"
                min={100}
                value={form.backoffMs}
                onChange={(e) => setForm({ ...form, backoffMs: parseInt(e.target.value) })}
              />
            </div>
            <div className="form-group">
              <label>Timeout (ms)</label>
              <input 
                type="number"
                min={1000}
                value={form.callbackTimeoutMs}
                onChange={(e) => setForm({ ...form, callbackTimeoutMs: parseInt(e.target.value) })}
              />
            </div>
          </div>

          <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn outline" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={saving}>
              <Save size={18} />
              {saving ? 'Creating...' : 'Register Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
