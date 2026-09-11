/**
 * GST reference data.
 *
 * Place of supply drives the single most important branch in Indian invoicing:
 * when the buyer's state matches the seller's, tax splits into CGST + SGST;
 * when it differs, the whole rate is charged as IGST. Everything here exists to
 * resolve a free-text state name into a canonical state + numeric code so that
 * branch is decided from data rather than from how someone typed "Gujarat".
 */

export interface IndianState {
  /** Two digit GST state code, also the first two digits of a GSTIN. */
  code: string;
  name: string;
  /** Union territories are still "states" for place-of-supply purposes. */
  isUnionTerritory?: boolean;
}

export const INDIAN_STATES: IndianState[] = [
  { code: '01', name: 'Jammu and Kashmir', isUnionTerritory: true },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh', isUnionTerritory: true },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi', isUnionTerritory: true },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', isUnionTerritory: true },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep', isUnionTerritory: true },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry', isUnionTerritory: true },
  { code: '35', name: 'Andaman and Nicobar Islands', isUnionTerritory: true },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh', isUnionTerritory: true },
  { code: '97', name: 'Other Territory' },
  { code: '96', name: 'Other Country' }
];

/** Rates the GST council actually uses; anything else is almost certainly a typo. */
export const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28] as const;

/** Units of measure offered in the item editor. */
export const UNITS = [
  'PCS',
  'NOS',
  'KG',
  'GM',
  'LTR',
  'ML',
  'MTR',
  'CM',
  'SQF',
  'SQM',
  'BOX',
  'PKT',
  'SET',
  'PAIR',
  'DOZ',
  'HRS',
  'DAY',
  'MONTH',
  'YEAR',
  'SERVICE',
  'OTH'
] as const;

const normalise = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

/** Aliases people type that are not the canonical GST spelling. */
const STATE_ALIASES: Record<string, string> = {
  newdelhi: '07',
  nctofdelhi: '07',
  delhincr: '07',
  orissa: '21',
  pondicherry: '34',
  puducherry: '34',
  uttaranchal: '05',
  jandk: '01',
  jk: '01',
  tn: '33',
  up: '09',
  mp: '23',
  ap: '37',
  wb: '19',
  mh: '27',
  ka: '29',
  gj: '24',
  rj: '08',
  hr: '06',
  pb: '03',
  kl: '32',
  ts: '36',
  tg: '36',
  daman: '26',
  diu: '26',
  dadraandnagarhaveli: '26',
  damananddiu: '26'
};

const BY_NORMALISED_NAME = new Map<string, IndianState>(
  INDIAN_STATES.map((state) => [normalise(state.name), state])
);

const BY_CODE = new Map<string, IndianState>(INDIAN_STATES.map((state) => [state.code, state]));

/**
 * Best-effort resolution of a state name or code to canonical GST data.
 *
 * Accepts "24", "24-Gujarat", "Gujarat", "gujarat", "GJ". Returns null when the
 * value cannot be recognised, and callers decide whether that is fatal.
 */
export const resolveState = (value?: string | null): IndianState | null => {
  if (!value) return null;

  const raw = value.trim();
  if (!raw) return null;

  // "24-Gujarat" / "24 Gujarat" - take the leading code when present.
  const codeMatch = raw.match(/^(\d{2})\b/);
  if (codeMatch?.[1] && BY_CODE.has(codeMatch[1])) {
    return BY_CODE.get(codeMatch[1]) ?? null;
  }

  const key = normalise(raw);
  if (!key) return null;

  const direct = BY_NORMALISED_NAME.get(key);
  if (direct) return direct;

  const aliasCode = STATE_ALIASES[key];
  if (aliasCode) return BY_CODE.get(aliasCode) ?? null;

  return null;
};

export const stateByCode = (code?: string | null): IndianState | null =>
  code ? BY_CODE.get(code.trim()) ?? null : null;

/** Canonical display form stored on documents, e.g. "24-Gujarat". */
export const formatPlaceOfSupply = (state: IndianState): string => `${state.code}-${state.name}`;

/** A GSTIN carries its state code in the first two digits. */
export const stateCodeFromGstin = (gstin?: string | null): string | null => {
  if (!gstin) return null;
  const code = gstin.trim().slice(0, 2);
  return BY_CODE.has(code) ? code : null;
};

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const isValidGstin = (gstin?: string | null): boolean =>
  Boolean(gstin && GSTIN_REGEX.test(gstin.trim().toUpperCase()));
