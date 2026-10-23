import { cn } from "../lib/utils";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-block w-40 max-w-full shrink-0", className)}>
      <img
        src="/assets/am25-monitor-logo-k.svg"
        alt="Monitor by AM25"
        width={3620}
        height={1080}
        className="block h-auto w-full dark:hidden"
      />
      <img
        src="/assets/am25-monitor-logo-w.svg"
        alt="Monitor by AM25"
        width={3620}
        height={1080}
        className="hidden h-auto w-full dark:block"
      />
    </span>
  );
}
