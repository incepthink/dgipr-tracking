import * as React from "react";
import { useT } from "@/lib/i18n";
import { addDays } from "@/lib/utils";
import { RAlert, RCard, RCardTitle, RCheck, RError, RFilterBar, RPage, RSegmented, RTitle, StatusLegend } from "@/components/reports/kit";
import { fig, rangeText } from "@/components/reports/period";
import { useFormFilters } from "../forms/common";
import {
  chaseText, CopyButton, DivisionPicker, FormPicker, notSentBy, periodName, reportingPeriod, RollCall, rollStats, Stepper,
  useCompliance, WhatsAppBox, windowOf,
} from "./shared";

/** State and zone: who has sent what, office by office, with a chase message for WhatsApp. */
export default function CompliancePage() {
  const tr = useT();
  const { t, tf, lang } = tr;
  const f = useFormFilters(14);
  const form = f.form;
  const n = form?.frequency === "weekly" ? 8 : 14;
  const anchor = f.params.get("end") || f.lastDay;
  const win = form ? windowOf(form, anchor, n) : { start: "", end: "" };
  const { data, error, isLoading } = useCompliance(f.formId, win.start, win.end, f.division, f.ready);
  const [pick, setPick] = React.useState(-1);
  const [mode, setMode] = React.useState<"day" | "overdue">("day");
  const [withOld, setWithOld] = React.useState(true);

  const now = Date.now();
  const defaultJ = data && form ? Math.max(0, data.periods.indexOf(reportingPeriod(form, f.lastDay, now))) : 0;
  const j = data ? (pick >= 0 && pick < data.periods.length ? pick : defaultJ === -1 ? data.periods.length - 1 : defaultJ) : 0;
  React.useEffect(() => setPick(-1), [win.end, f.formId]);
  const stats = data && form ? rollStats(form, data, now) : null;
  const missing = data ? notSentBy(data, j).reduce((s, g) => s + g.rows.length, 0) : 0;
  const text = data && form ? chaseText({ form, data, j, withOld, onlyOverdue: mode === "overdue", tr, now }) : "";
  const step = form?.frequency === "weekly" ? 7 : 1;
  const shift = (k: number) => f.set({ end: addDays(win.end, k * n * step) });

  return (
    <RPage>
      <RTitle title={t("nav_compliance")} sub={t("compliance_sub")} />
      <RFilterBar className="items-center">
        <FormPicker f={f} label={false} />
        {form && form.frequency !== "once" && (
          <Stepper label={win.start ? rangeText(win.start, win.end, lang) : "…"} onPrev={() => shift(-1)} onNext={() => shift(1)}
            prevOk={!!form && win.start > form.start_date} nextOk={win.end < f.lastDay} />
        )}
        <DivisionPicker f={f} />
        <StatusLegend className="lg:ml-auto" marks={["acc", "sub", "late", "ret", "over", "pend"]} />
      </RFilterBar>

      {error ? <RError error={error} /> : isLoading || !data || !form ? (
        <div className="h-96 animate-pulse rounded-2xl bg-r-sunk" />
      ) : !data.rows.length ? <RAlert tone="info">{t("rows_none")}</RAlert> : (
        <div className="flex flex-wrap items-start gap-5">
          <RCard className="min-w-0 flex-[999_1_700px] px-4 pt-4 pb-2">
            <RollCall form={form} data={data} highlight={j} onPick={(x) => { setPick(x); setMode("day"); }} />
          </RCard>

          <aside className="flex flex-[1_1_340px] flex-col gap-4 lg:sticky lg:top-20">
            <RCard className="gap-3.5">
              <h2 className="disp m-0 text-[22px] font-bold">{t("chase_list")}</h2>
              <RSegmented full label={t("chase_list")} value={mode} onChange={setMode}
                options={[
                  { value: "day", label: `${periodName(form, data.periods[j], lang)} · ${tf("n_offices", { n: missing })}` },
                  { value: "overdue", label: `${t("all_overdue")} · ${stats?.overdue ?? 0}` },
                ]} />
              {mode === "day" && (
                <RCheck checked={withOld} onChange={setWithOld} className="self-start">{t("also_older")}</RCheck>
              )}
              {(mode === "day" ? missing : stats?.overdue) ? <WhatsAppBox text={text} /> : <RAlert tone="success">{t("nobody_to_chase")}</RAlert>}
              <CopyButton variant="pri" size="md" text={text} label={t("copy_whatsapp")} done={t("copied_whatsapp")} />
              <span className="text-[13px] text-r-muted">{t("whatsapp_hint")}</span>
            </RCard>

            {stats && (
              <RCard className="gap-2.5">
                <RCardTitle className="text-[17px]">{tf("at_a_glance", { range: rangeText(data.start, data.end, lang) })}</RCardTitle>
                <dl className="m-0 grid grid-cols-[1fr_auto] gap-2 text-sm">
                  <dt>{t("periods_due")}</dt><dd className="num m-0 font-bold">{fig(stats.due)}</dd>
                  <dt>{t("sent_on_time")}</dt><dd className="num m-0 font-bold">{fig(stats.onTime)} · {pct(stats.onTime, stats.due)}</dd>
                  <dt>{t("st_sent_late")}</dt><dd className="num m-0 font-bold">{fig(stats.late)} · {pct(stats.late, stats.due)}</dd>
                  <dt>{t("returned_waiting")}</dt><dd className="num m-0 font-bold">{fig(stats.returned)}</dd>
                  <dt>{t("overdue_nothing")}</dt><dd className="num m-0 font-bold text-r-overdue-ink">{fig(stats.overdue)}</dd>
                  <dt>{t("still_open")}</dt><dd className="num m-0 font-bold">{fig(stats.open)}</dd>
                </dl>
              </RCard>
            )}
          </aside>
        </div>
      )}
    </RPage>
  );
}

function pct(a: number, b: number) {
  return b ? `${Math.round((1000 * a) / b) / 10}%` : "—";
}
