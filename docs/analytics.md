# Analytics: definitions and glossary

These definitions apply to every screen that analyses a form: `/office/analytics` (state and zone), *माझी आकडेवारी* (district), the Desk, the daily brief and the ask box. The code lives in `app/forms/insights.py`. The sheet-equivalent tables are in `app/forms/analytics.py`. If you change a number here, change it there too; the tests in `tests/test_insights.py` pin both.

## Basic terms

| Term | Definition |
|---|---|
| **Counted / reported** | The office-period has a submission with status *submitted*, *accepted* or *returned* (`service.COUNTED`). Drafts are never counted. |
| **Not reported** | No counted submission. It is shown as *अहवाल नाही* (hatched on the map and calendar, `–` in the tables). It is **never** shown as 0. |
| **Confirmed zero** | A typed 0 that the office confirmed. It is shown as 0. |
| **Due** | The period's deadline has passed. If the form has no deadline, the period has ended. A period that was reported early also counts as due. |
| **Latest due period** | The newest period, up to the range's end date, whose deadline has passed. This is what *आज लक्ष द्या* is about. |
| **Reporting %** | Periods reported ÷ periods due, per office. This is the map's default metric. |
| **Per reported day** | A total divided by the periods the office actually reported. This is what rankings use. An office that sent fewer days is not ranked lower for that (its reporting % shows the gap instead). |
| **Previous range** | The same number of days immediately before the selected range. Changes are shown only when that range starts on or after the form's start date (`comparable`). |
| **Groups** | `FormField.group`: print (मुद्रित माध्यमे), video (व्हिडिओ), social (समाज माध्यमे), other (इतर). An empty or unknown group counts as *other*. |

## Attention (आज लक्ष द्या)

| Item | Rule |
|---|---|
| **Missing** (*अहवाल आलेला नाही*) | Not reported for the latest due period. A draft is listed with *मसुदा*. |
| **Miss streak** (*सलग अहवाल नाही*) | Consecutive unreported periods ending at the latest due period. The check looks back at most 30 periods and lists streaks of 2 or more. |
| **Spike** (*असामान्य आकडा*) | A value that is at least 3 × the office's usual figure **and** at least 10 above it. The usual figure is the median of that office's last 14 reported values for the field, and at least 3 past values are needed. The Desk (`anomalyOf`) uses the same rule. |
| **Repeat** (*आदल्या दिवसासारखेच*) | Every entered value is identical to the immediately previous period's, at least 2 fields are filled, and the row is not all zeros. |
| **Correction** (*दुरुस्ती*) | A value the state office corrected within the selected range. It shows the original value and the corrected one. |

## Comparisons (तुलना)

- **Rank** (*सर्वाधिक*): by per-reported-day average, highest first.
- **Most improved** (*सर्वाधिक सुधारणा*): current per-day average minus the previous range's. Only offices (or divisions) that reported **at least 50 %** of their due periods in **both** ranges are eligible, so one good day after a silent week doesn't count. Rows are sorted by relative change, and only rises are listed. Rank and most improved are always shown together.
- **Below own usual** (*स्वतःच्या नेहमीपेक्षा कमी*): the per-day average fell by 25 % or more against the previous range, and the office reported at least half its due days.
- **Small multiples** use one shared y-scale. A day on which nobody in the panel reported is a dashed stub, not a zero bar.

## Map

- There is one shape per district, and `frontend/src/components/map/offices.ts` maps office codes to geo ids. The mapping is tested to cover all 34 district offices.
- The two Mumbai shapes are drawn neutral as *मुख्यालय*. The 8 विमाका units and HQ appear as chips under the map.
- For sequential metrics (reporting %, per day), colour is the quantile of the value among the districts that have one, on a single blue ramp.
- The *change* metric is diverging: red for a fall, blue for a rise, and grey for ±5 %.
- Hatching means the latest due period was not reported. It is never the palest step.
- Boundaries: geoBoundaries ADM2 (ODbL), see `frontend/src/components/map/SOURCE.md`. They are indicative only, not official boundaries.

## AI (brief and ask)

- **Brief:** code builds numbered facts (`f1`, `f2`, …). The model writes 4–5 sentences that refer to numbers only as `{f3}`. The text is rejected if it contains any digit (Latin or Devanagari) outside a placeholder, or any unknown id. Rejection, a missing key, an error or the daily cap all fall back to the template brief, which is built from the same facts. Briefs are cached per (form, latest due period, scope, language) in `analytics_briefs`.
- **Ask:** the model only chooses an intent and its parameters:
  - `not_reported(range, division)`
  - `top(field|group, level, range)`
  - `improved(field|group, level, range)`
  - `trend(field|group, office)`
  - `compare(offices, field|group, range)`
  - `totals(range, division)`
  - `office_summary(office, range)`

  The parameters are validated against the asker's own scope. A question that fits no intent gets *हे सध्या विचारता येत नाही* and the suggested questions. The suggested questions also work without a model.
- Every model call is written to the audit log (`ai.call`) with its token counts.
- Settings: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `AI_DAILY_CALL_LIMIT`.

## Glossary (मराठी ↔ English)

| मराठी | English |
|---|---|
| अहवाल पाठवला / अहवाल नाही | reported / not reported |
| पाठवलेला शून्य | a reported zero |
| देय | due |
| अहवाल % | reporting % |
| प्रति दिवस सरासरी | per reported day |
| सलग अहवाल नाही | missed in a row |
| असामान्य आकडे | unusual figures (spikes) |
| आदल्या दिवसासारखेच | same as the day before (repeat) |
| दुरुस्ती | correction |
| सर्वाधिक सुधारणा | most improved |
| स्वतःच्या नेहमीपेक्षा कमी | below own usual |
| मुद्रित माध्यमे / व्हिडिओ / समाज माध्यमे / इतर | print / video / social media / other |
| अहवाल दिनदर्शिका | reporting calendar |
| मुख्यालय | headquarters |
| विमाका (विभागीय माहिती कार्यालय) | divisional information office |
