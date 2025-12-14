type ProcessingJob = {
  docId: number;
  filePath: string;
};

export async function enqueueProcessingJob(job: ProcessingJob) {
  // Placeholder for a real queue (e.g., BullMQ, SQS, etc.)
  console.log("[job] enqueue processing", job);
  return { id: `job-${job.docId}-${Date.now()}`, ...job };
}
