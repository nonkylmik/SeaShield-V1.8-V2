import { CameraOff, Circle, Video } from "lucide-react";
import type { Camera } from "@/lib/seashield/types";
import { onlineText, utcTime } from "@/lib/seashield/format";
import { cn } from "@/lib/utils";

/** Simulated feed placeholder — no real video stream is used in Prototype V1. */
export function CameraTile({ camera, vesselName }: { camera: Camera; vesselName?: string | undefined }) {
  const offline = camera.state === "offline";
  const degraded = camera.state === "degraded";

  return (
    <figure className="group relative overflow-hidden border border-border bg-background">
      <div
        className={cn(
          "relative aspect-video w-full grid-backdrop",
          offline ? "opacity-40" : "opacity-100",
        )}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-panel/40 via-background to-panel-header/60" />
        {!offline ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-signal/25 to-transparent animate-scan" />
        ) : null}
        <div className="absolute inset-0 flex items-center justify-center">
          {offline ? (
            <div className="text-center">
              <CameraOff className="mx-auto size-6 text-critical" />
              <div className="label-mono mt-1 text-critical">Signal lost</div>
            </div>
          ) : (
            <div className="text-center">
              <Video className="mx-auto size-5 text-muted-foreground" />
              <div className="label-mono mt-1">Simulated feed</div>
            </div>
          )}
        </div>
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1.5">
          <span className="label-mono bg-background/80 px-1.5 py-0.5 text-foreground">{camera.label}</span>
        </div>
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
          {camera.recording ? (
            <span className="label-mono flex items-center gap-1 bg-background/80 px-1.5 py-0.5 text-critical">
              <Circle className="size-2 fill-current animate-pulse-signal" /> rec
            </span>
          ) : null}
        </div>
        <div className="absolute bottom-1.5 left-1.5 tabular text-[10px] text-muted-foreground">
          {utcTime(camera.lastFrame)}
        </div>
        <div className="absolute bottom-1.5 right-1.5 tabular text-[10px]">
          <span className={onlineText[camera.state]}>
            {offline ? "0 fps" : `${camera.fps} fps`}
          </span>
          {degraded ? <span className="ml-1 text-caution">frame loss</span> : null}
        </div>
      </div>
      <figcaption className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
        <span className="truncate text-xs">{vesselName ?? camera.zone}</span>
        <span className={cn("tabular text-[10px]", onlineText[camera.state])}>
          {camera.state.toUpperCase()} · {camera.uptime.toFixed(1)}%
        </span>
      </figcaption>
    </figure>
  );
}
