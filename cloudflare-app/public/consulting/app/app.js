import {
  auditLismoreComplianceJS,
  computePinSetbacksMeters,
  loadLismoreDatasets,
  renderCadLayoutSvg,
  runLismoreModelJS,
  wgs84ToMga56,
} from "./lismore-engine.js";
import {
  renderBoreholeProfileSvg,
  renderEtaCrossSectionSvg,
  renderGisSiteMapSvg,
  renderGreaseArrestorCrossSectionSvg,
  renderReedBedCrossSectionSvg,
  renderSdiCrossSectionSvg,
  renderSepticCrossSectionSvg,
  renderSizingAndWaterBalanceSvg,
  renderTreatmentTrainSvg,
} from "./diagrams.js";
import {
  deleteOfflineDraft,
  deleteOfflinePhoto,
  getDraftKey,
  getLastOfflineDraft,
  getOfflineDraft,
  listAllUnsyncedPhotos,
  listOfflineDrafts,
  listOfflinePhotos,
  markOfflinePhotoSynced,
  rekeyOfflinePhotos,
  saveOfflineDraft,
  saveOfflinePhoto,
} from "./offline-store.js";

// ============================================================================
// STATE & OFFLINE LOCAL MIRROR
// ============================================================================
const STORAGE_KEY = "ftf_ossm_draft_v1";

let rules = null;
let climate = null;
let activeJobId = null;
let assessment = null;
let spatial = null;
let lastModel = null;
let lastAudit = null;
let compiledArtifacts = null; // { docxBlob, dxfBlob, auditBlob, slug }
let compiledSeeArtifact = null; // { docxBlob, slug }
let localPhotos = []; // [{ id, caption, ext, bytes: ArrayBuffer, previewUrl }]
let vaultFiles = []; // Shared File objects uploaded for this job (readable by BOTH OSSM & SEE!)
let r2JobFiles = [];
let pendingAiExtract = null;
let uploadedDocsSummary = "";
let dashboardJobsCache = [];
let isDirty = false;
let lastSavedAt = null;

let wbMap = null;
let wbGisLayer = null;
let wbPinsLayer = null;

// ============================================================================
// NON-BLOCKING TOASTS, STYLED CONFIRM MODAL, LIGHTBOX & SAVE STATE UI
// ============================================================================
function showToast(message, variant = "info", durationMs = 3600) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  const item = document.createElement("div");
  item.className = `toast-item ${variant}`;
  item.textContent = message;
  stack.appendChild(item);
  setTimeout(() => {
    item.style.opacity = "0";
    item.style.transition = "opacity 0.2s ease";
    setTimeout(() => item.remove(), 220);
  }, durationMs);
}

function showConfirmDialog(title, body, okLabel = "Confirm") {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    if (!modal) return resolve(window.confirm(`${title}\n\n${body}`));
    document.getElementById("confirmModalTitle").textContent = title;
    document.getElementById("confirmModalBody").textContent = body;
    const okBtn = document.getElementById("btnConfirmOk");
    const cancelBtn = document.getElementById("btnConfirmCancel");
    okBtn.textContent = okLabel;
    modal.classList.add("open");

    const cleanup = (result) => {
      modal.classList.remove("open");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
  });
}

function updateSaveStateUi() {
  const btn = document.getElementById("btnSaveJob");
  const meta = document.getElementById("saveStateMeta");
  if (btn && !btn.disabled) {
    btn.innerHTML = isDirty ? `<span class="save-dot"></span>Save Job to D1` : "Save Job to D1";
  }
  if (meta) {
    if (isDirty) {
      meta.textContent = "Unsaved edits";
    } else if (lastSavedAt) {
      meta.textContent = `Saved ${lastSavedAt}`;
    } else {
      meta.textContent = "";
    }
  }
}

function markDirty() {
  isDirty = true;
  updateSaveStateUi();
}

function markSaved() {
  isDirty = false;
  lastSavedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  updateSaveStateUi();
}

// Drawing Zoom Lightbox (click any .drawing-frame to inspect SVG at full resolution)
function openDrawingLightbox(frameEl) {
  const svg = frameEl?.querySelector("svg");
  const modal = document.getElementById("drawingLightbox");
  const canvas = document.getElementById("lightboxCanvas");
  const titleEl = document.getElementById("lightboxTitle");
  if (!svg || !modal || !canvas) return;
  titleEl.textContent = frameEl.dataset.zoomTitle || "Engineering Drawing Preview";
  canvas.innerHTML = svg.outerHTML;
  modal.classList.add("open");
}

function closeDrawingLightbox() {
  document.getElementById("drawingLightbox")?.classList.remove("open");
}

document.getElementById("btnCloseLightbox")?.addEventListener("click", closeDrawingLightbox);
document.getElementById("drawingLightbox")?.addEventListener("click", (e) => {
  if (e.target.id === "drawingLightbox") closeDrawingLightbox();
});
document.addEventListener("click", (e) => {
  const frame = e.target.closest(".drawing-frame");
  if (frame && frame.querySelector("svg")) {
    openDrawingLightbox(frame);
  }
});

// Global Keyboard Shortcuts: Escape closes modals/drawers; Ctrl+S / Cmd+S saves active job to D1
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeDrawingLightbox();
    closeMobileDrawer();
    document.getElementById("newJobModal")?.classList.remove("open");
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveActiveJobToD1();
  }
});

// Mobile Drawer Controls
function openMobileDrawer() {
  document.getElementById("wsSidebar")?.classList.add("drawer-open");
  document.getElementById("wsDrawerBackdrop")?.classList.add("open");
}
function closeMobileDrawer() {
  document.getElementById("wsSidebar")?.classList.remove("drawer-open");
  document.getElementById("wsDrawerBackdrop")?.classList.remove("open");
}
document.getElementById("btnMobileMenu")?.addEventListener("click", openMobileDrawer);
document.getElementById("btnCloseDrawer")?.addEventListener("click", closeMobileDrawer);
document.getElementById("wsDrawerBackdrop")?.addEventListener("click", closeMobileDrawer);

// Pyodide Web Worker
let pyWorker = null;
let pyReqSeq = 0;
const pyPending = new Map();

function getPyWorker() {
  if (!pyWorker) {
    pyWorker = new Worker("/consulting/app/pyodide-worker.js?v=12");
    pyWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "status") {
        document.getElementById("pyBadge").textContent = "Pyodide: Loading...";
        logExport(msg.message);
        return;
      }
      if (msg.type === "ready") {
        document.getElementById("pyBadge").textContent = "Pyodide: Ready (WASM)";
        document.getElementById("pyBadge").className = "badge badge-pass";
        return;
      }
      const p = pyPending.get(msg.id);
      if (p) {
        pyPending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error));
      }
    };
  }
  return pyWorker;
}

function callPyWorker(action, payload = {}) {
  const id = ++pyReqSeq;
  return new Promise((resolve, reject) => {
    pyPending.set(id, { resolve, reject });
    getPyWorker().postMessage({ id, action, payload });
  });
}

function logExport(text) {
  const el = document.getElementById("exportLog");
  el.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
}

// ============================================================================
// THEME (LIGHT / DARK MODE), SIDEBAR NAVIGATION & SCOPE-DRIVEN WORKFLOWS
// ============================================================================
function syncThemeButton() {
  const btn = document.getElementById("btnThemeToggle");
  if (!btn) return;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  btn.textContent = isDark ? "☀ Light" : "🌙 Dark";
}

document.getElementById("btnThemeToggle")?.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("ftf_theme", next);
  syncThemeButton();
});

function getScope() {
  const d = assessment?.deliverables;
  return {
    ossm: d ? d.ossm !== false : true,
    see: d ? d.see !== false : true,
  };
}

function applyScopeVisibility() {
  const { ossm, see } = getScope();
  const btnO = document.getElementById("scopeBtnOssm");
  const btnS = document.getElementById("scopeBtnSee");
  if (btnO) {
    btnO.classList.toggle("on", ossm);
    btnO.textContent = ossm ? "✓ OSSM (s68)" : "+ OSSM (s68)";
  }
  if (btnS) {
    btnS.classList.toggle("on", see);
    btnS.textContent = see ? "✓ SEE (DA)" : "+ SEE (DA)";
  }

  const grpO = document.getElementById("navGroupOssm");
  const grpS = document.getElementById("navGroupSee");
  if (grpO) grpO.style.display = ossm ? "flex" : "none";
  if (grpS) grpS.style.display = see ? "flex" : "none";

  // Ribbon KPIs tailored to active scope
  ["kpiFlowWrap", "kpiLaaWrap", "kpiRbWrap"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = ossm ? "block" : "none";
  });
  const btnNextFromOssm = document.getElementById("btnNextFromOssmExport");
  if (btnNextFromOssm) btnNextFromOssm.style.display = see ? "inline-flex" : "none";

  const scopeBadges = document.getElementById("ribbonScopeBadges");
  if (scopeBadges) {
    scopeBadges.innerHTML =
      (ossm ? `<span class="badge badge-info">Section 68 OSSM</span>` : "") +
      (see ? `<span class="badge badge-pass">DA SEE (LEP/DCP)</span>` : "");
  }

  // Update dynamic step numbering on SEE flow when SEE-only vs Both
  const seeStep1 = document.querySelector("#navSeePlan .ws-step-dot");
  const seeStep2 = document.querySelector("#navSeeExport .ws-step-dot");
  if (seeStep1) seeStep1.textContent = ossm ? "6" : "3";
  if (seeStep2) seeStep2.textContent = ossm ? "7" : "4";

  // Update Field panel's Next button text dynamically
  const btnFieldNext = document.getElementById("btnNextFromField");
  if (btnFieldNext) {
    btnFieldNext.textContent = ossm
      ? "Next: OSSM Site Eval & Boreholes →"
      : "Next: DA Proposal & Lismore LEP/DCP →";
  }
}

function switchTab(panelId) {
  // Backwards-compatible alias mapping if any old ID is passed
  const alias = {
    "tab-dashboard": "panel-dashboard",
    "tab-gis": "panel-hub",
    "tab-field": "panel-field",
    "tab-model": "panel-ossm-model",
    "tab-export": "panel-ossm-export",
    "tab-see": "panel-see-plan",
  };
  const target = alias[panelId] || panelId;
  document.querySelectorAll(".ws-nav-item").forEach((b) => b.classList.toggle("active", b.dataset.panel === target));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === target));
  const activeBtn = document.querySelector(`.ws-nav-item[data-panel="${target}"] .ws-nav-left`);
  const mobLbl = document.getElementById("mobileActiveStepLabel");
  if (mobLbl && activeBtn) {
    mobLbl.textContent = activeBtn.textContent.replace(/^[⌂0-9]+\s*/, "").trim();
  }
  closeMobileDrawer();
  if (target === "panel-hub" && wbMap) {
    setTimeout(() => wbMap.invalidateSize(), 70);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".ws-nav-item[data-panel]").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.panel));
});
document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.goto));
});
document.getElementById("btnNextFromField")?.addEventListener("click", () => {
  const { ossm } = getScope();
  switchTab(ossm ? "panel-ossm-soil" : "panel-see-plan");
});
document.getElementById("btnBackFromSeePlan")?.addEventListener("click", () => {
  const { ossm } = getScope();
  switchTab(ossm ? "panel-ossm-export" : "panel-field");
});

document.getElementById("scopeBtnOssm")?.addEventListener("click", () => {
  const cur = getScope();
  if (cur.ossm && !cur.see) return; // Keep at least one deliverable active
  assessment.deliverables = { ossm: !cur.ossm, see: cur.see };
  applyScopeVisibility();
  syncStateFromForm();
});
document.getElementById("scopeBtnSee")?.addEventListener("click", () => {
  const cur = getScope();
  if (cur.see && !cur.ossm) return; // Keep at least one deliverable active
  assessment.deliverables = { ossm: cur.ossm, see: !cur.see };
  applyScopeVisibility();
  syncStateFromForm();
});

function updateSidebarProgress() {
  const gisBadge = document.getElementById("navGisBadge");
  if (gisBadge) {
    gisBadge.textContent = spatial?.fetched_live ? "GIS ✓" : "GIS";
    document.getElementById("navHub")?.classList.toggle("done", Boolean(spatial?.fetched_live));
  }
  const photoBadge = document.getElementById("navPhotoBadge");
  if (photoBadge) {
    const cnt = localPhotos.length + r2JobFiles.filter((f) => f.kind === "photo").length;
    photoBadge.textContent = `${cnt} photo${cnt === 1 ? "" : "s"}`;
    document.getElementById("navField")?.classList.toggle("done", cnt > 0);
  }
  const bhBadge = document.getElementById("navBhBadge");
  if (bhBadge && assessment) {
    const nBh = (assessment.boreholes || []).length;
    bhBadge.textContent = `${nBh} BH${nBh >= 2 ? " ✓" : ""}`;
    document.getElementById("navOssmSoil")?.classList.toggle("done", nBh >= 2);
  }
  const laaBadge = document.getElementById("navLaaBadge");
  if (laaBadge && lastModel) {
    laaBadge.textContent = `${lastModel.required_laa_m2} m²`;
    document.getElementById("navOssmModel")?.classList.toggle("done", (lastAudit?.departures_from_strategy?.length ?? 1) === 0);
  }
  const zBadge = document.getElementById("navSeeZoneBadge");
  const zRibbon = document.getElementById("ribbonZone");
  const zoneShort = spatial?.land_zoning?.length ? spatial.land_zoning[0].split(" ")[0] : "Fetch GIS";
  if (zBadge) zBadge.textContent = spatial?.land_zoning?.length ? `${zoneShort} ✓` : "LEP";
  if (zRibbon) zRibbon.textContent = zoneShort;
}

async function updateNetBadge() {
  const b = document.getElementById("netBadge");
  if (!b) return;
  const unsyncedPhotos = await listAllUnsyncedPhotos().catch(() => []);
  const pendingCount = unsyncedPhotos.length;
  if (navigator.onLine) {
    b.textContent = pendingCount > 0 ? `Online · Syncing ${pendingCount}...` : "Online · D1/R2";
    b.className = pendingCount > 0 ? "badge badge-info" : "badge badge-pass";
  } else {
    b.textContent = pendingCount > 0 ? `Offline (IndexedDB · ${pendingCount} queued)` : "Offline (IndexedDB)";
    b.className = "badge badge-warn";
  }
}

async function flushOfflineSyncQueue() {
  if (!navigator.onLine) return;
  try {
    const unsynced = await listAllUnsyncedPhotos();
    if (unsynced.length && activeJobId) {
      const curKey = getDraftKey(activeJobId, assessment);
      for (const ph of unsynced) {
        if (ph.draftKey !== curKey) continue;
        try {
          const blob = new Blob([ph.bytes], { type: ph.mimeType || "image/jpeg" });
          const fd = new FormData();
          fd.append("file", blob, `${ph.id}.${ph.ext || "jpg"}`);
          fd.append("kind", "photo");
          fd.append("caption", ph.caption || "Field photo");
          const resp = await fetch(`/consulting/api/jobs/${activeJobId}/files`, { method: "POST", body: fd });
          if (resp.ok) {
            await markOfflinePhotoSynced(ph.id, curKey);
          }
        } catch (_) {}
      }
      loadJobFiles(activeJobId);
    }
  } catch (_) {}
  await updateNetBadge();
}

window.addEventListener("online", async () => {
  await updateNetBadge();
  await flushOfflineSyncQueue();
  refreshDashboard();
});
window.addEventListener("offline", updateNetBadge);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/consulting/sw.js").catch(() => {});
}

// ============================================================================
// DEFAULT ASSESSMENT FACTORY
// ============================================================================
function createBlankAssessment() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    project_ref: `FTF-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
    applicant_name: "New Client",
    site_address: "Lismore NSW 2480",
    lot_number: "1",
    plan_label: "DP100000",
    lga: "Lismore City Council",
    is_multiple_occupancy: false,
    block_size_m2: 10000,
    development_description: "Combined Secondary On-Site Wastewater Treatment and Disposal System",
    development_category: "single_dwelling",
    deliverables: { ossm: true, see: true },
    project_brief: "",
    wastewater_sources: [],
    grease_arrestor_required: false,
    grease_arrestor_capacity_l: null,
    surge_balance_tank_l: null,
    custom_narratives: null,
    bedrooms: 3,
    water_supply: "roof_full_water_saving",
    wastewater_components: { toilet: true, bathroom: true, laundry: true, kitchen: true },
    treatment_system: "secondary_reed_bed",
    land_application_type: "eta_beds",
    buffer_feature: "gully",
    buffer_distance_m: 45,
    morand_code: "co",
    soil_texture_id: 9,
    reed_bed_wetted_depth_m: 0.7,
    root_zone_depth_mm: 300,
    gravel_depth_mm: 300,
    trench_width_m: 2.0,
    trench_separation_m: 2.0,
    site_eval: {
      assessment_date: today,
      recent_weather: "Intermittent showers",
      existing_system_notes: "",
      existing_vegetation: "Mixed native shrubs, scattered trees and grass cover",
      slope_pct: 7.0,
      slope_range_text: "5–7%",
      landform: "linear_planar",
      landform_notes: "Linear planar slope across proposed disposal area",
      aspect: "North-East",
      exposure: "high",
      boulders_rocks: "None encountered",
      boulders_limiting: false,
      flooding_potential: "None (above 1:20 and 1:100 year flood levels)",
      below_1_in_20_flood: false,
      below_1_in_100_flood: false,
      site_drainage: "Good; no channelled runoff or wetness observed",
      surface_dampness: false,
      waterlogging_vegetation: "No sign of sedges or bullrushes",
      waterlogging_present: false,
      surface_condition: "Grassed; no cracking or ponding",
      surface_cracking_or_bare: false,
      fill_notes: "None",
      contains_fill: false,
      erosion_notes: "No rills, slips, or cracks observed",
      erosion_present: false,
      depth_to_water_table_m: 3.0,
      run_on_diversion_proposed: "Construct upslope run-on diversion swale above reed bed and ETA bed",
      run_off_control_proposed: "Plant double row of Lomandra hystrix (1.0 m offset) downslope of ETA bed",
      reserve_laa_available: true,
      dist_perennial_watercourse_m: 150,
      dist_gully_m: 45,
      dist_domestic_bore_m: 300,
      dist_property_boundary_m: 25,
      boundary_is_downgradient: true,
      dist_dwelling_m: 16,
      septic_to_dwelling_m: 4.5,
      dist_nearest_small_tree_m: 6,
    },
    boreholes: [
      {
        borehole_id: "BH1 (Upper LAA)",
        bolus_ribbon_mm: "40–50 mm",
        bolus_description: "Plastic clay loam / strongly structured light clay",
        depth_to_bedrock_m: 3.0,
        depth_to_water_table_m: 3.0,
        horizons: [
          { horizon: "A", depth_top_mm: 0, depth_bottom_mm: 150, classification: "Topsoil", texture_moist: "loamy", structure_moist: "moderate", colour: "Dark brown", coarse_fragments_pct: 5, ph: 6.0, dispersive_class: 2, is_disposal_level: false },
          { horizon: "B", depth_top_mm: 150, depth_bottom_mm: 1000, classification: "Clay loam / light clay", texture_moist: "subplastic", structure_moist: "strong", colour: "Red-brown", coarse_fragments_pct: 5, ph: 6.0, dispersive_class: 2, is_disposal_level: true },
        ],
      },
      {
        borehole_id: "BH2 (Lower LAA)",
        bolus_ribbon_mm: "40–50 mm",
        bolus_description: "Consistent profile confirming uniform LAA",
        depth_to_bedrock_m: 3.0,
        depth_to_water_table_m: 3.0,
        horizons: [
          { horizon: "A", depth_top_mm: 0, depth_bottom_mm: 150, classification: "Topsoil", texture_moist: "loamy", structure_moist: "moderate", colour: "Dark brown", coarse_fragments_pct: 5, ph: 6.0, dispersive_class: 2, is_disposal_level: false },
          { horizon: "B", depth_top_mm: 150, depth_bottom_mm: 1000, classification: "Clay loam / light clay", texture_moist: "subplastic", structure_moist: "strong", colour: "Red-brown", coarse_fragments_pct: 5, ph: 6.0, dispersive_class: 2, is_disposal_level: true },
        ],
      },
    ],
    consultant: {
      name: "Field To Forest Environmental Consulting",
      qualification: "Accredited Wastewater Consultant (Northern Rivers NSW)",
      licence_number: "FTF-NSW",
      company: "Field To Forest",
      phone: "",
      email: "consulting@fieldtoforestfarm.com",
      postal_address: "Lismore NSW 2480",
    },
    field_pins: [],
    photos: [],
  };
}

// ============================================================================
// FORM BINDING & LIVE RECALCULATION
// ============================================================================
function populateSelects() {
  const mSel = document.getElementById("mMorand");
  mSel.innerHTML = Object.entries(rules.morand_soil_units)
    .sort((a, b) => a[1].unit.localeCompare(b[1].unit))
    .map(([code, u]) => `<option value="${code}">${u.unit} (${code}) — ${u.group} [P: ${u.p_sorption ?? "Unsuitable"}]</option>`)
    .join("");

  const sSel = document.getElementById("mSoilTexture");
  sSel.innerHTML = rules.soil_textures
    .map((t) => `<option value="${t.id}">Cat ${t.category}: ${t.name} (2ndry DLR ${t.secondary_trench_dlr} mm/d)</option>`)
    .join("");
}

function hydrateFormFromState() {
  const a = assessment;
  const se = a.site_eval;
  document.getElementById("fProjectRef").value = a.project_ref || "";
  document.getElementById("fDate").value = se.assessment_date || new Date().toISOString().slice(0, 10);
  document.getElementById("fApplicant").value = a.applicant_name || "";
  document.getElementById("fBlockM2").value = a.block_size_m2 ?? 10000;
  document.getElementById("fAddress").value = a.site_address || "";
  document.getElementById("fLot").value = a.lot_number || "";
  document.getElementById("fPlan").value = a.plan_label || "";

  document.getElementById("fSlope").value = se.slope_pct ?? 7;
  document.getElementById("fAspect").value = se.aspect || "";
  document.getElementById("fExposure").value = se.exposure || "medium";
  document.getElementById("fLandform").value = se.landform || "linear_planar";
  document.getElementById("fWtDepth").value = se.depth_to_water_table_m ?? 3.0;
  document.getElementById("fDistGully").value = se.dist_gully_m ?? 45;
  document.getElementById("fDistWater").value = se.dist_perennial_watercourse_m ?? 150;
  document.getElementById("fDistBound").value = se.dist_property_boundary_m ?? 25;
  document.getElementById("fDistSeptic").value = se.septic_to_dwelling_m ?? 4.5;
  document.getElementById("fReserve").value = String(se.reserve_laa_available !== false);
  document.getElementById("fExistingNotes").value = se.existing_system_notes || "";
  document.getElementById("fRunOn").value = se.run_on_diversion_proposed || "";

  document.getElementById("mDevCategory").value = a.development_category || "single_dwelling";
  document.getElementById("mDevDesc").value = a.development_description || "";
  document.getElementById("mGreaseReq").checked = Boolean(a.grease_arrestor_required);
  document.getElementById("mGreaseCap").value = a.grease_arrestor_capacity_l ?? 0;
  document.getElementById("mSurgeCap").value = a.surge_balance_tank_l ?? 0;
  document.getElementById("mBedrooms").value = a.bedrooms ?? 2;
  document.getElementById("mWaterSupply").value = a.water_supply || "roof_full_water_saving";
  document.getElementById("mTreatment").value = a.treatment_system || "secondary_reed_bed";
  document.getElementById("mLaaType").value = a.land_application_type || "eta_beds";
  document.getElementById("mMorand").value = a.morand_code || "co";
  document.getElementById("mSoilTexture").value = String(a.soil_texture_id ?? 9);
  document.getElementById("mRbDepth").value = a.reed_bed_wetted_depth_m ?? 0.7;
  document.getElementById("mRootMm").value = a.root_zone_depth_mm ?? 300;
  document.getElementById("mGravelMm").value = a.gravel_depth_mm ?? 300;
  document.getElementById("mTrenchW").value = a.trench_width_m ?? 2.0;

  const cn = a.custom_narratives || {};
  document.getElementById("narExec").value = cn.executive_summary || "";
  document.getElementById("narJust").value = cn.system_selection_justification || "";
  document.getElementById("narCtx").value = cn.development_context || "";
  document.getElementById("narComm").value = cn.commercial_trade_waste_notes || "";
  document.getElementById("narSoil").value = cn.site_soil_interpretation || "";
  document.getElementById("narOm").value = cn.custom_om_notes || "";
  if (cn.source_documents_summary) uploadedDocsSummary = cn.source_documents_summary;

  const briefEl = document.getElementById("aiNotesInput");
  if (briefEl) briefEl.value = a.project_brief || "";
  if (a.see_state) {
    const s = a.see_state;
    const setV = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    setV("seeDevType", s.development_type);
    setV("seeCost", s.estimated_cost_aud);
    setV("seeTitle", s.proposal_title);
    setV("seeGfa", s.gross_floor_area_m2);
    setV("seeHeight", s.building_height_m);
    setV("seeStoreys", s.storeys);
    setV("seeParking", s.proposed_parking_spaces);
    setV("seeCut", s.cut_max_m);
    setV("seeFill", s.fill_max_m);
    setV("seeDisturbed", s.disturbed_area_m2);
    setV("seeTrees", s.native_trees_removed);
    setV("seeTraffic", s.vehicle_movements_per_day);
    setV("seeHours", s.operating_hours || "");
    setV("seeStaffGuests", s.staff_or_guests_max || "");
    setV("seeSummary", s.proposal_summary || "");
    setV("seeMaterials", s.materials_and_colours);
    setV("seeExisting", s.existing_use_and_structures);
    setV("seeAccess", s.existing_access);
    setV("seeStormwater", s.stormwater_management);
    setV("seeVeg", s.vegetation_notes);
    setV("seeEscp", s.construction_waste_and_escp);
    setV("seeAmenity", s.neighbour_amenity_notes);
    setV("seeContam", s.contamination_history);
  }

  applyScopeVisibility();
  renderVaultFilesChips();
  renderSourcesEditor();
  renderBoreholesEditor();
  recalculateAndRender();
}

function syncStateFromForm() {
  const a = assessment;
  const se = a.site_eval;
  a.project_ref = document.getElementById("fProjectRef").value.trim() || a.project_ref;
  se.assessment_date = document.getElementById("fDate").value || se.assessment_date;
  a.applicant_name = document.getElementById("fApplicant").value.trim();
  a.block_size_m2 = Number(document.getElementById("fBlockM2").value || 10000);
  a.site_address = document.getElementById("fAddress").value.trim();
  a.lot_number = document.getElementById("fLot").value.trim();
  a.plan_label = document.getElementById("fPlan").value.trim().toUpperCase();

  se.slope_pct = Number(document.getElementById("fSlope").value || 0);
  se.slope_range_text = `${se.slope_pct}%`;
  se.aspect = document.getElementById("fAspect").value.trim();
  se.exposure = document.getElementById("fExposure").value;
  se.landform = document.getElementById("fLandform").value;
  se.depth_to_water_table_m = Number(document.getElementById("fWtDepth").value || 3.0);
  se.dist_gully_m = Number(document.getElementById("fDistGully").value || 45);
  a.buffer_distance_m = se.dist_gully_m;
  se.dist_perennial_watercourse_m = Number(document.getElementById("fDistWater").value || 150);
  se.dist_property_boundary_m = Number(document.getElementById("fDistBound").value || 25);
  se.septic_to_dwelling_m = Number(document.getElementById("fDistSeptic").value || 4.5);
  se.reserve_laa_available = document.getElementById("fReserve").value === "true";
  se.existing_system_notes = document.getElementById("fExistingNotes").value.trim();
  se.run_on_diversion_proposed = document.getElementById("fRunOn").value.trim();

  a.development_category = document.getElementById("mDevCategory").value || "single_dwelling";
  a.development_description = document.getElementById("mDevDesc").value.trim() || a.development_description;
  a.grease_arrestor_required = document.getElementById("mGreaseReq").checked;
  const gCap = Number(document.getElementById("mGreaseCap").value || 0);
  a.grease_arrestor_capacity_l = gCap > 0 ? gCap : null;
  const sCap = Number(document.getElementById("mSurgeCap").value || 0);
  a.surge_balance_tank_l = sCap > 0 ? sCap : null;
  a.bedrooms = Number(document.getElementById("mBedrooms").value || 1);
  a.water_supply = document.getElementById("mWaterSupply").value;
  a.treatment_system = document.getElementById("mTreatment").value;
  a.land_application_type = document.getElementById("mLaaType").value;
  a.morand_code = document.getElementById("mMorand").value;
  a.soil_texture_id = Number(document.getElementById("mSoilTexture").value || 9);
  a.reed_bed_wetted_depth_m = Number(document.getElementById("mRbDepth").value || 0.7);
  a.root_zone_depth_mm = Number(document.getElementById("mRootMm").value || 300);
  a.gravel_depth_mm = Number(document.getElementById("mGravelMm").value || 300);
  a.trench_width_m = Number(document.getElementById("mTrenchW").value || 2.0);

  const narExec = document.getElementById("narExec").value.trim();
  const narJust = document.getElementById("narJust").value.trim();
  const narCtx = document.getElementById("narCtx").value.trim();
  const narComm = document.getElementById("narComm").value.trim();
  const narSoil = document.getElementById("narSoil").value.trim();
  const narOm = document.getElementById("narOm").value.trim();
  if (narExec || narJust || narCtx || narComm || narSoil || narOm || uploadedDocsSummary) {
    a.custom_narratives = {
      ...(a.custom_narratives || {}),
      executive_summary: narExec || null,
      system_selection_justification: narJust || null,
      development_context: narCtx || null,
      commercial_trade_waste_notes: narComm || null,
      site_soil_interpretation: narSoil || null,
      custom_om_notes: narOm || null,
      source_documents_summary: uploadedDocsSummary || a.custom_narratives?.source_documents_summary || null,
    };
  } else {
    a.custom_narratives = null;
  }

  const briefEl = document.getElementById("aiNotesInput");
  if (briefEl) a.project_brief = briefEl.value.trim();
  a.see_state = buildSeeInputFromForm();

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeJobId, assessment, spatial }));
  } catch (_) {
    try {
      const slimSpatial = spatial ? { ...spatial, contours_geojson: [], neighbour_parcels_geojson: [] } : null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeJobId, assessment, spatial: slimSpatial }));
    } catch (_) {}
  }
  // Persist full multi-job draft asynchronously in IndexedDB
  saveOfflineDraft({
    draftKey: getDraftKey(activeJobId, assessment),
    activeJobId,
    assessment,
    spatial,
    dirty: true,
  }).catch(() => {});
  markDirty();
  recalculateAndRender();
}

function recalculateAndRender() {
  if (!rules || !climate || !assessment) return;
  lastModel = runLismoreModelJS(assessment, rules, climate);
  lastAudit = auditLismoreComplianceJS(assessment, spatial, lastModel, rules);

  // Header Ribbon
  document.getElementById("activeJobHeader").textContent =
    `${assessment.project_ref} — ${assessment.applicant_name} · ${assessment.site_address} (Lot ${assessment.lot_number} ${assessment.plan_label})`;
  document.getElementById("ribbonFlow").textContent = `${lastModel.total_flow_ld} L/d (${lastModel.design_persons} EP)`;
  document.getElementById("ribbonLaa").textContent = `${lastModel.required_laa_m2} m² (${lastModel.limiting_factor})`;
  document.getElementById("ribbonRb").textContent = lastModel.reed_bed_required_m2 > 0
    ? `${lastModel.reed_bed_required_m2} m² (${lastModel.reed_bed_hrt_days} d)`
    : "N/A";
  document.getElementById("ribbonStatus").innerHTML = lastAudit.departures_from_strategy.length === 0
    ? `<span class="badge badge-pass">0 Departures</span>`
    : `<span class="badge badge-warn">${lastAudit.departures_from_strategy.length} Departure(s)</span>`;

  // Model KPIs
  document.getElementById("outHyd").textContent = `${lastModel.hydraulic_area_m2} m²`;
  document.getElementById("outHydSub").textContent = `Exceed: ${lastModel.exceedance_pct_of_days}% of 7,670 d`;
  document.getElementById("outNit").textContent = `${lastModel.nitrogen_area_m2} m²`;
  document.getElementById("outNitSub").textContent = `N rem ${lastModel.n_removal_pct}% · perc ${lastModel.n_percolation_granted_kg_yr} kg/yr`;
  document.getElementById("outPhos").textContent = `${lastModel.phosphorus_area_m2} m²`;
  document.getElementById("outPhosSub").textContent = `${lastModel.morand_unit_name} (${lastModel.p_sorption_kg_ha_m.toLocaleString()} kg/ha·m)`;

  const tr = lastModel.trench_layout;
  const isIrrig = assessment.land_application_type !== "eta_beds";
  const layoutRowLabel = isIrrig
    ? "Contiguous Irrigation Zone (No Trench Separation)"
    : "Rectangular ETA Bed Layout (LCC Designer)";
  const layoutRowVal = isIrrig
    ? `<strong>${tr.trench_length_m} m × ${tr.trench_width_m} m = ${tr.envelope_area_m2} m²</strong> (0 m separation · ~${Math.round(lastModel.required_laa_m2)} m drip laterals @ 1.0 m · 1800 L pump well + CIDP req.)`
    : `<strong>${tr.number_of_trenches}× bed(s) ${tr.trench_length_m} m × ${tr.trench_width_m} m</strong> (sep ${tr.trench_separation_m} m; envelope ${tr.envelope_area_m2} m²)`;

  const multiRowsHtml = (lastModel.source_breakdown || []).length
    ? `<tr><td>Multi-Use Sources (${lastModel.source_breakdown.length})</td><td>${lastModel.source_breakdown.map((s) => `${s.label}: <strong>${s.daily_flow_ld} L/d</strong> (${s.ep_equivalent} EP, BOD ${s.influent_bod_mgl})`).join("<br/>")}<br/><span style="color:var(--muted);">Weighted Influent BOD5: <strong>${lastModel.weighted_influent_bod_mgl} mg/L</strong></span></td></tr>`
    : "";
  const greaseRowHtml = lastModel.grease_arrestor_min_l > 0
    ? `<tr><td>Commercial Grease Arrestor (AS/NZS 3500.2)</td><td><strong>${lastModel.grease_arrestor_min_l} L</strong> upstream of septic (3–6 monthly pump-out)</td></tr>`
    : "";
  const surgeRowHtml = lastModel.surge_tank_min_l > 0
    ? `<tr><td>Flow Equalisation / Surge Balance Tank</td><td><strong>${lastModel.surge_tank_min_l} L</strong> timer-dosed buffer for peak weekend/batch surges</td></tr>`
    : "";

  document.getElementById("modelSummaryTable").innerHTML = `
    <table class="data-table">
      <thead><tr><th>Parameter</th><th>Calculated Value</th></tr></thead>
      <tbody>
        ${multiRowsHtml}
        ${greaseRowHtml}
        <tr><td>Septic Tank (AS/NZS 1547 Table J1)</td><td><strong>${lastModel.septic_tank_min_l} L</strong> (${lastModel.septic_retention_days} days retention)</td></tr>
        ${surgeRowHtml}
        <tr><td>Soil ${isIrrig ? "DIR" : "DLR"} &amp; Bucket Cap (Sat / AWC)</td><td>${lastModel.max_deep_drainage_mmd} mm/d · ${lastModel.bucket_cap_sat_mm} mm / ${lastModel.bucket_cap_awc_mm} mm</td></tr>
        <tr><td>Reed Bed (Headley &amp; Davidson 2003)</td><td>${lastModel.reed_bed_required_m2 > 0 ? `${lastModel.reed_bed_required_m2} m² req → <strong>${lastModel.recommended_reed_bed_count}× ${lastModel.recommended_reed_bed_model}</strong> (${lastModel.recommended_reed_bed_provided_m2} m²)` : "Not nominated"}</td></tr>
        <tr><td>${layoutRowLabel}</td><td>${layoutRowVal}</td></tr>
        <tr><td>Actual Loading Rate &amp; Reserve LAA</td><td>${lastModel.daily_loading_rate_actual_mmd} mm/d · 100% Reserve: <strong>${lastModel.reserve_laa_m2} m²</strong></td></tr>
      </tbody>
    </table>
    ${isIrrig ? `<div style="margin-top:8px; padding:8px 10px; border-radius:8px; background:var(--forest-50); border:1px solid var(--border); font-size:0.8rem; color:var(--muted);">
      <strong>Note:</strong> Sub-surface / spray irrigation uses AS/NZS 1547's conservative Design Irrigation Rate (${lastModel.max_deep_drainage_mmd} mm/d, 0 mm gravel storage), requiring a larger contiguous grassed zone (~${tr.trench_length_m} m × ${tr.trench_width_m} m). On slopes &lt; 15%, Lismore City Council prefers passive <strong>ETA Beds</strong> which have much smaller footprints.
    </div>` : ""}
  `;

  // Live Borehole Profile + Sizing/Water-Balance Chart + CAD SVG + Export Embedded Drawings Preview + Readiness Bars
  const liveBhBox = document.getElementById("liveBoreholeSvgBox");
  if (liveBhBox) liveBhBox.innerHTML = renderBoreholeProfileSvg(assessment, lastModel, lastAudit);
  const liveSizingBox = document.getElementById("liveSizingSvgBox");
  if (liveSizingBox) liveSizingBox.innerHTML = renderSizingAndWaterBalanceSvg(assessment, lastModel);
  document.getElementById("cadSvgBox").innerHTML = renderCadLayoutSvg(assessment, lastModel);
  renderEmbeddedDrawingsPreview();
  renderReadinessBars();
  renderSeeTriggerBanner();
  updateSidebarProgress();

  // Compliance Audit
  const depBox = document.getElementById("departuresBox");
  if (lastAudit.departures_from_strategy.length) {
    depBox.innerHTML = `<div style="background:var(--warn-bg); color:var(--warn-fg); padding:10px 12px; border-radius:8px; font-size:0.84rem;">
      <strong>Mandatory Executive Summary Departures:</strong>
      <ul style="margin:4px 0 0; padding-left:18px;">${lastAudit.departures_from_strategy.map((d) => `<li>${d}</li>`).join("")}</ul>
    </div>`;
  } else {
    depBox.innerHTML = `<div style="background:var(--pass-bg); color:var(--pass-fg); padding:8px 12px; border-radius:8px; font-size:0.84rem; font-weight:600;">
      ✓ Zero Strategy Departures — Ready for Section 68 Submission
    </div>`;
  }

  document.getElementById("complianceTableBox").innerHTML = `
    <table class="data-table">
      <thead><tr><th>Code</th><th>Parameter</th><th>Value</th><th>Clause</th><th>Status</th></tr></thead>
      <tbody>
        ${lastAudit.checks.map((c) => {
          const cls = c.status === "PASS" ? "badge-pass" : c.status === "FAIL" ? "badge-fail" : "badge-warn";
          return `<tr>
            <td><code>${c.code}</code></td>
            <td>${c.parameter}</td>
            <td>${c.measured_value}</td>
            <td style="font-size:0.78rem; color:var(--muted);">${c.clause}</td>
            <td><span class="badge ${cls}">${c.status}</span></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderReadinessBars() {
  if (!assessment || !lastModel || !lastAudit) return;
  const hasGis = Boolean(spatial?.fetched_live);
  const photoCnt = localPhotos.length + r2JobFiles.filter((f) => f.kind === "photo").length;
  const bhs = assessment.boreholes || [];
  const minBhDepth = bhs.length
    ? Math.min(...bhs.map((b) => Math.max(0, ...(b.horizons || []).map((h) => Number(h.depth_bottom_mm || 0)))))
    : 0;
  const bhOk = bhs.length >= 2 && minBhDepth >= 1000;
  const failCount = (lastAudit.checks || []).filter((c) => c.status === "FAIL").length;
  const pinCount = (assessment.field_pins || []).length;

  const chip = (cls, text, target) =>
    `<button type="button" class="readiness-chip ${cls}" data-jump-panel="${target}">${text}</button>`;

  const ossmBar = document.getElementById("ossmReadinessBar");
  if (ossmBar) {
    ossmBar.innerHTML =
      `<strong style="color:var(--heading); margin-right:4px;">Pre-Lodgement Check:</strong>` +
      chip(hasGis ? "ok" : "warn", hasGis ? "✓ Live NSW GIS" : "⚠ Fetch Live GIS", "panel-hub") +
      chip(photoCnt > 0 ? "ok" : "warn", photoCnt > 0 ? `✓ ${photoCnt} Site Photo${photoCnt === 1 ? "" : "s"}` : "⚠ Add Site Photos", "panel-field") +
      chip(bhOk ? "ok" : "warn", bhOk ? `✓ ${bhs.length} BH (≥1000 mm)` : `⚠ ${bhs.length} BH / ${minBhDepth} mm`, "panel-ossm-soil") +
      chip(failCount === 0 ? "ok" : "fail", failCount === 0 ? "✓ 0 Compliance FAILs" : `✕ ${failCount} Compliance FAIL`, "panel-ossm-model") +
      chip(pinCount > 0 ? "ok" : "warn", pinCount > 0 ? `✓ ${pinCount} MGA56 Pin${pinCount === 1 ? "" : "s"}` : "○ Drop Map Pins (Opt)", "panel-hub");
    ossmBar.querySelectorAll("[data-jump-panel]").forEach((b) =>
      b.addEventListener("click", () => switchTab(b.dataset.jumpPanel)),
    );
  }

  const seeBar = document.getElementById("seeReadinessBar");
  if (seeBar) {
    const seeSummary = (document.getElementById("seeSummary")?.value || "").trim();
    const linkOssm = document.getElementById("seeLinkOssm")?.checked !== false;
    seeBar.innerHTML =
      `<strong style="color:var(--heading); margin-right:4px;">DA Readiness:</strong>` +
      chip(hasGis ? "ok" : "warn", hasGis ? "✓ Live LEP / Hazard GIS" : "⚠ Fetch Live GIS", "panel-hub") +
      chip(photoCnt > 0 ? "ok" : "warn", photoCnt > 0 ? `✓ ${photoCnt} Site Photo${photoCnt === 1 ? "" : "s"}` : "⚠ Add Site Photos", "panel-field") +
      chip(seeSummary.length > 10 ? "ok" : "warn", seeSummary.length > 10 ? "✓ Proposal Summary" : "⚠ Add Proposal Summary", "panel-see-plan") +
      chip(linkOssm ? "ok" : "warn", linkOssm ? "✓ Linked OSSM Cl. 6.9" : "○ OSSM Unlinked", "panel-see-plan");
    seeBar.querySelectorAll("[data-jump-panel]").forEach((b) =>
      b.addEventListener("click", () => switchTab(b.dataset.jumpPanel)),
    );
  }
}

function renderEmbeddedDrawingsPreview() {
  if (!assessment || !lastModel || !lastAudit) return;
  const elTT = document.getElementById("prevTreatmentTrain");
  const elGis = document.getElementById("prevGisMap");
  const elBh = document.getElementById("prevBoreholeProfile");
  const elSizing = document.getElementById("prevSizingChart");
  const elGrWrap = document.getElementById("prevGreaseWrap");
  const elGr = document.getElementById("prevGreaseXsec");
  const elSep = document.getElementById("prevSepticXsec");
  const elRbWrap = document.getElementById("prevReedBedWrap");
  const elRb = document.getElementById("prevReedBedXsec");
  const elLaa = document.getElementById("prevLaaXsec");
  const elLaaLabel = document.getElementById("prevLaaLabel");

  if (elTT) elTT.innerHTML = renderTreatmentTrainSvg(assessment, lastModel);
  const gisSvgStr = renderGisSiteMapSvg(assessment, spatial, { drawingCode: "OSSM-GIS-01", submissionLabel: "S68 SUBMISSION" });
  if (elGis) elGis.innerHTML = gisSvgStr;
  if (elBh) elBh.innerHTML = renderBoreholeProfileSvg(assessment, lastModel, lastAudit);
  if (elSizing) elSizing.innerHTML = renderSizingAndWaterBalanceSvg(assessment, lastModel);
  const elSeeGis = document.getElementById("prevSeeGisMap");
  if (elSeeGis) {
    elSeeGis.innerHTML = renderGisSiteMapSvg(assessment, spatial, { drawingCode: "SEE-GIS-01", submissionLabel: "DA SUBMISSION" });
  }

  const hasGrease = (lastModel.grease_arrestor_min_l || 0) > 0;
  if (elGrWrap) elGrWrap.style.display = hasGrease ? "block" : "none";
  if (elGr && hasGrease) elGr.innerHTML = renderGreaseArrestorCrossSectionSvg(lastModel);

  if (elSep) elSep.innerHTML = renderSepticCrossSectionSvg(lastModel);

  const hasRb = assessment.treatment_system === "secondary_reed_bed";
  if (elRbWrap) elRbWrap.style.display = hasRb ? "block" : "none";
  if (elRb && hasRb) elRb.innerHTML = renderReedBedCrossSectionSvg(assessment, lastModel);

  const isIrrig = assessment.land_application_type !== "eta_beds";
  if (elLaaLabel) {
    elLaaLabel.textContent = isIrrig
      ? "Section 9.4 — Sub-Surface Drip Irrigation Cross-Section"
      : "Section 9.4 — ETA Bed Cross-Section (LCC Design 1)";
  }
  if (elLaa) {
    elLaa.innerHTML = isIrrig
      ? renderSdiCrossSectionSvg(assessment, lastModel)
      : renderEtaCrossSectionSvg(assessment, lastModel, lastAudit);
  }
}

// ============================================================================
// BOREHOLES EDITOR
// ============================================================================
function renderBoreholesEditor() {
  const box = document.getElementById("boreholesContainer");
  box.innerHTML = (assessment.boreholes || []).map((bh, bIdx) => `
    <div style="border:1px solid var(--border); border-radius:8px; padding:10px; margin-bottom:10px; background:var(--surface-alt); color:var(--ink);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="color:var(--heading);">${bh.borehole_id}</strong>
        <span style="font-size:0.78rem; color:var(--muted);">Ribbon: ${bh.bolus_ribbon_mm || "40-50 mm"}</span>
      </div>
      <table class="data-table" style="font-size:0.78rem;">
        <thead><tr><th>Hor</th><th>Bottom mm</th><th>Class</th><th>Struct</th><th>pH</th><th>Emerson</th></tr></thead>
        <tbody>
          ${bh.horizons.map((h, hIdx) => `
            <tr>
              <td>${h.horizon}</td>
              <td><input data-bh="${bIdx}" data-hr="${hIdx}" data-k="depth_bottom_mm" type="number" value="${h.depth_bottom_mm}" style="width:64px; padding:3px;" /></td>
              <td><input data-bh="${bIdx}" data-hr="${hIdx}" data-k="classification" value="${h.classification}" style="width:110px; padding:3px;" /></td>
              <td><input data-bh="${bIdx}" data-hr="${hIdx}" data-k="structure_moist" value="${h.structure_moist}" style="width:74px; padding:3px;" /></td>
              <td><input data-bh="${bIdx}" data-hr="${hIdx}" data-k="ph" type="number" step="0.5" value="${h.ph ?? 6.0}" style="width:52px; padding:3px;" /></td>
              <td><input data-bh="${bIdx}" data-hr="${hIdx}" data-k="dispersive_class" type="number" min="1" max="4" value="${h.dispersive_class ?? 2}" style="width:44px; padding:3px;" /></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `).join("");

  box.querySelectorAll("input[data-bh]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const b = Number(inp.dataset.bh), h = Number(inp.dataset.hr), k = inp.dataset.k;
      const val = inp.type === "number" ? Number(inp.value) : inp.value;
      assessment.boreholes[b].horizons[h][k] = val;
      recalculateAndRender();
    });
  });
}

document.getElementById("btnAddBorehole").addEventListener("click", () => {
  const n = (assessment.boreholes?.length || 0) + 1;
  assessment.boreholes.push({
    borehole_id: `BH${n}`,
    bolus_ribbon_mm: "40–50 mm",
    bolus_description: "Clay loam / light clay",
    depth_to_bedrock_m: 3.0,
    depth_to_water_table_m: 3.0,
    horizons: [
      { horizon: "A", depth_top_mm: 0, depth_bottom_mm: 150, classification: "Topsoil", texture_moist: "loamy", structure_moist: "moderate", colour: "Dark brown", coarse_fragments_pct: 5, ph: 6.0, dispersive_class: 2, is_disposal_level: false },
      { horizon: "B", depth_top_mm: 150, depth_bottom_mm: 1000, classification: "Clay loam", texture_moist: "plastic", structure_moist: "moderate", colour: "Brown", coarse_fragments_pct: 5, ph: 6.0, dispersive_class: 2, is_disposal_level: true },
    ],
  });
  renderBoreholesEditor();
  recalculateAndRender();
});

// ============================================================================
// INTERACTIVE MAP + PIN PLACEMENT + LIVE NSW GIS
// ============================================================================
function recomputePinLocalCoords() {
  const pins = assessment?.field_pins || [];
  if (!pins.length) return;
  const resolveMga = (p) => {
    if (p.easting_mga56 && p.northing_mga56 && Math.abs(p.northing_mga56) > 1000) {
      return [Number(p.easting_mga56), Number(p.northing_mga56)];
    }
    if (p.longitude != null && p.latitude != null) {
      return wgs84ToMga56(Number(p.longitude), Number(p.latitude));
    }
    if (p.easting_mga56 && p.northing_mga56 && Math.abs(p.northing_mga56) <= 90) {
      return wgs84ToMga56(Number(p.easting_mga56), Number(p.northing_mga56));
    }
    return null;
  };
  const dwPin = pins.find((p) => p.feature_type === "dwelling");
  let origin = dwPin ? resolveMga(dwPin) : null;
  if (!origin && spatial?.centroid_easting_mga56 && spatial?.centroid_northing_mga56) {
    origin = [Number(spatial.centroid_easting_mga56), Number(spatial.centroid_northing_mga56)];
  }
  if (!origin) origin = resolveMga(pins[0]);
  if (!origin) return;

  for (const p of pins) {
    const mga = resolveMga(p);
    if (!mga) continue;
    p.easting_mga56 = mga[0];
    p.northing_mga56 = mga[1];
    p.local_x_m = Math.round((mga[0] - origin[0]) * 100) / 100;
    p.local_y_m = Math.round((mga[1] - origin[1]) * 100) / 100;
  }
}

function dropPinAtLatLng(ptype, lat, lng) {
  const [easting, northing] = wgs84ToMga56(lng, lat);
  assessment.field_pins = assessment.field_pins || [];
  const bhCount = assessment.field_pins.filter((p) => p.feature_type === "borehole").length;
  const label = ptype === "borehole" ? `BH${bhCount + 1}` : ptype.replace(/_/g, " ").toUpperCase();
  if (ptype !== "borehole") {
    assessment.field_pins = assessment.field_pins.filter((p) => p.feature_type !== ptype);
  }
  assessment.field_pins.push({
    label,
    feature_type: ptype,
    local_x_m: 0,
    local_y_m: 0,
    easting_mga56: easting,
    northing_mga56: northing,
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lng.toFixed(6)),
  });
  recomputePinLocalCoords();
  renderMapPins();
  syncStateFromForm();
  return { label, easting, northing };
}

function updatePinModeUi() {
  const sel = document.getElementById("pinTypeSelect");
  const mapEl = document.getElementById("wbMap");
  const banner = document.getElementById("pinModeBanner");
  const txt = document.getElementById("pinModeText");
  const val = sel?.value || "";
  if (mapEl) mapEl.classList.toggle("pin-mode", Boolean(val));
  if (banner) banner.classList.toggle("active", Boolean(val));
  if (txt && val) {
    const label = sel.options[sel.selectedIndex]?.text || val;
    txt.textContent = `Pin-Drop Mode: ${label} — click map or tap "Use My GPS" to record GDA2020 MGA56.`;
  }
}

document.getElementById("pinTypeSelect")?.addEventListener("change", updatePinModeUi);
document.getElementById("btnExitPinMode")?.addEventListener("click", () => {
  const sel = document.getElementById("pinTypeSelect");
  if (sel) sel.value = "";
  updatePinModeUi();
});

document.getElementById("btnDropGpsPin")?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("GPS geolocation is not supported on this browser.", "warn");
    return;
  }
  const sel = document.getElementById("pinTypeSelect");
  const ptype = sel?.value || "eta_bed";
  if (sel && !sel.value) {
    sel.value = ptype;
    updatePinModeUi();
  }
  const btn = document.getElementById("btnDropGpsPin");
  btn.disabled = true;
  btn.textContent = "Locating...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      btn.textContent = "📍 Use My GPS";
      const { latitude, longitude, accuracy } = pos.coords;
      const dropped = dropPinAtLatLng(ptype, latitude, longitude);
      if (wbMap) wbMap.setView([latitude, longitude], Math.max(wbMap.getZoom(), 18));
      showToast(`Pinned ${dropped.label} via GPS (±${Math.round(accuracy)} m · E${Math.round(dropped.easting)} N${Math.round(dropped.northing)})`, "pass");
    },
    (err) => {
      btn.disabled = false;
      btn.textContent = "📍 Use My GPS";
      showToast(`GPS error: ${err.message}`, "error");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
  );
});

function initWbMap() {
  if (wbMap) return;
  wbMap = L.map("wbMap").setView([-28.58, 153.18], 13);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Imagery &copy; Esri | Cadastre &copy; NSW Spatial Services",
    maxZoom: 19,
  }).addTo(wbMap);
  wbGisLayer = L.layerGroup().addTo(wbMap);
  wbPinsLayer = L.layerGroup().addTo(wbMap);

  wbMap.on("click", (ev) => {
    const ptype = document.getElementById("pinTypeSelect").value;
    if (!ptype) return;
    const { lat, lng } = ev.latlng;
    const dropped = dropPinAtLatLng(ptype, lat, lng);
    showToast(`Recorded ${dropped.label} (MGA56 E${Math.round(dropped.easting)} N${Math.round(dropped.northing)})`, "info", 2200);
  });
}

function renderMapPins() {
  if (!wbPinsLayer) return;
  wbPinsLayer.clearLayers();
  const pins = assessment.field_pins || [];
  pins.forEach((p) => {
    const lat = p.latitude != null ? p.latitude : (p.northing_mga56 && Math.abs(p.northing_mga56) <= 90 ? p.northing_mga56 : null);
    const lng = p.longitude != null ? p.longitude : (p.easting_mga56 && Math.abs(p.easting_mga56) <= 180 ? p.easting_mga56 : null);
    if (lat != null && lng != null) {
      L.circleMarker([lat, lng], {
        radius: 7, color: "#fff", weight: 2, fillColor: "#b45309", fillOpacity: 0.95,
      }).bindTooltip(p.label, { permanent: true, direction: "top" }).addTo(wbPinsLayer);
    }
  });

  const etaPin = pins.find((p) => p.feature_type === "eta_bed");
  let setbackBanner = "";
  let measuredSetbacks = null;
  if (etaPin && etaPin.easting_mga56 && etaPin.northing_mga56 && Math.abs(etaPin.northing_mga56) > 1000 && spatial) {
    measuredSetbacks = computePinSetbacksMeters([etaPin.easting_mga56, etaPin.northing_mga56], spatial);
    const parts = [];
    if (measuredSetbacks.boundary_m != null) parts.push(`Boundary: <strong>${measuredSetbacks.boundary_m} m</strong>`);
    if (measuredSetbacks.watercourse_m != null) parts.push(`Nearest Mapped Watercourse: <strong>${measuredSetbacks.watercourse_m} m</strong>`);
    if (parts.length) {
      setbackBanner = `<div style="margin-top:6px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span>Measured from LAA Pin (MGA56): ${parts.join(" · ")}</span>
        <button type="button" id="btnApplyPinSetbacks" class="btn btn-outline btn-sm" style="padding:2px 8px; font-size:0.74rem;">Apply to Setback Fields</button>
      </div>`;
    }
  }

  const listEl = document.getElementById("pinsList");
  listEl.innerHTML = pins.length
    ? `<div>Captured MGA56 Pins (${pins.length}): ` +
      pins.map((p, idx) => `<span class="badge badge-info" style="margin:2px 4px 2px 0;" title="MGA56 E${p.easting_mga56 ?? "—"} N${p.northing_mga56 ?? "—"} (Local ${p.local_x_m ?? 0}m, ${p.local_y_m ?? 0}m)">${p.label} <button type="button" data-rm-pin="${idx}" style="border:none; background:none; color:inherit; cursor:pointer; font-weight:800; padding:0 0 0 3px;">✕</button></span>`).join("") +
      `</div>${setbackBanner}`
    : "Select a feature in 'Drop Pin' and tap the satellite imagery to record GDA2020 MGA56 coordinates for CAD & setback checks.";

  listEl.querySelectorAll("[data-rm-pin]").forEach((btn) => {
    btn.addEventListener("click", () => {
      assessment.field_pins.splice(Number(btn.dataset.rmPin), 1);
      recomputePinLocalCoords();
      renderMapPins();
      syncStateFromForm();
    });
  });

  document.getElementById("btnApplyPinSetbacks")?.addEventListener("click", () => {
    if (!measuredSetbacks) return;
    if (measuredSetbacks.boundary_m != null) {
      document.getElementById("fDistBound").value = measuredSetbacks.boundary_m;
    }
    if (measuredSetbacks.watercourse_m != null) {
      document.getElementById("fDistWater").value = measuredSetbacks.watercourse_m;
    }
    syncStateFromForm();
  });
}

function renderSpatialOnMap() {
  initWbMap();
  wbGisLayer.clearLayers();
  const box = document.getElementById("gisOverlaysBox");
  if (!spatial || !spatial.fetched_live) {
    box.textContent = spatial?.warnings?.join(" ") || "No live NSW GIS overlay fetched yet.";
    return;
  }

  box.innerHTML = `
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
      <span class="badge badge-info">${spatial.lot_id_string} (${spatial.parcel_area_ha} ha)</span>
      <span class="badge badge-info">Zone: ${(spatial.land_zoning || []).join(", ") || "Verify"}</span>
      <span class="badge ${spatial.drinking_water_catchment ? "badge-warn" : "badge-pass"}">Rous Water: ${spatial.drinking_water_catchment ? "YES" : "No"}</span>
      <span class="badge ${spatial.flood_planning ? "badge-warn" : "badge-pass"}">Flood: ${spatial.flood_planning ? "YES" : "No"}</span>
      <span class="badge ${spatial.acid_sulfate_soils?.length ? "badge-warn" : "badge-pass"}">ASS: ${spatial.acid_sulfate_soils?.length ? spatial.acid_sulfate_soils[0] : "None"}</span>
      <span class="badge ${spatial.bushfire_prone_land?.length ? "badge-warn" : "badge-pass"}">BFPL: ${spatial.bushfire_prone_land?.length ? "Yes" : "No"}</span>
    </div>
    <ul style="margin:0; padding-left:18px;">${(spatial.pre_site_flags || []).map((f) => `<li>${f}</li>`).join("")}</ul>
  `;

  if (spatial.neighbour_parcels_geojson?.length) {
    L.geoJSON(spatial.neighbour_parcels_geojson, { style: { color: "#cbd5e1", weight: 1, fillOpacity: 0.05 } }).addTo(wbGisLayer);
  }
  if (spatial.watercourses_geojson?.length) {
    L.geoJSON(spatial.watercourses_geojson, { style: { color: "#38bdf8", weight: 2.2 } }).addTo(wbGisLayer);
  }
  if (spatial.parcel_geojson) {
    const subj = L.geoJSON(spatial.parcel_geojson, {
      style: { color: "#ef4444", weight: 2.6, fillColor: "#f87171", fillOpacity: 0.22 },
    }).addTo(wbGisLayer);
    setTimeout(() => {
      wbMap.invalidateSize();
      wbMap.fitBounds(subj.getBounds().pad(0.25));
    }, 80);
  }
  renderMapPins();
  renderEmbeddedDrawingsPreview();
  renderSeeTriggerBanner();
  updateSidebarProgress();
}

document.getElementById("btnRunGis").addEventListener("click", async () => {
  syncStateFromForm();
  const st = document.getElementById("gisStatus");
  st.textContent = "Querying live NSW Spatial Services...";
  try {
    const qs = new URLSearchParams({ lot: assessment.lot_number, plan: assessment.plan_label });
    const r = await fetch(`/consulting/api/spatial/precheck?${qs.toString()}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || data.error);
    spatial = data;
    if (spatial.parcel_area_m2 && !assessment.is_multiple_occupancy) {
      assessment.block_size_m2 = Math.round(spatial.parcel_area_m2);
      document.getElementById("fBlockM2").value = assessment.block_size_m2;
    }
    st.textContent = spatial.fetched_live ? "Live NSW GIS Loaded ✓" : "Lot not found";
    renderSpatialOnMap();
    recalculateAndRender();
  } catch (err) {
    st.textContent = `Error: ${err.message}`;
  }
});

// ============================================================================
// VOICE DICTATION, AUDIO MEMO & R2 PHOTO UPLOAD
// ============================================================================
let recognition = null;
document.getElementById("btnDictate").addEventListener("click", () => {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const st = document.getElementById("voiceStatus");
  if (!SpeechRec) {
    st.textContent = "Speech recognition requires Chrome/Edge; use Audio Memo recorder instead.";
    return;
  }
  if (recognition) {
    recognition.stop();
    recognition = null;
    document.getElementById("btnDictate").textContent = "Start Voice Dictation";
    st.textContent = "Dictation stopped.";
    return;
  }
  recognition = new SpeechRec();
  recognition.lang = "en-AU";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (ev) => {
    let txt = "";
    for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript + " ";
    document.getElementById("fVoiceTranscript").value = txt.trim();
  };
  recognition.start();
  document.getElementById("btnDictate").textContent = "Stop Dictation";
  st.textContent = "Listening (en-AU)...";
});

let mediaRec = null;
let audioChunks = [];
document.getElementById("btnRecordAudio").addEventListener("click", async () => {
  const st = document.getElementById("voiceStatus");
  if (mediaRec && mediaRec.state === "recording") {
    mediaRec.stop();
    document.getElementById("btnRecordAudio").textContent = "Record Audio Memo";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRec.onstop = async () => {
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      if (activeJobId && navigator.onLine) {
        const fd = new FormData();
        fd.append("file", blob, `voice_memo_${Date.now()}.webm`);
        fd.append("kind", "audio");
        fd.append("caption", "Field voice memo");
        await fetch(`/consulting/api/jobs/${activeJobId}/files`, { method: "POST", body: fd });
        st.textContent = "Audio memo saved to Cloudflare R2 ✓";
        loadJobFiles(activeJobId);
      } else {
        st.textContent = `Audio recorded (${Math.round(blob.size / 1024)} KB) — Save Job to D1 to upload to R2.`;
      }
    };
    mediaRec.start();
    document.getElementById("btnRecordAudio").textContent = "Stop Recording";
    st.textContent = "Recording field voice memo...";
  } catch (err) {
    st.textContent = `Microphone error: ${err.message}`;
  }
});

function renderLocalPhotos() {
  const box = document.getElementById("localPhotosBox");
  if (!box) return;
  if (!localPhotos.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = localPhotos
    .map(
      (ph) => `
      <div style="border:1px solid var(--border); border-radius:8px; padding:6px; width:136px; background:var(--surface-alt); font-size:0.74rem;">
        <img src="${ph.previewUrl}" alt="${ph.caption}" style="width:100%; height:82px; object-fit:cover; border-radius:5px;" />
        <div style="margin-top:4px; font-weight:600; color:var(--heading); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${ph.caption}">${ph.caption}</div>
        <button type="button" data-rm-photo="${ph.id}" style="margin-top:4px; font-size:0.7rem; color:var(--fail-fg); background:none; border:none; cursor:pointer; padding:0;">Remove</button>
      </div>`,
    )
    .join("");
  box.querySelectorAll("[data-rm-photo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rmId = btn.dataset.rmPhoto;
      localPhotos = localPhotos.filter((p) => p.id !== rmId);
      deleteOfflinePhoto(rmId).catch(() => {});
      renderLocalPhotos();
      updateSidebarProgress();
      updateNetBadge();
    });
  });
}

async function restoreLocalPhotosFromIdb(draftKey) {
  localPhotos.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
  localPhotos = [];
  const savedPhotos = await listOfflinePhotos(draftKey).catch(() => []);
  for (const ph of savedPhotos) {
    if (!ph.bytes) continue;
    const blob = new Blob([ph.bytes], { type: ph.mimeType || "image/jpeg" });
    localPhotos.push({
      id: ph.id,
      caption: ph.caption,
      ext: ph.ext || "jpg",
      mimeType: ph.mimeType || "image/jpeg",
      bytes: ph.bytes,
      synced: Boolean(ph.synced),
      previewUrl: URL.createObjectURL(blob),
    });
  }
  renderLocalPhotos();
  updateSidebarProgress();
}

document.getElementById("btnUploadPhoto").addEventListener("click", async () => {
  const fileEl = document.getElementById("photoFileInput");
  if (!fileEl.files.length) return showToast("Choose or capture a site photo first.", "warn");
  const file = fileEl.files[0];
  const caption = document.getElementById("photoCaptionInput").value.trim() || file.name.replace(/\.[^.]+$/, "");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const mimeType = file.type || "image/jpeg";
  const bytes = await file.arrayBuffer();
  const previewUrl = URL.createObjectURL(file);
  const photoId = `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const draftKey = getDraftKey(activeJobId, assessment);

  const photoObj = {
    id: photoId,
    caption,
    ext,
    mimeType,
    bytes,
    synced: false,
    previewUrl,
  };
  localPhotos.push(photoObj);
  // Persist immediately to IndexedDB so offline reloads NEVER lose site photos
  await saveOfflinePhoto({
    id: photoId,
    draftKey,
    caption,
    ext,
    mimeType,
    bytes,
    synced: false,
  }).catch(() => {});
  renderLocalPhotos();
  updateSidebarProgress();
  document.getElementById("photoCaptionInput").value = "";
  fileEl.value = "";

  // Also persist to Cloudflare R2 if online & job can be saved
  if (navigator.onLine) {
    try {
      if (!activeJobId) await saveActiveJobToD1();
      if (activeJobId) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "photo");
        fd.append("caption", caption);
        const resp = await fetch(`/consulting/api/jobs/${activeJobId}/files`, { method: "POST", body: fd });
        if (resp.ok) {
          photoObj.synced = true;
          await markOfflinePhotoSynced(photoId, getDraftKey(activeJobId, assessment)).catch(() => {});
          loadJobFiles(activeJobId);
        }
      }
    } catch (_) {
      // Photo remains safely persisted in IndexedDB for offline .docx embedding & auto-sync when online
    }
  }
  updateNetBadge();
});

async function loadJobFiles(jobId) {
  if (!jobId) return;
  const r = await fetch(`/consulting/api/jobs/${jobId}`);
  if (!r.ok) return;
  const data = await r.json();
  const files = data.files || [];
  r2JobFiles = files;
  document.getElementById("r2FilesList").innerHTML = files.length
    ? `<strong>Stored in Cloudflare R2 (${files.length}):</strong> ` +
      files.map((f) => `<a href="/consulting/api/files/${f.r2_key}" target="_blank" class="badge badge-info" style="margin:2px;">${f.kind}: ${f.filename}</a>`).join("")
    : "No files uploaded to R2 for this job yet.";
}

// ============================================================================
// D1 DASHBOARD & JOB PERSISTENCE
// ============================================================================
function renderFilteredJobsTable() {
  const jBox = document.getElementById("jobsList");
  if (!jBox) return;
  const q = (document.getElementById("dashJobSearch")?.value || "").trim().toLowerCase();
  const statusF = (document.getElementById("dashJobStatusFilter")?.value || "").trim().toLowerCase();
  const filtered = dashboardJobsCache.filter((j) => {
    if (statusF && String(j.status || "").toLowerCase() !== statusF) return false;
    if (!q) return true;
    const hay = `${j.project_ref || ""} ${j.applicant_name || ""} ${j.site_address || ""} ${j.lot_number || ""} ${j.plan_label || ""}`.toLowerCase();
    return hay.includes(q);
  });

  if (!dashboardJobsCache.length) {
    jBox.innerHTML = `<p style="color:var(--muted);">No saved jobs in D1 yet. Click <strong>+ Create New Job</strong> to start a project.</p>`;
    return;
  }
  if (!filtered.length) {
    jBox.innerHTML = `<p style="color:var(--muted);">No jobs match your search/status filter.</p>`;
    return;
  }

  const escAttr = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const statuses = ["precheck", "field", "drafted", "qa", "lodged", "approved"];
  jBox.innerHTML = `<table class="data-table"><thead><tr><th>Ref</th><th>Client &amp; Lot</th><th>Status</th><th>Actions</th></tr></thead><tbody>` +
    filtered.map((j) => `<tr>
      <td><strong>${escAttr(j.project_ref)}</strong></td>
      <td>${escAttr(j.applicant_name)}<br/><span style="font-size:0.78rem; color:var(--muted);">Lot ${escAttr(j.lot_number)} ${escAttr(j.plan_label)}</span></td>
      <td>
        <select class="status-select" data-job-status="${escAttr(j.id)}" data-status="${escAttr(j.status)}" aria-label="Job status">
          ${statuses.map((st) => `<option value="${st}" ${st === j.status ? "selected" : ""}>${st}</option>`).join("")}
        </select>
      </td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:nowrap;">
          <button class="btn btn-outline btn-sm" data-open-job="${escAttr(j.id)}">Open</button>
          <button class="btn btn-danger-outline btn-sm" data-del-job="${escAttr(j.id)}" data-del-ref="${escAttr(j.project_ref)}" data-del-name="${escAttr(j.applicant_name)}" title="Permanently delete job, D1 records, and all R2 files">Delete</button>
        </div>
      </td>
    </tr>`).join("") + `</tbody></table>`;

  jBox.querySelectorAll("[data-open-job]").forEach((b) =>
    b.addEventListener("click", () => openJobFromD1(b.dataset.openJob)),
  );
  jBox.querySelectorAll("[data-del-job]").forEach((b) =>
    b.addEventListener("click", () => deleteJobFromD1(b.dataset.delJob, b.dataset.delRef, b.dataset.delName, b)),
  );
  jBox.querySelectorAll("[data-job-status]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.dataset.jobStatus;
      const nextStatus = sel.value;
      sel.dataset.status = nextStatus;
      try {
        const resp = await fetch(`/consulting/api/jobs/${encodeURIComponent(id)}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const row = dashboardJobsCache.find((x) => x.id === id);
        if (row) row.status = nextStatus;
        showToast(`Status updated to '${nextStatus}'.`, "pass", 2200);
      } catch (err) {
        showToast(`Status update failed: ${err.message}`, "error");
      }
    });
  });
}

document.getElementById("dashJobSearch")?.addEventListener("input", renderFilteredJobsTable);
document.getElementById("dashJobStatusFilter")?.addEventListener("change", renderFilteredJobsTable);

async function refreshDashboard() {
  const offlineDrafts = await listOfflineDrafts().catch(() => []);
  const kpiOff = document.getElementById("dashKpiOffline");
  if (kpiOff) kpiOff.textContent = String(offlineDrafts.length);

  try {
    const [jr, er] = await Promise.all([
      fetch("/consulting/api/jobs"),
      fetch("/consulting/api/enquiries"),
    ]);
    const jobsData = jr.ok ? await jr.json() : { jobs: [] };
    const enqData = er.ok ? await er.json() : { enquiries: [] };
    dashboardJobsCache = jobsData.jobs || [];

    const jCnt = document.getElementById("navJobsCount");
    if (jCnt) jCnt.textContent = String(dashboardJobsCache.length || 0);
    const kpiTot = document.getElementById("dashKpiTotal");
    const kpiAct = document.getElementById("dashKpiActive");
    const kpiEnq = document.getElementById("dashKpiEnq");
    if (kpiTot) kpiTot.textContent = String(dashboardJobsCache.length);
    if (kpiAct) kpiAct.textContent = String(dashboardJobsCache.filter((j) => !["lodged", "approved"].includes(j.status)).length);
    if (kpiEnq) kpiEnq.textContent = String((enqData.enquiries || []).filter((e) => e.status === "new").length);

    renderFilteredJobsTable();

    const eBox = document.getElementById("enquiriesList");
    if (!enqData.enquiries.length) {
      eBox.innerHTML = `<p style="color:var(--muted);">No public quote requests yet. Test the quote form on <a href="/consulting/#quote">/consulting/</a>.</p>`;
    } else {
      eBox.innerHTML = `<table class="data-table"><thead><tr><th>Client</th><th>Lot/DP</th><th>Status</th><th></th></tr></thead><tbody>` +
        enqData.enquiries.map((e) => `<tr>
          <td><strong>${e.full_name}</strong><br/><span style="font-size:0.78rem; color:var(--muted);">${e.email}</span></td>
          <td>${e.lot_number ? `Lot ${e.lot_number} ${e.plan_label}` : e.site_address || "—"}</td>
          <td><span class="badge ${e.status === "converted" ? "badge-pass" : "badge-warn"}">${e.status}</span></td>
          <td>${e.status !== "converted" ? `<button class="btn btn-accent btn-sm" data-conv-enq="${e.id}">Convert &rarr; Job</button>` : ""}</td>
        </tr>`).join("") + `</tbody></table>`;
      eBox.querySelectorAll("[data-conv-enq]").forEach((b) =>
        b.addEventListener("click", async () => {
          const resp = await fetch(`/consulting/api/enquiries/${b.dataset.convEnq}/convert`, { method: "POST" });
          if (resp.ok) {
            const out = await resp.json();
            await refreshDashboard();
            await openJobFromD1(out.job_id);
          }
        }),
      );
    }
  } catch (err) {
    const offlineDrafts = await listOfflineDrafts().catch(() => []);
    const jBox = document.getElementById("jobsList");
    if (offlineDrafts.length) {
      const escAttr = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      jBox.innerHTML =
        `<p style="color:var(--warn-fg); font-weight:600; margin-top:0;">Offline Mode — Showing ${offlineDrafts.length} local IndexedDB draft(s):</p>` +
        `<table class="data-table"><thead><tr><th>Ref</th><th>Client &amp; Lot</th><th>Saved</th><th></th></tr></thead><tbody>` +
        offlineDrafts.map((d) => `<tr>
          <td><strong>${escAttr(d.projectRef)}</strong></td>
          <td>${escAttr(d.applicantName)}<br/><span style="font-size:0.78rem; color:var(--muted);">Lot ${escAttr(d.lotNumber)} ${escAttr(d.planLabel)}</span></td>
          <td style="font-size:0.76rem; color:var(--muted);">${escAttr(String(d.updatedAt || "").slice(0, 16).replace("T", " "))}</td>
          <td><button class="btn btn-outline btn-sm" data-open-idb="${escAttr(d.draftKey)}">Open</button></td>
        </tr>`).join("") + `</tbody></table>`;
      jBox.querySelectorAll("[data-open-idb]").forEach((b) => {
        b.addEventListener("click", async () => {
          const rec = await getOfflineDraft(b.dataset.openIdb);
          if (!rec) return;
          activeJobId = rec.activeJobId || null;
          assessment = rec.assessment;
          spatial = rec.spatial || null;
          await restoreLocalPhotosFromIdb(rec.draftKey);
          hydrateFormFromState();
          renderSpatialOnMap();
          switchTab("panel-hub");
        });
      });
    } else {
      jBox.textContent = "Offline — using local IndexedDB storage.";
    }
  }
}

async function openJobFromD1(jobId) {
  const resp = await fetch(`/consulting/api/jobs/${jobId}`);
  if (!resp.ok) return;
  const data = await resp.json();
  activeJobId = data.id;
  assessment = data.assessment;
  spatial = data.spatial;
  vaultFiles = [];
  r2JobFiles = [];
  await restoreLocalPhotosFromIdb(getDraftKey(activeJobId, assessment));
  hydrateFormFromState();
  renderSpatialOnMap();
  loadJobFiles(jobId);
  switchTab("panel-hub");
}

async function deleteJobFromD1(jobId, projectRef, applicantName, btnEl) {
  const label = `${projectRef || jobId}${applicantName ? ` (${applicantName})` : ""}`;
  const confirmed = await showConfirmDialog(
    `Delete job ${label}?`,
    "This permanently removes the D1 database record and ALL associated R2 files (uploaded documents, site photos, audio memos, and archived reports). This cannot be undone.",
    "Delete Permanently",
  );
  if (!confirmed) return;
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = "Deleting...";
  }
  try {
    const resp = await fetch(`/consulting/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    const raw = await resp.text();
    let out = {};
    try { out = raw ? JSON.parse(raw) : {}; } catch (_) {}
    if (!resp.ok) throw new Error(out.error || `HTTP ${resp.status}`);

    await deleteOfflineDraft(`job:${jobId}`).catch(() => {});

    // If the currently open job was deleted, reset workspace cleanly to a fresh blank draft
    if (activeJobId === jobId) {
      activeJobId = null;
      spatial = null;
      localPhotos = [];
      vaultFiles = [];
      r2JobFiles = [];
      compiledArtifacts = null;
      compiledSeeArtifact = null;
      pendingAiExtract = null;
      assessment = createBlankAssessment();
      renderLocalPhotos();
      renderVaultFilesChips();
      const filesBox = document.getElementById("jobFilesList");
      if (filesBox) filesBox.innerHTML = `<span style="color:var(--muted);">No files uploaded yet.</span>`;
      hydrateFormFromState();
      if (wbMap) renderSpatialOnMap();
    }
    await refreshDashboard();
    showToast(`Deleted job ${label} and associated R2 files.`, "pass");
  } catch (err) {
    showToast(`Failed to delete job: ${err.message}`, "error");
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = "Delete";
    }
  }
}

async function saveActiveJobToD1() {
  syncStateFromForm();
  // Trim heavy raw GIS contour vertices client-side before sending to D1 (server also compacts)
  const spatialForApi = spatial
    ? {
        ...spatial,
        contours_geojson: (spatial.contours_geojson || []).slice(0, 25),
        neighbour_parcels_geojson: (spatial.neighbour_parcels_geojson || []).slice(0, 18),
        watercourses_geojson: (spatial.watercourses_geojson || []).slice(0, 25),
      }
    : null;
  const payload = {
    status: "field",
    assessment,
    spatial: spatialForApi,
    model_result: lastModel,
    audit_result: lastAudit,
  };
  const btn = document.getElementById("btnSaveJob");
  btn.disabled = true;
  try {
    let resp;
    if (activeJobId) {
      resp = await fetch(`/consulting/api/jobs/${activeJobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      resp = await fetch("/consulting/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    const rawText = await resp.text();
    let out = {};
    try {
      out = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      throw new Error(`HTTP ${resp.status}: ${rawText.slice(0, 200) || "Non-JSON server response"}`);
    }
    if (!resp.ok) throw new Error(out.error || out.detail || `Save failed (HTTP ${resp.status})`);
    const prevDraftKey = getDraftKey(activeJobId, assessment);
    activeJobId = out.id || activeJobId;
    const newDraftKey = getDraftKey(activeJobId, assessment);
    if (prevDraftKey !== newDraftKey) {
      await rekeyOfflinePhotos(prevDraftKey, newDraftKey).catch(() => {});
      await deleteOfflineDraft(prevDraftKey).catch(() => {});
    }
    await saveOfflineDraft({ draftKey: newDraftKey, activeJobId, assessment, spatial, dirty: false }).catch(() => {});
    await flushOfflineSyncQueue();
    markSaved();
    btn.textContent = "Saved to D1 ✓";
    showToast(`Saved ${assessment.project_ref} to Cloudflare D1.`, "pass", 2400);
    setTimeout(() => { updateSaveStateUi(); }, 1800);
    refreshDashboard();
  } catch (err) {
    showToast(`Saved locally in IndexedDB. D1 sync deferred: ${err.message}`, "warn", 4500);
  } finally {
    btn.disabled = false;
    updateSaveStateUi();
  }
}

document.getElementById("btnSaveJob")?.addEventListener("click", saveActiveJobToD1);
document.getElementById("btnRefreshDash")?.addEventListener("click", refreshDashboard);

// ============================================================================
// SHARED PROJECT EVIDENCE VAULT (DROPZONE + MULTI-FILE CHIPS)
// ============================================================================
function renderVaultFilesChips() {
  const box = document.getElementById("vaultFilesChips");
  if (!box) return;
  if (!vaultFiles.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = vaultFiles
    .map(
      (f, idx) => `
      <span class="vault-file-chip">
        📄 ${f.name} <span style="color:var(--muted); font-weight:500;">(${Math.max(1, Math.round(f.size / 1024))} KB)</span>
        <button type="button" data-rm-vault="${idx}" style="border:none; background:none; color:var(--fail-fg); cursor:pointer; font-weight:800; padding:0 2px;">✕</button>
      </span>`,
    )
    .join("");
  box.querySelectorAll("[data-rm-vault]").forEach((btn) => {
    btn.addEventListener("click", () => {
      vaultFiles.splice(Number(btn.dataset.rmVault), 1);
      renderVaultFilesChips();
    });
  });
}

function addFilesToVault(fileList) {
  for (const f of fileList || []) {
    if (!vaultFiles.some((x) => x.name === f.name && x.size === f.size)) {
      vaultFiles.push(f);
    }
  }
  renderVaultFilesChips();
}

const vaultZone = document.getElementById("vaultDropzone");
const aiFilesInputEl = document.getElementById("aiFilesInput");
if (vaultZone && aiFilesInputEl) {
  vaultZone.addEventListener("click", () => aiFilesInputEl.click());
  vaultZone.addEventListener("dragover", (e) => { e.preventDefault(); vaultZone.classList.add("dragover"); });
  vaultZone.addEventListener("dragleave", () => vaultZone.classList.remove("dragover"));
  vaultZone.addEventListener("drop", (e) => {
    e.preventDefault();
    vaultZone.classList.remove("dragover");
    addFilesToVault(e.dataTransfer?.files);
  });
  aiFilesInputEl.addEventListener("change", () => {
    addFilesToVault(aiFilesInputEl.files);
    aiFilesInputEl.value = "";
  });
}

// ============================================================================
// NEW PROJECT WIZARD MODAL (SCOPE + BRIEF + EXISTING DOCS)
// ============================================================================
function openNewJobModal() {
  const modal = document.getElementById("newJobModal");
  if (!modal) return;
  document.getElementById("njApplicant").value = "";
  document.getElementById("njRef").value = `FTF-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
  document.getElementById("njAddress").value = "";
  document.getElementById("njLot").value = "";
  document.getElementById("njPlan").value = "";
  document.getElementById("njBrief").value = "";
  document.getElementById("njFiles").value = "";
  document.getElementById("njScopeOssm").checked = true;
  document.getElementById("njScopeSee").checked = true;
  document.getElementById("choiceOssmCard").classList.add("selected");
  document.getElementById("choiceSeeCard").classList.add("selected");
  modal.classList.add("open");
}

function closeNewJobModal() {
  document.getElementById("newJobModal")?.classList.remove("open");
}

document.getElementById("btnOpenNewJob")?.addEventListener("click", openNewJobModal);
document.getElementById("btnNewJobDash")?.addEventListener("click", openNewJobModal);
document.getElementById("btnCloseNewJob")?.addEventListener("click", closeNewJobModal);
document.getElementById("btnCancelNewJob")?.addEventListener("click", closeNewJobModal);
document.getElementById("njScopeOssm")?.addEventListener("change", (e) => {
  document.getElementById("choiceOssmCard")?.classList.toggle("selected", e.target.checked);
});
document.getElementById("njScopeSee")?.addEventListener("change", (e) => {
  document.getElementById("choiceSeeCard")?.classList.toggle("selected", e.target.checked);
});

document.getElementById("btnConfirmNewJob")?.addEventListener("click", async () => {
  const scopeOssm = document.getElementById("njScopeOssm").checked;
  const scopeSee = document.getElementById("njScopeSee").checked;
  if (!scopeOssm && !scopeSee) {
    showToast("Select at least one consulting deliverable (OSSM, SEE, or Both).", "warn");
    return;
  }

  activeJobId = null;
  spatial = null;
  localPhotos = [];
  vaultFiles = [];
  r2JobFiles = [];
  uploadedDocsSummary = "";
  pendingAiExtract = null;
  renderLocalPhotos();

  assessment = createBlankAssessment();
  assessment.deliverables = { ossm: scopeOssm, see: scopeSee };
  assessment.project_ref = document.getElementById("njRef").value.trim() || assessment.project_ref;
  assessment.applicant_name = document.getElementById("njApplicant").value.trim() || "New Client";
  assessment.site_address = document.getElementById("njAddress").value.trim() || "Lismore NSW 2480";
  assessment.lot_number = document.getElementById("njLot").value.trim() || "1";
  assessment.plan_label = (document.getElementById("njPlan").value.trim() || "DP000000").replace(/\s+/g, "").toUpperCase();
  assessment.project_brief = document.getElementById("njBrief").value.trim();

  const modalFiles = document.getElementById("njFiles")?.files;
  if (modalFiles?.length) addFilesToVault(modalFiles);

  if (assessment.project_brief) {
    document.getElementById("seeSummary").value = assessment.project_brief;
  }

  hydrateFormFromState();
  closeNewJobModal();
  switchTab("panel-hub");

  if (document.getElementById("njAutoGis")?.checked && assessment.lot_number && assessment.plan_label !== "DP000000") {
    document.getElementById("btnRunGis")?.click();
  }
});

// ============================================================================
// BROWSER PYODIDE EXPORT (.DOCX + .DXF + AUDIT JSON + R2 ARCHIVE)
// ============================================================================
async function rasterizeSvgToPngArrayBuffer(svgString, label = "SVG") {
  return new Promise((resolve) => {
    const vb = svgString.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    const vw = vb ? Math.round(Number(vb[1])) : 740;
    const vh = vb ? Math.round(Number(vb[2])) : 560;
    // Ensure explicit pixel width/height attributes on root <svg> so headless/Image rasterizers never render 0x0
    let normalizedSvg = svgString.replace(/<svg\b([^>]*)>/, (m, attrs) => {
      const cleaned = attrs
        .replace(/\swidth="[^"]*"/g, "")
        .replace(/\sheight="[^"]*"/g, "");
      return `<svg${cleaned} width="${vw}" height="${vh}">`;
    });

    const img = new Image();
    const blob = new Blob([normalizedSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = vw * 2;
      canvas.height = vh * 2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(async (pngBlob) => {
        resolve(pngBlob ? await pngBlob.arrayBuffer() : null);
      }, "image/png");
    };
    img.onerror = (e) => {
      console.error(`[rasterizeSvgToPngArrayBuffer] Failed to rasterize ${label}:`, e);
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function downloadBlob(blob, filename) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

document.getElementById("btnCompilePackage").addEventListener("click", async () => {
  syncStateFromForm();
  const btn = document.getElementById("btnCompilePackage");
  const prog = document.getElementById("ossmProgressTrack");
  btn.disabled = true;
  if (prog) prog.classList.add("active");
  try {
    logExport("Rasterizing GIS Site Map, CAD Layout Plan, Treatment Train & Engineering Cross-Sections...");
    const hasRb = assessment.treatment_system === "secondary_reed_bed";
    const isAwts = assessment.treatment_system === "secondary_awts";
    const isIrrig = assessment.land_application_type !== "eta_beds";
    const hasGrease = (lastModel.grease_arrestor_min_l || 0) > 0;

    const [
      cadPngBytes,
      gisPngBytes,
      ttPngBytes,
      sizingPngBytes,
      bhPngBytes,
      greasePngBytes,
      septicPngBytes,
      rbPngBytes,
      laaPngBytes,
    ] = await Promise.all([
      rasterizeSvgToPngArrayBuffer(renderCadLayoutSvg(assessment, lastModel), "CAD Layout"),
      rasterizeSvgToPngArrayBuffer(renderGisSiteMapSvg(assessment, spatial, { drawingCode: "OSSM-GIS-01", submissionLabel: "S68 SUBMISSION" }), "GIS Site Map"),
      rasterizeSvgToPngArrayBuffer(renderTreatmentTrainSvg(assessment, lastModel), "Treatment Train"),
      rasterizeSvgToPngArrayBuffer(renderSizingAndWaterBalanceSvg(assessment, lastModel), "Sizing & Water Balance Chart"),
      (assessment.boreholes || []).length ? rasterizeSvgToPngArrayBuffer(renderBoreholeProfileSvg(assessment, lastModel, lastAudit), "Borehole Soil Profile") : Promise.resolve(null),
      hasGrease ? rasterizeSvgToPngArrayBuffer(renderGreaseArrestorCrossSectionSvg(lastModel), "Grease Arrestor Cross-Section") : Promise.resolve(null),
      !isAwts ? rasterizeSvgToPngArrayBuffer(renderSepticCrossSectionSvg(lastModel), "Septic Cross-Section") : Promise.resolve(null),
      hasRb ? rasterizeSvgToPngArrayBuffer(renderReedBedCrossSectionSvg(assessment, lastModel), "Reed Bed Cross-Section") : Promise.resolve(null),
      rasterizeSvgToPngArrayBuffer(
        isIrrig
          ? renderSdiCrossSectionSvg(assessment, lastModel)
          : renderEtaCrossSectionSvg(assessment, lastModel, lastAudit),
        isIrrig ? "SDI Cross-Section" : "ETA Cross-Section",
      ),
    ]);

    const embeddedDrawingsCount = [cadPngBytes, gisPngBytes, ttPngBytes, sizingPngBytes, bhPngBytes, greasePngBytes, septicPngBytes, rbPngBytes, laaPngBytes].filter(Boolean).length;
    logExport(`Rasterized ${embeddedDrawingsCount} engineering drawing(s). Compiling .DOCX + .DXF in Pyodide...`);

    const diagrams = {
      treatment_train: ttPngBytes,
      sizing_chart: sizingPngBytes,
      borehole_profile: bhPngBytes,
      grease_xsec: greasePngBytes,
      septic_xsec: septicPngBytes,
      reed_bed_xsec: rbPngBytes,
      laa_xsec: laaPngBytes,
    };

    // Collect site photos from local session (and any R2-persisted photos not already in localPhotos)
    const photosPayload = localPhotos.map((p) => ({
      caption: p.caption,
      ext: p.ext,
      bytes: p.bytes.slice(0),
    }));
    if (!photosPayload.length && r2JobFiles.length && navigator.onLine) {
      const r2Photos = r2JobFiles.filter((f) => f.kind === "photo");
      for (const f of r2Photos) {
        try {
          const resp = await fetch(`/consulting/api/files/${f.r2_key}`);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            const ext = (f.filename?.split(".").pop() || "jpg").toLowerCase();
            photosPayload.push({ caption: f.caption || f.filename, ext, bytes: buf });
          }
        } catch (_) {}
      }
    }

    const out = await callPyWorker("generate", {
      assessment,
      spatial,
      cadPngBytes,
      gisPngBytes,
      diagrams,
      photos: photosPayload,
    });
    const slug = `${assessment.project_ref}_Lot${assessment.lot_number}_${assessment.plan_label}`.replace(/\s+/g, "_");
    compiledArtifacts = {
      slug,
      docxBlob: new Blob([out.docxBuffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      dxfBlob: new Blob([out.dxfBuffer], { type: "application/dxf" }),
      auditBlob: new Blob([JSON.stringify({ input: assessment, spatial, model: out.model, audit: out.audit }, null, 2)], { type: "application/json" }),
    };

    logExport(`SUCCESS — Compiled ${slug}_OSSM_Report.docx (${Math.round(compiledArtifacts.docxBlob.size / 1024)} KB, embedded ${out.embeddedCount ?? embeddedDrawingsCount} image(s) incl. GIS Map, CAD Plan & Cross-Sections) & ${slug}_Layout_Plan.dxf (${Math.round(compiledArtifacts.dxfBlob.size / 1024)} KB) in browser WebAssembly.`);
    document.getElementById("exportDownloads").style.display = "grid";
    document.getElementById("btnArchiveR2").disabled = false;
    showToast("Compiled Section 68 OSSM .DOCX + .DXF package.", "pass");
  } catch (err) {
    logExport(`Compile error: ${err.message}`);
    showToast(`OSSM compile failed: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    if (prog) prog.classList.remove("active");
  }
});

document.getElementById("dlDocx").addEventListener("click", () => {
  if (compiledArtifacts) downloadBlob(compiledArtifacts.docxBlob, `${compiledArtifacts.slug}_OSSM_Report.docx`);
});
document.getElementById("dlDxf").addEventListener("click", () => {
  if (compiledArtifacts) downloadBlob(compiledArtifacts.dxfBlob, `${compiledArtifacts.slug}_Layout_Plan.dxf`);
});
document.getElementById("dlJson").addEventListener("click", () => {
  if (compiledArtifacts) downloadBlob(compiledArtifacts.auditBlob, `${compiledArtifacts.slug}_Audit_Bundle.json`);
});

document.getElementById("btnArchiveR2").addEventListener("click", async () => {
  if (!compiledArtifacts) return;
  if (!activeJobId) await saveActiveJobToD1();
  const btn = document.getElementById("btnArchiveR2");
  btn.disabled = true;
  logExport("Uploading .DOCX, .DXF & Audit JSON to Cloudflare R2...");
  try {
    const uploads = [
      [compiledArtifacts.docxBlob, `${compiledArtifacts.slug}_OSSM_Report.docx`, "docx"],
      [compiledArtifacts.dxfBlob, `${compiledArtifacts.slug}_Layout_Plan.dxf`, "dxf"],
      [compiledArtifacts.auditBlob, `${compiledArtifacts.slug}_Audit_Bundle.json`, "audit_json"],
    ];
    for (const [blob, fname, kind] of uploads) {
      const fd = new FormData();
      fd.append("file", blob, fname);
      fd.append("kind", kind);
      fd.append("caption", `Compiled ${kind}`);
      const r = await fetch(`/consulting/api/jobs/${activeJobId}/files`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`R2 upload failed for ${fname}`);
    }
    logExport("Archived all 3 deliverables to Cloudflare R2 & linked to D1 Job ✓");
    loadJobFiles(activeJobId);
  } catch (err) {
    logExport(`R2 archive error: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ============================================================================
// MULTI-USE / AGRITOURISM / FOOD PROCESSING SOURCES EDITOR
// ============================================================================
const SOURCE_PRESETS = {
  dwelling: { label: "Primary Dwelling", source_type: "dwelling", units: 1, bedrooms_per_unit: 3, guests_per_unit: null, flow_rate_lpd_override: null, daily_flow_l_override: null, influent_bod_mgl: null, requires_grease_trap: false, peak_surge_factor: 1.0 },
  secondary_dwelling: { label: "Secondary Dwelling (Dual Occupancy)", source_type: "secondary_dwelling", units: 1, bedrooms_per_unit: 2, guests_per_unit: null, flow_rate_lpd_override: null, daily_flow_l_override: null, influent_bod_mgl: null, requires_grease_trap: false, peak_surge_factor: 1.0 },
  agritourism_cabin: { label: "Agritourism Eco-Cabins", source_type: "agritourism_cabin", units: 3, bedrooms_per_unit: 1, guests_per_unit: 2, flow_rate_lpd_override: 120, daily_flow_l_override: null, influent_bod_mgl: 250, requires_grease_trap: false, peak_surge_factor: 1.2 },
  food_processing_commercial: { label: "On-Farm Food Processing / Kitchen", source_type: "food_processing_commercial", units: 1, bedrooms_per_unit: 0, guests_per_unit: null, flow_rate_lpd_override: null, daily_flow_l_override: 450, influent_bod_mgl: 650, requires_grease_trap: true, peak_surge_factor: 1.2 },
  day_visitors_amenities: { label: "Farm-Gate Day Visitors / Toilets", source_type: "day_visitors_amenities", units: 20, bedrooms_per_unit: 0, guests_per_unit: null, flow_rate_lpd_override: 18, daily_flow_l_override: null, influent_bod_mgl: 220, requires_grease_trap: false, peak_surge_factor: 1.0 },
};

function renderSourcesEditor() {
  const box = document.getElementById("sourcesTableBox");
  if (!box) return;
  const srcs = assessment.wastewater_sources || [];
  if (!srcs.length) {
    box.innerHTML = `Standard single-dwelling mode (using Bedrooms field below). Click any button above to model Dual Occupancy, Agritourism Cabins, or Food Processing + Grease Arrestor.`;
    return;
  }
  box.innerHTML = `
    <table class="data-table" style="font-size:0.76rem;">
      <thead><tr><th>Label</th><th>Units</th><th>BR / Unit</th><th>Direct L/d (opt)</th><th>BOD mg/L</th><th>Grease</th><th></th></tr></thead>
      <tbody>
        ${srcs.map((s, idx) => `
          <tr>
            <td><input data-src="${idx}" data-k="label" value="${(s.label || "").replace(/"/g, "&quot;")}" style="width:155px; padding:3px;" /></td>
            <td><input data-src="${idx}" data-k="units" type="number" min="1" value="${s.units ?? 1}" style="width:48px; padding:3px;" /></td>
            <td><input data-src="${idx}" data-k="bedrooms_per_unit" type="number" min="0" value="${s.bedrooms_per_unit ?? 0}" style="width:48px; padding:3px;" /></td>
            <td><input data-src="${idx}" data-k="daily_flow_l_override" type="number" min="0" step="25" placeholder="Auto" value="${s.daily_flow_l_override ?? ""}" style="width:68px; padding:3px;" /></td>
            <td><input data-src="${idx}" data-k="influent_bod_mgl" type="number" min="50" max="2000" step="50" placeholder="250" value="${s.influent_bod_mgl ?? ""}" style="width:58px; padding:3px;" /></td>
            <td style="text-align:center;"><input data-src="${idx}" data-k="requires_grease_trap" type="checkbox" ${s.requires_grease_trap ? "checked" : ""} style="width:auto;" /></td>
            <td><button type="button" data-rm-src="${idx}" style="border:none; background:none; color:var(--fail-fg); cursor:pointer; font-weight:700;">✕</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  box.querySelectorAll("input[data-src]").forEach((el) => {
    el.addEventListener("change", () => {
      const idx = Number(el.dataset.src);
      const k = el.dataset.k;
      if (el.type === "checkbox") {
        assessment.wastewater_sources[idx][k] = el.checked;
        if (el.checked) {
          assessment.grease_arrestor_required = true;
          document.getElementById("mGreaseReq").checked = true;
        }
      } else if (el.type === "number") {
        assessment.wastewater_sources[idx][k] = el.value === "" ? null : Number(el.value);
      } else {
        assessment.wastewater_sources[idx][k] = el.value;
      }
      recalculateAndRender();
    });
  });
  box.querySelectorAll("[data-rm-src]").forEach((btn) => {
    btn.addEventListener("click", () => {
      assessment.wastewater_sources.splice(Number(btn.dataset.rmSrc), 1);
      if (!assessment.wastewater_sources.length) {
        assessment.development_category = "single_dwelling";
        document.getElementById("mDevCategory").value = "single_dwelling";
      }
      renderSourcesEditor();
      recalculateAndRender();
    });
  });
}

document.querySelectorAll("[data-add-src]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const type = btn.dataset.addSrc;
    assessment.wastewater_sources = assessment.wastewater_sources || [];
    // If transitioning from single dwelling -> multi-use, seed existing primary dwelling first!
    if (assessment.wastewater_sources.length === 0 && type !== "dwelling") {
      assessment.wastewater_sources.push({
        ...SOURCE_PRESETS.dwelling,
        bedrooms_per_unit: Number(assessment.bedrooms || 3),
      });
    }
    const preset = { ...SOURCE_PRESETS[type] };
    assessment.wastewater_sources.push(preset);
    if (type === "food_processing_commercial") {
      assessment.grease_arrestor_required = true;
      document.getElementById("mGreaseReq").checked = true;
      assessment.development_category = assessment.wastewater_sources.length > 1 ? "mixed_farm_development" : "food_processing_commercial";
    } else if (type === "agritourism_cabin") {
      assessment.development_category = "agritourism_cabins";
    } else if (type === "secondary_dwelling") {
      assessment.development_category = "dual_occupancy";
    }
    document.getElementById("mDevCategory").value = assessment.development_category;
    renderSourcesEditor();
    recalculateAndRender();
  });
});

// ============================================================================
// GOOGLE GEMINI AI INTAKE & CUSTOM REPORT WRITER (gemini-4-hydrogen)
// ============================================================================
function getAiHeaders() {
  const headers = {};
  const sessionKey = (document.getElementById("aiSessionKeyInput")?.value || "").trim();
  if (sessionKey) headers["X-Gemini-Api-Key"] = sessionKey;
  return headers;
}

async function checkAiStatus() {
  const badge = document.getElementById("aiStatusBadge");
  if (!badge) return;
  try {
    const r = await fetch("/consulting/api/ai/status");
    if (!r.ok) return;
    const data = await r.json();
    if (data.model) document.getElementById("aiModelInput").value = data.model;
    if (data.configured) {
      badge.textContent = `Gemini AI Ready (${data.model})`;
      badge.className = "badge badge-pass";
    } else {
      badge.textContent = `Gemini AI (${data.model}) — Add GEMINI_API_KEY in .dev.vars or Session Box`;
      badge.className = "badge badge-warn";
    }
  } catch (_) {
    badge.textContent = "Gemini AI: Offline";
    badge.className = "badge badge-warn";
  }
}

document.getElementById("btnAiExtract")?.addEventListener("click", async () => {
  const notes = document.getElementById("aiNotesInput").value.trim();
  const fieldTranscript = (document.getElementById("fVoiceTranscript")?.value || "").trim();
  const combinedNotes = [notes, fieldTranscript ? `Field Notes: ${fieldTranscript}` : ""].filter(Boolean).join("\n\n");
  const model = document.getElementById("aiModelInput").value.trim() || "gemini-4-hydrogen";
  const st = document.getElementById("aiExtractStatus");
  const preview = document.getElementById("aiExtractPreview");
  const applyBtn = document.getElementById("btnAiApply");

  if (!vaultFiles.length && !combinedNotes) {
    st.textContent = "Drop at least one PDF/plan/image into the Vault or enter a Project Brief first.";
    return;
  }

  const fd = new FormData();
  for (const f of vaultFiles) fd.append("files", f);
  fd.append("notes", combinedNotes);
  fd.append("model", model);
  if (activeJobId) fd.append("job_id", activeJobId);

  const btn = document.getElementById("btnAiExtract");
  btn.disabled = true;
  st.textContent = `Sending ${vaultFiles.length} vault file(s) + brief to Gemini (${model})...`;
  try {
    const resp = await fetch("/consulting/api/ai/extract", {
      method: "POST",
      headers: getAiHeaders(),
      body: fd,
    });
    const raw = await resp.text();
    let data = {};
    try { data = JSON.parse(raw); } catch (_) { throw new Error(`HTTP ${resp.status}: ${raw.slice(0, 200)}`); }
    if (!resp.ok) throw new Error(data.detail || data.setup_hint || data.error || `HTTP ${resp.status}`);

    pendingAiExtract = data.extracted;
    const ex = pendingAiExtract;
    const sourcesHtml = (ex.wastewater_sources || []).length
      ? `<ul style="margin:4px 0; padding-left:18px;">${ex.wastewater_sources.map((s) => `<li><strong>${s.label}</strong> (${s.source_type}): ${s.units} unit(s)${s.daily_flow_l_override ? `, ${s.daily_flow_l_override} L/d` : `, ${s.bedrooms_per_unit} BR`}${s.requires_grease_trap ? " · <strong style='color:var(--warn-fg);'>Grease Trap Req.</strong>" : ""}</li>`).join("")}</ul>`
      : `Single dwelling (${ex.bedrooms || 3} BR)`;
    const missingHtml = (ex.missing_info_flags || []).length
      ? `<div style="margin-top:6px; color:var(--warn-fg);"><strong>Verify on Site:</strong> ${ex.missing_info_flags.join(" · ")}</div>`
      : "";

    preview.innerHTML = `
      <div><strong>Extracted via ${data.model_used}:</strong> ${ex.development_description || ""}</div>
      <div style="margin-top:4px;"><strong>Property:</strong> ${ex.applicant_name || "—"} · ${ex.site_address || "—"} (Lot ${ex.lot_number || "?"} ${ex.plan_label || "?"}) · Category: <code>${ex.development_category || "single_dwelling"}</code></div>
      <div style="margin-top:4px;"><strong>Wastewater Sources:</strong> ${sourcesHtml}</div>
      ${ex.grease_arrestor_required ? `<div style="margin-top:4px; color:var(--warn-fg);"><strong>Grease Arrestor Flagged:</strong> ${ex.grease_arrestor_capacity_l ? ex.grease_arrestor_capacity_l + " L" : "Auto-sized (>= 1,000 L)"}</div>` : ""}
      ${ex.document_summary ? `<div style="margin-top:6px; color:var(--muted);"><strong>Source Doc Summary:</strong> ${ex.document_summary}</div>` : ""}
      ${missingHtml}
    `;
    preview.style.display = "block";
    applyBtn.style.display = "inline-flex";
    st.textContent = `Extraction complete (${data.files_processed?.length || 0} file(s) read) — review below and click Apply.`;
    if (data.archived_docs?.length && activeJobId) loadJobFiles(activeJobId);
  } catch (err) {
    st.textContent = `AI Extract Error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnAiApply")?.addEventListener("click", () => {
  if (!pendingAiExtract) return;
  const ex = pendingAiExtract;
  if (ex.applicant_name) assessment.applicant_name = ex.applicant_name;
  if (ex.site_address) assessment.site_address = ex.site_address;
  if (ex.lot_number) assessment.lot_number = String(ex.lot_number);
  if (ex.plan_label) assessment.plan_label = String(ex.plan_label).replace(/\s+/g, "").toUpperCase();
  if (ex.block_size_m2 && Number(ex.block_size_m2) > 100) assessment.block_size_m2 = Number(ex.block_size_m2);
  if (ex.development_category) assessment.development_category = ex.development_category;
  if (ex.development_description) assessment.development_description = ex.development_description;
  if (ex.bedrooms && Number(ex.bedrooms) >= 1) assessment.bedrooms = Number(ex.bedrooms);
  if (ex.water_supply) assessment.water_supply = ex.water_supply;
  if (ex.treatment_system) assessment.treatment_system = ex.treatment_system;
  if (ex.land_application_type) assessment.land_application_type = ex.land_application_type;
  if (Array.isArray(ex.wastewater_sources)) assessment.wastewater_sources = ex.wastewater_sources;
  assessment.grease_arrestor_required = Boolean(ex.grease_arrestor_required);
  assessment.grease_arrestor_capacity_l = ex.grease_arrestor_capacity_l ? Number(ex.grease_arrestor_capacity_l) : null;
  assessment.surge_balance_tank_l = ex.surge_balance_tank_l ? Number(ex.surge_balance_tank_l) : null;

  const h = ex.site_eval_hints || {};
  if (h.slope_pct != null) assessment.site_eval.slope_pct = Number(h.slope_pct);
  if (h.aspect) assessment.site_eval.aspect = h.aspect;
  if (h.existing_vegetation) assessment.site_eval.existing_vegetation = h.existing_vegetation;
  if (h.existing_system_notes) assessment.site_eval.existing_system_notes = h.existing_system_notes;
  if (h.dist_gully_m != null) assessment.site_eval.dist_gully_m = Number(h.dist_gully_m);
  if (h.dist_perennial_watercourse_m != null) assessment.site_eval.dist_perennial_watercourse_m = Number(h.dist_perennial_watercourse_m);
  if (h.dist_property_boundary_m != null) assessment.site_eval.dist_property_boundary_m = Number(h.dist_property_boundary_m);

  if (ex.document_summary) {
    uploadedDocsSummary = ex.document_summary;
    assessment.custom_narratives = {
      ...(assessment.custom_narratives || {}),
      source_documents_summary: ex.document_summary,
    };
  }

  // Also pre-fill SEE proposal fields cleanly from the shared extraction!
  if (ex.development_description) document.getElementById("seeTitle").value = ex.development_description;
  if (ex.document_summary) document.getElementById("seeSummary").value = ex.document_summary;
  const catMap = {
    single_dwelling: "dwelling_house",
    dual_occupancy: "dual_occupancy",
    agritourism_cabins: "agritourism_farm_stay",
    food_processing_commercial: "farm_gate_food_processing",
    mixed_farm_development: "agritourism_farm_stay",
  };
  if (ex.development_category && catMap[ex.development_category]) {
    document.getElementById("seeDevType").value = catMap[ex.development_category];
  }

  hydrateFormFromState();
  const { ossm } = getScope();
  document.getElementById("aiExtractStatus").textContent = "Applied to Project (Shared across OSSM & SEE) ✓";
  switchTab(ossm ? "panel-ossm-model" : "panel-see-plan");
});

function getSharedProjectContextSummary() {
  const parts = [];
  if (assessment?.project_brief) parts.push(`Project Brief: ${assessment.project_brief}`);
  const fieldNotes = (document.getElementById("fVoiceTranscript")?.value || "").trim();
  if (fieldNotes) parts.push(`Field Inspection Notes: ${fieldNotes}`);
  if (uploadedDocsSummary || assessment?.custom_narratives?.source_documents_summary) {
    parts.push(`Uploaded Client Docs Summary: ${uploadedDocsSummary || assessment.custom_narratives.source_documents_summary}`);
  }
  return parts.join("\n\n");
}

document.getElementById("btnAiDraft")?.addEventListener("click", async () => {
  syncStateFromForm();
  const btn = document.getElementById("btnAiDraft");
  const st = document.getElementById("aiDraftStatus");
  const model = document.getElementById("aiModelInput").value.trim() || "gemini-4-hydrogen";
  const customInstructions = document.getElementById("aiDraftInstructions").value.trim();

  btn.disabled = true;
  st.textContent = `Drafting bespoke council report prose with Gemini (${model}) grounded in OSmodel300614 outputs...`;
  try {
    const resp = await fetch("/consulting/api/ai/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAiHeaders() },
      body: JSON.stringify({
        assessment,
        spatial,
        model_result: lastModel,
        audit_result: lastAudit,
        document_summary: getSharedProjectContextSummary(),
        custom_instructions: customInstructions,
        model,
      }),
    });
    const raw = await resp.text();
    let data = {};
    try { data = JSON.parse(raw); } catch (_) { throw new Error(`HTTP ${resp.status}: ${raw.slice(0, 200)}`); }
    if (!resp.ok) throw new Error(data.detail || data.setup_hint || data.error || `HTTP ${resp.status}`);

    const cn = data.custom_narratives || {};
    assessment.custom_narratives = cn;
    document.getElementById("narExec").value = cn.executive_summary || "";
    document.getElementById("narJust").value = cn.system_selection_justification || "";
    document.getElementById("narCtx").value = cn.development_context || "";
    document.getElementById("narComm").value = cn.commercial_trade_waste_notes || "";
    document.getElementById("narSoil").value = cn.site_soil_interpretation || "";
    document.getElementById("narOm").value = cn.custom_om_notes || "";
    syncStateFromForm();
    st.textContent = `Custom report narrative drafted via ${data.model_used} ✓ — Review or edit any paragraph below, then click Compile .DOCX + .DXF Package.`;
  } catch (err) {
    st.textContent = `AI Draft Error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnAiClearNarratives")?.addEventListener("click", () => {
  assessment.custom_narratives = null;
  ["narExec", "narJust", "narCtx", "narComm", "narSoil", "narOm"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("aiDraftStatus").textContent = "Cleared custom narratives — report will use standard deterministic template prose.";
  syncStateFromForm();
});

// ============================================================================
// STATEMENT OF ENVIRONMENTAL EFFECTS (SEE) BUILDER — LISMORE LEP 2012 & DCP
// ============================================================================
function buildSeeInputFromForm() {
  const linkOssm = document.getElementById("seeLinkOssm")?.checked !== false;
  let linkedOssm = null;
  if (linkOssm && lastModel) {
    const tr = lastModel.trench_layout;
    const parts = [
      `Concurrent Section 68 OSSM System (${assessment.project_ref}): ${lastModel.total_flow_ld} L/day (${lastModel.design_persons} EP)`,
    ];
    if (lastModel.grease_arrestor_min_l > 0) parts.push(`${lastModel.grease_arrestor_min_l} L Grease Arrestor (AS/NZS 3500.2)`);
    parts.push(`${lastModel.septic_tank_min_l} L Septic Tank`);
    if (lastModel.recommended_reed_bed_count > 0) {
      parts.push(`${lastModel.recommended_reed_bed_count}× ${lastModel.recommended_reed_bed_model} (${lastModel.recommended_reed_bed_provided_m2} m²)`);
    }
    parts.push(`${lastModel.required_laa_m2} m² LAA (${tr.number_of_trenches}× ${tr.trench_length_m} m × ${tr.trench_width_m} m) + 100% Reserve LAA (${lastModel.reserve_laa_m2} m²)`);
    linkedOssm = parts.join(" → ");
  }

  const narExec = (document.getElementById("seeNarExec")?.value || "").trim();
  const narSite = (document.getElementById("seeNarSite")?.value || "").trim();
  const narProp = (document.getElementById("seeNarProp")?.value || "").trim();
  const narZone = (document.getElementById("seeNarZone")?.value || "").trim();
  const narImp = (document.getElementById("seeNarImp")?.value || "").trim();
  const narSuit = (document.getElementById("seeNarSuit")?.value || "").trim();
  const hasNar = Boolean(narExec || narSite || narProp || narZone || narImp || narSuit || uploadedDocsSummary);

  return {
    project_ref: `${assessment.project_ref}-SEE`,
    assessment_date: assessment.site_eval?.assessment_date || new Date().toISOString().slice(0, 10),
    applicant_name: assessment.applicant_name || "Applicant",
    site_address: assessment.site_address || "Lismore NSW 2480",
    lot_number: assessment.lot_number || "1",
    plan_label: assessment.plan_label || "DP000000",
    lga: assessment.lga || "Lismore City Council",
    block_size_m2: Number(assessment.block_size_m2 || 10000),
    development_type: document.getElementById("seeDevType")?.value || "dwelling_house",
    proposal_title: (document.getElementById("seeTitle")?.value || "").trim() || assessment.development_description,
    proposal_summary: (document.getElementById("seeSummary")?.value || "").trim(),
    estimated_cost_aud: Number(document.getElementById("seeCost")?.value || 350000),
    gross_floor_area_m2: Number(document.getElementById("seeGfa")?.value || 180),
    building_height_m: Number(document.getElementById("seeHeight")?.value || 5.8),
    storeys: Number(document.getElementById("seeStoreys")?.value || 1),
    materials_and_colours: (document.getElementById("seeMaterials")?.value || "").trim(),
    existing_use_and_structures: (document.getElementById("seeExisting")?.value || "").trim(),
    cut_max_m: Number(document.getElementById("seeCut")?.value || 0.8),
    fill_max_m: Number(document.getElementById("seeFill")?.value || 0.6),
    disturbed_area_m2: Number(document.getElementById("seeDisturbed")?.value || 450),
    native_trees_removed: Number(document.getElementById("seeTrees")?.value || 0),
    vegetation_notes: (document.getElementById("seeVeg")?.value || "").trim(),
    existing_access: (document.getElementById("seeAccess")?.value || "").trim(),
    proposed_parking_spaces: Number(document.getElementById("seeParking")?.value || 2),
    vehicle_movements_per_day: Number(document.getElementById("seeTraffic")?.value || 6),
    operating_hours: (document.getElementById("seeHours")?.value || "").trim() || null,
    staff_or_guests_max: (document.getElementById("seeStaffGuests")?.value || "").trim() || null,
    stormwater_management: (document.getElementById("seeStormwater")?.value || "").trim(),
    construction_waste_and_escp: (document.getElementById("seeEscp")?.value || "").trim(),
    neighbour_amenity_notes: (document.getElementById("seeAmenity")?.value || "").trim(),
    contamination_history: (document.getElementById("seeContam")?.value || "").trim(),
    linked_ossm_summary: linkedOssm,
    custom_narratives: hasNar
      ? {
          executive_summary: narExec || null,
          site_and_locality_context: narSite || null,
          proposal_details_narrative: narProp || null,
          statutory_zone_justification: narZone || null,
          environmental_impacts_and_mitigation: narImp || null,
          site_suitability_and_public_interest: narSuit || null,
          source_documents_summary: uploadedDocsSummary || assessment.custom_narratives?.source_documents_summary || null,
          ai_model_used: document.getElementById("aiModelInput")?.value?.trim() || "gemini-4-hydrogen",
        }
      : null,
    consultant: assessment.consultant,
  };
}

function renderSeeTriggerBanner() {
  const box = document.getElementById("seeTriggerBanner");
  if (!box || !assessment) return;
  const zone = spatial?.land_zoning?.length ? spatial.land_zoning.join(", ") : "Run Tab 1 Live NSW GIS to auto-detect Zoning";
  const badges = [
    `<span class="badge badge-info">Zone: ${zone}</span>`,
    `<span class="badge ${spatial?.flood_planning ? "badge-warn" : "badge-pass"}">Flood Cl. 5.21: ${spatial?.flood_planning ? "TRIGGERED" : "Clear"}</span>`,
    `<span class="badge ${spatial?.bushfire_prone_land?.length ? "badge-warn" : "badge-pass"}">Bushfire PBP 2019: ${spatial?.bushfire_prone_land?.length ? spatial.bushfire_prone_land[0] : "Clear"}</span>`,
    `<span class="badge ${spatial?.acid_sulfate_soils?.length ? "badge-warn" : "badge-pass"}">ASS Cl. 6.1: ${spatial?.acid_sulfate_soils?.length ? spatial.acid_sulfate_soils[0] : "Clear"}</span>`,
    `<span class="badge ${spatial?.drinking_water_catchment ? "badge-warn" : "badge-pass"}">Drinking Water Cl. 6.4: ${spatial?.drinking_water_catchment ? "Rous Water" : "Outside"}</span>`,
    `<span class="badge ${spatial?.terrestrial_biodiversity ? "badge-warn" : "badge-pass"}">Biodiversity / Koala: ${spatial?.terrestrial_biodiversity ? "Mapped" : "Clear"}</span>`,
  ];
  box.innerHTML = `<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;"><strong>Live Lismore LEP 2012 Triggers:</strong> ${badges.join("")}</div>`;
}

document.getElementById("btnAiDraftSee")?.addEventListener("click", async () => {
  syncStateFromForm();
  const seeInput = buildSeeInputFromForm();
  const btn = document.getElementById("btnAiDraftSee");
  const st = document.getElementById("seeAiStatus");
  const model = document.getElementById("aiModelInput")?.value?.trim() || "gemini-4-hydrogen";
  const customInstructions = document.getElementById("seeAiInstructions")?.value?.trim() || "";

  btn.disabled = true;
  st.textContent = `Drafting Lismore City Council SEE narrative with Gemini (${model})...`;
  try {
    const resp = await fetch("/consulting/api/ai/draft-see", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAiHeaders() },
      body: JSON.stringify({
        see_input: seeInput,
        spatial,
        document_summary: getSharedProjectContextSummary(),
        custom_instructions: customInstructions,
        model,
      }),
    });
    const raw = await resp.text();
    let data = {};
    try { data = JSON.parse(raw); } catch (_) { throw new Error(`HTTP ${resp.status}: ${raw.slice(0, 200)}`); }
    if (!resp.ok) throw new Error(data.detail || data.setup_hint || data.error || `HTTP ${resp.status}`);

    const cn = data.custom_narratives || {};
    document.getElementById("seeNarExec").value = cn.executive_summary || "";
    document.getElementById("seeNarSite").value = cn.site_and_locality_context || "";
    document.getElementById("seeNarProp").value = cn.proposal_details_narrative || "";
    document.getElementById("seeNarZone").value = cn.statutory_zone_justification || "";
    document.getElementById("seeNarImp").value = cn.environmental_impacts_and_mitigation || "";
    document.getElementById("seeNarSuit").value = cn.site_suitability_and_public_interest || "";
    st.textContent = `SEE narrative drafted via ${data.model_used} ✓ — Review/edit below, then click Compile Lismore SEE (.DOCX).`;
  } catch (err) {
    st.textContent = `Gemini SEE Draft Error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnCompileSee")?.addEventListener("click", async () => {
  syncStateFromForm();
  const seeInput = buildSeeInputFromForm();
  const btn = document.getElementById("btnCompileSee");
  const logEl = document.getElementById("seeLog");
  const prog = document.getElementById("seeProgressTrack");
  btn.disabled = true;
  if (prog) prog.classList.add("active");
  try {
    logEl.textContent = `[${new Date().toLocaleTimeString()}] Rasterizing GDA2020 GIS Site Location Map (SEE-GIS-01)...`;
    const gisPngBytes = await rasterizeSvgToPngArrayBuffer(
      renderGisSiteMapSvg(assessment, spatial, { drawingCode: "SEE-GIS-01", submissionLabel: "DA SUBMISSION" }),
      "SEE GIS Site Map",
    );
    const photosPayload = localPhotos.map((p) => ({
      caption: p.caption,
      ext: p.ext,
      bytes: p.bytes.slice(0),
    }));

    logEl.textContent = `[${new Date().toLocaleTimeString()}] Running Lismore LEP 2012 / DCP 2012 audit & compiling SEE .DOCX in Pyodide...`;
    const out = await callPyWorker("generate_see", {
      seeInput,
      spatial,
      gisPngBytes,
      photos: photosPayload,
    });

    const slug = `${assessment.project_ref}_Lot${assessment.lot_number}_${assessment.plan_label}`.replace(/\s+/g, "_");
    compiledSeeArtifact = {
      slug,
      docxBlob: new Blob([out.docxBuffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    };

    logEl.textContent = `[${new Date().toLocaleTimeString()}] SUCCESS — Compiled ${slug}_Lismore_SEE.docx (${Math.round(compiledSeeArtifact.docxBlob.size / 1024)} KB, ${out.embeddedCount} embedded image(s), ${out.audit?.checks?.length || 0} LEP/DCP/SEPP checks).`;
    document.getElementById("btnDownloadSee").style.display = "inline-flex";
    document.getElementById("btnArchiveSeeR2").disabled = false;
    showToast("Compiled Lismore SEE .DOCX report.", "pass");
  } catch (err) {
    logEl.textContent = `[${new Date().toLocaleTimeString()}] SEE Compile Error: ${err.message}`;
    showToast(`SEE compile failed: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    if (prog) prog.classList.remove("active");
  }
});

document.getElementById("btnDownloadSee")?.addEventListener("click", () => {
  if (compiledSeeArtifact) {
    downloadBlob(compiledSeeArtifact.docxBlob, `${compiledSeeArtifact.slug}_Lismore_SEE.docx`);
  }
});

document.getElementById("btnArchiveSeeR2")?.addEventListener("click", async () => {
  if (!compiledSeeArtifact) return;
  if (!activeJobId) await saveActiveJobToD1();
  const btn = document.getElementById("btnArchiveSeeR2");
  const logEl = document.getElementById("seeLog");
  btn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("file", compiledSeeArtifact.docxBlob, `${compiledSeeArtifact.slug}_Lismore_SEE.docx`);
    fd.append("kind", "docx");
    fd.append("caption", "Lismore City Council Statement of Environmental Effects (SEE)");
    const r = await fetch(`/consulting/api/jobs/${activeJobId}/files`, { method: "POST", body: fd });
    if (!r.ok) throw new Error("R2 upload failed");
    logEl.textContent = `[${new Date().toLocaleTimeString()}] Archived Lismore SEE .DOCX to Cloudflare R2 & linked to D1 Job ✓`;
    loadJobFiles(activeJobId);
  } catch (err) {
    logEl.textContent = `[${new Date().toLocaleTimeString()}] R2 upload error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// ============================================================================
// BOOTSTRAP
// ============================================================================
async function checkAuthSession() {
  try {
    const r = await fetch("/consulting/api/auth/session");
    if (!r.ok) return;
    const data = await r.json();
    const btn = document.getElementById("btnSignOut");
    if (btn && data.auth_enabled) {
      btn.style.display = "inline-flex";
    }
  } catch (_) {}
}

document.getElementById("btnSignOut")?.addEventListener("click", async () => {
  await fetch("/consulting/api/auth/logout", { method: "POST" });
  window.location.href = "/consulting/admin-login";
});

async function boot() {
  syncThemeButton();
  updateNetBadge();
  checkAuthSession();
  checkAiStatus();
  const ds = await loadLismoreDatasets();
  rules = ds.rules;
  climate = ds.climate;
  populateSelects();

  // Wire all live form fields across Shared Hub, Field, OSSM & SEE panels
  document.querySelectorAll(".ws-main input, .ws-main select, .ws-main textarea").forEach((el) => {
    if (["aiFilesInput", "aiModelInput", "aiSessionKeyInput", "photoFileInput", "photoCaptionInput", "pinTypeSelect", "aiDraftInstructions", "seeAiInstructions"].includes(el.id)) return;
    el.addEventListener("input", syncStateFromForm);
    el.addEventListener("change", syncStateFromForm);
  });

  // Restore saved IndexedDB multi-job draft (falling back to localStorage) or start cleanly with a blank Lismore project
  const idbDraft = await getLastOfflineDraft().catch(() => null);
  if (idbDraft?.assessment) {
    activeJobId = idbDraft.activeJobId || null;
    assessment = idbDraft.assessment;
    spatial = idbDraft.spatial || null;
    await restoreLocalPhotosFromIdb(idbDraft.draftKey);
  } else {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        activeJobId = parsed.activeJobId || null;
        assessment = parsed.assessment || createBlankAssessment();
        spatial = parsed.spatial || null;
      } catch (_) {
        assessment = createBlankAssessment();
      }
    } else {
      assessment = createBlankAssessment();
    }
  }
  recomputePinLocalCoords();

  hydrateFormFromState();
  initWbMap();
  if (spatial) renderSpatialOnMap();
  refreshDashboard();
  flushOfflineSyncQueue();
}

boot();
