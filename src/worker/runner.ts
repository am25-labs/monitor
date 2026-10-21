import { DurableObject } from "cloudflare:workers";
import { runJob } from "./engine";

export class MonitorRunner extends DurableObject<Env> {
  async enqueue(id: string) {
    await this.ctx.storage.transaction(async (storage) => {
      await storage.put(`job:${id}`, id);
      if (await storage.getAlarm() === null) await storage.setAlarm(Date.now());
    });
  }

  async alarm() {
    await this.ctx.storage.setAlarm(Date.now() + 30000);
    const jobs = await this.ctx.storage.list<string>({ prefix: "job:", limit: 100 });
    for (const [key, id] of jobs) {
      try {
        await runJob(this.env, id);
        await this.ctx.storage.delete(key);
      } catch {
        console.error(JSON.stringify({ event: "runner_retry", jobId: id }));
      }
    }
    await this.ctx.storage.transaction(async (storage) => {
      const pending = await storage.list({ prefix: "job:", limit: 1 });
      if (!pending.size) await storage.deleteAlarm();
      else {
        const alarm = await storage.getAlarm();
        if (alarm === null) await storage.setAlarm(Date.now() + 30000);
      }
    });
  }
}
