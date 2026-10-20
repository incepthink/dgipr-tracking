import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { heatBands, heatLevels, MAP, type DistrictShape } from "./geometry";
import { useMapCamera } from "./use-map-camera";
import "./map.css";

const PLATE_REACH = 120;
const PLATE_HEIGHT = 80;
const SWEEP_MS = 520;

export type MapStatus = "missing" | "ok" | "hq";

export interface MaharashtraMapProps {
  /** Map district id → value; null = nothing to show (left as plain land, or hatched when status is missing). */
  values: Map<string, number | null>;
  /** missing: did not report (hatched, distinct from 0); hq: headquarters shapes, drawn neutral. */
  status?: Map<string, MapStatus>;
  /** Display name per district id. */
  names: Record<string, string>;
  format: (n: number) => string;
  metricLabel: string;
  /** Change vs before: two hues around a grey midpoint instead of the one-hue quantile ramp. */
  diverging?: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  pending?: boolean;
}

/** Diverging step for a percentage change: ±5% is "about the same". */
function divLevel(v: number) {
  return v <= -25 ? "d-2" : v < -5 ? "d-1" : v <= 5 ? "d0" : v < 25 ? "d1" : "d2";
}

/**
 * The state coloured by one value per district (a choropleth: the data is per district, so the whole shape is the
 * mark). Pan / zoom / pinch via useMapCamera; a plate follows the pointer; click a district to select it.
 * "Not reported" is a hatch, never the palest step, so it can't be read as a small number.
 */
export function MaharashtraMap({ values, status, names, format, metricLabel, diverging, selected, onSelect, pending }: MaharashtraMapProps) {
  const { t } = useT();
  const { svgRef, groupRef, isPanning, hasDragged, zoomBy, reset, surfaceProps } = useMapCamera(MAP.size);
  const frameRef = useRef<HTMLDivElement>(null);
  const frameBox = useRef<DOMRect | null>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const [pointed, setPointed] = useState<DistrictShape | null>(null);
  const [plateBelow, setPlateBelow] = useState(false);

  const levels = useMemo(() => {
    if (!diverging) return heatLevels(values) as Record<string, number | string>;
    const out: Record<string, string> = {};
    values.forEach((v, k) => { if (v !== null && Number.isFinite(v)) out[k] = divLevel(v); });
    return out;
  }, [values, diverging]);

  const describe = useCallback((id: string) => {
    const st = status?.get(id);
    const v = values.get(id);
    if (st === "hq") return t("map_hq");
    if (st === "missing" && (v === null || v === undefined)) return t("map_not_reported");
    const val = v === null || v === undefined ? t("map_no_value") : `${metricLabel}: ${format(v)}`;
    return st === "missing" ? `${val} · ${t("map_latest_missing")}` : val;
  }, [status, values, format, metricLabel, t]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => { frameBox.current = frame.getBoundingClientRect(); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    window.addEventListener("scroll", measure, true);
    return () => { ro.disconnect(); window.removeEventListener("scroll", measure, true); };
  }, []);

  const trackPointer = useCallback((e: { clientX: number; clientY: number }) => {
    const box = frameBox.current;
    if (!box) return;
    const top = e.clientY - box.top;
    const x = e.clientX - box.left;
    const left = box.width < PLATE_REACH * 2 ? box.width / 2 : Math.min(box.width - PLATE_REACH, Math.max(PLATE_REACH, x));
    plateRef.current?.style.setProperty("--plate-x", `${left}px`);
    plateRef.current?.style.setProperty("--plate-y", `${top}px`);
    setPlateBelow(top < PLATE_HEIGHT);
  }, []);

  const enter = useCallback((d: DistrictShape) => { if (!isPanning) setPointed(d); }, [isPanning]);
  const leave = useCallback((d: DistrictShape) => setPointed((c) => (c?.id === d.id ? null : c)), []);
  const pick = useCallback((d: DistrictShape) => {
    if (hasDragged() || status?.get(d.id) === "hq") return;
    onSelect(selected === d.id ? null : d.id);
  }, [hasDragged, onSelect, selected, status]);

  const hatched = MAP.districts.filter((d) => status?.get(d.id) === "missing");

  return (
    <div className="flex flex-col gap-2">
      <div ref={frameRef} className="map-frame" tabIndex={-1} data-panning={isPanning || undefined} data-pending={pending || undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape") onSelect(null);
          if (e.key === "+" || e.key === "=") zoomBy(1.5);
          if (e.key === "-") zoomBy(1 / 1.5);
        }}>
        <svg ref={svgRef} viewBox={MAP.viewBox} className="map-surface" role="img" aria-label={`${t("map_title")} — ${metricLabel}`}
          preserveAspectRatio="xMidYMid meet" {...surfaceProps}
          onClick={(e) => { if (e.target === e.currentTarget && !hasDragged()) onSelect(null); }}>
          <defs>
            <path id="map-land-shape" d={MAP.landPath} />
            <clipPath id="map-land-clip"><use href="#map-land-shape" /></clipPath>
            <linearGradient id="map-land-fill" x1="0" y1="0" x2="0.7" y2="1">
              <stop offset="0%" className="map-land-a" />
              <stop offset="100%" className="map-land-b" />
            </linearGradient>
            <pattern id="map-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="9" className="map-hatch-line" />
            </pattern>
          </defs>
          <g ref={groupRef} className="map-camera">
            <use href="#map-land-shape" className="map-sheet" fill="url(#map-land-fill)" aria-hidden />
            <g clipPath="url(#map-land-clip)">
              <g className="map-choropleth" aria-hidden>
                {MAP.districts.map((d) => {
                  const lvl = status?.get(d.id) === "hq" ? "hq" : levels[d.id];
                  return lvl === undefined ? null : <path key={d.id} className="map-choropleth-fill" data-level={lvl} d={d.d} />;
                })}
              </g>
              <g className="map-hatch-layer" aria-hidden>
                {hatched.map((d) => <path key={d.id} d={d.d} fill="url(#map-hatch)" />)}
              </g>
              <g>
                {MAP.districts.map((d) => (
                  <DistrictPath key={d.id} district={d} delay={(d.centroid[0] / MAP.size[0]) * SWEEP_MS}
                    label={`${names[d.id] ?? d.id} — ${describe(d.id)}`}
                    onEnter={enter} onLeave={leave} onMove={trackPointer} onPick={pick} />
                ))}
              </g>
              <g className="map-lit" aria-hidden>
                {MAP.districts.filter((d) => d.id === selected).map((d) => <path key={d.id} className="map-district-lit" d={d.d} />)}
              </g>
            </g>
            <use href="#map-land-shape" className="map-coast" aria-hidden />
          </g>
        </svg>

        <div ref={plateRef} className="map-readout" data-visible={pointed ? "" : undefined} data-below={plateBelow ? "" : undefined} aria-hidden>
          <div className="map-readout-card">
            <b>{pointed ? names[pointed.id] ?? pointed.id : ""}</b>
            <span className="num opacity-85">{pointed ? describe(pointed.id) : ""}</span>
          </div>
        </div>

        <div className="map-controls">
          <button type="button" onClick={() => zoomBy(1.6)} aria-label={t("map_zoom_in")}><Glyph d="M8 3.5v9M3.5 8h9" /></button>
          <span className="map-controls-rule" aria-hidden />
          <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label={t("map_zoom_out")}><Glyph d="M3.5 8h9" /></button>
          <span className="map-controls-rule" aria-hidden />
          <button type="button" onClick={reset} aria-label={t("map_reset")}><Glyph d="M6 2.5v3.5H2.5M10 13.5V10h3.5M2.5 10H6v3.5M13.5 6H10V2.5" /></button>
        </div>
        <p className="map-attribution">{t("map_attribution")}</p>
      </div>
      <MapLegend values={values} format={format} diverging={diverging} hasMissing={hatched.length > 0} />
    </div>
  );
}

/** Steps of the ramp with the value range each covers (quantile bands), plus the "not reported" hatch. */
export function MapLegend({ values, format, diverging, hasMissing }: { values: Map<string, number | null>; format: (n: number) => string; diverging?: boolean; hasMissing: boolean }) {
  const { t } = useT();
  const bands = useMemo(() => heatBands(values), [values]);
  const sw = (cls: string) => <span className={`inline-block h-3 w-5 rounded-[3px] ${cls}`} />;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-r-muted">
      {diverging ? (
        <>
          <span className="flex items-center gap-1.5">{sw("bg-[color-mix(in_oklab,var(--r-overdue)_75%,var(--r-land))]")}≤ −25%</span>
          <span className="flex items-center gap-1.5">{sw("bg-[color-mix(in_oklab,var(--r-overdue)_35%,var(--r-land))]")}{t("map_down")}</span>
          <span className="flex items-center gap-1.5">{sw("bg-r-sunk")}±5%</span>
          <span className="flex items-center gap-1.5">{sw("bg-r-seq-2")}{t("map_up")}</span>
          <span className="flex items-center gap-1.5">{sw("bg-r-seq-4")}≥ +25%</span>
        </>
      ) : bands.length ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {bands.map((b) => (
            <span key={b.level} className="flex items-center gap-1.5">
              {sw(["", "bg-r-seq-1", "bg-r-seq-2", "bg-r-seq-3", "bg-r-seq-4", "bg-r-seq-5"][b.level])}
              <span className="num">{b.min === b.max ? format(b.min) : `${format(b.min)}–${format(b.max)}`}</span>
            </span>
          ))}
        </span>
      ) : null}
      {hasMissing && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-[3px] border border-r-overdue bg-[repeating-linear-gradient(45deg,var(--r-overdue)_0_1.5px,transparent_1.5px_5px)] opacity-80" />
          {t("map_not_reported")}
        </span>
      )}
    </div>
  );
}

const DistrictPath = memo(function DistrictPath({ district, delay, label, onEnter, onLeave, onMove, onPick }: {
  district: DistrictShape; delay: number; label: string;
  onEnter: (d: DistrictShape) => void; onLeave: (d: DistrictShape) => void;
  onMove: (e: React.PointerEvent<SVGPathElement>) => void; onPick: (d: DistrictShape) => void;
}) {
  return (
    <path d={district.d} className="map-district" style={{ animationDelay: `${delay}ms` }}
      onPointerEnter={() => onEnter(district)} onPointerLeave={() => onLeave(district)} onPointerMove={onMove} onClick={() => onPick(district)}>
      <title>{label}</title>
    </path>
  );
});

function Glyph({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
