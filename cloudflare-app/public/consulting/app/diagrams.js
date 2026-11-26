/**
 * Programmatic Engineering Cross-Sections & GDA2020/MGA56 GIS Site Map SVG Renderers
 * for Lismore City Council Section 68 OSSM Reports (Field To Forest Environmental Consulting).
 * Every label & dimension is dynamically driven from the single-source-of-truth model JSON.
 */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shared Architectural / Engineering Pin Feature Registry & Custom SVG Symbol Renderers.
 * Used identically by both the interactive Leaflet Map Studio AND the exported GIS Site Location Map (OSSM-GIS-01 / SEE-GIS-01).
 */
export const PIN_FEATURE_SPECS = {
  dwelling: { label: "Primary Dwelling", shortLabel: "DWELLING", color: "#0f172a", bg: "#e2e8f0" },
  secondary_dwelling: { label: "Secondary Dwelling", shortLabel: "2ND DWELLING", color: "#334155", bg: "#e2e8f0" },
  tourist_cabin: { label: "Tourist / Eco Cabin", shortLabel: "CABIN", color: "#047857", bg: "#d1fae5" },
  farm_shed: { label: "Farm Shed / Barn", shortLabel: "FARM SHED", color: "#78350f", bg: "#fef3c7" },
  commercial_kitchen: { label: "Commercial / Food Shed", shortLabel: "FOOD SHED", color: "#be123c", bg: "#ffe4e6" },
  septic_tank: { label: "Septic Tank", shortLabel: "SEPTIC TANK", color: "#9a3412", bg: "#ffedd5" },
  grease_arrestor: { label: "Grease Arrestor", shortLabel: "GREASE TRAP", color: "#b45309", bg: "#fef3c7" },
  reed_bed: { label: "Reed Bed", shortLabel: "REED BED", color: "#15803d", bg: "#dcfce7" },
  pump_well: { label: "Pump Well", shortLabel: "PUMP WELL", color: "#0369a1", bg: "#e0f2fe" },
  eta_bed: { label: "ETA Bed / LAA", shortLabel: "ETA BED / LAA", color: "#1d4ed8", bg: "#dbeafe" },
  reserve_laa: { label: "Reserve LAA", shortLabel: "RESERVE LAA", color: "#0f766e", bg: "#ccfbf1" },
  borehole: { label: "Soil Borehole", shortLabel: "BH", color: "#a16207", bg: "#fef9c3" },
  water_tank: { label: "Water Tank / Bore", shortLabel: "WATER TANK", color: "#0284c7", bg: "#e0f2fe" },
  swale: { label: "Diversion Swale", shortLabel: "SWALE", color: "#0e7490", bg: "#cffafe" },
  tree: { label: "Significant Tree", shortLabel: "TREE", color: "#166534", bg: "#dcfce7" },
  custom: { label: "Site Feature", shortLabel: "FEATURE", color: "#7c3aed", bg: "#ede9fe" },
};

/**
 * Renders the interior SVG markup for a custom architectural/engineering pin symbol centered at (0,0) in a 28x28 coordinate space.
 */
export function renderPinGlyphInner(featureType) {
  const spec = PIN_FEATURE_SPECS[featureType] || PIN_FEATURE_SPECS.custom;
  const col = spec.color;
  switch (featureType) {
    case "dwelling":
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <polygon points="0,-7.5 -7.2,-1.2 7.2,-1.2" fill="#ffffff" />
        <rect x="-5.4" y="-1.4" width="10.8" height="7.4" rx="0.6" fill="#ffffff" />
        <rect x="-1.6" y="1.4" width="3.2" height="4.6" fill="${col}" />
        <rect x="-4.4" y="0.3" width="2" height="2" fill="${col}" />
        <rect x="2.4" y="0.3" width="2" height="2" fill="${col}" />
      `;
    case "secondary_dwelling":
      // Compact granny-flat / studio cottage with skillion/gable roof + side porch
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <polygon points="-1.2,-6.8 -7.4,-1.4 5.0,-1.4" fill="#ffffff" />
        <rect x="-5.8" y="-1.6" width="9.2" height="7.2" rx="0.6" fill="#ffffff" />
        <rect x="3.2" y="0.6" width="3.8" height="5.0" fill="#cbd5e1" />
        <line x1="3.0" y1="0.6" x2="7.5" y2="0.6" stroke="#ffffff" stroke-width="1.3" />
        <rect x="-2.6" y="1.6" width="2.6" height="4.0" fill="${col}" />
        <rect x="-4.8" y="0.2" width="1.7" height="1.7" fill="${col}" />
      `;
    case "tourist_cabin":
      // Distinct A-frame eco-cabin with pitched triangular roof & glazed front
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <polygon points="0,-8.0 -7.6,5.8 7.6,5.8" fill="#ffffff" />
        <polygon points="0,-3.2 -3.2,5.8 3.2,5.8" fill="${col}" />
        <line x1="-8.2" y1="5.8" x2="8.2" y2="5.8" stroke="#a7f3d0" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="0" cy="-4.6" r="1.2" fill="#fde68a" />
      `;
    case "farm_shed":
      // Wide rural barn / machinery shed with pitched gable roof & wide roller-door
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <polygon points="0,-7.0 -8.2,-2.2 -8.2,5.8 8.2,5.8 8.2,-2.2" fill="#ffffff" />
        <rect x="-4.8" y="-0.6" width="9.6" height="6.4" rx="0.5" fill="${col}" />
        <line x1="-4.2" y1="1.2" x2="4.2" y2="1.2" stroke="#fde68a" stroke-width="0.9" />
        <line x1="-4.2" y1="3.0" x2="4.2" y2="3.0" stroke="#fde68a" stroke-width="0.9" />
        <line x1="-4.2" y1="4.8" x2="4.2" y2="4.8" stroke="#fde68a" stroke-width="0.9" />
      `;
    case "commercial_kitchen":
      // Farm-gate / commercial food processing building with striped awning & roof vent
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <rect x="2.6" y="-7.4" width="2.4" height="3.6" fill="#fecdd3" />
        <rect x="-7.4" y="-4.2" width="14.8" height="3.2" rx="0.8" fill="#fde68a" />
        <rect x="-6.4" y="-1.0" width="12.8" height="6.8" rx="0.6" fill="#ffffff" />
        <rect x="-4.4" y="0.8" width="4.4" height="3.2" fill="${col}" />
        <rect x="1.6" y="0.8" width="2.8" height="5.0" fill="${col}" />
      `;
    case "septic_tank":
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <rect x="-7.5" y="-3.8" width="15" height="9.2" rx="3" fill="#ffffff" />
        <line x1="1.5" y1="-3.8" x2="1.5" y2="3.2" stroke="${col}" stroke-width="1.6" />
        <rect x="-5" y="-6.8" width="3.4" height="3.2" rx="0.6" fill="#fed7aa" />
        <rect x="2.2" y="-6.8" width="3.4" height="3.2" rx="0.6" fill="#fed7aa" />
        <line x1="-6" y1="1.8" x2="6" y2="1.8" stroke="#60a5fa" stroke-width="1.3" />
      `;
    case "grease_arrestor":
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <rect x="-7.2" y="-5" width="14.4" height="10.4" rx="1.6" fill="#ffffff" />
        <rect x="-6.2" y="-3.8" width="8" height="3.2" fill="#f59e0b" />
        <line x1="2.4" y1="-5" x2="2.4" y2="3" stroke="${col}" stroke-width="1.6" />
        <path d="M -3 1.4 Q -1.2 3.8 0.6 1.4" fill="none" stroke="${col}" stroke-width="1.4" />
      `;
    case "reed_bed":
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <rect x="-7.4" y="0.8" width="14.8" height="5.4" rx="1.5" fill="#ffffff" />
        <line x1="-4" y1="1" x2="-4.6" y2="-6.2" stroke="#bbf7d0" stroke-width="1.7" stroke-linecap="round" />
        <line x1="0" y1="1" x2="0" y2="-7.6" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
        <line x1="4" y1="1" x2="4.6" y2="-6.2" stroke="#bbf7d0" stroke-width="1.7" stroke-linecap="round" />
        <ellipse cx="-4.6" cy="-6.4" rx="1.2" ry="2.2" fill="#fde68a" />
        <ellipse cx="0" cy="-7.4" rx="1.2" ry="2.4" fill="#fde68a" />
        <ellipse cx="4.6" cy="-6.4" rx="1.2" ry="2.2" fill="#fde68a" />
      `;
    case "pump_well":
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <circle cx="0" cy="0" r="6.8" fill="none" stroke="#ffffff" stroke-width="1.8" />
        <path d="M 0,4.5 L 0,-4.2 M -3.6,-1 L 0,-4.6 L 3.6,-1" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      `;
    case "eta_bed":
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <rect x="-7.2" y="-5.6" width="14.4" height="11.2" rx="1.5" fill="#ffffff" />
        <line x1="-5.2" y1="-2.8" x2="5.2" y2="-2.8" stroke="${col}" stroke-width="1.7" stroke-dasharray="2.4,1.2" />
        <line x1="-5.2" y1="0" x2="5.2" y2="0" stroke="${col}" stroke-width="1.7" stroke-dasharray="2.4,1.2" />
        <line x1="-5.2" y1="2.8" x2="5.2" y2="2.8" stroke="${col}" stroke-width="1.7" stroke-dasharray="2.4,1.2" />
      `;
    case "reserve_laa":
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <rect x="-7" y="-5.4" width="14" height="10.8" rx="1.5" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-dasharray="2.6,1.6" />
        <line x1="-4.8" y1="3.4" x2="4.8" y2="-3.4" stroke="#99f6e4" stroke-width="1.4" />
        <line x1="-4.8" y1="-3.4" x2="4.8" y2="3.4" stroke="#99f6e4" stroke-width="1.4" />
      `;
    case "borehole":
      // Standard AS 1726 geotechnical borehole target (alternating filled/open quadrants + crosshairs)
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <circle cx="0" cy="0" r="6.6" fill="#ffffff" stroke="#0f172a" stroke-width="1.2" />
        <path d="M 0,0 L 0,-6.6 A 6.6,6.6 0 0,1 6.6,0 Z" fill="#0f172a" />
        <path d="M 0,0 L 0,6.6 A 6.6,6.6 0 0,1 -6.6,0 Z" fill="#0f172a" />
        <line x1="-9.2" y1="0" x2="9.2" y2="0" stroke="#ffffff" stroke-width="1.1" />
        <line x1="0" y1="-9.2" x2="0" y2="9.2" stroke="#ffffff" stroke-width="1.1" />
      `;
    case "water_tank":
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <path d="M 0,-7.4 C 3.8,-2.2 5.4,0.8 5.4,3.2 A 5.4,5.4 0 0,1 -5.4,3.2 C -5.4,0.8 -3.8,-2.2 0,-7.4 Z" fill="#ffffff" />
      `;
    case "swale":
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <path d="M -7,-2 Q 0,4.5 7,-2" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" />
        <path d="M -5.5,2.5 Q 0,7.5 5.5,2.5" fill="none" stroke="#a5f3fc" stroke-width="1.7" stroke-linecap="round" />
      `;
    case "tree":
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <circle cx="0" cy="-2.2" r="5.2" fill="#bbf7d0" stroke="#ffffff" stroke-width="1.2" />
        <rect x="-1.4" y="2.2" width="2.8" height="5.2" fill="#fde68a" />
      `;
    default:
      return `
        <circle cx="0" cy="0" r="12.5" fill="${col}" stroke="#ffffff" stroke-width="2" />
        <polygon points="0,-6.6 6.6,0 0,6.6 -6.6,0" fill="#ffffff" />
        <circle cx="0" cy="0" r="2.1" fill="${col}" />
      `;
  }
}

/** Standalone scaled SVG string for Leaflet DivIcons, Pin Palette buttons & Pin Manager cards */
export function renderPinMarkerSvg(featureType, sizePx = 28) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -15 30 30" width="${sizePx}" height="${sizePx}">${renderPinGlyphInner(featureType)}</svg>`;
}

/** 1. Cover-page Treatment Train Graphic */
export function renderTreatmentTrainSvg(inp, model) {
  const hasRb = inp.treatment_system === "secondary_reed_bed";
  const isAwts = inp.treatment_system === "secondary_awts";
  const isIrrig = inp.land_application_type !== "eta_beds";
  const tr = model.trench_layout;

  const hasMulti = Array.isArray(model.source_breakdown) && model.source_breakdown.length > 0;
  const steps = [
    {
      title: hasMulti ? "MULTI-USE SOURCES" : "SOURCE",
      sub: hasMulti ? `${model.source_breakdown.length} Sources (${model.design_persons} EP)` : `${inp.bedrooms} BR Dwelling (${model.design_persons} EP)`,
      detail: `${model.total_flow_ld} L/d · BOD ${model.weighted_influent_bod_mgl || 250}`,
      fill: "#f1f5f9",
      stroke: "#334155",
    },
  ];
  if ((model.grease_arrestor_min_l || 0) > 0) {
    steps.push({
      title: "GREASE ARRESTOR",
      sub: `${model.grease_arrestor_min_l} L Trap`,
      detail: "AS/NZS 3500.2 FOG Capture",
      fill: "#fef3c7",
      stroke: "#b45309",
    });
  }
  steps.push(
    isAwts
      ? { title: "SECONDARY AWTS", sub: "NSW Health Accredited", detail: "Aeration + Disinfection", fill: "#fed7aa", stroke: "#9a3412" }
      : { title: "PRIMARY SEPTIC", sub: `${model.septic_tank_min_l} L Poly/Concrete`, detail: `Baffle + Filter (${model.septic_retention_days} d)`, fill: "#fed7aa", stroke: "#9a3412" },
  );
  if ((model.surge_tank_min_l || 0) > 0) {
    steps.push({
      title: "BALANCE TANK",
      sub: `${model.surge_tank_min_l} L Surge`,
      detail: "Timer-Dosed Equalisation",
      fill: "#ede9fe",
      stroke: "#6d28d9",
    });
  }
  if (hasRb) {
    steps.push({
      title: "SECONDARY REED BED",
      sub: `${model.recommended_reed_bed_count}× Rigid Tub (${model.recommended_reed_bed_provided_m2} m²)`,
      detail: `HRT ${model.reed_bed_hrt_days} d · ${model.n_removal_pct}% N Rem.`,
      fill: "#bbf7d0",
      stroke: "#166534",
    });
  }
  if (isIrrig) {
    steps.push({
      title: "PUMP WELL",
      sub: "1,800 L + Alarm",
      detail: "Disc Filter + Indexing Valve",
      fill: "#e0f2fe",
      stroke: "#0369a1",
    });
  }
  steps.push({
    title: isIrrig ? "IRRIGATION ZONE" : "ETA DISPOSAL FIELD",
    sub: isIrrig
      ? `${tr.trench_length_m} m × ${tr.trench_width_m} m (${model.required_laa_m2} m²)`
      : `${tr.number_of_trenches}× Bed ${tr.trench_length_m} m × ${tr.trench_width_m} m`,
    detail: `+ 100% Reserve (${model.reserve_laa_m2} m²)`,
    fill: "#dbeafe",
    stroke: "#1e40af",
  });

  const boxW = 165;
  const gap = 28;
  const W = steps.length * boxW + (steps.length - 1) * gap + 32;
  const H = 108;

  let body = "";
  steps.forEach((st, i) => {
    const x = 16 + i * (boxW + gap);
    body += `
      <rect x="${x}" y="18" width="${boxW}" height="74" rx="10" fill="${st.fill}" stroke="${st.stroke}" stroke-width="2" />
      <text x="${x + boxW / 2}" y="38" text-anchor="middle" font-size="10.5" font-weight="800" fill="${st.stroke}">${esc(st.title)}</text>
      <text x="${x + boxW / 2}" y="57" text-anchor="middle" font-size="10" font-weight="600" fill="#0f172a">${esc(st.sub)}</text>
      <text x="${x + boxW / 2}" y="74" text-anchor="middle" font-size="9.5" fill="#475569">${esc(st.detail)}</text>
    `;
    if (i < steps.length - 1) {
      const ax1 = x + boxW + 3;
      const ax2 = x + boxW + gap - 4;
      body += `<line x1="${ax1}" y1="55" x2="${ax2}" y2="55" stroke="#143628" stroke-width="2.2" marker-end="url(#ttArr)" />`;
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#ffffff; font-family:Inter,sans-serif;">
    <defs>
      <marker id="ttArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#143628" />
      </marker>
    </defs>
    ${body}
  </svg>`;
}

/** 2. Cross-Section of Conventional Baffled Septic Tank (AS/NZS 1546.1 & LCC Appendix A) */
export function renderSepticCrossSectionSvg(model) {
  const W = 740, H = 390;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#ffffff; border:1px solid #d7dfd9; border-radius:8px; font-family:Inter,sans-serif;">
    <defs>
      <marker id="flowArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#1d4ed8" />
      </marker>
    </defs>
    <text x="${W / 2}" y="24" text-anchor="middle" font-size="13.5" font-weight="800" fill="#0d241b">
      TYPICAL CROSS-SECTION — ${model.septic_tank_min_l} L BAFFLED SEPTIC TANK WITH EFFLUENT FILTER
    </text>
    <text x="${W / 2}" y="41" text-anchor="middle" font-size="10" fill="#52635c">
      AS/NZS 1546.1 &amp; Lismore City Council OSSM Strategy (2013) Appendix A · Retention: ${model.septic_retention_days} days @ ${model.total_flow_ld} L/d
    </text>

    <!-- Ground line -->
    <line x1="28" y1="84" x2="480" y2="84" stroke="#15803d" stroke-width="2" stroke-dasharray="8,4" />
    <text x="36" y="77" font-size="9" font-weight="700" fill="#15803d">FINISHED GROUND LEVEL</text>

    <!-- Crusher dust bedding -->
    <rect x="78" y="314" width="354" height="18" fill="#d6d3d1" stroke="#57534e" stroke-width="1.2" />
    <text x="255" y="327" text-anchor="middle" font-size="9" font-weight="700" fill="#292524">100 mm LEVEL COMPACTED CRUSHER-DUST BEDDING</text>

    <!-- Tank outer shell -->
    <rect x="86" y="96" width="338" height="218" fill="#eff6ff" stroke="#1e293b" stroke-width="3.2" />

    <!-- Inspection openings & pump-out access lid -->
    <rect x="116" y="84" width="34" height="12" fill="#cbd5e1" stroke="#1e293b" stroke-width="1.6" />
    <rect x="230" y="84" width="52" height="12" fill="#cbd5e1" stroke="#1e293b" stroke-width="1.6" />
    <rect x="356" y="84" width="34" height="12" fill="#cbd5e1" stroke="#1e293b" stroke-width="1.6" />
    <text x="133" y="76" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a">1</text>
    <text x="256" y="76" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a">3</text>
    <text x="373" y="76" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a">2</text>

    <!-- Liquid zone -->
    <rect x="88" y="156" width="334" height="156" fill="#bfdbfe" />
    <!-- Scum layer (chamber 1) -->
    <rect x="88" y="148" width="214" height="24" fill="#fde68a" stroke="#b45309" stroke-width="1" />
    <text x="195" y="164" text-anchor="middle" font-size="9.5" font-weight="700" fill="#78350f">7. SCUM LAYER</text>

    <!-- Sludge layer -->
    <path d="M 88 265 Q 155 245 210 278 T 302 288 L 302 312 L 88 312 Z" fill="#a8a29e" stroke="#57534e" stroke-width="1" />
    <path d="M 310 294 Q 365 288 422 298 L 422 312 L 310 312 Z" fill="#a8a29e" stroke="#57534e" stroke-width="1" />
    <text x="180" y="298" text-anchor="middle" font-size="9.5" font-weight="700" fill="#1c1917">8. ACCUMULATED SLUDGE</text>

    <!-- Internal baffle wall -->
    <rect x="302" y="114" width="8" height="154" fill="#475569" />
    <text x="292" y="218" text-anchor="end" font-size="9.5" font-weight="800" fill="#0f172a">6</text>

    <!-- Inlet pipe & square junction -->
    <rect x="44" y="122" width="82" height="12" fill="#94a3b8" stroke="#1e293b" stroke-width="1.3" />
    <rect x="118" y="122" width="12" height="72" fill="#94a3b8" stroke="#1e293b" stroke-width="1.3" />
    <line x1="28" y1="128" x2="62" y2="128" stroke="#1d4ed8" stroke-width="2" marker-end="url(#flowArr)" />
    <text x="136" y="140" font-size="9.5" font-weight="800" fill="#0f172a">4</text>

    <!-- Outlet pipe, square junction & effluent filter -->
    <rect x="372" y="138" width="98" height="12" fill="#94a3b8" stroke="#1e293b" stroke-width="1.3" />
    <rect x="366" y="138" width="16" height="86" fill="#fef08a" stroke="#1e293b" stroke-width="1.4" />
    <line x1="366" y1="152" x2="382" y2="164" stroke="#1e293b" stroke-width="1" />
    <line x1="366" y1="168" x2="382" y2="180" stroke="#1e293b" stroke-width="1" />
    <line x1="366" y1="184" x2="382" y2="196" stroke="#1e293b" stroke-width="1" />
    <line x1="366" y1="200" x2="382" y2="212" stroke="#1e293b" stroke-width="1" />
    <line x1="436" y1="144" x2="478" y2="144" stroke="#1d4ed8" stroke-width="2" marker-end="url(#flowArr)" />
    <text x="358" y="148" text-anchor="end" font-size="9.5" font-weight="800" fill="#0f172a">5</text>
    <text x="392" y="190" font-size="9.5" font-weight="800" fill="#0f172a">9</text>

    <!-- Flow path arrows -->
    <path d="M 124 202 Q 160 226 218 228" fill="none" stroke="#1d4ed8" stroke-width="1.8" marker-end="url(#flowArr)" />
    <path d="M 272 276 Q 318 282 346 254" fill="none" stroke="#1d4ed8" stroke-width="1.8" marker-end="url(#flowArr)" />

    <!-- Legend panel -->
    <rect x="498" y="84" width="222" height="248" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.2" />
    <text x="512" y="106" font-size="10.5" font-weight="800" fill="#0d241b">COMPONENT KEY</text>
    <text x="512" y="128" font-size="9.5" fill="#1e293b">1 &amp; 2. Inspection Openings</text>
    <text x="512" y="148" font-size="9.5" fill="#1e293b">3. Pump-Out Access Hatch</text>
    <text x="512" y="168" font-size="9.5" fill="#1e293b">4 &amp; 5. Inlet / Outlet Squares</text>
    <text x="512" y="188" font-size="9.5" fill="#1e293b">6. Internal Baffle Wall</text>
    <text x="512" y="208" font-size="9.5" fill="#1e293b">7. Floating Scum Layer</text>
    <text x="512" y="228" font-size="9.5" fill="#1e293b">8. Settled Sludge Zone</text>
    <text x="512" y="248" font-size="9.5" font-weight="700" fill="#9a3412">9. Outlet Effluent Filter</text>
    <text x="524" y="263" font-size="8.6" fill="#475569">(External U-trap recommended)</text>
    <line x1="510" y1="278" x2="706" y2="278" stroke="#cbd5e1" />
    <text x="512" y="295" font-size="8.6" fill="#334155">• Setback &gt; 3.0 m from buildings</text>
    <text x="512" y="310" font-size="8.6" fill="#334155">• Desludge every 3–5 years</text>
    <text x="512" y="325" font-size="8.6" fill="#334155">• Clean filter every 6 months</text>

    <text x="${W / 2}" y="370" text-anchor="middle" font-size="9.5" fill="#52635c">
      NOT TO SCALE — All plumbing &amp; tank installation to AS/NZS 3500 &amp; NSW Health Accreditation
    </text>
  </svg>`;
}

/** Helper to resolve physical Duraplas rigid reed bed tub dimensions (metres) */
function resolveReedBedDims(model, inp) {
  if (model?.recommended_reed_bed_dims && model.recommended_reed_bed_dims.length_m > 0) {
    return model.recommended_reed_bed_dims;
  }
  const name = String(model?.recommended_reed_bed_model || "").toLowerCase();
  if (name.includes("extra deep")) {
    return { length_m: 3.1, width_m: 2.0, depth_m: 0.94, wetted_depth_m: 0.75, area_m2: 6.2 };
  }
  if (name.includes("standard")) {
    return { length_m: 3.1, width_m: 2.0, depth_m: 0.64, wetted_depth_m: 0.50, area_m2: 6.2 };
  }
  // Default: Duraplas Deep Reed Bed Tub
  const wd = Number(inp?.reed_bed_wetted_depth_m || 0.70);
  return { length_m: 3.0, width_m: 1.9, depth_m: 0.87, wetted_depth_m: wd, area_m2: 5.7 };
}

/** 3. True-to-Scale Plan & Elevation Cross-Section of Rigid Reed Bed Tub(s) (LCC Reed Bed Guide & Strategy Appendix A s4.0) */
export function renderReedBedCrossSectionSvg(inp, model) {
  const W = 760;
  const nTrays = Math.max(1, model.recommended_reed_bed_count || 1);
  const dims = resolveReedBedDims(model, inp);
  const tubL = Number(dims.length_m || 3.0);
  const tubW = Number(dims.width_m || 1.9);
  const tubD = Number(dims.depth_m || 0.87);
  const wettedD = Math.max(0.35, Math.min(tubD - 0.08, Number(inp.reed_bed_wetted_depth_m || dims.wetted_depth_m || 0.70)));
  const tubArea = Number(dims.area_m2 || (tubL * tubW));
  const plantsPerTray = Math.max(12, Math.round(tubArea * 4.5));

  // --- SECTION A: TRUE 1:1 SCALE LONGITUDINAL ELEVATION (1 RIGID TUB) ---
  const elevScale = 132; // px per metre (exact same X and Y scale!)
  const elevW = Math.round(tubL * elevScale); // e.g. 3.0m -> 396px
  const elevH = Math.round(tubD * elevScale); // e.g. 0.87m -> 115px
  const ex = Math.round((W - elevW) / 2); // centered cleanly (~182px left & right margins)
  const ey = 96;
  const wettedH = Math.round(wettedD * elevScale);
  const waterY = ey + elevH - wettedH;
  const rimFreeboardPx = Math.round(0.10 * elevScale); // 100mm rim proud of ground
  const gndY = ey + rimFreeboardPx;
  const ballastInW = Math.round(0.40 * elevScale); // 400mm inlet coarse rock zone
  const ballastOutW = Math.round(0.45 * elevScale); // 450mm outlet coarse rock zone
  const baseH = Math.max(12, Math.round(0.10 * elevScale)); // 100mm compacted crusher dust
  const elevDimY = ey + elevH + baseH + 18;

  // --- SECTION B: TRUE 1:1 SCALE PLAN VIEW (ALL nTrays CONNECTED IN SERIES) ---
  const planHeaderY = elevDimY + 34;
  const gapM = 0.5; // 500mm inter-tub link pipe clearance
  const totalSeriesM = nTrays * tubL + (nTrays - 1) * gapM;
  const maxPlanW = 520;
  const maxPlanH = 166;
  const planScale = Math.min(maxPlanW / totalSeriesM, maxPlanH / tubW); // exact uniform px/m!
  const drawTubW = tubL * planScale;
  const drawTubH = tubW * planScale;
  const drawGap = gapM * planScale;
  const arrW = totalSeriesM * planScale;
  const startX = (W - arrW) / 2;
  const py = planHeaderY + 28;

  // Build scaled plan view tubs in series
  const ballastInPlan = 0.40 * planScale;
  const ballastOutPlan = 0.45 * planScale;
  const plantCols = drawTubW >= 210 ? 4 : drawTubW >= 130 ? 3 : 2;
  const plantRows = drawTubH >= 115 ? 3 : 2;
  const plantR = Math.max(3.5, Math.min(8.5, planScale * 0.095));
  const outBoxR = Math.max(6, Math.min(13, planScale * 0.14));

  let planTubsSvg = "";
  for (let t = 0; t < nTrays; t++) {
    const tx = startX + t * (drawTubW + drawGap);
    const midY = py + drawTubH / 2;
    const spX = tx + Math.max(6, ballastInPlan * 0.45);
    const spW = Math.max(5, Math.min(10, planScale * 0.10));
    const inLineX = tx + ballastInPlan;
    const outLineX = tx + drawTubW - ballastOutPlan;
    const outCx = tx + drawTubW - ballastOutPlan * 0.48;

    // Tub label cleanly above top edge (no collision with adjacent tubs)
    const tubTitle = nTrays <= 2
      ? `TUB ${t + 1}: ${tubL.toFixed(1)} m × ${tubW.toFixed(1)} m (${tubArea.toFixed(1)} m²)`
      : `TUB ${t + 1} (${tubL.toFixed(1)}×${tubW.toFixed(1)} m)`;

    // Macrophyte grid evenly spaced inside central 20mm aggregate zone
    const zoneLeft = inLineX + plantR + 6;
    const zoneRight = outLineX - plantR - 6;
    const zoneTop = py + plantR + 10;
    const zoneBot = py + drawTubH - plantR - 10;
    let plantsSvg = "";
    if (zoneRight > zoneLeft && zoneBot > zoneTop) {
      for (let c = 0; c < plantCols; c++) {
        const px = plantCols === 1 ? (zoneLeft + zoneRight) / 2 : zoneLeft + (c * (zoneRight - zoneLeft)) / (plantCols - 1);
        for (let r = 0; r < plantRows; r++) {
          const cy = plantRows === 1 ? (zoneTop + zoneBot) / 2 : zoneTop + (r * (zoneBot - zoneTop)) / (plantRows - 1);
          plantsSvg += `<circle cx="${px.toFixed(1)}" cy="${cy.toFixed(1)}" r="${plantR.toFixed(1)}" fill="#4ade80" stroke="#166534" stroke-width="1.2" />`;
        }
      }
    }

    planTubsSvg += `
      <text x="${(tx + drawTubW / 2).toFixed(1)}" y="${(py - 8).toFixed(1)}" text-anchor="middle" font-size="${nTrays > 3 ? 8.2 : 9}" font-weight="700" fill="#143628">${tubTitle}</text>
      <rect x="${tx.toFixed(1)}" y="${py.toFixed(1)}" width="${drawTubW.toFixed(1)}" height="${drawTubH.toFixed(1)}" fill="#f0fdf4" stroke="#1e293b" stroke-width="2.6" />
      <!-- Inlet & Outlet coarse rock zones -->
      <rect x="${(tx + 1.5).toFixed(1)}" y="${(py + 1.5).toFixed(1)}" width="${Math.max(2, ballastInPlan - 1.5).toFixed(1)}" height="${(drawTubH - 3).toFixed(1)}" fill="#e7e5e4" opacity="0.7" />
      <rect x="${outLineX.toFixed(1)}" y="${(py + 1.5).toFixed(1)}" width="${Math.max(2, ballastOutPlan - 1.5).toFixed(1)}" height="${(drawTubH - 3).toFixed(1)}" fill="#e7e5e4" opacity="0.7" />
      <line x1="${inLineX.toFixed(1)}" y1="${(py + 2).toFixed(1)}" x2="${inLineX.toFixed(1)}" y2="${(py + drawTubH - 2).toFixed(1)}" stroke="#b45309" stroke-width="1.3" stroke-dasharray="4,3" />
      <line x1="${outLineX.toFixed(1)}" y1="${(py + 2).toFixed(1)}" x2="${outLineX.toFixed(1)}" y2="${(py + drawTubH - 2).toFixed(1)}" stroke="#b45309" stroke-width="1.3" stroke-dasharray="4,3" />
      <!-- 100mm slotted spreader manifold -->
      <rect x="${(spX - spW / 2).toFixed(1)}" y="${(py + 10).toFixed(1)}" width="${spW.toFixed(1)}" height="${(drawTubH - 20).toFixed(1)}" fill="#94a3b8" stroke="#1e293b" stroke-width="1.1" />
      <!-- Macrophytes -->
      ${plantsSvg}
      <!-- 150mm PVC outlet control box -->
      <circle cx="${outCx.toFixed(1)}" cy="${midY.toFixed(1)}" r="${outBoxR.toFixed(1)}" fill="#eff6ff" stroke="#1d4ed8" stroke-width="1.8" />
    `;

    // Series connecting pipe between tubs
    if (t < nTrays - 1) {
      const nextSpX = tx + drawTubW + drawGap + Math.max(6, ballastInPlan * 0.45) - spW / 2;
      planTubsSvg += `
        <rect x="${(outCx + outBoxR - 1).toFixed(1)}" y="${(midY - 4).toFixed(1)}" width="${(nextSpX - (outCx + outBoxR - 1)).toFixed(1)}" height="8" fill="#94a3b8" stroke="#1e293b" stroke-width="1" />
        <line x1="${(tx + drawTubW + 2).toFixed(1)}" y1="${midY.toFixed(1)}" x2="${(tx + drawTubW + drawGap - 3).toFixed(1)}" y2="${midY.toFixed(1)}" stroke="#14532d" stroke-width="1.8" marker-end="url(#rbArr)" />
      `;
    }
  }

  // Inlet pipe (left of Tub 1) & Outlet pipe (right of Last Tub)
  const planMidY = py + drawTubH / 2;
  const firstSpX = startX + Math.max(6, ballastInPlan * 0.45) - Math.max(5, Math.min(10, planScale * 0.10)) / 2;
  const lastOutRight = startX + arrW - ballastOutPlan * 0.48 + outBoxR - 1;
  const planDimY = py + drawTubH + 20;
  const legendY = planDimY + 24;
  const footerY = legendY + 42;
  const H = footerY + 46;

  // Graphic scale bar (1.0 m exact at planScale)
  const scaleBarM = planScale < 45 ? 2.0 : 1.0;
  const scaleBarPx = Math.round(scaleBarM * planScale);
  const scaleBarX = W - 36 - scaleBarPx;
  const scaleBarY = legendY + 12;

  const overallDimText = nTrays === 1
    ? `${tubL.toFixed(1)} m (${Math.round(tubL * 1000)} mm) LENGTH`
    : `${nTrays}× TUBS IN SERIES — ${totalSeriesM.toFixed(1)} m OVERALL (${nTrays} × ${tubL.toFixed(1)} m + 0.5 m LINKS)`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#ffffff; border:1px solid #d7dfd9; border-radius:8px; font-family:Inter,sans-serif;">
    <defs>
      <marker id="rbArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#14532d" />
      </marker>
      <marker id="dimTick" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M 0 2 L 10 5 L 0 8 z" fill="#475569" />
      </marker>
    </defs>

    <!-- Title Block -->
    <text x="${W / 2}" y="24" text-anchor="middle" font-size="13.5" font-weight="800" fill="#0d241b">
      CONSTRUCTION DETAIL — HORIZONTAL SUBSURFACE FLOW REED BED (${nTrays}× RIGID TUB)
    </text>
    <text x="${W / 2}" y="40" text-anchor="middle" font-size="10" fill="#52635c">
      ${esc(model.recommended_reed_bed_model)} (${tubL.toFixed(1)} m × ${tubW.toFixed(1)} m × ${tubD.toFixed(2)} m D) · Provided ${model.recommended_reed_bed_provided_m2} m² · Wetted ${wettedD.toFixed(2)} m · HRT ${model.reed_bed_hrt_days} d
    </text>

    <!-- ================================================================ -->
    <!-- A. LONGITUDINAL ELEVATION SECTION (TRUE 1:1 SCALE)               -->
    <!-- ================================================================ -->
    <text x="36" y="64" font-size="10.5" font-weight="800" fill="#143628">
      A. LONGITUDINAL ELEVATION SECTION (TRUE SCALE: 1 TUB = ${tubL.toFixed(1)} m L × ${tubD.toFixed(2)} m D)
    </text>

    <!-- Surrounding ground level (100 mm below rim) -->
    <line x1="36" y1="${gndY}" x2="${ex}" y2="${gndY}" stroke="#4d7c0f" stroke-width="1.8" />
    <line x1="${ex + elevW}" y1="${gndY}" x2="${W - 36}" y2="${gndY}" stroke="#4d7c0f" stroke-width="1.8" />
    <text x="${ex - 8}" y="${ey + 6}" text-anchor="end" font-size="8.2" font-weight="700" fill="#9a3412">Rim ≥ 100 mm proud</text>

    <!-- Outer Rigid Tub Shell -->
    <rect x="${ex}" y="${ey}" width="${elevW}" height="${elevH}" fill="#e5e7eb" stroke="#1e293b" stroke-width="2.8" />
    <!-- Wetted aggregate zone -->
    <rect x="${ex + 2}" y="${waterY}" width="${elevW - 4}" height="${wettedH - 1}" fill="#cbd5e1" />
    <!-- Inlet & outlet coarse rock zones (50-100 mm) -->
    <rect x="${ex + 2}" y="${ey + 2}" width="${ballastInW}" height="${elevH - 4}" fill="#d6d3d1" stroke="#b45309" stroke-width="1.2" stroke-dasharray="4,3" />
    <rect x="${ex + elevW - ballastOutW - 2}" y="${ey + 2}" width="${ballastOutW}" height="${elevH - 4}" fill="#d6d3d1" stroke="#b45309" stroke-width="1.2" stroke-dasharray="4,3" />
    <!-- Effluent water surface line -->
    <line x1="${ex + 2}" y1="${waterY}" x2="${ex + elevW - 2}" y2="${waterY}" stroke="#1d4ed8" stroke-width="2" stroke-dasharray="6,3" />

    <!-- Interior Elevation Labels (clearly separated vertically) -->
    <text x="${ex + elevW / 2 - 4}" y="${waterY - 4}" text-anchor="middle" font-size="8.2" font-weight="700" fill="#1d4ed8">
      WATER LEVEL (50–100 mm BELOW GRAVEL · WETTED ${wettedD.toFixed(2)} m)
    </text>
    <text x="${ex + elevW / 2 - 4}" y="${waterY + Math.round(wettedH * 0.48)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#1e293b">
      CLEAN WASHED 20 mm AGGREGATE (POROSITY 0.40)
    </text>
    <text x="${ex + elevW / 2 - 4}" y="${waterY + Math.round(wettedH * 0.78)}" text-anchor="middle" font-size="8.4" fill="#475569">
      50–100 mm clean rock packed around inlet &amp; outlet zones
    </text>

    <!-- Inlet pipe (100mm PVC) -->
    <rect x="${ex - 68}" y="${waterY + 4}" width="${68 + Math.round(ballastInW * 0.55)}" height="9" fill="#94a3b8" stroke="#1e293b" stroke-width="1.1" />
    <line x1="${ex - 96}" y1="${waterY + 8.5}" x2="${ex - 42}" y2="${waterY + 8.5}" stroke="#14532d" stroke-width="1.8" marker-end="url(#rbArr)" />
    <text x="${ex - 10}" y="${waterY + 26}" text-anchor="end" font-size="8.5" font-weight="700" fill="#14532d">100 mm INLET</text>

    <!-- 150mm PVC outlet control box with adjustable standpipe -->
    <rect x="${ex + elevW - Math.round(ballastOutW * 0.72)}" y="${ey - 6}" width="32" height="${elevH + 4}" fill="#eff6ff" stroke="#1d4ed8" stroke-width="1.6" />
    <rect x="${ex + elevW - Math.round(ballastOutW * 0.72) + 12}" y="${waterY}" width="8" height="${ey + elevH - waterY - 8}" fill="#64748b" />
    <rect x="${ex + elevW - Math.round(ballastOutW * 0.72) + 12}" y="${ey + elevH - 16}" width="${Math.round(ballastOutW * 0.72) + 64}" height="9" fill="#94a3b8" stroke="#1e293b" stroke-width="1.1" />
    <line x1="${ex + elevW + 14}" y1="${ey + elevH - 11.5}" x2="${ex + elevW + 84}" y2="${ey + elevH - 11.5}" stroke="#14532d" stroke-width="1.8" marker-end="url(#rbArr)" />
    <text x="${ex + elevW + 12}" y="${ey + elevH - 22}" text-anchor="start" font-size="8.5" font-weight="700" fill="#14532d">TO LAA (100 mm PVC)</text>
    <text x="${ex + elevW + 12}" y="${ey - 10}" text-anchor="end" font-size="8.5" font-weight="700" fill="#1d4ed8">150 mm PVC OUTLET BOX + STANDPIPE</text>

    <!-- Left Depth Dimension Line (Elevation) -->
    <line x1="${ex - 116}" y1="${ey}" x2="${ex - 116}" y2="${ey + elevH}" stroke="#475569" stroke-width="1.1" marker-start="url(#dimTick)" marker-end="url(#dimTick)" />
    <line x1="${ex - 122}" y1="${ey}" x2="${ex - 110}" y2="${ey}" stroke="#475569" stroke-width="1" />
    <line x1="${ex - 122}" y1="${ey + elevH}" x2="${ex - 110}" y2="${ey + elevH}" stroke="#475569" stroke-width="1" />
    <rect x="${ex - 146}" y="${ey + elevH / 2 - 9}" width="60" height="18" rx="3" fill="#ffffff" />
    <text x="${ex - 116}" y="${ey + elevH / 2 + 3}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#334155">${tubD.toFixed(2)} m D</text>

    <!-- Crusher dust base -->
    <rect x="${ex - 12}" y="${ey + elevH}" width="${elevW + 24}" height="${baseH}" fill="#d6d3d1" stroke="#57534e" stroke-width="1" />
    <text x="${ex + elevW / 2}" y="${ey + elevH + baseH - 3}" text-anchor="middle" font-size="8" font-weight="700" fill="#292524">
      75–100 mm LEVEL COMPACTED CRUSHER-DUST BASE
    </text>

    <!-- Elevation Length Dimension Line -->
    <line x1="${ex}" y1="${elevDimY}" x2="${ex + elevW}" y2="${elevDimY}" stroke="#475569" stroke-width="1.1" marker-start="url(#dimTick)" marker-end="url(#dimTick)" />
    <line x1="${ex}" y1="${elevDimY - 5}" x2="${ex}" y2="${elevDimY + 5}" stroke="#475569" stroke-width="1" />
    <line x1="${ex + elevW}" y1="${elevDimY - 5}" x2="${ex + elevW}" y2="${elevDimY + 5}" stroke="#475569" stroke-width="1" />
    <rect x="${ex + elevW / 2 - 72}" y="${elevDimY - 8}" width="144" height="16" rx="3" fill="#ffffff" />
    <text x="${ex + elevW / 2}" y="${elevDimY + 3.5}" text-anchor="middle" font-size="8.8" font-weight="700" fill="#334155">
      ${tubL.toFixed(1)} m (${Math.round(tubL * 1000)} mm) TUB LENGTH
    </text>

    <!-- ================================================================ -->
    <!-- B. TRUE-TO-SCALE PLAN VIEW (ALL RIGID TUBS IN SERIES)            -->
    <!-- ================================================================ -->
    <text x="36" y="${planHeaderY}" font-size="10.5" font-weight="800" fill="#143628">
      B. PLAN VIEW — TRUE TO SCALE (${nTrays}× ${tubL.toFixed(1)} m × ${tubW.toFixed(1)} m RIGID TUB${nTrays > 1 ? "S IN SERIES" : ""} · TOTAL ${model.recommended_reed_bed_provided_m2} m²)
    </text>

    <!-- Inlet pipe entering Tub 1 -->
    <rect x="${(startX - 54).toFixed(1)}" y="${(planMidY - 4.5).toFixed(1)}" width="${(firstSpX - (startX - 54)).toFixed(1)}" height="9" fill="#94a3b8" stroke="#1e293b" stroke-width="1.1" />
    <line x1="${(startX - 78).toFixed(1)}" y1="${planMidY.toFixed(1)}" x2="${(startX - 36).toFixed(1)}" y2="${planMidY.toFixed(1)}" stroke="#14532d" stroke-width="1.8" marker-end="url(#rbArr)" />
    <text x="${(startX - 10).toFixed(1)}" y="${(planMidY + 18).toFixed(1)}" text-anchor="end" font-size="8.4" font-weight="700" fill="#14532d">100 mm INLET</text>

    <!-- Outlet pipe leaving Last Tub -->
    <rect x="${lastOutRight.toFixed(1)}" y="${(planMidY - 4.5).toFixed(1)}" width="${(startX + arrW + 54 - lastOutRight).toFixed(1)}" height="9" fill="#94a3b8" stroke="#1e293b" stroke-width="1.1" />
    <line x1="${(startX + arrW + 24).toFixed(1)}" y1="${planMidY.toFixed(1)}" x2="${(startX + arrW + 76).toFixed(1)}" y2="${planMidY.toFixed(1)}" stroke="#14532d" stroke-width="1.8" marker-end="url(#rbArr)" />
    <text x="${(startX + arrW + 10).toFixed(1)}" y="${(planMidY + 18).toFixed(1)}" text-anchor="start" font-size="8.4" font-weight="700" fill="#14532d">TO LAA (100 mm)</text>

    <!-- All Scaled Rigid Tubs + Series Links -->
    ${planTubsSvg}

    <!-- Vertical Width Dimension Arrow (left of Tub 1, above inlet pipe) -->
    <line x1="${(startX - 24).toFixed(1)}" y1="${py.toFixed(1)}" x2="${(startX - 24).toFixed(1)}" y2="${(py + drawTubH).toFixed(1)}" stroke="#475569" stroke-width="1.1" marker-start="url(#dimTick)" marker-end="url(#dimTick)" />
    <line x1="${(startX - 30).toFixed(1)}" y1="${py.toFixed(1)}" x2="${(startX - 18).toFixed(1)}" y2="${py.toFixed(1)}" stroke="#475569" stroke-width="1" />
    <line x1="${(startX - 30).toFixed(1)}" y1="${(py + drawTubH).toFixed(1)}" x2="${(startX - 18).toFixed(1)}" y2="${(py + drawTubH).toFixed(1)}" stroke="#475569" stroke-width="1" />
    <rect x="${(startX - 52).toFixed(1)}" y="${(py + drawTubH * 0.22 - 8).toFixed(1)}" width="56" height="16" rx="3" fill="#ffffff" />
    <text x="${(startX - 24).toFixed(1)}" y="${(py + drawTubH * 0.22 + 3.5).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#334155">${tubW.toFixed(1)} m W</text>

    <!-- Horizontal Overall Length Dimension Arrow (cleanly below plan tubs) -->
    <line x1="${startX.toFixed(1)}" y1="${planDimY.toFixed(1)}" x2="${(startX + arrW).toFixed(1)}" y2="${planDimY.toFixed(1)}" stroke="#475569" stroke-width="1.1" marker-start="url(#dimTick)" marker-end="url(#dimTick)" />
    <line x1="${startX.toFixed(1)}" y1="${(planDimY - 5).toFixed(1)}" x2="${startX.toFixed(1)}" y2="${(planDimY + 5).toFixed(1)}" stroke="#475569" stroke-width="1" />
    <line x1="${(startX + arrW).toFixed(1)}" y1="${(planDimY - 5).toFixed(1)}" x2="${(startX + arrW).toFixed(1)}" y2="${(planDimY + 5).toFixed(1)}" stroke="#475569" stroke-width="1" />
    <rect x="${(W / 2 - (nTrays === 1 ? 82 : 168)).toFixed(1)}" y="${(planDimY - 8).toFixed(1)}" width="${nTrays === 1 ? 164 : 336}" height="16" rx="3" fill="#ffffff" />
    <text x="${W / 2}" y="${(planDimY + 3.5).toFixed(1)}" text-anchor="middle" font-size="8.8" font-weight="700" fill="#334155">
      ${overallDimText}
    </text>

    <!-- Non-Overlapping Plan Component Legend + Metric Scale Bar -->
    <rect x="36" y="${legendY - 6}" width="12" height="10" fill="#94a3b8" stroke="#1e293b" stroke-width="1" />
    <text x="54" y="${legendY + 2}" font-size="8.6" font-weight="700" fill="#334155">100 mm Slotted Inlet Spreader (in 50–100 mm ballast)</text>

    <circle cx="352" cy="${legendY - 1}" r="5.5" fill="#eff6ff" stroke="#1d4ed8" stroke-width="1.6" />
    <text x="364" y="${legendY + 2}" font-size="8.6" font-weight="700" fill="#1d4ed8">150 mm PVC Outlet Box + Rubber Seal</text>

    <circle cx="42" cy="${legendY + 19}" r="5.5" fill="#4ade80" stroke="#166534" stroke-width="1.2" />
    <text x="54" y="${legendY + 22}" font-size="8.6" font-weight="700" fill="#166534">
      Dense Macrophytes (4–5/m² ≈ ${plantsPerTray}/tub · ${plantsPerTray * nTrays} total: Lomandra hystrix / Schoenoplectus validus)
    </text>

    <!-- True Graphic Scale Bar (Plan View) -->
    <rect x="${scaleBarX}" y="${scaleBarY}" width="${scaleBarPx}" height="6" fill="#0d241b" />
    <rect x="${scaleBarX + Math.round(scaleBarPx / 2)}" y="${scaleBarY}" width="${scaleBarPx - Math.round(scaleBarPx / 2)}" height="6" fill="#ffffff" stroke="#0d241b" stroke-width="1" />
    <text x="${scaleBarX + scaleBarPx / 2}" y="${scaleBarY - 3}" text-anchor="middle" font-size="7.8" font-weight="700" fill="#0d241b">PLAN SCALE: ${scaleBarM.toFixed(0)} m</text>

    <!-- Key Spec Footer -->
    <rect x="36" y="${footerY}" width="${W - 72}" height="38" rx="6" fill="#f7f5ef" stroke="#143628" stroke-width="1" />
    <text x="48" y="${footerY + 15}" font-size="8.8" font-weight="700" fill="#0d241b">
      LCC MANDATORY CONTROLS: Rigid impermeable mould only (flexible liners prohibited) · Lip ≥ 100 mm above ground · Backfill walls while filling gravel
    </text>
    <text x="48" y="${footerY + 29}" font-size="8.6" fill="#334155">
      Multiple trays must be connected in SERIES at identical level · Maintain adjustable standpipe for summer aeration (200 mm drop for 2 weeks).
    </text>
  </svg>`;
}

/** 4. Dynamically Dimensioned Cross-Section of ETA Bed (LCC Strategy Appendix B Design 1) */
export function renderEtaCrossSectionSvg(inp, model, audit) {
  const W = 740, H = 390;
  const rootMm = Math.round(Number(inp.root_zone_depth_mm || 300));
  const gravMm = Math.round(Number(inp.gravel_depth_mm || 300));
  const totalMm = rootMm + gravMm;
  const tr = model.trench_layout;
  const gypNote = audit?.requires_gypsum ? `APPLY GYPSUM @ ${audit.gypsum_rate_kg_m2.toFixed(1)} kg/m² TO RIPPED BASE` : "RIP BASE LEVEL PRIOR TO BACKFILLING";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#ffffff; border:1px solid #d7dfd9; border-radius:8px; font-family:Inter,sans-serif;">
    <text x="${W / 2}" y="24" text-anchor="middle" font-size="13.5" font-weight="800" fill="#0d241b">
      CROSS-SECTION — EVAPOTRANSPIRATION / ABSORPTION (ETA) BED (LCC DESIGN 1)
    </text>
    <text x="${W / 2}" y="41" text-anchor="middle" font-size="10" fill="#52635c">
      ${tr.number_of_trenches}× Bed(s): ${tr.trench_length_m} m Long × ${tr.trench_width_m} m Wide × ${totalMm} mm Deep · ${esc(model.soil_texture_name)} (DLR ${model.max_deep_drainage_mmd} mm/d)
    </text>

    <!-- Original ground level -->
    <line x1="26" y1="154" x2="714" y2="154" stroke="#64748b" stroke-width="1.3" stroke-dasharray="7,4" />
    <text x="698" y="147" text-anchor="end" font-size="8.8" fill="#475569">ORIGINAL CONTOUR</text>

    <!-- Crowned perennial grass topsoil mound -->
    <path d="M 180 154 Q 370 116 560 154 L 560 200 L 180 200 Z" fill="#d9a973" stroke="#92400e" stroke-width="1.5" />
    <path d="M 178 154 Q 370 114 562 154" fill="none" stroke="#15803d" stroke-width="4.5" />
    <text x="370" y="168" text-anchor="middle" font-size="10" font-weight="700" fill="#451a03">FRIABLE TOPSOIL (${rootMm} mm) + MOWED PERENNIAL GRASS</text>

    <!-- Geotextile matting separator -->
    <path d="M 180 200 L 315 200 Q 370 184 425 200 L 560 200" fill="none" stroke="#0f172a" stroke-width="3.2" />

    <!-- Clean gravel bed -->
    <rect x="180" y="202" width="380" height="92" fill="#cbd5e1" stroke="#1e293b" stroke-width="2.2" />
    <text x="370" y="264" text-anchor="middle" font-size="10.5" font-weight="700" fill="#1e293b">
      CLEAN WASHED 20–50 mm BLUE METAL / GRAVEL (${gravMm} mm DEEP)
    </text>

    <!-- 100mm slotted PVC pipe (NO geotextile sock!) -->
    <circle cx="370" cy="218" r="14" fill="#ffffff" stroke="#dc2626" stroke-width="2.5" />
    <circle cx="370" cy="218" r="6" fill="none" stroke="#dc2626" stroke-width="1.2" stroke-dasharray="2,2" />

    <!-- Inspection shaft -->
    <rect x="444" y="136" width="16" height="158" fill="#fef08a" stroke="#854d0e" stroke-width="1.5" />

    <!-- Callout leaders -->
    <line x1="370" y1="204" x2="370" y2="96" stroke="#dc2626" stroke-width="1.2" />
    <text x="370" y="78" text-anchor="middle" font-size="9.5" font-weight="800" fill="#dc2626">100 mm SLOTTED PVC PIPE (CENTRALLY FED)</text>
    <text x="370" y="91" text-anchor="middle" font-size="8.8" font-weight="700" fill="#991b1b">NO GEOTEXTILE SOCK ON PIPE (LCC Strategy App. B s3.0)</text>

    <line x1="452" y1="136" x2="510" y2="112" stroke="#854d0e" stroke-width="1.2" />
    <text x="515" y="114" font-size="9" font-weight="700" fill="#854d0e">100 mm Inspection Shaft</text>

    <line x1="255" y1="200" x2="215" y2="114" stroke="#0f172a" stroke-width="1.2" />
    <text x="210" y="112" text-anchor="end" font-size="9" font-weight="700" fill="#0f172a">Geotextile Fabric Mat</text>

    <!-- Dimension bars (Left: depths & 2m separation; Bottom: width) -->
    <line x1="158" y1="154" x2="158" y2="200" stroke="#0f172a" stroke-width="1.3" />
    <text x="150" y="180" text-anchor="end" font-size="9.5" font-weight="700" fill="#0f172a">${rootMm} mm</text>
    <line x1="158" y1="202" x2="158" y2="294" stroke="#0f172a" stroke-width="1.3" />
    <text x="150" y="252" text-anchor="end" font-size="9.5" font-weight="700" fill="#0f172a">${gravMm} mm</text>

    <line x1="28" y1="236" x2="174" y2="236" stroke="#1e40af" stroke-width="1.8" />
    <text x="100" y="229" text-anchor="middle" font-size="9" font-weight="800" fill="#1e40af">≥ ${tr.trench_separation_m.toFixed(1)} m between beds</text>

    <line x1="180" y1="316" x2="560" y2="316" stroke="#0f172a" stroke-width="1.6" />
    <line x1="180" y1="308" x2="180" y2="324" stroke="#0f172a" stroke-width="1.6" />
    <line x1="560" y1="308" x2="560" y2="324" stroke="#0f172a" stroke-width="1.6" />
    <text x="370" y="332" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0f172a">BED WIDTH = ${tr.trench_width_m.toFixed(1)} m (MAX LENGTH 20.0 m · MAX SLOPE 15%)</text>

    <!-- Base treatment callout -->
    <rect x="44" y="346" width="652" height="30" rx="6" fill="#fef3c7" stroke="#b45309" stroke-width="1.2" />
    <text x="370" y="365" text-anchor="middle" font-size="9.5" font-weight="800" fill="#92400e">
      BASE PREPARATION: ${gypNote} · EXCLUDE VEHICLES &amp; LIVESTOCK PERMANENTLY
    </text>
  </svg>`;
}

/** 5. Cross-Section of Sub-Surface Drip Irrigation (LCC Strategy Appendix B s4.0) */
export function renderSdiCrossSectionSvg(inp, model) {
  const W = 740, H = 360;
  const tr = model.trench_layout;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#ffffff; border:1px solid #d7dfd9; border-radius:8px; font-family:Inter,sans-serif;">
    <text x="${W / 2}" y="24" text-anchor="middle" font-size="13.5" font-weight="800" fill="#0d241b">
      CROSS-SECTION — SUB-SURFACE DRIP IRRIGATION (SDI) LATERAL INSTALLATION
    </text>
    <text x="${W / 2}" y="41" text-anchor="middle" font-size="10" fill="#52635c">
      Contiguous Zone: ${tr.trench_length_m} m × ${tr.trench_width_m} m = ${model.required_laa_m2} m² · DIR ${model.max_deep_drainage_mmd} mm/d · Requires Certified Irrigation Design Plan (CIDP)
    </text>

    <!-- Soil profile layers -->
    <rect x="54" y="106" width="632" height="82" fill="#d9a973" stroke="#92400e" stroke-width="1.4" />
    <rect x="54" y="188" width="632" height="84" fill="#cbd5e1" stroke="#475569" stroke-width="1.4" />
    <line x1="54" y1="106" x2="686" y2="106" stroke="#15803d" stroke-width="5" />
    <text x="370" y="96" text-anchor="middle" font-size="10" font-weight="800" fill="#15803d">MOWED PERENNIAL GRASS COVER (ROOT ZONE EVAPOTRANSPIRATION)</text>

    <!-- Pressure compensating dripper laterals at 150 mm depth, 1.0 m spacing -->
    ${[160, 300, 440, 580].map((x) => `
      <ellipse cx="${x}" cy="154" rx="34" ry="20" fill="#bae6fd" opacity="0.65" />
      <circle cx="${x}" cy="154" r="8" fill="#0284c7" stroke="#0c4a6e" stroke-width="2" />
    `).join("")}

    <line x1="300" y1="146" x2="300" y2="106" stroke="#0c4a6e" stroke-width="1.3" stroke-dasharray="3,2" />
    <text x="308" y="130" font-size="9" font-weight="800" fill="#0c4a6e">100–150 mm Burial Depth</text>

    <line x1="300" y1="210" x2="440" y2="210" stroke="#0f172a" stroke-width="1.6" />
    <text x="370" y="226" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0f172a">LATERAL SPACING: 0.6–1.0 m (ROOT-RETARDANT PRESSURE-COMPENSATING DRIP LINE)</text>
    <text x="370" y="252" text-anchor="middle" font-size="9.5" fill="#334155">SUBSOIL HORIZON (${esc(model.soil_texture_name)}) — TOPSOIL ROOT ZONE = 300 mm</text>

    <rect x="54" y="290" width="632" height="50" rx="6" fill="#ecfeff" stroke="#0e7490" stroke-width="1.2" />
    <text x="68" y="310" font-size="9" font-weight="800" fill="#155e75">
      LCC MANDATORY IRRIGATION CONTROLS (Appendix B s4.0, C &amp; D): Tertiary disinfected effluent required · 1,800 L Pump Well + Alarm
    </text>
    <text x="68" y="328" font-size="8.8" fill="#155e75">
      Above-ground 130 µm disc filter + liquid-filled pressure gauges · Scour flush velocity ≥ 0.8 m/s · Quarterly servicing &amp; Council report within 7 days.
    </text>
  </svg>`;
}

/** Web Mercator helpers for pixel-exact alignment between aerial tiles and GPS pins */
function lonToMercX(lon) {
  return (lon + 180) / 360;
}
function latToMercY(lat) {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}
function mercXToLon(x) {
  return x * 360 - 180;
}
function mercYToLat(y) {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function extractValidPins(inp) {
  const out = [];
  for (const pin of inp?.field_pins || []) {
    const pLat = pin.latitude != null ? Number(pin.latitude) : (pin.northing_mga56 && Math.abs(pin.northing_mga56) <= 90 ? Number(pin.northing_mga56) : null);
    const pLon = pin.longitude != null ? Number(pin.longitude) : (pin.easting_mga56 && Math.abs(pin.easting_mga56) <= 180 ? Number(pin.easting_mga56) : null);
    if (pLat == null || pLon == null || !Number.isFinite(pLat) || !Number.isFinite(pLon)) continue;
    const spec = PIN_FEATURE_SPECS[pin.feature_type] || PIN_FEATURE_SPECS.custom;
    out.push({ pin, spec, lat: pLat, lon: pLon });
  }
  return out;
}

/**
 * Computes the exact Web Mercator viewport for Drawing 2 (Zoomed Exact-GPS Pin & Infrastructure Plan).
 * Shared by both renderGisPinDetailMapSvg and the browser aerial tile stitcher for 0 px alignment error.
 */
export function computePinMapViewport(inp, spatial, options = {}) {
  const mapX = options.mapX ?? 24;
  const mapY = options.mapY ?? 44;
  const mapW = options.mapW ?? 582;
  const mapH = options.mapH ?? 408;
  const validPins = extractValidPins(inp);
  if (!validPins.length) return null;

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const p of validPins) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }

  const midLat = (minLat + maxLat) / 2;
  const midLon = (minLon + maxLon) / 2;
  const mPerDegLat = 111132;
  const mPerDegLon = 111320 * Math.cos((midLat * Math.PI) / 180);

  const rawSpanLonM = (maxLon - minLon) * mPerDegLon;
  const rawSpanLatM = (maxLat - minLat) * mPerDegLat;
  const baseSpanM = Math.max(rawSpanLonM, rawSpanLatM);
  // Generous tight framing: minimum 56 m across so single/clustered fixtures + footprints have clear context
  const padM = Math.max(18, baseSpanM * 0.34);
  let targetWM = Math.max(58, rawSpanLonM + padM * 2);
  let targetHM = Math.max(42, rawSpanLatM + padM * 2);

  // Match exact map frame aspect ratio (mapW / mapH) with zero letterboxing so aerial tiles fill edge-to-edge
  const aspect = mapW / mapH;
  if (targetWM / targetHM < aspect) {
    targetWM = targetHM * aspect;
  } else {
    targetHM = targetWM / aspect;
  }

  const halfLon = targetWM / 2 / mPerDegLon;
  const halfLat = targetHM / 2 / mPerDegLat;
  const viewMinLon = midLon - halfLon;
  const viewMaxLon = midLon + halfLon;
  const viewMinLat = midLat - halfLat;
  const viewMaxLat = midLat + halfLat;

  const mercMinX = lonToMercX(viewMinLon);
  const mercMaxX = lonToMercX(viewMaxLon);
  const mercMinY = latToMercY(viewMaxLat); // north = smaller mercY
  const mercMaxY = latToMercY(viewMinLat); // south = larger mercY
  const mercSpanX = Math.max(1e-12, mercMaxX - mercMinX);
  const mercSpanY = Math.max(1e-12, mercMaxY - mercMinY);

  // Choose ideal slippy tile zoom level (~1.4x retina resolution)
  const worldPxNeeded = (mapW * 1.35) / mercSpanX;
  const idealZoom = Math.max(14, Math.min(19, Math.round(Math.log2(worldPxNeeded / 256))));
  const scalePxPerM = mapW / targetWM;

  const proj = (lon, lat) => [
    mapX + ((lonToMercX(lon) - mercMinX) / mercSpanX) * mapW,
    mapY + ((latToMercY(lat) - mercMinY) / mercSpanY) * mapH,
  ];

  return {
    pins: validPins,
    midLat,
    midLon,
    viewMinLon: mercXToLon(mercMinX),
    viewMaxLon: mercXToLon(mercMaxX),
    viewMinLat: mercYToLat(mercMaxY),
    viewMaxLat: mercYToLat(mercMinY),
    mercMinX,
    mercMaxX,
    mercMinY,
    mercMaxY,
    targetWM,
    targetHM,
    scalePxPerM,
    zoom: idealZoom,
    mapX,
    mapY,
    mapW,
    mapH,
    proj,
  };
}

/** 6. Browser-Rendered GDA2020 / MGA Zone 56 Whole-Parcel Site Location & Constraints Map (Drawing 1 — Clean Locality, No Pin Clutter) */
export function renderGisSiteMapSvg(inp, spatial, options = {}) {
  const drawingCode = options.drawingCode || "OSSM-GIS-01";
  const detailCode = options.detailDrawingCode || (drawingCode.startsWith("SEE") ? "SEE-GIS-02" : "OSSM-GIS-02");
  const submissionLabel = options.submissionLabel || "S68 SUBMISSION";
  const W = 820, H = 560;
  const mapX = 56, mapY = 44, mapW = 738, mapH = 408;

  if (!spatial || !spatial.parcel_geojson) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#f8fafc; border:1px solid #cbd5e1; font-family:Inter,sans-serif;">
      <text x="${W / 2}" y="${H / 2 - 10}" text-anchor="middle" font-size="14" font-weight="800" fill="#143628">
        SITE LOCATION MAP — Lot ${esc(inp.lot_number)} ${esc(inp.plan_label)} (${esc(inp.site_address)})
      </text>
      <text x="${W / 2}" y="${H / 2 + 16}" text-anchor="middle" font-size="11" fill="#52635c">
        Live NSW Spatial Services cadastre &amp; watercourse map pending spatial lookup (${esc(drawingCode)}).
      </text>
    </svg>`;
  }

  const coordsOf = (geom) => {
    if (!geom) return [];
    if (geom.type === "Polygon") return geom.coordinates;
    if (geom.type === "MultiPolygon") return geom.coordinates.flat();
    if (geom.type === "LineString") return [geom.coordinates];
    if (geom.type === "MultiLineString") return geom.coordinates;
    return [];
  };

  const subjRings = coordsOf(spatial.parcel_geojson.geometry);
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of subjRings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  const midLat = (minLat + maxLat) / 2;
  const mPerDegLat = 111132;
  const mPerDegLon = 111320 * Math.cos((midLat * Math.PI) / 180);

  const spanLonM = Math.max(80, (maxLon - minLon) * mPerDegLon);
  const spanLatM = Math.max(80, (maxLat - minLat) * mPerDegLat);
  const padM = Math.max(spanLonM, spanLatM) * 0.35;

  const viewMinLon = minLon - padM / mPerDegLon;
  const viewMaxLon = maxLon + padM / mPerDegLon;
  const viewMinLat = minLat - padM / mPerDegLat;
  const viewMaxLat = maxLat + padM / mPerDegLat;

  const viewWM = (viewMaxLon - viewMinLon) * mPerDegLon;
  const viewHM = (viewMaxLat - viewMinLat) * mPerDegLat;
  const scale = Math.min(mapW / viewWM, mapH / viewHM);
  const usedW = viewWM * scale;
  const usedH = viewHM * scale;
  const offX = mapX + (mapW - usedW) / 2;
  const offY = mapY + (mapH - usedH) / 2;

  const proj = (lon, lat) => [
    offX + (lon - viewMinLon) * mPerDegLon * scale,
    offY + (viewMaxLat - lat) * mPerDegLat * scale,
  ];

  const polyPath = (rings) =>
    rings
      .map((ring) =>
        ring
          .map(([lo, la], idx) => {
            const [x, y] = proj(lo, la);
            return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ") + " Z",
      )
      .join(" ");

  const linePath = (lines) =>
    lines
      .map((line) =>
        line
          .map(([lo, la], idx) => {
            const [x, y] = proj(lo, la);
            return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" "),
      )
      .join(" ");

  // Neighbouring parcels
  let nbSvg = "";
  for (const nf of spatial.neighbour_parcels_geojson || []) {
    const rings = coordsOf(nf.geometry);
    if (!rings.length) continue;
    nbSvg += `<path d="${polyPath(rings)}" fill="#ffffff" stroke="#94a3b8" stroke-width="0.9" />`;
    const r0 = rings[0];
    let sx = 0, sy = 0;
    for (const [lo, la] of r0) { sx += lo; sy += la; }
    const [lx, ly] = proj(sx / r0.length, sy / r0.length);
    if (lx > mapX + 20 && lx < mapX + mapW - 20 && ly > mapY + 14 && ly < mapY + mapH - 14) {
      const p = nf.properties || {};
      nbSvg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="8" fill="#475569">Lot ${esc(p.lotnumber || "")} ${esc(p.planlabel || "")}</text>`;
    }
  }

  // Contours (index contours every 50 m drawn bolder + subtle elevation labels)
  let contSvg = "";
  const placedElevPts = [];
  for (const cf of spatial.contours_geojson || []) {
    const lines = coordsOf(cf.geometry);
    if (!lines.length) continue;
    const elev = Number(cf.properties?.elevation);
    const isIndex = Number.isFinite(elev) && elev % 50 === 0;
    contSvg += `<path d="${linePath(lines)}" fill="none" stroke="${isIndex ? "#a68a64" : "#cbb89d"}" stroke-width="${isIndex ? "1.15" : "0.7"}" opacity="${isIndex ? "0.9" : "0.75"}" />`;
    if (Number.isFinite(elev) && lines[0]?.length >= 2) {
      const midPt = lines[0][Math.floor(lines[0].length / 2)];
      const [ex, ey] = proj(midPt[0], midPt[1]);
      if (
        ex > mapX + 34 &&
        ex < mapX + mapW - 224 &&
        ey > mapY + 40 &&
        ey < mapY + mapH - 36 &&
        placedElevPts.every(([px, py]) => Math.hypot(ex - px, ey - py) > 54)
      ) {
        placedElevPts.push([ex, ey]);
        contSvg += `<text x="${ex.toFixed(1)}" y="${ey.toFixed(1)}" text-anchor="middle" font-size="6.8" font-weight="${isIndex ? "800" : "600"}" fill="#7c5d3b" stroke="#ffffff" stroke-width="2.2" paint-order="stroke">${Math.round(elev)}m</text>`;
      }
    }
  }

  // Watercourses + 40 m gully & 100 m perennial watercourse buffer halos
  const buf40StrokePx = Math.max(4, Math.min(55, 80 * scale));
  const buf100StrokePx = Math.max(8, Math.min(110, 200 * scale));
  let wcBuf100Svg = "", wcBufSvg = "", wcLineSvg = "";
  for (const wf of spatial.watercourses_geojson || []) {
    const lines = coordsOf(wf.geometry);
    if (!lines.length) continue;
    const d = linePath(lines);
    wcBuf100Svg += `<path d="${d}" fill="none" stroke="#bfdbfe" stroke-width="${buf100StrokePx.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.22" />`;
    wcBufSvg += `<path d="${d}" fill="none" stroke="#60a5fa" stroke-width="${buf40StrokePx.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.34" />`;
    wcLineSvg += `<path d="${d}" fill="none" stroke="#1d4ed8" stroke-width="1.8" stroke-linecap="round" />`;
  }

  // Detail Area Extent Indicator Box (when GPS pins exist, show clean dashed key-plan box instead of cramped pins)
  const pinVp = computePinMapViewport(inp, spatial);
  let detailExtentSvg = "";
  const hasDetailExtent = Boolean(pinVp);
  if (pinVp) {
    const [dx1, dy1] = proj(pinVp.viewMinLon, pinVp.viewMaxLat);
    const [dx2, dy2] = proj(pinVp.viewMaxLon, pinVp.viewMinLat);
    const dCx = (dx1 + dx2) / 2;
    const dCy = (dy1 + dy2) / 2;
    const dW = Math.max(26, Math.abs(dx2 - dx1));
    const dH = Math.max(20, Math.abs(dy2 - dy1));
    const bx = Math.max(mapX + 10, Math.min(mapX + mapW - dW - 10, dCx - dW / 2));
    const by = Math.max(mapY + 38, Math.min(mapY + mapH - dH - 22, dCy - dH / 2));
    const tagText = `DETAIL AREA — SEE ${detailCode}`;
    const tagW = tagText.length * 4.9 + 12;
    const tagX = Math.max(mapX + 8, Math.min(mapX + mapW - tagW - 8, bx + dW / 2 - tagW / 2));
    const tagY = by - 19 >= mapY + 36 ? by - 19 : by + dH + 4;
    detailExtentSvg = `
      <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${dW.toFixed(1)}" height="${dH.toFixed(1)}" rx="3" fill="rgba(15,23,42,0.08)" stroke="#0f172a" stroke-width="1.8" stroke-dasharray="5,3" />
      <rect x="${tagX.toFixed(1)}" y="${tagY.toFixed(1)}" width="${tagW.toFixed(1)}" height="15" rx="3" fill="#0f172a" />
      <text x="${(tagX + tagW / 2).toFixed(1)}" y="${(tagY + 10.5).toFixed(1)}" text-anchor="middle" font-size="7.4" font-weight="800" fill="#ffffff">${esc(tagText)}</text>
    `;
  }

  // Triggered statutory overlay ribbon (top-left of map frame)
  const activeOverlays = [];
  if (spatial.drinking_water_catchment) activeOverlays.push("ROUS WATER");
  if (spatial.flood_planning) activeOverlays.push("FLOOD");
  if (spatial.bushfire_prone_land?.length) activeOverlays.push("BUSHFIRE");
  if (spatial.acid_sulfate_soils?.length) activeOverlays.push("ASS");
  if (spatial.riparian_land || spatial.wetlands) activeOverlays.push("RIPARIAN");
  if (spatial.terrestrial_biodiversity) activeOverlays.push("BIODIVERSITY");
  const overlayBannerW = activeOverlays.length ? Math.min(440, 128 + activeOverlays.join(" · ").length * 5.3) : 0;
  const overlayBannerSvg = activeOverlays.length
    ? `<rect x="${mapX + 10}" y="${mapY + 10}" width="${overlayBannerW}" height="22" rx="5" fill="rgba(254,243,199,0.95)" stroke="#b45309" stroke-width="1" />
       <text x="${mapX + 18}" y="${mapY + 24}" font-size="8.2" font-weight="800" fill="#92400e">ACTIVE OVERLAYS: ${esc(activeOverlays.join(" · "))}</text>`
    : "";

  const legendW = 208;
  const legendX = mapX + mapW - legendW - 10;
  const legendY = mapY + 10;
  const legendH = hasDetailExtent ? 114 : 98;

  // Subject parcel + centroid pill (shown cleanly when no Detail Extent box occupies the center)
  const subjD = polyPath(subjRings);
  const [cx, cy] = proj(spatial.centroid_lon || (minLon + maxLon) / 2, spatial.centroid_lat || (minLat + maxLat) / 2);

  // Nice metric scale bar
  const targetM = (mapW / scale) * 0.22;
  const barM = [20, 50, 100, 200, 250, 500, 1000].reduce((a, b) => (Math.abs(b - targetM) < Math.abs(a - targetM) ? b : a));
  const barPx = barM * scale;
  const zoningStr = (spatial.land_zoning || []).join(", ") || "Verify LEP";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#ffffff; font-family:Inter,sans-serif;">
    <defs>
      <clipPath id="gisClip"><rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" /></clipPath>
    </defs>

    <text x="${W / 2}" y="26" text-anchor="middle" font-size="13" font-weight="800" fill="#0d241b">
      SITE LOCATION &amp; ENVIRONMENTAL CONSTRAINTS MAP — ${esc(inp.site_address)} (Lot ${esc(inp.lot_number)} ${esc(inp.plan_label)})
    </text>

    <rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" fill="#f8fafc" stroke="#1e293b" stroke-width="1.4" />
    <g clip-path="url(#gisClip)">
      ${nbSvg}
      ${contSvg}
      <path d="${subjD}" fill="#fecaca" fill-opacity="0.52" stroke="#991b1b" stroke-width="2.4" />
      ${wcBuf100Svg}
      ${wcBufSvg}
      ${wcLineSvg}
      ${!hasDetailExtent ? `<rect x="${(cx - 64).toFixed(1)}" y="${(cy - 22).toFixed(1)}" width="128" height="44" rx="6" fill="rgba(255,255,255,0.92)" stroke="#991b1b" stroke-width="1.2" />
      <text x="${cx.toFixed(1)}" y="${(cy - 7).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#7f1d1d">SUBJECT LOT</text>
      <text x="${cx.toFixed(1)}" y="${(cy + 6).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#7f1d1d">Lot ${esc(inp.lot_number)} ${esc(inp.plan_label)}</text>
      <text x="${cx.toFixed(1)}" y="${(cy + 17).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#7f1d1d">(${(spatial.parcel_area_ha || inp.block_size_m2 / 10000).toFixed(2)} ha)</text>` : ""}
      ${detailExtentSvg}
    </g>
    ${overlayBannerSvg}

    <!-- Legend box -->
    <rect x="${legendX}" y="${legendY}" width="${legendW}" height="${legendH}" rx="6" fill="rgba(255,255,255,0.95)" stroke="#cbd5e1" stroke-width="1" />
    <rect x="${legendX + 10}" y="${legendY + 10}" width="16" height="10" fill="#fecaca" stroke="#991b1b" stroke-width="1.5" />
    <text x="${legendX + 32}" y="${legendY + 19}" font-size="8.4" fill="#1e293b">Subject Lot (${esc(inp.lot_number)}/${esc(inp.plan_label)})</text>
    <rect x="${legendX + 10}" y="${legendY + 26}" width="16" height="10" fill="#ffffff" stroke="#94a3b8" stroke-width="1" />
    <text x="${legendX + 32}" y="${legendY + 35}" font-size="8.4" fill="#1e293b">Adjoining Cadastre</text>
    <line x1="${legendX + 10}" y1="${legendY + 47}" x2="${legendX + 26}" y2="${legendY + 47}" stroke="#1d4ed8" stroke-width="2" />
    <text x="${legendX + 32}" y="${legendY + 51}" font-size="8.4" fill="#1e293b">Mapped Watercourse</text>
    <rect x="${legendX + 10}" y="${legendY + 59}" width="16" height="10" fill="#60a5fa" opacity="0.45" stroke="#2563eb" stroke-dasharray="2,2" />
    <text x="${legendX + 32}" y="${legendY + 68}" font-size="8.4" fill="#1e293b">40 m Gully / 100 m Stream Halo</text>
    <line x1="${legendX + 10}" y1="${legendY + 81}" x2="${legendX + 26}" y2="${legendY + 81}" stroke="#cbd5e1" stroke-width="1.3" />
    <text x="${legendX + 32}" y="${legendY + 84}" font-size="8.4" fill="#1e293b">NSW Elevation Contours</text>
    ${hasDetailExtent ? `<rect x="${legendX + 10}" y="${legendY + 94}" width="16" height="10" fill="rgba(15,23,42,0.08)" stroke="#0f172a" stroke-width="1.4" stroke-dasharray="3,2" />
    <text x="${legendX + 32}" y="${legendY + 103}" font-size="8.4" font-weight="700" fill="#0f172a">Detail Plan (${esc(detailCode)})</text>` : ""}

    <!-- Scale bar -->
    <g transform="translate(${mapX + 16}, ${mapY + mapH - 28})">
      <rect x="0" y="6" width="${(barPx / 2).toFixed(1)}" height="8" fill="#1e293b" stroke="#1e293b" />
      <rect x="${(barPx / 2).toFixed(1)}" y="6" width="${(barPx / 2).toFixed(1)}" height="8" fill="#ffffff" stroke="#1e293b" />
      <text x="0" y="3" font-size="8.5" font-weight="700" fill="#0f172a">0</text>
      <text x="${(barPx / 2).toFixed(1)}" y="3" text-anchor="middle" font-size="8.5" font-weight="700" fill="#0f172a">${barM / 2}</text>
      <text x="${barPx.toFixed(1)}" y="3" text-anchor="middle" font-size="8.5" font-weight="700" fill="#0f172a">${barM} m</text>
    </g>

    <!-- North arrow -->
    <g transform="translate(${mapX + mapW - 34}, ${mapY + mapH - 54})">
      <line x1="0" y1="34" x2="0" y2="8" stroke="#0f172a" stroke-width="2.4" />
      <polygon points="0,0 -6,12 6,12" fill="#0f172a" />
      <text x="0" y="-4" text-anchor="middle" font-size="11" font-weight="800" fill="#0f172a">N</text>
    </g>

    <!-- Formal Title Block Footer -->
    <rect x="${mapX}" y="468" width="${mapW}" height="74" fill="#f7f5ef" stroke="#143628" stroke-width="1.3" />
    <line x1="${mapX + 275}" y1="468" x2="${mapX + 275}" y2="542" stroke="#143628" stroke-width="0.9" />
    <line x1="${mapX + 520}" y1="468" x2="${mapX + 520}" y2="542" stroke="#143628" stroke-width="0.9" />

    <text x="${mapX + 10}" y="485" font-size="8.5" font-weight="800" fill="#143628">PROJECT &amp; SITE DETAILS</text>
    <text x="${mapX + 10}" y="502" font-size="8.5" fill="#1e293b">Site: ${esc(inp.site_address)}</text>
    <text x="${mapX + 10}" y="517" font-size="8.5" fill="#1e293b">Lot/DP: Lot ${esc(inp.lot_number)} ${esc(inp.plan_label)}  |  LGA: ${esc(inp.lga)}</text>
    <text x="${mapX + 10}" y="532" font-size="8.2" fill="#334155">Applicant: ${esc(inp.applicant_name)}  |  Zone: ${esc(zoningStr)}</text>

    <text x="${mapX + 285}" y="485" font-size="8.5" font-weight="800" fill="#143628">SPATIAL METADATA &amp; DATUM</text>
    <text x="${mapX + 285}" y="502" font-size="8.3" fill="#1e293b">Datum: GDA2020 / MGA Zone 56 (EPSG:7856)</text>
    <text x="${mapX + 285}" y="517" font-size="8.0" fill="#334155">Centroid: E ${Math.round(spatial.centroid_easting_mga56 || 0)}, N ${Math.round(spatial.centroid_northing_mga56 || 0)}</text>
    <text x="${mapX + 285}" y="532" font-size="7.6" fill="#475569">Source: NSW Spatial Services &amp; Planning Portal</text>

    <text x="${mapX + 530}" y="485" font-size="8.5" font-weight="800" fill="#143628">PREPARED BY</text>
    <text x="${mapX + 530}" y="502" font-size="8.3" fill="#1e293b">${esc(inp.consultant?.name || "Field To Forest")}</text>
    <text x="${mapX + 530}" y="517" font-size="8.3" fill="#1e293b">Ref: ${esc(inp.project_ref)}  |  Date: ${esc(inp.site_eval?.assessment_date || "")}</text>
    <text x="${mapX + 530}" y="532" font-size="8.3" font-weight="800" fill="#991b1b">Drawing: ${esc(drawingCode)}  |  ${esc(submissionLabel)}</text>
  </svg>`;
}

/** 6b. Zoomed Exact-GPS Infrastructure & Site Features Map (Drawing 2 — Zero Pin Labels, Dedicated Side Legend, Vector or Aerial Backdrop) */
export function renderGisPinDetailMapSvg(inp, spatial, options = {}) {
  const drawingCode = options.drawingCode || "OSSM-GIS-02";
  const submissionLabel = options.submissionLabel || "S68 SUBMISSION";
  const W = 820, H = 560;
  const mapX = 24, mapY = 44, mapW = 582, mapH = 408;
  const legX = 616, legY = 44, legW = 180, legH = 408;

  const vp = computePinMapViewport(inp, spatial, { mapX, mapY, mapW, mapH });
  if (!vp) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#f8fafc; border:1px solid #cbd5e1; font-family:Inter,sans-serif;">
      <text x="${W / 2}" y="${H / 2 - 10}" text-anchor="middle" font-size="13.5" font-weight="800" fill="#143628">
        INFRASTRUCTURE &amp; GPS FEATURE PLAN (${esc(drawingCode)})
      </text>
      <text x="${W / 2}" y="${H / 2 + 16}" text-anchor="middle" font-size="10.5" fill="#52635c">
        Place one or more GPS pins on the Interactive Map Studio to generate this site features plan.
      </text>
    </svg>`;
  }

  const isAerial = options.backdropMode === "aerial" && Boolean(options.aerialDataUrl);
  const { proj, scalePxPerM: scale } = vp;

  const coordsOf = (geom) => {
    if (!geom) return [];
    if (geom.type === "Polygon") return geom.coordinates;
    if (geom.type === "MultiPolygon") return geom.coordinates.flat();
    if (geom.type === "LineString") return [geom.coordinates];
    if (geom.type === "MultiLineString") return geom.coordinates;
    return [];
  };
  const polyPath = (rings) =>
    rings
      .map((ring) =>
        ring
          .map(([lo, la], idx) => {
            const [x, y] = proj(lo, la);
            return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ") + " Z",
      )
      .join(" ");
  const linePath = (lines) =>
    lines
      .map((line) =>
        line
          .map(([lo, la], idx) => {
            const [x, y] = proj(lo, la);
            return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" "),
      )
      .join(" ");

  // Subtle vector grid in clean vector mode
  let gridSvg = "";
  if (!isAerial) {
    const gridStepM = vp.targetWM > 160 ? 50 : vp.targetWM > 75 ? 20 : 10;
    const stepPx = gridStepM * scale;
    if (stepPx >= 24) {
      for (let gx = mapX + stepPx; gx < mapX + mapW - 4; gx += stepPx) {
        gridSvg += `<line x1="${gx.toFixed(1)}" y1="${mapY}" x2="${gx.toFixed(1)}" y2="${mapY + mapH}" stroke="#e2e8f0" stroke-width="0.6" />`;
      }
      for (let gy = mapY + stepPx; gy < mapY + mapH - 4; gy += stepPx) {
        gridSvg += `<line x1="${mapX}" y1="${gy.toFixed(1)}" x2="${mapX + mapW}" y2="${gy.toFixed(1)}" stroke="#e2e8f0" stroke-width="0.6" />`;
      }
    }
  }

  // Adjoining parcels, contours, watercourses & subject parcel boundary
  let nbSvg = "", contSvg = "", wcBuf100Svg = "", wcBufSvg = "", wcLineSvg = "", subjSvg = "";
  if (spatial) {
    for (const nf of spatial.neighbour_parcels_geojson || []) {
      const rings = coordsOf(nf.geometry);
      if (rings.length) {
        nbSvg += `<path d="${polyPath(rings)}" fill="${isAerial ? "none" : "#ffffff"}" stroke="${isAerial ? "rgba(255,255,255,0.55)" : "#cbd5e1"}" stroke-width="1" />`;
      }
    }
    const placedDetailElevs = [];
    for (const cf of spatial.contours_geojson || []) {
      const lines = coordsOf(cf.geometry);
      if (!lines.length) continue;
      const elev = Number(cf.properties?.elevation);
      const isIndex = Number.isFinite(elev) && elev % 50 === 0;
      const strokeCol = isAerial
        ? (isIndex ? "rgba(253,230,138,0.82)" : "rgba(253,230,138,0.48)")
        : (isIndex ? "#a68a64" : "#cbb89d");
      contSvg += `<path d="${linePath(lines)}" fill="none" stroke="${strokeCol}" stroke-width="${isIndex ? "1.35" : "0.85"}" />`;
      if (Number.isFinite(elev)) {
        for (const line of lines) {
          if (line.length < 2) continue;
          const midPt = line[Math.floor(line.length / 2)];
          const [ex, ey] = proj(midPt[0], midPt[1]);
          if (
            ex > mapX + 24 &&
            ex < mapX + mapW - 24 &&
            ey > mapY + 20 &&
            ey < mapY + mapH - 42 &&
            placedDetailElevs.every(([px, py]) => Math.hypot(ex - px, ey - py) > 58)
          ) {
            placedDetailElevs.push([ex, ey]);
            contSvg += `<text x="${ex.toFixed(1)}" y="${ey.toFixed(1)}" text-anchor="middle" font-size="7.2" font-weight="700" fill="${isAerial ? "#fef08a" : "#7c5d3b"}" stroke="${isAerial ? "rgba(15,23,42,0.82)" : "#ffffff"}" stroke-width="2.4" paint-order="stroke">${Math.round(elev)}m</text>`;
            break;
          }
        }
      }
    }
    if (spatial.parcel_geojson?.geometry) {
      const subjRings = coordsOf(spatial.parcel_geojson.geometry);
      if (subjRings.length) {
        subjSvg = `<path d="${polyPath(subjRings)}" fill="${isAerial ? "rgba(254,202,202,0.08)" : "rgba(254,202,202,0.22)"}" stroke="${isAerial ? "#f87171" : "#991b1b"}" stroke-width="2.2" stroke-dasharray="7,3" />`;
      }
    }
    const buf40Px = Math.max(4, Math.min(260, 80 * scale));
    const buf100Px = Math.max(8, Math.min(520, 200 * scale));
    for (const wf of spatial.watercourses_geojson || []) {
      const lines = coordsOf(wf.geometry);
      if (!lines.length) continue;
      const d = linePath(lines);
      wcBuf100Svg += `<path d="${d}" fill="none" stroke="#93c5fd" stroke-width="${buf100Px.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="${isAerial ? "0.14" : "0.18"}" />`;
      wcBufSvg += `<path d="${d}" fill="none" stroke="#38bdf8" stroke-width="${buf40Px.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="${isAerial ? "0.22" : "0.28"}" />`;
      wcLineSvg += `<path d="${d}" fill="none" stroke="${isAerial ? "#38bdf8" : "#1d4ed8"}" stroke-width="2.2" stroke-linecap="round" />`;
    }
  }

  // Scaled true-size footprints + Exact-GPS Custom SVG Pins (ZERO text labels, ZERO artificial nudging)
  const model = options.model || null;
  let footprintsSvg = "";
  let pinsSvg = "";
  let hasFootprints = false;
  const typeCounts = new Map();

  for (const item of vp.pins) {
    const { pin, spec, lon, lat } = item;
    const [px, py] = proj(lon, lat);
    typeCounts.set(pin.feature_type, (typeCounts.get(pin.feature_type) || 0) + 1);

    // True-to-scale footprint rectangle beneath area features
    let lM = pin.length_m ? Number(pin.length_m) : 0;
    let wM = pin.width_m ? Number(pin.width_m) : 0;
    if ((!lM || !wM) && model) {
      const tr = model.trench_layout || {};
      if (pin.feature_type === "eta_bed" || pin.feature_type === "reserve_laa") {
        lM = Number(tr.trench_length_m || 0);
        const nTr = Math.max(1, Number(tr.number_of_trenches || 1));
        wM = nTr * Number(tr.trench_width_m || 2) + (nTr - 1) * Number(tr.trench_separation_m || 0);
      } else if (pin.feature_type === "reed_bed" && (model.recommended_reed_bed_count || 0) > 0) {
        const d = resolveReedBedDims(model, inp);
        const nRb = Math.max(1, Number(model.recommended_reed_bed_count || 1));
        lM = nRb * Number(d.length_m || 3.0) + (nRb - 1) * 0.5;
        wM = Number(d.width_m || 1.9);
      } else if (pin.feature_type === "septic_tank") {
        lM = 2.6;
        wM = 1.6;
      } else if (pin.feature_type === "grease_arrestor") {
        lM = 1.8;
        wM = 1.2;
      }
    }
    const fw = lM * scale;
    const fh = wM * scale;
    if (fw >= 6 || fh >= 6) {
      hasFootprints = true;
      const rot = Number(pin.rotation_deg || 0);
      const dash = pin.feature_type === "reserve_laa" ? ' stroke-dasharray="5,3"' : "";
      footprintsSvg += `<rect x="${(px - fw / 2).toFixed(1)}" y="${(py - fh / 2).toFixed(1)}" width="${Math.max(5, fw).toFixed(1)}" height="${Math.max(5, fh).toFixed(1)}" rx="2" fill="${spec.color}" fill-opacity="${isAerial ? "0.34" : "0.20"}" stroke="${isAerial ? "#ffffff" : spec.color}" stroke-width="${isAerial ? "2.0" : "1.5"}"${dash} transform="rotate(${rot.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)})" />`;
    }

    // Exact GPS symbol (scaled cleanly for zoomed plan)
    const symScale = vp.pins.length > 8 ? 0.86 : 0.96;
    pinsSvg += `<g transform="translate(${px.toFixed(1)}, ${py.toFixed(1)}) scale(${symScale.toFixed(2)})">${renderPinGlyphInner(pin.feature_type)}</g>`;
  }

  // Metric Scale Bar tailored for zoomed extent (5 m, 10 m, 20 m, 25 m, 50 m, 100 m)
  const targetBarM = (mapW / scale) * 0.24;
  const barM = [5, 10, 20, 25, 50, 100, 200].reduce((a, b) => (Math.abs(b - targetBarM) < Math.abs(a - targetBarM) ? b : a));
  const barPx = barM * scale;

  // Dedicated Right-Hand Legend Panel using actual custom pin labels (deduplicating identical type+label pairs)
  const legendEntries = [];
  const legendKeyMap = new Map();
  for (const item of vp.pins) {
    const ft = item.pin.feature_type;
    const rawLbl = String(item.pin.label || item.spec.label || ft).trim();
    const k = `${ft}::${rawLbl.toLowerCase()}`;
    if (legendKeyMap.has(k)) {
      legendKeyMap.get(k).count += 1;
    } else {
      const entry = { ft, label: rawLbl, count: 1 };
      legendKeyMap.set(k, entry);
      legendEntries.push(entry);
    }
  }

  const maxVisibleRows = 15;
  const visibleEntries = legendEntries.slice(0, maxVisibleRows);
  const overflowCount = legendEntries.length - visibleEntries.length;
  const totalSlots = visibleEntries.length + (overflowCount > 0 ? 1 : 0);
  const legRowStep = totalSlots > 10 ? Math.max(14, Math.floor(228 / totalSlots)) : 22;
  const legSymScale = legRowStep < 16 ? 0.42 : legRowStep < 20 ? 0.50 : 0.60;
  const legFontSize = legRowStep < 16 ? 7.3 : legRowStep < 20 ? 7.9 : 8.4;
  const maxChars = legFontSize <= 7.5 ? 25 : 22;
  let legRowsSvg = "";
  let curY = legY + 33;
  for (const ent of visibleEntries) {
    const countTxt = ent.count > 1 ? ` (×${ent.count})` : "";
    const fullLbl = `${ent.label}${countTxt}`;
    const shownLbl = fullLbl.length > maxChars ? `${fullLbl.slice(0, maxChars - 1)}…` : fullLbl;
    legRowsSvg += `
      <g transform="translate(${legX + 19}, ${curY}) scale(${legSymScale.toFixed(2)})">${renderPinGlyphInner(ent.ft)}</g>
      <text x="${legX + 34}" y="${(curY + 3.0).toFixed(1)}" font-size="${legFontSize}" font-weight="700" fill="#0f172a">${esc(shownLbl)}</text>
    `;
    curY += legRowStep;
  }
  if (overflowCount > 0) {
    legRowsSvg += `<text x="${legX + 14}" y="${(curY + 2).toFixed(1)}" font-size="7.4" font-style="italic" fill="#475569">+ ${overflowCount} more (see schedule)</text>`;
    curY += legRowStep;
  }

  const ctxStartY = Math.max(curY + 6, legY + legH - 134);
  const backdropLabel = isAerial ? (options.aerialAttribution || "Aerial Imagery Backdrop") : "Vector GIS / CAD Backdrop";
  const zoningStr = (spatial?.land_zoning || []).join(", ") || "Verify LEP";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#ffffff; font-family:Inter,sans-serif;">
    <defs>
      <clipPath id="pinDetailClip"><rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" /></clipPath>
    </defs>

    <text x="${W / 2}" y="26" text-anchor="middle" font-size="13" font-weight="800" fill="#0d241b">
      INFRASTRUCTURE &amp; GPS FEATURE PLAN — ${esc(inp.site_address)} (Lot ${esc(inp.lot_number)} ${esc(inp.plan_label)})
    </text>

    <!-- Map Canvas -->
    <rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" fill="${isAerial ? "#1a2420" : "#f8fafc"}" stroke="#1e293b" stroke-width="1.4" />
    <g clip-path="url(#pinDetailClip)">
      ${isAerial ? `<image href="${esc(options.aerialDataUrl)}" x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" preserveAspectRatio="none" />` : ""}
      ${gridSvg}
      ${nbSvg}
      ${contSvg}
      ${subjSvg}
      ${wcBuf100Svg}
      ${wcBufSvg}
      ${wcLineSvg}
      ${footprintsSvg}
      ${pinsSvg}
    </g>

    <!-- Scale bar (bottom-left with pill backing for aerial contrast) -->
    <g transform="translate(${mapX + 12}, ${mapY + mapH - 34})">
      <rect x="-6" y="-8" width="${(barPx + 24).toFixed(1)}" height="30" rx="5" fill="rgba(255,255,255,0.92)" stroke="#cbd5e1" stroke-width="0.8" />
      <rect x="0" y="8" width="${(barPx / 2).toFixed(1)}" height="7" fill="#0f172a" stroke="#0f172a" />
      <rect x="${(barPx / 2).toFixed(1)}" y="8" width="${(barPx / 2).toFixed(1)}" height="7" fill="#ffffff" stroke="#0f172a" />
      <text x="0" y="4" font-size="8.2" font-weight="700" fill="#0f172a">0</text>
      <text x="${(barPx / 2).toFixed(1)}" y="4" text-anchor="middle" font-size="8.2" font-weight="700" fill="#0f172a">${barM / 2}</text>
      <text x="${barPx.toFixed(1)}" y="4" text-anchor="middle" font-size="8.2" font-weight="700" fill="#0f172a">${barM} m</text>
    </g>

    <!-- Dedicated Right-Hand Legend Panel (Zero Pin Overlap) -->
    <rect x="${legX}" y="${legY}" width="${legW}" height="${legH}" rx="6" fill="#f8fafc" stroke="#1e293b" stroke-width="1.2" />
    <rect x="${legX}" y="${legY}" width="${legW}" height="22" rx="5" fill="#143628" />
    <text x="${legX + legW / 2}" y="${legY + 14.5}" text-anchor="middle" font-size="8.8" font-weight="800" fill="#ffffff">FEATURE LEGEND (${vp.pins.length} PINS)</text>

    ${legRowsSvg}

    <line x1="${legX + 10}" y1="${ctxStartY - 8}" x2="${legX + legW - 10}" y2="${ctxStartY - 8}" stroke="#cbd5e1" stroke-width="1" />
    <text x="${legX + 10}" y="${ctxStartY + 4}" font-size="7.8" font-weight="800" fill="#143628">MAP LAYERS &amp; ORIENTATION</text>
    <line x1="${legX + 10}" y1="${ctxStartY + 18}" x2="${legX + 26}" y2="${ctxStartY + 18}" stroke="#991b1b" stroke-width="2" stroke-dasharray="4,2" />
    <text x="${legX + 32}" y="${ctxStartY + 21}" font-size="7.8" fill="#334155">Lot Boundary</text>
    ${hasFootprints ? `<rect x="${legX + 10}" y="${ctxStartY + 29}" width="16" height="9" fill="#1d4ed8" fill-opacity="0.22" stroke="#1d4ed8" stroke-width="1.2" />
    <text x="${legX + 32}" y="${ctxStartY + 37}" font-size="7.8" fill="#334155">Scaled Design Footprint</text>` : ""}
    <line x1="${legX + 10}" y1="${ctxStartY + 49}" x2="${legX + 26}" y2="${ctxStartY + 49}" stroke="#1d4ed8" stroke-width="2" />
    <text x="${legX + 32}" y="${ctxStartY + 52}" font-size="7.8" fill="#334155">Watercourse / Buffers</text>
    <line x1="${legX + 10}" y1="${ctxStartY + 63}" x2="${legX + 26}" y2="${ctxStartY + 63}" stroke="#cbd5e1" stroke-width="1.2" />
    <text x="${legX + 32}" y="${ctxStartY + 66}" font-size="7.8" fill="#334155">Elevation Contours</text>

    <!-- North Arrow inside Legend -->
    <g transform="translate(${legX + legW / 2}, ${legY + legH - 42})">
      <line x1="0" y1="26" x2="0" y2="6" stroke="#0f172a" stroke-width="2.2" />
      <polygon points="0,-2 -5,9 5,9" fill="#0f172a" />
      <text x="0" y="-6" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a">N</text>
      <text x="0" y="36" text-anchor="middle" font-size="7.0" fill="#475569">Span: ~${Math.round(vp.targetWM)} m × ${Math.round(vp.targetHM)} m</text>
    </g>

    <!-- Formal Title Block Footer -->
    <rect x="${mapX}" y="468" width="${W - 48}" height="74" fill="#f7f5ef" stroke="#143628" stroke-width="1.3" />
    <line x1="${mapX + 286}" y1="468" x2="${mapX + 286}" y2="542" stroke="#143628" stroke-width="0.9" />
    <line x1="${mapX + 544}" y1="468" x2="${mapX + 544}" y2="542" stroke="#143628" stroke-width="0.9" />

    <text x="${mapX + 10}" y="485" font-size="8.5" font-weight="800" fill="#143628">DETAIL PLAN EXTENT</text>
    <text x="${mapX + 10}" y="502" font-size="8.5" fill="#1e293b">Site: ${esc(inp.site_address)}</text>
    <text x="${mapX + 10}" y="517" font-size="8.5" fill="#1e293b">Lot/DP: Lot ${esc(inp.lot_number)} ${esc(inp.plan_label)}  |  Zone: ${esc(zoningStr)}</text>
    <text x="${mapX + 10}" y="532" font-size="8.0" fill="#334155">Pins plotted at exact GDA2020 GPS coordinates (see schedule)</text>

    <text x="${mapX + 296}" y="485" font-size="8.5" font-weight="800" fill="#143628">PROJECTION &amp; BACKDROP</text>
    <text x="${mapX + 296}" y="502" font-size="8.2" fill="#1e293b">Datum: GDA2020 / MGA Zone 56 (EPSG:7856)</text>
    <text x="${mapX + 296}" y="517" font-size="8.0" fill="#334155">Window: ~${Math.round(vp.targetWM)} m × ${Math.round(vp.targetHM)} m (Exact GPS)</text>
    <text x="${mapX + 296}" y="532" font-size="7.6" fill="#475569">${esc(backdropLabel)}</text>

    <text x="${mapX + 554}" y="485" font-size="8.5" font-weight="800" fill="#143628">PREPARED BY</text>
    <text x="${mapX + 554}" y="502" font-size="8.3" fill="#1e293b">${esc(inp.consultant?.name || "Field To Forest")}</text>
    <text x="${mapX + 554}" y="517" font-size="8.3" fill="#1e293b">Ref: ${esc(inp.project_ref)}  |  Date: ${esc(inp.site_eval?.assessment_date || "")}</text>
    <text x="${mapX + 554}" y="532" font-size="8.3" font-weight="800" fill="#991b1b">Drawing: ${esc(drawingCode)}  |  ${esc(submissionLabel)}</text>
  </svg>`;
}

/** 8. LAA Sizing Drivers & Alstonville 1970-1991 Monthly Water Balance Chart (SVG) */
export function renderSizingAndWaterBalanceSvg(inp, model) {
  const W = 760, H = 310;
  const drivers = [
    { key: "Hydraulic", label: "Hydraulic (7,670-d)", val: Number(model.hydraulic_area_m2 || 0) },
    { key: "Nitrogen", label: "Nitrogen Balance", val: Number(model.nitrogen_area_m2 || 0) },
    { key: "Phosphorus", label: "Phosphorus (50-yr)", val: Number(model.phosphorus_area_m2 || 0) },
    { key: "Minimum Area Cap", label: "Minimum Area Cap", val: Number(model.area_cap_m2 || 0) },
  ];
  const maxVal = Math.max(10, ...drivers.map((d) => d.val));
  const barAreaX = 132, barMaxW = 160;
  let barsSvg = "";
  drivers.forEach((d, idx) => {
    const y = 78 + idx * 44;
    const isLim = d.key === model.limiting_factor;
    const bw = Math.max(3, (d.val / maxVal) * barMaxW);
    barsSvg += `
      <text x="${barAreaX - 8}" y="${y + 16}" text-anchor="end" font-size="9.2" font-weight="${isLim ? 800 : 600}" fill="${isLim ? "#0d241b" : "#334155"}">${esc(d.label)}</text>
      <rect x="${barAreaX}" y="${y}" width="${bw.toFixed(1)}" height="24" rx="4" fill="${isLim ? "#143628" : "#94a3b8"}" />
      <text x="${(barAreaX + bw + 6).toFixed(1)}" y="${y + 16}" font-size="9.2" font-weight="${isLim ? 800 : 600}" fill="${isLim ? "#143628" : "#475569"}">${d.val.toFixed(1)} m²${isLim ? " ★" : ""}</text>
    `;
  });

  // Right panel: Alstonville 1970-1991 monthly rainfall vs ET
  const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const rain = [194, 232, 239, 178, 152, 134, 88, 72, 64, 108, 136, 165];
  const et = [146, 121, 114, 89, 68, 56, 61, 79, 101, 123, 134, 151];
  const chartX = 416, chartY = 92, chartW = 312, chartH = 148;
  const maxMm = 260;
  const stepX = chartW / months.length;

  let climateBars = "";
  let etPts = "";
  months.forEach((m, i) => {
    const bx = chartX + i * stepX + 4;
    const bw = stepX - 8;
    const rh = (rain[i] / maxMm) * chartH;
    const ry = chartY + chartH - rh;
    const ex = chartX + i * stepX + stepX / 2;
    const ey = chartY + chartH - (et[i] / maxMm) * chartH;
    climateBars += `
      <rect x="${bx.toFixed(1)}" y="${ry.toFixed(1)}" width="${bw.toFixed(1)}" height="${rh.toFixed(1)}" fill="#93c5fd" stroke="#1d4ed8" stroke-width="0.8" />
      <text x="${ex.toFixed(1)}" y="${chartY + chartH + 14}" text-anchor="middle" font-size="8.4" fill="#475569">${m}</text>
    `;
    etPts += `${i === 0 ? "M" : "L"}${ex.toFixed(1)},${ey.toFixed(1)} `;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#ffffff; border:1px solid #d7dfd9; border-radius:8px; font-family:Inter,sans-serif;">
    <text x="${W / 2}" y="24" text-anchor="middle" font-size="13" font-weight="800" fill="#0d241b">
      OSMODEL300614 LAA SIZING DRIVERS &amp; ALSTONVILLE WATER BALANCE SUMMARY
    </text>
    <text x="${W / 2}" y="40" text-anchor="middle" font-size="9.5" fill="#52635c">
      Governing Factor: ${esc(model.limiting_factor)} (${model.required_laa_m2} m² LAA) · Flow: ${model.total_flow_ld} L/d · Actual Rate: ${model.daily_loading_rate_actual_mmd} mm/d vs Max ${model.max_deep_drainage_mmd} mm/d
    </text>

    <!-- Left panel -->
    <rect x="16" y="54" width="356" height="212" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
    <text x="28" y="71" font-size="9.6" font-weight="800" fill="#143628">1. AREA DETERMINATION (m²)</text>
    ${barsSvg}
    <text x="28" y="254" font-size="8.3" fill="#475569">★ Limiting factor governs LAA sizing (+ 100% Reserve = ${model.reserve_laa_m2} m²)</text>

    <!-- Right panel -->
    <rect x="386" y="54" width="358" height="212" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
    <text x="398" y="71" font-size="9.6" font-weight="800" fill="#143628">2. ALSTONVILLE RAINFALL vs. ET (1970–1991)</text>
    <line x1="${chartX}" y1="${chartY + chartH}" x2="${chartX + chartW}" y2="${chartY + chartH}" stroke="#475569" stroke-width="1.2" />
    <line x1="${chartX}" y1="${chartY}" x2="${chartX}" y2="${chartY + chartH}" stroke="#475569" stroke-width="1.2" />
    <text x="${chartX - 4}" y="${chartY + 6}" text-anchor="end" font-size="7.6" fill="#64748b">260</text>
    <text x="${chartX - 4}" y="${chartY + chartH / 2 + 3}" text-anchor="end" font-size="7.6" fill="#64748b">130</text>
    <text x="${chartX - 4}" y="${chartY + chartH}" text-anchor="end" font-size="7.6" fill="#64748b">0</text>
    ${climateBars}
    <path d="${etPts.trim()}" fill="none" stroke="#b45309" stroke-width="2.2" />
    <rect x="556" y="61" width="10" height="8" fill="#93c5fd" stroke="#1d4ed8" stroke-width="0.8" />
    <text x="570" y="68" font-size="8" fill="#334155">Mean Rain (mm)</text>
    <line x1="654" y1="65" x2="668" y2="65" stroke="#b45309" stroke-width="2.2" />
    <text x="672" y="68" font-size="8" fill="#334155">Crop ET</text>

    <!-- Exceedance verification footer -->
    <rect x="16" y="274" width="${W - 32}" height="26" rx="6" fill="#f0fdf4" stroke="#166534" stroke-width="1" />
    <text x="${W / 2}" y="291" text-anchor="middle" font-size="9" font-weight="800" fill="#14532d">
      7,670-DAY BALANCE VERIFIED: 95th-Percentile Exceedance = ${Number(model.p95_exceedance_mm || 0).toFixed(2)} mm  |  Exceedance Days: ${model.exceedance_days_count} / 7,670 (${model.exceedance_pct_of_days}%)  |  Bucket Sat/AWC: ${model.bucket_cap_sat_mm}/${model.bucket_cap_awc_mm} mm
    </text>
  </svg>`;
}

/** 9. Stratigraphic Soil Borehole Profile Graphic (BH1, BH2, ...) */
export function renderBoreholeProfileSvg(inp, model, audit) {
  const bhs = Array.isArray(inp.boreholes) ? inp.boreholes : [];
  const W = 740, H = 310;
  const maxDepth = Math.max(
    1000,
    ...bhs.flatMap((b) => (b.horizons || []).map((h) => Number(h.depth_bottom_mm || 0))),
  );
  const topY = 74, colH = 182;
  const depthToY = (mm) => topY + (mm / maxDepth) * colH;

  const horizonFill = (h) => {
    const c = String(h.colour || "").toLowerCase();
    if (c.includes("dark") || String(h.horizon || "").toUpperCase().startsWith("A")) return "#8b6b4a";
    if (c.includes("red")) return "#b86b4b";
    if (c.includes("grey") || c.includes("gray")) return "#94a3b8";
    if (c.includes("yellow") || c.includes("ochre")) return "#d4a359";
    return "#b08968";
  };

  let rulerSvg = `<line x1="66" y1="${topY}" x2="66" y2="${topY + colH}" stroke="#334155" stroke-width="1.5" />`;
  for (let d = 0; d <= maxDepth; d += 200) {
    const y = depthToY(d);
    rulerSvg += `
      <line x1="60" y1="${y.toFixed(1)}" x2="66" y2="${y.toFixed(1)}" stroke="#334155" stroke-width="1.2" />
      <text x="56" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8.2" fill="#475569">${d}</text>
    `;
  }

  const colAreaW = W - 104;
  const slotW = colAreaW / Math.max(1, bhs.length);
  const barW = Math.min(84, slotW * 0.36);

  let colsSvg = "";
  bhs.forEach((bh, idx) => {
    const bx = 92 + idx * slotW;
    const bhMax = Math.max(0, ...(bh.horizons || []).map((h) => Number(h.depth_bottom_mm || 0)));
    colsSvg += `<text x="${(bx + barW / 2).toFixed(1)}" y="${topY - 10}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#0d241b">${esc(bh.borehole_id)} (${bhMax} mm)</text>`;
    for (const h of bh.horizons || []) {
      const y1 = depthToY(Number(h.depth_top_mm || 0));
      const y2 = depthToY(Number(h.depth_bottom_mm || 0));
      const hh = Math.max(14, y2 - y1);
      const midY = y1 + hh / 2;
      const isDisp = Boolean(h.is_disposal_level);
      const dispCls = h.dispersive_class != null ? Number(h.dispersive_class) : null;
      const fill = horizonFill(h);
      colsSvg += `
        <rect x="${bx.toFixed(1)}" y="${y1.toFixed(1)}" width="${barW.toFixed(1)}" height="${hh.toFixed(1)}" fill="${fill}" stroke="${isDisp ? "#b45309" : "#1e293b"}" stroke-width="${isDisp ? 2.4 : 1.1}" />
        <text x="${(bx + barW / 2).toFixed(1)}" y="${(midY + 3.5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#ffffff">${esc(h.horizon)}${isDisp ? "*" : ""}</text>
        <text x="${(bx + barW + 8).toFixed(1)}" y="${(midY - 2).toFixed(1)}" font-size="8.4" font-weight="${isDisp ? 800 : 600}" fill="#0f172a">${esc(h.classification || "")} (${h.depth_top_mm}–${h.depth_bottom_mm})</text>
        <text x="${(bx + barW + 8).toFixed(1)}" y="${(midY + 10).toFixed(1)}" font-size="8.0" font-weight="${dispCls >= 3 ? 800 : 500}" fill="${dispCls >= 3 ? "#991b1b" : "#475569"}">pH ${h.ph != null ? Number(h.ph).toFixed(1) : "—"} · Emerson ${dispCls != null ? "Class " + dispCls : "—"}</text>
      `;
    }
  });

  const gypBanner = audit?.requires_gypsum
    ? `DISPERSIVE SUBSOIL (EMERSON CLASS 3/4): APPLY AGRICULTURAL GYPSUM @ ${Number(audit.gypsum_rate_kg_m2 || 1.0).toFixed(1)} kg/m²`
    : "NON-DISPERSIVE PROFILE (EMERSON CLASS 1–2) · DISPOSAL HORIZON (*) CONFIRMED";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#ffffff; border:1px solid #d7dfd9; border-radius:8px; font-family:Inter,sans-serif;">
    <text x="${W / 2}" y="24" text-anchor="middle" font-size="13" font-weight="800" fill="#0d241b">
      STRATIGRAPHIC SOIL BOREHOLE PROFILES — ${esc(model.morand_unit_name)} (${esc(model.morand_code)}) · SOIL CATEGORY ${model.soil_category}
    </text>
    <text x="${W / 2}" y="40" text-anchor="middle" font-size="9.4" fill="#52635c">
      ${esc(model.soil_texture_name)} (Ksat ${esc(model.soil_ksat_md)} m/d) · Water Table / Bedrock: ≥ ${Number(inp.site_eval?.depth_to_water_table_m ?? 3.0).toFixed(1)} m · * Denotes Disposal Horizon
    </text>
    <text x="56" y="${topY - 10}" text-anchor="end" font-size="8.2" font-weight="700" fill="#334155">mm</text>
    ${rulerSvg}
    ${colsSvg}
    <rect x="24" y="272" width="${W - 48}" height="26" rx="6" fill="${audit?.requires_gypsum ? "#fef3c7" : "#f0fdf4"}" stroke="${audit?.requires_gypsum ? "#b45309" : "#166534"}" stroke-width="1.1" />
    <text x="${W / 2}" y="289" text-anchor="middle" font-size="8.9" font-weight="800" fill="${audit?.requires_gypsum ? "#92400e" : "#14532d"}">
      ${esc(gypBanner)}
    </text>
  </svg>`;
}

/** 7. Commercial Grease Arrestor Cross-Section (AS/NZS 3500.2 & NSW Liquid Trade Waste) */
export function renderGreaseArrestorCrossSectionSvg(model) {
  const W = 740, H = 370;
  const capL = model.grease_arrestor_min_l || 1000;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#ffffff; border:1px solid #d7dfd9; border-radius:8px; font-family:Inter,sans-serif;">
    <defs>
      <marker id="grArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 1 L 10 5 L 0 9 z" fill="#b45309" />
      </marker>
    </defs>
    <text x="${W / 2}" y="24" text-anchor="middle" font-size="13" font-weight="800" fill="#0d241b">
      CROSS-SECTION — ${capL} L COMMERCIAL GREASE ARRESTOR (AS/NZS 3500.2)
    </text>
    <text x="${W / 2}" y="41" text-anchor="middle" font-size="9.8" fill="#52635c">
      Upstream of Primary Septic Tank for Commercial Kitchen / Food Processing · Pump-Out Every 3–6 Months
    </text>

    <!-- Ground line -->
    <line x1="26" y1="80" x2="488" y2="80" stroke="#15803d" stroke-width="2" stroke-dasharray="8,4" />
    <text x="34" y="72" font-size="8.8" font-weight="700" fill="#15803d">FINISHED SURFACE (GAS-TIGHT TRAFFICABLE LID)</text>

    <!-- Crusher dust base -->
    <rect x="80" y="302" width="350" height="18" fill="#d6d3d1" stroke="#57534e" stroke-width="1.2" />
    <text x="255" y="315" text-anchor="middle" font-size="8.8" font-weight="700" fill="#292524">100 mm LEVEL COMPACTED BEDDING PAD</text>

    <!-- Tank shell + airtight lid -->
    <rect x="86" y="88" width="338" height="214" fill="#eff6ff" stroke="#1e293b" stroke-width="3" />
    <rect x="82" y="80" width="346" height="10" fill="#64748b" stroke="#1e293b" stroke-width="1.4" />

    <!-- Aqueous layer + trapped FOG grease crust + settled food solids -->
    <rect x="88" y="146" width="334" height="154" fill="#bae6fd" />
    <rect x="88" y="128" width="248" height="36" fill="#f59e0b" stroke="#92400e" stroke-width="1.2" />
    <text x="212" y="150" text-anchor="middle" font-size="9.5" font-weight="800" fill="#451a03">TRAPPED FOG (FATS, OILS &amp; GREASE)</text>
    <rect x="88" y="266" width="334" height="34" fill="#a8a29e" stroke="#57534e" stroke-width="1" />
    <text x="212" y="287" text-anchor="middle" font-size="9.2" font-weight="700" fill="#1c1917">SETTLED FOOD SOLIDS SUMP</text>
    <text x="212" y="218" text-anchor="middle" font-size="9.5" font-weight="700" fill="#0c4a6e">CLARIFIED MIDDLE WATER ZONE</text>

    <!-- Internal baffle wall -->
    <rect x="336" y="102" width="8" height="158" fill="#334155" />

    <!-- Inlet pipe from commercial kitchen -->
    <rect x="40" y="114" width="86" height="12" fill="#94a3b8" stroke="#1e293b" stroke-width="1.2" />
    <rect x="114" y="114" width="12" height="72" fill="#94a3b8" stroke="#1e293b" stroke-width="1.2" />
    <line x1="26" y1="120" x2="64" y2="120" stroke="#b45309" stroke-width="2" marker-end="url(#grArr)" />
    <text x="34" y="108" font-size="8.6" font-weight="700" fill="#9a3412">KITCHEN WASTE</text>

    <!-- Submerged outlet tee to septic tank -->
    <rect x="372" y="132" width="102" height="12" fill="#38bdf8" stroke="#0369a1" stroke-width="1.2" />
    <rect x="372" y="132" width="12" height="114" fill="#38bdf8" stroke="#0369a1" stroke-width="1.2" />
    <line x1="432" y1="138" x2="480" y2="138" stroke="#b45309" stroke-width="2" marker-end="url(#grArr)" />
    <text x="424" y="124" font-size="8.6" font-weight="700" fill="#0369a1">TO SEPTIC TANK</text>

    <!-- Spec Legend -->
    <rect x="500" y="80" width="220" height="240" rx="8" fill="#fffbeb" stroke="#d97706" stroke-width="1.2" />
    <text x="514" y="102" font-size="10" font-weight="800" fill="#92400e">MANDATORY FOG CONTROLS</text>
    <text x="514" y="124" font-size="8.8" fill="#1e293b">• Capacity: ${capL} L (min. 1,000 L)</text>
    <text x="514" y="144" font-size="8.8" fill="#1e293b">• Kitchen/food sinks ONLY (no toilets)</text>
    <text x="514" y="164" font-size="8.8" fill="#1e293b">• Fit ≤ 3 mm sink basket strainers</text>
    <text x="514" y="184" font-size="8.8" fill="#1e293b">• Vent to atmosphere per AS/NZS 3500</text>
    <text x="514" y="204" font-size="8.8" fill="#1e293b">• Direct vacuum-tanker access</text>
    <text x="514" y="224" font-size="8.8" font-weight="700" fill="#9a3412">• Pump out every 3–6 months</text>
    <text x="514" y="242" font-size="8.4" fill="#475569">  (NSW EPA licensed liquid waste)</text>
    <text x="514" y="264" font-size="8.4" fill="#475569">• NO enzyme/emulsifier degreasers</text>
    <text x="514" y="282" font-size="8.4" fill="#475569">• Keep pump-out dockets for Council</text>

    <text x="${W / 2}" y="352" text-anchor="middle" font-size="9.2" fill="#52635c">
      NOT TO SCALE — Install &amp; vent strictly in accordance with AS/NZS 3500.2 &amp; NSW Liquid Trade Waste Guidelines
    </text>
  </svg>`;
}
