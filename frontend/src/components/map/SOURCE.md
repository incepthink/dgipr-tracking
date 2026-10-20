# Maharashtra boundary data

Generated on 2026-08-18 from the simplified `gbOpen` India datasets published
by geoBoundaries.

## Inputs

- State boundary (`IND ADM1`, represented year 2011):
  https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/
- District boundaries (`IND ADM2`, represented year 2021):
  https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/

The downloaded files are pinned to geoBoundaries commit `9469f09`.

## Licenses

- The ADM1 API metadata identifies the source license as Creative Commons
  Attribution 2.5 India (CC BY 2.5 IN).
- The ADM2 API metadata identifies the source license as Open Data Commons Open
  Database License 1.0 (ODbL 1.0).

Attribution: geoBoundaries; ADM1 source DataMeet India community and Election
Commission of India; ADM2 source Pathways Data Pvt. Ltd. and
lgdirectory.gov.in.

## Transformations

- Selected Maharashtra by ISO code `IN-MH`.
- Extracted the 36 Maharashtra district features from the India ADM2 dataset.
- Reduced properties to stable map-facing IDs, current display names, and source
  identifiers.
- Updated the display names Ahilyanagar, Chhatrapati Sambhajinagar, Dharashiv,
  Beed, Buldhana, Gondia, Mumbai City, and Raigad without changing geometry.
- Stored the already-simplified source geometry without further simplification.

These boundaries are indicative proof-of-concept data and must not be described
as official Maharashtra government boundaries.
