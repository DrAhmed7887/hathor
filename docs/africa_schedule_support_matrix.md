# Africa vaccination schedule support matrix

This matrix tracks which African childhood immunization schedules can be
represented in Hathor using official or authoritative sources. It is a support
plan, not a claim of broad country support. A country can have WHO/XMart rows and
still remain `needs_review` until the infant schedule, local card labels, and
country-specific exceptions are reviewed row by row.

> **Warning:** Hathor must not imply WHO certification or endorsement. Schedule
> guidance requires clinician/public-health confirmation. Use the phrase "based
> on WHO/UNICEF country-reported schedule sources where available" when
> describing these seeds.

## Source notes

The [WHO Immunization Data portal](https://immunizationdata.who.int/) states
that vaccination schedule data are updated from official country reporting
submitted through the WHO/UNICEF Joint Reporting Form on Immunization. Hathor
uses these records as primary source evidence, then treats national Ministry of
Health or EPI schedules as secondary verification when available.

The current WHO portal pages expose two useful XMart resources:

- `WIISE/MT_AD_SCHEDULER`: country-reported schedule rows, including
  `ISO_3_CODE`, `VACCINECODE`, `AGEADMINISTERED`, `TARGETPOP_GENERAL`,
  `GEOAREA`, `YEAR`, and `SOURCECOMMENT`.
- `WIISE/V_REF_VACDISEASE`: vaccine-to-disease reference rows, including
  `VACCINECODE`, `VACCINEDESCRIPTION`, `DISEASECODE`, `DISEASEDESCRIPTION`,
  and `SCHEDULERCODE`.

The WHO portal documents that `AGEADMINISTERED` values use compact timing codes:
`B` means birth, `D` means days, `W` means weeks, `M` means months, `Y` means
years, and contact-based rows such as `1st contact` do not have a fixed age.

## Support matrix

| Country | ISO-3 | WHO/XMart rows found | National source found | Infant routine schedule extracted | Local card names captured | Language likely used on cards | Status | Notes | Source links |
|---|---:|---:|---|---|---|---|---|---|---|
| Egypt | EGY | 69 | Partial | Partial | Partial | Arabic / English | partial_ready | Existing Hathor seed is usable for the demo but still has PRD open questions around exact current EPI details. Keep source and safety wording visible. | [WHO/XMart EGY](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27EGY%27), [WHO EMRO Egypt EPI](https://www.emro.who.int/egy/programmes/expanded-programme-on-immunization.html), [UNICEF Egypt vaccines](https://www.unicef.org/egypt/vaccines) |
| Sudan | SDN | 34 | Not reviewed | No | No | Arabic / English | needs_review | WHO/XMart rows exist, but no row-level Hathor seed review has been completed. | [WHO/XMart SDN](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27SDN%27) |
| Morocco | MAR | 38 | Not reviewed | No | No | Arabic / French | needs_review | WHO/XMart rows exist; national EPI source and card labels need review before seeding. | [WHO/XMart MAR](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27MAR%27) |
| Algeria | DZA | 22 | Not reviewed | No | No | Arabic / French | needs_review | WHO/XMart rows exist; national EPI source and local notation need review. | [WHO/XMart DZA](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27DZA%27) |
| Tunisia | TUN | 32 | Not reviewed | No | No | Arabic / French | needs_review | WHO/XMart rows exist; national source and dose timing need review. | [WHO/XMart TUN](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27TUN%27) |
| Libya | LBY | 33 | Not reviewed | No | No | Arabic / English | needs_review | WHO/XMart rows exist; current national source and local card notation need review. | [WHO/XMart LBY](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27LBY%27) |
| Kenya | KEN | 41 | Not reviewed | No | No | English / local | needs_review | WHO/XMart rows exist, including malaria-related rows; subnational or programme-specific details need review before seeding. | [WHO/XMart KEN](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27KEN%27) |
| Ethiopia | ETH | 40 | Not reviewed | No | No | Amharic / English / local | needs_review | WHO/XMart rows exist; local card labels and national schedule confirmation are not captured. | [WHO/XMart ETH](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27ETH%27) |
| Tanzania | TZA | 22 | Not reviewed | No | No | English / Swahili | needs_review | WHO/XMart rows exist; local card language and national source need review. | [WHO/XMart TZA](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27TZA%27) |
| Uganda | UGA | 40 | Not reviewed | No | No | English / local | needs_review | WHO/XMart rows exist; infant schedule and school-age rows need review. | [WHO/XMart UGA](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27UGA%27) |
| Rwanda | RWA | 23 | Not reviewed | No | No | English / French / Kinyarwanda | needs_review | WHO/XMart rows exist; national source and card notation need review. | [WHO/XMart RWA](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27RWA%27) |
| Nigeria | NGA | 37 | Partial | Partial | Partial | English | needs_review | Existing Hathor seed remains available, but it requires row-level re-verification against current WHO/XMart 2024 JRF rows before being marked ready. Do not overwrite it blindly. | [WHO/XMart NGA](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27NGA%27), [WHO Nigeria country profile](https://www.who.int/publications/m/item/immunization-2024-nigeria-country-profile), [UNICEF Nigeria schedule PDF](https://www.unicef.org/nigeria/media/9911/file/Nigeria%20Immunization%20Schedule.pdf.pdf) |
| Ghana | GHA | 44 | Not reviewed | No | No | English | needs_review | WHO/XMart rows exist, including malaria-related rows; national source and card labels need review. | [WHO/XMart GHA](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27GHA%27) |
| Senegal | SEN | 47 | Not reviewed | No | No | French / local | needs_review | WHO/XMart rows exist; French local notation and national source need review. | [WHO/XMart SEN](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27SEN%27) |
| Cote d'Ivoire | CIV | 48 | Not reviewed | No | No | French / local | needs_review | WHO/XMart rows exist; national source and French card labels need review. | [WHO/XMart CIV](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27CIV%27) |
| South Africa | ZAF | 36 | Not reviewed | No | No | English / local | needs_review | WHO/XMart rows exist; combined-product labels and national EPI source need review before seeding. | [WHO/XMart ZAF](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27ZAF%27) |
| Zambia | ZMB | 48 | Not reviewed | No | No | English / local | needs_review | WHO/XMart rows exist; national source and card notation need review. | [WHO/XMart ZMB](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27ZMB%27) |
| Zimbabwe | ZWE | 38 | Not reviewed | No | No | English / local | needs_review | WHO/XMart rows exist; national source and local card labels need review. | [WHO/XMart ZWE](https://xmart-api-public.who.int/WIISE/MT_AD_SCHEDULER?%24filter=ISO_3_CODE%20eq%20%27ZWE%27) |

## Current support summary

- `partial_ready`: Egypt. The seed exists and is usable for the current demo
  flow, with visible source and clinical-confirmation warnings.
- `needs_review`: Nigeria and the remaining shortlist countries. Nigeria has an
  existing seed, but current WHO/XMart rows must be checked against it before the
  seed is promoted.
- `ready`: No newly imported African country is marked ready in this pass.

## Next pass

Review Nigeria row by row against the WHO/XMart 2024 JRF data before adding new
country seeds. After Nigeria, prioritize one country at a time, starting with a
country where national EPI PDFs and local card terminology are easy to verify.
