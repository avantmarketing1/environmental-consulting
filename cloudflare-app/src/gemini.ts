/**
 * Google Gemini API multimodal integration for Field To Forest Environmental Consulting.
 * Default model: gemini-4-hydrogen (configurable via GEMINI_MODEL env var or per-request override).
 *
 * Core Compliance Guardrail:
 *   - Stage 1 (extractStructuredAssessment): Converts raw PDFs (architectural plans, SEEs, DA docs),
 *     images, audio notes, and unstructured text into structured JSON for human review.
 *   - Stage 3 (draftCustomReportNarratives): Synthesises bespoke, council-ready narrative sections
 *     strictly grounded in the deterministic OSmodel300614 / AS/NZS 1547 outputs — NEVER invents math.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen";

export interface GeminiFilePart {
  filename: string;
  mimeType: string;
  data: ArrayBuffer;
}

/** Stack-safe chunked ArrayBuffer -> Base64 encoder (< 3 ms CPU on Cloudflare Workers). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function stripMarkdownJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

async function callGeminiJson(
  apiKey: string,
  model: string,
  parts: Array<Record<string, unknown>>,
  temperature = 0.15,
): Promise<{ parsed: Record<string, unknown>; modelUsed: string }> {
  const safeModel = (model || DEFAULT_GEMINI_MODEL).trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(safeModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
      },
    }),
  });

  const rawBody = await resp.text();
  if (!resp.ok) {
    let detail = rawBody.slice(0, 400);
    try {
      const errJson = JSON.parse(rawBody);
      detail = errJson?.error?.message || detail;
    } catch (_) {}
    throw new Error(`Gemini API (${safeModel}) returned HTTP ${resp.status}: ${detail}`);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawBody);
  } catch (_) {
    throw new Error("Gemini API returned non-JSON envelope.");
  }

  const candidates = (data.candidates as Array<Record<string, unknown>>) || [];
  const first = candidates[0];
  const content = first?.content as Record<string, unknown> | undefined;
  const outParts = (content?.parts as Array<Record<string, unknown>>) || [];
  const text = outParts.map((p) => String(p.text ?? "")).join("").trim();
  if (!text) {
    throw new Error("Gemini API returned an empty response.");
  }

  const cleaned = stripMarkdownJsonFences(text);
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return { parsed, modelUsed: safeModel };
  } catch (err) {
    throw new Error(`Gemini output was not valid JSON: ${cleaned.slice(0, 260)}`);
  }
}

const EXTRACTION_PROMPT = `You are a senior NSW Environmental & Wastewater Consulting intake analyst specialising in Lismore City Council Section 68 On-Site Sewage Management (OSSM) approvals, AS/NZS 1547:2012, and AS/NZS 3500.2.

Inspect ALL attached files (which may include architectural PDF floor/site plans, Statements of Environmental Effects (SEE), DA documentation, site photos, audio notes, or emails) and any pasted unstructured notes.

Extract structured engineering intake data strictly matching this JSON schema:
{
  "applicant_name": string | null,
  "site_address": string | null,
  "lot_number": string | null,
  "plan_label": string | null,
  "block_size_m2": number | null,
  "development_category": "single_dwelling" | "dual_occupancy" | "agritourism_cabins" | "food_processing_commercial" | "mixed_farm_development",
  "development_description": string,
  "bedrooms": number,
  "water_supply": "roof_full_water_saving" | "roof_standard" | "reticulated_full_water_saving" | "reticulated_standard",
  "treatment_system": "secondary_reed_bed" | "secondary_awts" | "primary_septic" | "secondary_generic",
  "land_application_type": "eta_beds" | "subsurface_drip_irrigation" | "surface_spray_irrigation",
  "wastewater_sources": [
    {
      "label": string,
      "source_type": "dwelling" | "secondary_dwelling" | "agritourism_cabin" | "day_visitors_amenities" | "food_processing_commercial",
      "units": number,
      "bedrooms_per_unit": number,
      "guests_per_unit": number | null,
      "flow_rate_lpd_override": number | null,
      "daily_flow_l_override": number | null,
      "influent_bod_mgl": number | null,
      "requires_grease_trap": boolean,
      "peak_surge_factor": number
    }
  ],
  "grease_arrestor_required": boolean,
  "grease_arrestor_capacity_l": number | null,
  "surge_balance_tank_l": number | null,
  "site_eval_hints": {
    "slope_pct": number | null,
    "aspect": string | null,
    "existing_vegetation": string | null,
    "existing_system_notes": string | null,
    "dist_gully_m": number | null,
    "dist_perennial_watercourse_m": number | null,
    "dist_property_boundary_m": number | null
  },
  "document_summary": string,
  "missing_info_flags": [string],
  "extraction_notes": string
}

RULES:
1. If the project is a single residential house only, set "development_category": "single_dwelling" and leave "wastewater_sources": [].
2. If the project involves a Dual Occupancy, Secondary Dwelling, Multiple Agritourism Cabins, Day Visitors, Farm-Gate Café, or On-Farm Food Processing Facility, populate "wastewater_sources" with one clean entry per distinct source (e.g., Primary Dwelling, Secondary Dwelling, 4x 1-BR Eco-Cabins, On-Farm Food Processing Shed).
3. Whenever a commercial kitchen, café, farm-gate tasting room, or food processing/washdown facility is detected, set "requires_grease_trap": true on that source and "grease_arrestor_required": true, and estimate realistic daily_flow_l_override and influent_bod_mgl (e.g., 650 mg/L post-grease-trap) if mentioned or infer conservatively and flag it in missing_info_flags.
4. For agritourism cabins or weekend peak operations, set peak_surge_factor between 1.0 and 1.3 where appropriate.
5. Never invent Lot/DP or measurements not present in the source material — use null and list what the consultant must verify on site in "missing_info_flags".
6. Format plan_label cleanly like "DP123456" (no spaces).
7. Return ONLY valid JSON matching the schema above.`;

export async function extractStructuredAssessmentWithGemini(params: {
  apiKey: string;
  model?: string;
  notes?: string;
  files: GeminiFilePart[];
}): Promise<{ extracted: Record<string, unknown>; modelUsed: string }> {
  const parts: Array<Record<string, unknown>> = [{ text: EXTRACTION_PROMPT }];

  if (params.notes && params.notes.trim()) {
    parts.push({ text: `\n--- UNSTRUCTURED CLIENT / FIELD NOTES ---\n${params.notes.trim()}` });
  }

  for (const f of params.files) {
    const mime = f.mimeType || "application/octet-stream";
    if (mime.startsWith("text/") || mime === "application/json" || f.filename.endsWith(".md") || f.filename.endsWith(".txt")) {
      const decoded = new TextDecoder("utf-8").decode(f.data);
      parts.push({ text: `\n--- UPLOADED TEXT DOCUMENT: ${f.filename} ---\n${decoded.slice(0, 60_000)}` });
    } else {
      parts.push({ text: `\n--- ATTACHED FILE: ${f.filename} (${mime}) ---` });
      parts.push({
        inlineData: {
          mimeType: mime,
          data: arrayBufferToBase64(f.data),
        },
      });
    }
  }

  const { parsed, modelUsed } = await callGeminiJson(
    params.apiKey,
    params.model || DEFAULT_GEMINI_MODEL,
    parts,
    0.1,
  );
  return { extracted: parsed, modelUsed };
}

const DRAFTING_PROMPT = `You are a Principal Environmental & Wastewater Consultant writing a formal Lismore City Council Section 68 Local Government Act 1993 On-Site Sewage Management (OSSM) Report for "Field To Forest Environmental Consulting".

STRICT ENGINEERING & COMPLIANCE RULES:
1. NEVER change, recalculate, contradict, or invent ANY numeric value! Every flow rate (L/d), Equivalent Persons (EP), LAA area (m²), septic tank volume (L), reed bed area/count/HRT, grease arrestor volume (L), surge tank volume (L), DLR/DIR (mm/d), soil category, Morand unit, and setback distance MUST match the deterministic MODEL_RESULT and COMPLIANCE_AUDIT JSON verbatim.
2. Tailor the prose specifically to the actual development (e.g., Single Dwelling, Dual Occupancy, Agritourism Cabins with weekend surge equalisation, On-Farm Food Processing with AS/NZS 3500.2 Grease Arrestor & FOG controls, or Mixed Farm Development) and incorporate any relevant planning/site context from the uploaded SEE / client documents.
3. Write in authoritative, crisp Australian environmental consulting prose (Australian spelling: metres, litres, amelioration, equalisation, programme, authorise, odour).
4. Cite Lismore City Council OSSM Strategy (2013), AS/NZS 1547:2012, AS/NZS 1546.1, AS/NZS 3500.2, and NSW Liquid Trade Waste Guidelines where relevant.
5. Keep paragraphs concise (2–4 sentences each, separated by blank lines \\n\\n). Do not use markdown headers or bullet symbols inside prose paragraphs.

Return ONLY valid JSON matching this exact schema:
{
  "executive_summary": string,
  "development_context": string,
  "system_selection_justification": string,
  "commercial_trade_waste_notes": string | null,
  "site_soil_interpretation": string,
  "departure_mitigations": string | null,
  "custom_om_notes": string | null
}

- Set "commercial_trade_waste_notes" to a detailed paragraph ONLY if grease_arrestor_min_l > 0, surge_tank_min_l > 0, or commercial/agritourism sources exist; otherwise null.
- Set "departure_mitigations" to a crisp justification paragraph ONLY if departures_from_strategy is non-empty or exceeds_commercial_threshold_2000ld is true; otherwise null.
- Set "custom_om_notes" to tailored operational guidance for this specific property (e.g., cabin guest welcome card rules, seasonal holiday peak management, food processing washdown/composting separation, bushfire poly-pipe shielding) or null if standard.`;

export async function draftCustomReportNarrativesWithGemini(params: {
  apiKey: string;
  model?: string;
  assessment: Record<string, unknown>;
  spatial: Record<string, unknown> | null;
  modelResult: Record<string, unknown>;
  auditResult: Record<string, unknown>;
  documentSummary?: string;
  customInstructions?: string;
}): Promise<{ custom_narratives: Record<string, unknown>; modelUsed: string }> {
  // Trim raw GeoJSON polygons from spatial context to keep tokens focused & fast
  const spatialSummary = params.spatial
    ? {
        lot_id_string: params.spatial.lot_id_string,
        parcel_area_ha: params.spatial.parcel_area_ha,
        land_zoning: params.spatial.land_zoning,
        min_lot_size: params.spatial.min_lot_size,
        flood_planning: params.spatial.flood_planning,
        landslide_risk: params.spatial.landslide_risk,
        acid_sulfate_soils: params.spatial.acid_sulfate_soils,
        drinking_water_catchment: params.spatial.drinking_water_catchment,
        bushfire_prone_land: params.spatial.bushfire_prone_land,
        nearest_watercourse_m: params.spatial.nearest_watercourse_m,
        pre_site_flags: params.spatial.pre_site_flags,
      }
    : null;

  const contextBlob = JSON.stringify(
    {
      ASSESSMENT_INPUT: params.assessment,
      SPATIAL_OVERLAYS: spatialSummary,
      DETERMINISTIC_MODEL_RESULT: params.modelResult,
      COMPLIANCE_AUDIT: params.auditResult,
      UPLOADED_CLIENT_DOCS_SUMMARY: params.documentSummary || null,
      CONSULTANT_CUSTOM_INSTRUCTIONS: params.customInstructions || null,
    },
    null,
    2,
  );

  const parts = [
    { text: DRAFTING_PROMPT },
    { text: `\n--- VERIFIED PROJECT DATA (SINGLE SOURCE OF TRUTH) ---\n${contextBlob}` },
  ];

  const { parsed, modelUsed } = await callGeminiJson(
    params.apiKey,
    params.model || DEFAULT_GEMINI_MODEL,
    parts,
    0.25,
  );

  return {
    custom_narratives: {
      executive_summary: parsed.executive_summary ?? null,
      development_context: parsed.development_context ?? null,
      system_selection_justification: parsed.system_selection_justification ?? null,
      commercial_trade_waste_notes: parsed.commercial_trade_waste_notes ?? null,
      site_soil_interpretation: parsed.site_soil_interpretation ?? null,
      departure_mitigations: parsed.departure_mitigations ?? null,
      custom_om_notes: parsed.custom_om_notes ?? null,
      source_documents_summary: params.documentSummary || null,
      ai_model_used: modelUsed,
    },
    modelUsed,
  };
}

const SEE_DRAFTING_PROMPT = `You are a Principal NSW Town Planner & Environmental Consultant writing a formal Lismore City Council Statement of Environmental Effects (SEE) pursuant to Section 4.12 & Section 4.15 of the Environmental Planning and Assessment Act 1979 (NSW) for "Field To Forest Environmental Consulting".

STRICT PLANNING & COMPLIANCE RULES:
1. NEVER change, contradict, or invent ANY property measurement, zoning code, hazard overlay, GFA, height, cut/fill depth, parking count, or OSSM wastewater figure! Cite exact figures from SEE_INPUT, SPATIAL_OVERLAYS, and LINKED_OSSM_SUMMARY verbatim.
2. Address Lismore Local Environmental Plan (LEP) 2012 (Zone objectives, Cl. 4.1/4.2A/4.2C, Cl. 5.4, Cl. 5.10, Cl. 5.21 Flood Planning, Cl. 6.1 Acid Sulfate Soils, Cl. 6.2 Earthworks, Cl. 6.4 Drinking Water Catchments, Cl. 6.6 Riparian Land, Cl. 6.9 Essential Services) and Lismore DCP 2012 Part A (Ch. 1, 7, 8, 11, 14, 22) plus applicable SEPPs & Planning for Bush Fire Protection 2019 where triggered.
3. Write in authoritative, crisp Australian town planning prose (Australian spelling: metres, litres, neighbourhood, colour, minimise, equalisation, programme).
4. Keep paragraphs concise (2–4 sentences each, separated by \\n\\n). Do not use markdown headings or bullet symbols inside prose paragraphs.

Return ONLY valid JSON matching this exact schema:
{
  "executive_summary": string,
  "site_and_locality_context": string,
  "proposal_details_narrative": string,
  "statutory_zone_justification": string,
  "environmental_impacts_and_mitigation": string,
  "site_suitability_and_public_interest": string
}`;

export async function draftCustomSeeNarrativesWithGemini(params: {
  apiKey: string;
  model?: string;
  seeInput: Record<string, unknown>;
  spatial: Record<string, unknown> | null;
  documentSummary?: string;
  customInstructions?: string;
}): Promise<{ custom_narratives: Record<string, unknown>; modelUsed: string }> {
  const spatialSummary = params.spatial
    ? {
        lot_id_string: params.spatial.lot_id_string,
        parcel_area_ha: params.spatial.parcel_area_ha,
        land_zoning: params.spatial.land_zoning,
        min_lot_size: params.spatial.min_lot_size,
        flood_planning: params.spatial.flood_planning,
        flood_details: params.spatial.flood_details,
        landslide_risk: params.spatial.landslide_risk,
        acid_sulfate_soils: params.spatial.acid_sulfate_soils,
        drinking_water_catchment: params.spatial.drinking_water_catchment,
        riparian_land: params.spatial.riparian_land,
        terrestrial_biodiversity: params.spatial.terrestrial_biodiversity,
        bushfire_prone_land: params.spatial.bushfire_prone_land,
        nearest_watercourse_m: params.spatial.nearest_watercourse_m,
        pre_site_flags: params.spatial.pre_site_flags,
      }
    : null;

  const parts = [
    { text: SEE_DRAFTING_PROMPT },
    {
      text: `\n--- VERIFIED DA / SEE DATA (SINGLE SOURCE OF TRUTH) ---\n${JSON.stringify(
        {
          SEE_INPUT: params.seeInput,
          SPATIAL_OVERLAYS: spatialSummary,
          UPLOADED_CLIENT_DOCS_SUMMARY: params.documentSummary || null,
          CONSULTANT_CUSTOM_INSTRUCTIONS: params.customInstructions || null,
        },
        null,
        2,
      )}`,
    },
  ];

  const { parsed, modelUsed } = await callGeminiJson(
    params.apiKey,
    params.model || DEFAULT_GEMINI_MODEL,
    parts,
    0.25,
  );

  return {
    custom_narratives: {
      executive_summary: parsed.executive_summary ?? null,
      site_and_locality_context: parsed.site_and_locality_context ?? null,
      proposal_details_narrative: parsed.proposal_details_narrative ?? null,
      statutory_zone_justification: parsed.statutory_zone_justification ?? null,
      environmental_impacts_and_mitigation: parsed.environmental_impacts_and_mitigation ?? null,
      site_suitability_and_public_interest: parsed.site_suitability_and_public_interest ?? null,
      source_documents_summary: params.documentSummary || null,
      ai_model_used: modelUsed,
    },
    modelUsed,
  };
}
