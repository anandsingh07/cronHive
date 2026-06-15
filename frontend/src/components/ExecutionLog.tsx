"use client";

import { LiveEvent } from "@/hooks/useSocket";
import { Terminal, Clock, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

type JobEventPayload = {
  jobId: string;
  attemptNumber?: number;
  durationMs?: number;
  status?: string;
  message?: string;
};

export default function ExecutionLog({ events }: { events: LiveEvent[] }) {
  if (events.length === 0) {
    return (
      <div style={{ padding: '3rem 1rem', textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>
        <Terminal size={32} style={{ marginBottom: '1rem', opacity: 0.3 }} />
        <div>Waiting for real-time events...</div>
      </div>
    );
  }

  return (
    <div className="event-log">
      {events.map((event) => (
        <div key={event.id} className="event-item">
          <div className="event-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {event.name === 'job.success' && <CheckCircle size={12} color="var(--success)" />}
              {event.name === 'job.failed' && <XCircle size={12} color="var(--error)" />}
              {event.name === 'job.alert' && <AlertTriangle size={12} color="var(--warning)" />}
              {event.name === 'job.started' && <Clock size={12} color="var(--accent)" />}
              <span className="event-name">{event.name}</span>
            </div>
            <span className="event-time">{new Date(event.at).toLocaleTimeString()}</span>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
            {event.name === 'job.started' && `Job ${(event.payload as JobEventPayload).jobId?.slice(0, 8)} started (Attempt ${(event.payload as JobEventPayload).attemptNumber})`}
            {event.name === 'job.success' && `Job ${(event.payload as JobEventPayload).jobId?.slice(0, 8)} succeeded (${(event.payload as JobEventPayload).durationMs}ms)`}
            {event.name === 'job.failed' && `Job ${(event.payload as JobEventPayload).jobId?.slice(0, 8)} failed (${(event.payload as JobEventPayload).status})`}
            {event.name === 'job.alert' && `${(event.payload as JobEventPayload).message}`}
          </div>
          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}
