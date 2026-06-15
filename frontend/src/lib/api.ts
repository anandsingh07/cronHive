export type Job = {
  id: string;
  name: string;
  cronExpression: string;
  callbackUrl: string;
  timezone: string;
  maxRetries: number;
  backoffMs: number;
  callbackTimeoutMs: number;
  enabled: boolean;
  paused: boolean;
  consecutiveDeadCount: number;
  createdAt: string;
  updatedAt: string;
};

export async function fetchJobs(): Promise<Job[]> {
  const res = await fetch('/jobs');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function createJob(data: Record<string, unknown>) {
  const res = await fetch('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Create failed');
  }
  return res.json();
}

export async function deleteJob(id: string) {
  const res = await fetch(`/jobs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

export async function triggerJob(id: string) {
  const res = await fetch(`/jobs/${id}/trigger`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Trigger failed (${res.status})`);
  }
  return res.json();
}

export async function pauseJob(id: string) {
  const res = await fetch(`/jobs/${id}/pause`, { method: 'POST' });
  if (!res.ok) throw new Error(`Pause failed (${res.status})`);
  return res.json();
}

export async function resumeJob(id: string) {
  const res = await fetch(`/jobs/${id}/resume`, { method: 'POST' });
  if (!res.ok) throw new Error(`Resume failed (${res.status})`);
  return res.json();
}

export async function toggleJob(id: string, enabled: boolean) {
  const res = await fetch(`/jobs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`Update failed (${res.status})`);
  return res.json();
}
