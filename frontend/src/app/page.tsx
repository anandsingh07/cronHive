"use client";

import { useEffect, useState, useCallback } from "react";
import { 
  Plus, 
  RefreshCw, 
  Activity, 
  Database, 
  Terminal,
  ExternalLink 
} from "lucide-react";
import { useSocket } from "@/hooks/useSocket";
import * as api from "@/lib/api";
import JobTable from "@/components/JobTable";
import ExecutionLog from "@/components/ExecutionLog";
import JobModal from "@/components/JobModal";

export default function Dashboard() {
  const [jobs, setJobs] = useState<api.Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { isConnected, events } = useSocket();

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.fetchJobs();
      setJobs(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load jobs";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleAction = async (id: string, action: string) => {
    setBusyId(id);
    setError(null);
    try {
      switch (action) {
        case "trigger": await api.triggerJob(id); break;
        case "pause": await api.pauseJob(id); break;
        case "resume": await api.resumeJob(id); break;
        case "delete": await api.deleteJob(id); break;
        case "toggle": 
          const job = jobs.find(j => j.id === id);
          if (job) await api.toggleJob(id, !job.enabled);
          break;
      }
      await loadJobs();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Action failed";
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="dashboard-container">
      <nav className="top-nav">
        <div className="nav-brand">
          <h1>CronHive</h1>
        </div>
        <div className="top-actions">
          <div className="status-indicator">
            <div className={`dot ${isConnected ? "active" : ""}`} />
            <span>{isConnected ? "Connected" : "Reconnecting..."}</span>
          </div>
        </div>
      </nav>

      <div className="content-wrapper">

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--error)', color: 'var(--error)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem' }} className="dashboard-grid">
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={20} color="var(--accent)" />
              Scheduled Jobs
            </h2>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                className="btn outline" 
                onClick={loadJobs}
                disabled={loading}
              >
                <RefreshCw size={16} className={loading ? "spin" : ""} />
                Refresh
              </button>
              <button 
                className="btn" 
                onClick={() => setIsModalOpen(true)}
              >
                <Plus size={16} />
                New Job
              </button>
            </div>
          </div>

          <div className="glass-panel">
            <JobTable 
              jobs={jobs} 
              loading={loading} 
              onAction={handleAction} 
              busyId={busyId}
            />
          </div>
        </section>

        <aside>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Terminal size={20} color="var(--accent)" />
            Live Feed
          </h2>
          <div className="glass-panel">
            <ExecutionLog events={events} />
          </div>
        </aside>
      </div>
      </div>

      <JobModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={() => {
          setIsModalOpen(false);
          loadJobs();
        }}
      />

      <style jsx>{`
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </main>
  );
}
