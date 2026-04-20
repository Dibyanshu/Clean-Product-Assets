export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  agentType: string;
  projectId?: string;
  status: JobStatus;
  message: string;
  startedAt: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

const jobs = new Map<string, Job>();

export function createJob(agentType: string, projectId?: string): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    agentType,
    projectId,
    status: "pending",
    message: "Job created",
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  return job;
}

export function updateJob(
  id: string,
  updates: Partial<Omit<Job, "id">>,
): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, updates);
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return Array.from(jobs.values());
}
