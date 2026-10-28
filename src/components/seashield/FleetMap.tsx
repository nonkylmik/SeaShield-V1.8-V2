import { geoGraticule10, geoNaturalEarth1, geoPath, type GeoGeometryObject } from "d3-geo";
import { Crosshair, Globe2, Minus, Plus } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
// Bundled Natural Earth land (see src/assets/maps/README.md); loaded from the app's own origin when the map opens.
import landUrl from "@/assets/maps/ne_110m_land.geojson?url";
import {
  centerOn,
  clampView,
  fitPoints,
  markerStyle,
  WORLD_VIEW,
  zoomAt,
  type MapRow,
  type MapView,
} from "@/lib/seashield/mapModel";
import type { SecurityState, Severity } from "@/lib/seashield/types";
import { cn } from "@/lib/utils";

// The SVG works in these viewBox units; the Natural Earth projection is fitted to them once.
const WIDTH = 960;
const HEIGHT = 500;
const SPHERE: GeoGeometryObject = { type: "Sphere" };
const projection = geoNaturalEarth1().fitExtent(
  [
    [8, 8],
    [WIDTH - 8, HEIGHT - 8],
  ],
  SPHERE,
);
const drawPath = geoPath(projection);
const SPHERE_PATH = drawPath(SPHERE) ?? "";
const GRATICULE_PATH = drawPath(geoGraticule10()) ?? "";

/** Marker colour is the backend security status; contact is shown by shape and label (see markerStyle). */
const SECURITY_FILL: Record<SecurityState, string> = {
  secure: "var(--secure)",
  elevated: "var(--caution)",
  warning: "var(--warning)",
  critical: "var(--critical)",
  unknown: "var(--muted-foreground)",
};

const SEVERITY_FILL: Record<Severity, string> = {
  critical: "var(--critical)",
  high: "var(--warning)",
  medium: "var(--caution)",
  low: "var(--signal)",
  info: "var(--muted-foreground)",
};

export type CenterRequest = { vesselId: string; seq: number } | null;

function project(row: MapRow): [number, number] | null {
  return row.position ? projection([row.position.lon, row.position.lat]) : null;
}

export function FleetMap({
  rows,
  selectedId,
  onSelect,
  centerRequest,
  notLive,
}: {
  /** Vessels to draw; only those with a position get a marker. */
  rows: MapRow[];
  selectedId: string | null;
  onSelect: (vesselId: string) => void;
  centerRequest: CenterRequest;
  /** Positions are not live (refresh failed or backend unreachable): the map is hatched. */
  notLive: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<MapView>(WORLD_VIEW);
  const [land, setLand] = useState<GeoGeometryObject | null>(null);
  const [landFailed, setLandFailed] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; view: MapView } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(landUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Coastline ${response.status}`);
        return response.json() as Promise<GeoGeometryObject>;
      })
      .then((geometry) => {
        if (!cancelled) setLand(geometry);
      })
      .catch(() => {
        if (!cancelled) setLandFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const landPath = useMemo(() => (land ? (drawPath(land) ?? "") : ""), [land]);

  const markers = useMemo(
    () =>
      rows.flatMap((row) => {
        const point = project(row);
        return point && row.position ? [{ row, position: row.position, point }] : [];
      }),
    [rows],
  );

  // Centre on a vessel picked from the list or the search.
  useEffect(() => {
    if (!centerRequest) return;
    const target = markers.find((marker) => marker.row.id === centerRequest.vesselId);
    if (target) setView((current) => centerOn(target.point, Math.max(current.k, 4), WIDTH, HEIGHT));
    // Only a new request recentres; marker updates must not move the operator's view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerRequest]);

  /** Client coordinates to viewBox units. */
  const toViewBox = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return [WIDTH / 2, HEIGHT / 2];
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return [point.x, point.y];
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // A native listener: React's wheel handler is passive and cannot stop the page from scrolling.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const [cx, cy] = toViewBox(event.clientX, event.clientY);
      setView((current) => zoomAt(current, event.deltaY < 0 ? 1.25 : 0.8, cx, cy, WIDTH, HEIGHT));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const [x, y] = toViewBox(event.clientX, event.clientY);
    drag.current = { id: event.pointerId, x, y, view };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const [x, y] = toViewBox(event.clientX, event.clientY);
    setView(
      clampView(
        { ...start.view, x: start.view.x + x - start.x, y: start.view.y + y - start.y },
        WIDTH,
        HEIGHT,
      ),
    );
  };
  const endDrag = () => {
    drag.current = null;
  };

  const zoomBy = (factor: number) =>
    setView((current) => zoomAt(current, factor, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT));
  const fitFleet = () =>
    setView(
      fitPoints(
        markers.map((marker) => marker.point),
        WIDTH,
        HEIGHT,
      ),
    );
  const transform = `translate(${view.x} ${view.y}) scale(${view.k})`;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label="Simulated fleet positions on a world map (Natural Earth projection)"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <pattern
            id="map-not-live"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="10"
              stroke="var(--muted-foreground)"
              strokeWidth="2"
              strokeOpacity="0.35"
            />
          </pattern>
        </defs>
        <g transform={transform}>
          <path
            d={SPHERE_PATH}
            fill="var(--panel)"
            stroke="var(--border)"
            strokeWidth={1 / view.k}
          />
          <path
            d={GRATICULE_PATH}
            fill="none"
            stroke="var(--border)"
            strokeOpacity="0.45"
            strokeWidth={0.6 / view.k}
          />
          {landPath ? (
            <path
              d={landPath}
              fill="var(--secondary)"
              stroke="var(--muted-foreground)"
              strokeOpacity="0.5"
              strokeWidth={0.6 / view.k}
            />
          ) : null}
        </g>
        {/* Markers keep a fixed size at every zoom level. */}
        {markers.map(({ row, position, point }) => {
          const style = markerStyle(row.securityState, position.freshness);
          const fill = SECURITY_FILL[style.securityState];
          const x = point[0] * view.k + view.x;
          const y = point[1] * view.k + view.y;
          const selected = row.id === selectedId;
          return (
            <g
              key={row.id}
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={0}
              aria-label={`${row.name}: ${row.securityState} security status, position ${position.freshness}`}
              aria-pressed={selected}
              className="cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSelect(row.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(row.id);
                }
              }}
            >
              {selected ? (
                <circle r="13" fill="none" stroke="var(--signal)" strokeWidth="1.5" />
              ) : null}
              {position.courseDeg === null ? (
                <circle
                  r="5.5"
                  fill={style.outline === "hollow" ? "none" : fill}
                  stroke={style.outline === "hollow" ? fill : "var(--foreground)"}
                  strokeWidth={style.outline === "hollow" ? 2 : 1}
                  strokeDasharray={style.outline === "dashed" ? "2.5 2" : undefined}
                />
              ) : (
                <path
                  d="M0 -8 L5.5 6 L0 3 L-5.5 6 Z"
                  transform={`rotate(${position.courseDeg})`}
                  fill={style.outline === "hollow" ? "none" : fill}
                  stroke={style.outline === "hollow" ? fill : "var(--foreground)"}
                  strokeWidth={style.outline === "hollow" ? 2 : 1}
                  strokeDasharray={style.outline === "dashed" ? "2.5 2" : undefined}
                  strokeLinejoin="round"
                />
              )}
              {row.openIncidents > 0 && row.incidentSeverity ? (
                <g transform="translate(9 -9)">
                  <circle
                    r="6"
                    fill={SEVERITY_FILL[row.incidentSeverity]}
                    stroke="var(--background)"
                    strokeWidth="1"
                  />
                  <text
                    textAnchor="middle"
                    y="3"
                    fontSize="8"
                    fontWeight="700"
                    fill="var(--background)"
                  >
                    {row.openIncidents}
                  </text>
                </g>
              ) : null}
              <text
                x="11"
                y="4"
                fontSize="10"
                fill="var(--foreground)"
                className="font-mono"
                paintOrder="stroke"
                stroke="var(--background)"
                strokeWidth="3"
              >
                {row.name}
              </text>
              {style.label ? (
                <text
                  x="11"
                  y="16"
                  fontSize="9"
                  fontWeight="700"
                  fill="var(--foreground)"
                  className="font-mono"
                  paintOrder="stroke"
                  stroke="var(--background)"
                  strokeWidth="3"
                >
                  {style.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {notLive ? (
          <rect width={WIDTH} height={HEIGHT} fill="url(#map-not-live)" pointerEvents="none" />
        ) : null}
      </svg>
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <MapButton label="Zoom in" onClick={() => zoomBy(1.5)} disabled={view.k >= 8}>
          <Plus className="size-4" />
        </MapButton>
        <MapButton label="Zoom out" onClick={() => zoomBy(1 / 1.5)} disabled={view.k <= 1}>
          <Minus className="size-4" />
        </MapButton>
        <MapButton label="World view" onClick={() => setView(WORLD_VIEW)}>
          <Globe2 className="size-4" />
        </MapButton>
        <MapButton label="Fit to fleet" onClick={fitFleet} disabled={markers.length === 0}>
          <Crosshair className="size-4" />
        </MapButton>
      </div>
      <div className="label-mono absolute bottom-2 left-2 rounded-sm border border-border bg-panel/90 px-2 py-1 normal-case">
        Natural Earth projection · {view.k.toFixed(1)}× · operational overview, not a navigational
        chart
        {landFailed ? " · coastline unavailable" : ""}
      </div>
    </div>
  );
}

function MapButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-8 items-center justify-center rounded-sm border border-border bg-panel text-foreground hover:bg-accent",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}
