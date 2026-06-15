"use client";

import { Play, Pause, Trash2, Power, Globe } from "lucide-react";
import * as api from "@/lib/api";

type JobTableProps = {
  jobs: api.Job[];
  loading: boolean;
  onAction: (id: string, action: string) => void;
  busyId: string | null;
};

export default function JobTable({ jobs, loading, onAction, busyId }: JobTableProps) {
  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>
        Loading jobs...
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.5 }}>
        No jobs configured. Press &quot;New Job&quot; to get started.
      </div>
    );
  }

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Name / ID</th>
            <th>Schedule</th>
            <th>Status</th>
            <th>Callback URL</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <div style={{ fontWeight: 700 }}>{job.name}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.2rem' }}>{job.id.slice(0, 8)}...</div>
              </td>
              <td>
                <code className="mono" style={{ backgroundColor: 'var(--glass)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
                  {job.cronExpression}
                </code>
                <div style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.4rem' }}>
                  <Globe size={10} color="var(--muted)" />
                  <span style={{ color: 'var(--muted)' }}>{job.timezone}</span>
                </div>
              </td>
              <td>
                <span className={`badge ${job.paused ? 'badge-paused' : job.enabled ? 'badge-active' : 'badge-disabled'}`}>
                  {job.paused ? 'Paused' : job.enabled ? 'Active' : 'Disabled'}
                </span>
                {job.consecutiveDeadCount > 0 && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.65rem', color: 'var(--error)', fontWeight: 600 }}>
                    Dead: {job.consecutiveDeadCount}
                  </div>
                )}
              </td>
              <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }} className="mono">{job.callbackUrl}</span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                  <button 
                    className="btn outline" 
                    title="Manual Trigger"
                    onClick={() => onAction(job.id, "trigger")}
                    disabled={busyId === job.id || !job.enabled}
                    style={{ padding: '0.4rem' }}
                  >
                    <Play size={14} />
                  </button>
                  <button 
                    className="btn outline" 
                    title={job.paused ? "Resume Schedule" : "Pause Schedule"}
                    onClick={() => onAction(job.id, job.paused ? "resume" : "pause")}
                    disabled={busyId === job.id}
                    style={{ padding: '0.4rem' }}
                  >
                    {job.paused ? <Play size={14} fill="var(--warning)" /> : <Pause size={14} />}
                  </button>
                  <button 
                    className="btn outline" 
                    title={job.enabled ? "Disable Job" : "Enable Job"}
                    onClick={() => onAction(job.id, "toggle")}
                    disabled={busyId === job.id}
                    style={{ padding: '0.4rem' }}
                  >
                    <Power size={14} color={job.enabled ? "var(--success)" : "var(--muted)"} />
                  </button>
                  <button 
                    className="btn danger outline" 
                    title="Delete Job"
                    onClick={() => onAction(job.id, "delete")}
                    disabled={busyId === job.id}
                    style={{ padding: '0.4rem', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
