import { DurableObject } from "cloudflare:workers";
import { tick } from "./engine";

export class MonitorScheduler extends DurableObject<Env> {
  async ensure() {
    await this.ctx.storage.transaction(async (storage) => {
      const alarm = await storage.getAlarm();
      if (alarm !== null && alarm >= Date.now() - 120000) return;
      const next = Date.now() + 1000;
      await storage.put("scheduledFor", next);
      await storage.setAlarm(next);
    });
  }

  async alarm() {
    const scheduledFor = await this.ctx.storage.get<number>("scheduledFor") ?? Date.now();
    const next = (Math.floor(Date.now() / 60000) + 1) * 60000;
    await this.ctx.storage.transaction(async (storage) => {
      await storage.put("scheduledFor", next);
      await storage.setAlarm(next);
    });
    try {
      await tick(this.env, undefined, Math.floor(scheduledFor / 1000), "alarm");
    } catch {
      const retry = Date.now() + 15000;
      await this.ctx.storage.transaction(async (storage) => {
        const alarm = await storage.getAlarm();
        const next = alarm === null ? retry : Math.min(alarm, retry);
        await storage.put("scheduledFor", next);
        await storage.setAlarm(next);
      });
      console.error(JSON.stringify({ event: "scheduler_retry" }));
    }
  }
}
