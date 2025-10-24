import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const NAMESPACE = "http://koop.overheid.nl/apps/opera/";
const DATE_FAR_FUTURE = "9999-12-31";
const ANIMATION_INTERVAL_MS = 4000;
const TRANSITION_DURATION_MS = 700;
const DEFAULT_STATUS_MESSAGE = "Select a scenario to begin.";

const scenarioSelect = document.getElementById("scenarioSelect");
const folderInput = document.getElementById("folderInput");
const prevButton = document.getElementById("prevButton");
const playPauseButton = document.getElementById("playPauseButton");
const nextButton = document.getElementById("nextButton");
const statusMessage = document.getElementById("statusMessage");
const timelineTitle = document.getElementById("timelineTitle");
const timelineMeta = document.getElementById("timelineMeta");

const svg = d3.select("#timelineSvg");
const tooltip = d3
  .select("body")
  .append("div")
  .attr("class", "tooltip");

const margin = { top: 60, right: 220, bottom: 40, left: 170 };
const svgNode = document.getElementById("timelineSvg");
const defaultWidth = svgNode.clientWidth || 1100;
const defaultHeight = svgNode.clientHeight || 640;
svg.attr("viewBox", [0, 0, defaultWidth, defaultHeight]);

const axisGroup = svg
  .append("g")
  .attr("class", "axis axis--y")
  .attr("transform", `translate(${margin.left},0)`);

const instrumentsGroup = svg.append("g").attr("class", "instruments");

// Add gradient and marker definitions for open-ended regulations
const defs = svg.append("defs");

const gradient = defs.append("linearGradient")
  .attr("id", "openEndedGradient")
  .attr("x1", "0%")
  .attr("y1", "0%")
  .attr("x2", "0%")
  .attr("y2", "100%");

gradient.append("stop")
  .attr("offset", "0%")
  .attr("stop-color", "#5c6bf0")
  .attr("stop-opacity", 1.0);

gradient.append("stop")
  .attr("offset", "80%")
  .attr("stop-color", "#5c6bf0")
  .attr("stop-opacity", 0.7);

gradient.append("stop")
  .attr("offset", "100%")
  .attr("stop-color", "#5c6bf0")
  .attr("stop-opacity", 0.0);

// Arrow marker for open-ended regulations (pointing down)
defs.append("marker")
  .attr("id", "arrowhead")
  .attr("viewBox", "0 0 10 10")
  .attr("refX", "5")
  .attr("refY", "9")
  .attr("markerWidth", "8")
  .attr("markerHeight", "8")
  .attr("orient", "0deg")
  .append("path")
  .attr("d", "M 0 0 L 5 10 L 10 0 z")
  .attr("fill", "#5c6bf0");

let snapshots = [];
let activeIndex = 0;
let animationHandle = null;
let isPlaying = false;
let activeScenarioName = "";
let scenarioManifest = null;

if (scenarioSelect) {
  scenarioSelect.addEventListener("change", handleScenarioSelect);
}

if (folderInput) {
  folderInput.addEventListener("change", handleFolderSelection);
}

prevButton.addEventListener("click", () => {
  stopPlayback();
  goToSnapshot(activeIndex - 1);
});
nextButton.addEventListener("click", () => {
  stopPlayback();
  goToSnapshot(activeIndex + 1);
});
playPauseButton.addEventListener("click", togglePlayback);

window.addEventListener("beforeunload", () => {
  stopPlayback();
  tooltip.remove();
});

initializeScenarioManifest();

function updateControlsState() {
  const hasSnapshots = snapshots.length > 0;
  const hasMultipleSnapshots = snapshots.length > 1;

  prevButton.disabled = !hasMultipleSnapshots;
  nextButton.disabled = !hasMultipleSnapshots;
  playPauseButton.disabled = !hasMultipleSnapshots;

  if (!hasMultipleSnapshots) {
    stopPlayback();
  }

  if (!hasSnapshots) {
    playPauseButton.textContent = "Play";
  }
}

async function handleFolderSelection(event) {
  stopPlayback();
  statusMessage.textContent = "Loading scenario…";

  const files = Array.from(event.target.files || []).filter((file) =>
    file.name.toLowerCase().endsWith(".xml"),
  );

  if (!files.length) {
    snapshots = [];
    activeScenarioName = "";
    clearVisualization();
    statusMessage.textContent = "No XML files found in the selected scenario folder.";
    updateControlsState();
    return;
  }

  if (scenarioSelect) {
    scenarioSelect.value = "";
  }

  try {
    const scenario = groupScenarioFiles(files);
    const stateEntries = Array.from(scenario.states.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );

    const stateGroups = stateEntries.map((entry) => ({
      stateName: entry.name,
      files: entry.files,
    }));

    await loadScenarioFromStateGroups({
      scenarioName: scenario.name,
      stateGroups,
    });
  } catch (error) {
    console.error(error);
    snapshots = [];
    activeScenarioName = "";
    clearVisualization();
    statusMessage.textContent = `Failed to load scenario: ${error.message}`;
    updateControlsState();
  }
}

async function handleScenarioSelect(event) {
  const scenarioId = event.target.value;

  if (!scenarioId) {
    snapshots = [];
    activeScenarioName = "";
    stopPlayback();
    clearVisualization();
    statusMessage.textContent = DEFAULT_STATUS_MESSAGE;
    updateControlsState();
    return;
  }

  if (!scenarioManifest) {
    statusMessage.textContent = "No scenario manifest is available.";
    return;
  }

  const scenarioEntry = scenarioManifest.scenarios.find(
    (scenario) => scenario.id === scenarioId,
  );

  if (!scenarioEntry) {
    statusMessage.textContent = "Selected scenario is not listed in the manifest.";
    return;
  }

  try {
    statusMessage.textContent = `Loading scenario ${scenarioEntry.label || scenarioEntry.id}…`;

    if (folderInput) {
      folderInput.value = "";
    }

    const scenarioBasePath = `${scenarioManifest.basePath}/${scenarioEntry.id}`.replace(
      /\/{2,}/g,
      "/",
    );

    const stateGroups = [];
    for (const state of scenarioEntry.states) {
      const files = await Promise.all(
        (state.files || []).map((filePath) =>
          fetchScenarioFile({
            scenarioBasePath,
            scenarioId: scenarioEntry.id,
            filePath,
          }),
        ),
      );
      stateGroups.push({
        stateName: state.label || state.id,
        files,
      });
    }

    await loadScenarioFromStateGroups({
      scenarioName: scenarioEntry.label || scenarioEntry.id,
      stateGroups,
    });
  } catch (error) {
    console.error(error);
    snapshots = [];
    activeScenarioName = "";
    clearVisualization();
    statusMessage.textContent = `Failed to load scenario: ${error.message}`;
    updateControlsState();
  }
}

async function initializeScenarioManifest() {
  if (!scenarioSelect) {
    return;
  }

  try {
    const response = await fetch("sample-data/scenarios/index.json", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while loading scenario manifest.`);
    }

    const rawManifest = await response.json();
    scenarioManifest = normalizeScenarioManifest(rawManifest);
    populateScenarioSelect();
  } catch (error) {
    console.warn("Scenario manifest could not be loaded.", error);
    scenarioManifest = null;
    if (scenarioSelect) {
      scenarioSelect.disabled = true;
      scenarioSelect.innerHTML =
        '<option value="">No scenarios available (manifest missing)</option>';
    }
    if (statusMessage && statusMessage.textContent === DEFAULT_STATUS_MESSAGE) {
      statusMessage.textContent =
        "Scenario dropdown unavailable (manifest missing). Use the folder loader instead.";
    }
  }
}

function normalizeScenarioManifest(rawManifest) {
  const basePath =
    typeof rawManifest?.basePath === "string" && rawManifest.basePath.trim()
      ? rawManifest.basePath.trim().replace(/\/+$/, "")
      : "sample-data/scenarios";

  const scenarios = Array.isArray(rawManifest?.scenarios)
    ? rawManifest.scenarios
        .map((scenario) => {
          const id = scenario?.id || scenario?.slug || scenario?.name;
          if (!id) {
            return null;
          }
          const label = scenario?.label || scenario?.title || id;
          const states = Array.isArray(scenario?.states)
            ? scenario.states
                .map((state) => {
                  const stateId = state?.id || state?.name;
                  if (!stateId) {
                    return null;
                  }
                  const files = Array.isArray(state?.files)
                    ? state.files
                        .map((filePath) => String(filePath || "").trim())
                        .filter(Boolean)
                    : [];
                  if (!files.length) {
                    return null;
                  }
                  return {
                    id: stateId,
                    label: state?.label || stateId,
                    files,
                  };
                })
                .filter(Boolean)
            : [];

          if (!states.length) {
            return null;
          }

          return {
            id,
            label,
            states,
          };
        })
        .filter(Boolean)
    : [];

  return {
    basePath,
    scenarios,
  };
}

function populateScenarioSelect() {
  if (!scenarioSelect) {
    return;
  }

  scenarioSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Select scenario…";
  scenarioSelect.append(defaultOption);

  if (!scenarioManifest || !scenarioManifest.scenarios.length) {
    scenarioSelect.disabled = true;
    defaultOption.textContent = "No scenarios available";
    return;
  }

  scenarioManifest.scenarios.forEach((scenario) => {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenario.label;
    scenarioSelect.append(option);
  });

  scenarioSelect.disabled = false;
}

async function loadScenarioFromStateGroups({ scenarioName, stateGroups }) {
  if (!Array.isArray(stateGroups) || !stateGroups.length) {
    snapshots = [];
    activeScenarioName = scenarioName;
    stopPlayback();
    clearVisualization();
    statusMessage.textContent = "No state folders were found inside the scenario.";
    updateControlsState();
    return;
  }

  stopPlayback();

  try {
    const builtSnapshots = [];
    let totalXmlFiles = 0;

    for (const group of stateGroups) {
      const files = group.files || [];
      totalXmlFiles += files.length;
      const result = await buildSnapshotFromState({
        scenarioName,
        stateName: group.stateName,
        files,
      });
      if (result.instruments.length > 0) {
        builtSnapshots.push(result);
      }
    }

    if (!builtSnapshots.length) {
      snapshots = [];
      activeScenarioName = scenarioName;
      clearVisualization();
      statusMessage.textContent = "No usable timeline entries were found in the scenario.";
      updateControlsState();
      return;
    }

    snapshots = builtSnapshots;
    activeScenarioName = scenarioName;
    activeIndex = 0;
    renderSnapshot(snapshots[activeIndex]);
    updateControlsState();
    statusMessage.textContent = `Loaded scenario ${scenarioName} with ${snapshots.length} state${snapshots.length === 1 ? "" : "s"} (${totalXmlFiles} XML files).`;
  } catch (error) {
    snapshots = [];
    activeScenarioName = scenarioName;
    clearVisualization();
    statusMessage.textContent = `Failed to load scenario: ${error.message}`;
    updateControlsState();
    throw error;
  }
}

async function fetchScenarioFile({ scenarioBasePath, scenarioId, filePath }) {
  const cleanedScenarioBase = scenarioBasePath.replace(/\/+$/, "");
  const normalizedPath = String(filePath || "").replace(/^\/+/, "");
  const url = `${cleanedScenarioBase}/${normalizedPath}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch ${normalizedPath} (HTTP ${response.status})`);
  }

  const content = await response.text();
  const segments = normalizedPath.split(/[/\\]+/);
  const fileName = segments[segments.length - 1] || normalizedPath;
  const relativePath = `${scenarioId}/${normalizedPath}`;

  return {
    name: fileName,
    webkitRelativePath: relativePath,
    async text() {
      return content;
    },
  };
}

function parseTimelineXml(xmlText, file) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "application/xml");
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    throw new Error(parseError.textContent || "Unknown XML parsing error");
  }

  const metadataNode = xmlDoc.getElementsByTagNameNS(NAMESPACE, "metadata")[0];
  const meta = {
    publicationId: textForTag(metadataNode, "publicatie-id"),
    publicationDate: parseDate(textForTag(metadataNode, "datum-bekendmaking")),
    instrumentId: textForTag(metadataNode, "instrument-id"),
    instrumentType: textForTag(metadataNode, "instrument-type"),
    deliveryId: textForTag(metadataNode, "id-levering"),
    supplyTime: parseDate(textForTag(metadataNode, "aanlevering-tijd")),
    sourceFile: file.webkitRelativePath || file.name,
  };

  const instrumentNodes = Array.from(
    xmlDoc.getElementsByTagNameNS(NAMESPACE, "instrument-toestanden"),
  );

  const instruments = instrumentNodes
    .map((instrumentNode) => {
      const instrumentId = instrumentNode.getAttribute("instrument-id");
      const rawToestanden = Array.from(
        instrumentNode.getElementsByTagNameNS(NAMESPACE, "toestand"),
      );

      const versions = rawToestanden.map((node) => {
        const versionNumber = numberForTag(node, "versie-nummer");
        const validFrom = parseDate(
          textForTag(node, "juridisch-werkend-vanaf"),
        );
        const validToRaw = textForTag(node, "juridisch-werkend-tot");
        const validTo =
          !validToRaw || validToRaw === DATE_FAR_FUTURE
            ? null
            : parseDate(validToRaw);

        return {
          key: [
            instrumentId,
            versionNumber,
            validFrom ? validFrom.toISOString() : "unknown",
          ].join("|"),
          instrumentType: textForTag(node, "instrument-type") || "onbekend",
          versionNumber,
          versionId: textForTag(node, "instrument-versie-id"),
          publicationId: textForTag(node, "publicatie-id"),
          publicationDate: parseDate(textForTag(node, "publicatie-date")),
          validFrom,
          validTo,
          onTimeline: textForTag(node, "op-tijdlijn") !== "false",
          status: textForTag(node, "status") || textForTag(node, "verwerking"),
          operation: node.getAttribute("creeer-operatie") || "",
          supplyTime: parseDate(node.getAttribute("aanlevering-tijd")),
        };
      });

      const filteredVersions = versions.filter(
        (version) => version.validFrom instanceof Date && !Number.isNaN(+version.validFrom),
      );

      if (!filteredVersions.length) {
        return null;
      }

      const instrumentType =
        filteredVersions[0]?.instrumentType ||
        instrumentNode.getAttribute("instrument-type") ||
        "onbekend";

      return {
        instrumentId,
        instrumentType,
        displayName: buildInstrumentLabel(instrumentId, instrumentType),
        versions: filteredVersions.sort(compareVersions),
      };
    })
    .filter(Boolean)
    .sort(compareInstruments);

  return {
    meta,
    instruments,
  };
}

function groupScenarioFiles(files) {
  const states = new Map();
  let scenarioName = "";

  for (const file of files) {
    const segments = splitPathSegments(file.webkitRelativePath || file.name);
    if (segments.length < 3) {
      continue;
    }

    if (!scenarioName) {
      scenarioName = segments[0];
    }

    const stateName = segments[1];
    if (!states.has(stateName)) {
      states.set(stateName, { name: stateName, files: [] });
    }
    states.get(stateName).files.push(file);
  }

  if (!scenarioName) {
    scenarioName = inferScenarioName(files);
  }

  return {
    name: scenarioName || "Scenario",
    states,
  };
}

async function buildSnapshotFromState({ scenarioName, stateName, files }) {
  const instrumentsById = new Map();
  const publications = [];
  const sourceFiles = [];

  const sortedFiles = [...files].sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(
      b.webkitRelativePath || b.name,
      undefined,
      { numeric: true, sensitivity: "base" },
    ),
  );

  for (const file of sortedFiles) {
    const xmlText = await file.text();
    const parsed = parseTimelineXml(xmlText, file);

    sourceFiles.push(parsed.meta.sourceFile);
    publications.push({
      publicationId: parsed.meta.publicationId,
      publicationDate: parsed.meta.publicationDate,
      instrumentId: parsed.meta.instrumentId,
      instrumentType: parsed.meta.instrumentType,
    });

    parsed.instruments.forEach((instrument) => {
      const existing = instrumentsById.get(instrument.instrumentId);

      if (!existing) {
        instrumentsById.set(instrument.instrumentId, {
          ...instrument,
          versions: [...instrument.versions],
        });
        return;
      }

      existing.versions = mergeVersions(existing.versions, instrument.versions);
      existing.instrumentType = prioritizeInstrumentType(
        existing.instrumentType,
        instrument.instrumentType,
      );
      existing.displayName = buildInstrumentLabel(
        existing.instrumentId,
        existing.instrumentType,
      );
    });
  }

  const instruments = Array.from(instrumentsById.values()).sort(compareInstruments);

  return {
    meta: {
      scenarioName,
      stateName,
      sourceFiles,
      publications,
    },
    instruments,
  };
}

function mergeVersions(existing, incoming) {
  const byKey = new Map();
  existing.forEach((version) => byKey.set(version.key, version));
  incoming.forEach((version) => byKey.set(version.key, version));
  return Array.from(byKey.values()).sort(compareVersions);
}

function prioritizeInstrumentType(currentType, newType) {
  if (!newType) {
    return currentType;
  }
  if (!currentType) {
    return newType;
  }
  return instrumentTypeWeight(newType) < instrumentTypeWeight(currentType)
    ? newType
    : currentType;
}

function compareInstruments(a, b) {
  const weightDiff =
    instrumentTypeWeight(a.instrumentType) - instrumentTypeWeight(b.instrumentType);
  if (weightDiff !== 0) {
    return weightDiff;
  }
  return a.displayName.localeCompare(b.displayName, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareVersions(a, b) {
  const aTime = a.validFrom ? a.validFrom.getTime() : Number.NEGATIVE_INFINITY;
  const bTime = b.validFrom ? b.validFrom.getTime() : Number.NEGATIVE_INFINITY;
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  return (a.versionNumber || 0) - (b.versionNumber || 0);
}

function instrumentTypeWeight(type) {
  if (type === "regeling") {
    return 0;
  }
  if (type === "informatie-object") {
    return 1;
  }
  return 2;
}

function inferScenarioName(files) {
  const first = files[0];
  if (!first) {
    return "";
  }
  const segments = splitPathSegments(first.webkitRelativePath || first.name);
  return segments[0] || "";
}

function splitPathSegments(path) {
  return path.split(/[/\\]+/).filter(Boolean);
}

function renderSnapshot(snapshot) {
  const width = svgNode.clientWidth || defaultWidth;
  const height = svgNode.clientHeight || defaultHeight;
  svg.attr("viewBox", [0, 0, width, height]);

  const allVersions = snapshot.instruments.flatMap((instrument) => instrument.versions);

  let earliestDate = d3.min(allVersions, (version) => version.validFrom);
  if (!(earliestDate instanceof Date) || Number.isNaN(earliestDate?.getTime())) {
    earliestDate = new Date();
  }

  const latestExplicitEnd = d3.max(
    allVersions,
    (version) => version.validTo ?? null,
  );
  const latestStartCandidate = d3.max(allVersions, (version) => version.validFrom);
  const latestStart =
    latestStartCandidate instanceof Date && !Number.isNaN(latestStartCandidate.getTime())
      ? latestStartCandidate
      : earliestDate;

  // Calculate the actual data range end (latest of explicit ends or starts)
  const dataEnd = latestExplicitEnd || latestStart;

  // Always show 10% more time from first to last date in data
  const dataRange = dataEnd.getTime() - earliestDate.getTime();
  const extendedEnd = new Date(dataEnd.getTime() + dataRange * 0.1);

  const domainEnd = extendedEnd;

  const yScale = d3
    .scaleTime()
    .domain([earliestDate, domainEnd])
    .range([margin.top, height - margin.bottom])
    .nice();

  const axis = d3.axisLeft(yScale).ticks(10).tickFormat(d3.timeFormat("%Y-%m-%d"));

  axisGroup
    .transition()
    .duration(TRANSITION_DURATION_MS)
    .call(axis);

  const xScale = d3
    .scaleBand()
    .domain(snapshot.instruments.map((instrument) => instrument.instrumentId))
    .range([margin.left, width - margin.right])
    .paddingInner(0.4)
    .paddingOuter(0.2);

  const columnWidth = Math.min(180, Math.max(60, xScale.bandwidth() * 0.7));

  const instrumentSelection = instrumentsGroup
    .selectAll(".instrument")
    .data(snapshot.instruments, (d) => d.instrumentId);

  const instrumentEnter = instrumentSelection
    .enter()
    .append("g")
    .attr("class", "instrument")
    .attr(
      "transform",
      (d) =>
        `translate(${xScale(d.instrumentId) + xScale.bandwidth() / 2},0)`,
    );

  instrumentEnter
    .append("text")
    .attr("class", "instrument__label")
    .attr("text-anchor", "middle")
    .attr("y", margin.top - 25)
    .text((d) => d.displayName);

  instrumentSelection
    .merge(instrumentEnter)
    .transition()
    .duration(TRANSITION_DURATION_MS)
    .attr(
      "transform",
      (d) =>
        `translate(${xScale(d.instrumentId) + xScale.bandwidth() / 2},0)`,
    )
    .select(".instrument__label")
    .text((d) => d.displayName);

  instrumentSelection.exit().remove();

  instrumentsGroup
    .selectAll(".instrument")
    .each(function (instrument) {
      const container = d3.select(this);
      const rects = container
        .selectAll(".instrument__rect")
        .data(instrument.versions, (d) => d.key);

      const rectEnter = rects
        .enter()
        .append("rect")
        .attr("class", (version) =>
          [
            "instrument__rect",
            instrument.instrumentType === "regeling"
              ? "instrument__rect--regulation"
              : "instrument__rect--attachment",
            version.onTimeline ? null : "instrument__rect--off-timeline",
            !version.validTo ? "instrument__rect--open-ended" : null,
          ]
            .filter(Boolean)
            .join(" "),
        )
        .attr("x", -columnWidth / 2)
        .attr("width", columnWidth)
        .attr("y", (d) => yScale(d.validFrom) || margin.top)
        .attr("height", (d) =>
          Math.max(
            4,
            (yScale(d.validTo ?? domainEnd) || margin.top) -
              (yScale(d.validFrom) || margin.top),
          ),
        )
        .on("mouseenter", (event, version) => {
          tooltip
            .style("opacity", 1)
            .html(buildTooltipContent(instrument, version));
        })
        .on("mousemove", (event) => {
          tooltip
            .style("left", `${event.pageX}px`)
            .style("top", `${event.pageY - 20}px`);
        })
        .on("mouseleave", () => {
          tooltip.style("opacity", 0);
        });

      rects
        .merge(rectEnter)
        .transition()
        .duration(TRANSITION_DURATION_MS)
        .attr("class", (version) =>
          [
            "instrument__rect",
            instrument.instrumentType === "regeling"
              ? "instrument__rect--regulation"
              : "instrument__rect--attachment",
            version.onTimeline ? null : "instrument__rect--off-timeline",
            !version.validTo ? "instrument__rect--open-ended" : null,
          ]
            .filter(Boolean)
            .join(" "),
        )
        .attr("x", -columnWidth / 2)
        .attr("width", columnWidth)
        .attr("y", (d) => yScale(d.validFrom) || margin.top)
        .attr("height", (d) =>
          Math.max(
            4,
            (yScale(d.validTo ?? domainEnd) || margin.top) -
              (yScale(d.validFrom) || margin.top),
          ),
        );

      rects.exit().remove();

      // Add arrow indicators for open-ended regulations
      const arrows = container
        .selectAll(".instrument__arrow")
        .data(instrument.versions.filter(v => !v.validTo), (d) => `${d.key}-arrow`);

      const arrowsEnter = arrows
        .enter()
        .append("line")
        .attr("class", "instrument__arrow")
        .attr("x1", 0)
        .attr("x2", 0)
        .attr("y1", (d) => {
          const rectY = yScale(d.validFrom) || margin.top;
          const rectHeight = Math.max(
            4,
            (yScale(d.validTo ?? domainEnd) || margin.top) - rectY,
          );
          return rectY + rectHeight;
        })
        .attr("y2", (d) => {
          const rectY = yScale(d.validFrom) || margin.top;
          const rectHeight = Math.max(
            4,
            (yScale(d.validTo ?? domainEnd) || margin.top) - rectY,
          );
          return rectY + rectHeight + 20;
        })
        .attr("stroke", "#5c6bf0")
        .attr("stroke-width", 3)
        .attr("marker-end", "url(#arrowhead)")
        .style("opacity", 0);

      arrows
        .merge(arrowsEnter)
        .transition()
        .duration(TRANSITION_DURATION_MS)
        .attr("x1", 0)
        .attr("x2", 0)
        .attr("y1", (d) => {
          const rectY = yScale(d.validFrom) || margin.top;
          const rectHeight = Math.max(
            4,
            (yScale(d.validTo ?? domainEnd) || margin.top) - rectY,
          );
          return rectY + rectHeight;
        })
        .attr("y2", (d) => {
          const rectY = yScale(d.validFrom) || margin.top;
          const rectHeight = Math.max(
            4,
            (yScale(d.validTo ?? domainEnd) || margin.top) - rectY,
          );
          return rectY + rectHeight + 20;
        })
        .style("opacity", 1);

      arrows.exit().remove();

      const labels = container
        .selectAll(".instrument__version-label")
        .data(instrument.versions, (d) => `${d.key}-label`);

      const labelsEnter = labels
        .enter()
        .append("text")
        .attr("class", "instrument__version-label")
        .attr("text-anchor", "middle")
        .style("opacity", 0);

      labels
        .merge(labelsEnter)
        .transition()
        .duration(TRANSITION_DURATION_MS)
        .attr("x", 0)
        .attr("y", (d) => {
          const y = yScale(d.validFrom) || margin.top;
          const heightRect =
            (yScale(d.validTo ?? domainEnd) || margin.top) -
            (yScale(d.validFrom) || margin.top);
          return y + Math.min(heightRect / 2 + 4, Math.max(14, heightRect / 2));
        })
        .text((d) => `v${d.versionNumber ?? "?"}`)
        .style("opacity", (d) => {
          const heightRect =
            (yScale(d.validTo ?? domainEnd) || margin.top) -
            (yScale(d.validFrom) || margin.top);
          return heightRect > 24 ? 1 : 0;
        });

      labels.exit().remove();
    });

  updateSnapshotHeading(snapshot);
}

function goToSnapshot(index) {
  if (!snapshots.length) {
    return;
  }
  activeIndex = (index + snapshots.length) % snapshots.length;
  renderSnapshot(snapshots[activeIndex]);
}

function togglePlayback() {
  if (!snapshots.length) {
    return;
  }
  if (isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  if (isPlaying || snapshots.length <= 1) {
    return;
  }
  isPlaying = true;
  playPauseButton.textContent = "Pause";
  animationHandle = window.setInterval(() => {
    goToSnapshot(activeIndex + 1);
  }, ANIMATION_INTERVAL_MS);
}

function stopPlayback() {
  if (animationHandle) {
    window.clearInterval(animationHandle);
    animationHandle = null;
  }
  isPlaying = false;
  playPauseButton.textContent = "Play";
}

function clearVisualization() {
  instrumentsGroup.selectAll("*").remove();
  axisGroup.selectAll("*").remove();
  timelineTitle.textContent = "Timeline";
  timelineMeta.textContent = "";
}

function updateSnapshotHeading(snapshot) {
  const scenarioName = snapshot.meta.scenarioName || activeScenarioName || "Scenario";
  const stateName = snapshot.meta.stateName || `State ${activeIndex + 1}`;
  timelineTitle.textContent = `${scenarioName} • ${stateName} (${activeIndex + 1}/${snapshots.length})`;

  const instrumentCount = snapshot.instruments.length;
  const regulationCount = snapshot.instruments.filter(
    (instrument) => instrument.instrumentType === "regeling",
  ).length;

  const publicationDates = snapshot.meta.publications
    .map((item) => item.publicationDate)
    .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const formatter = d3.timeFormat("%Y-%m-%d");
  const lines = [
    `${instrumentCount} instrument${instrumentCount === 1 ? "" : "s"}`,
  ];

  if (regulationCount) {
    lines.push(`${regulationCount} regulation${regulationCount === 1 ? "" : "s"}`);
  }

  if (publicationDates.length === 1) {
    lines.push(`Bekendmaking: ${formatter(publicationDates[0])}`);
  } else if (publicationDates.length > 1) {
    lines.push(
      `Bekendmaking: ${formatter(publicationDates[0])} → ${formatter(publicationDates.slice(-1)[0])}`,
    );
  }

  lines.push(`Files: ${snapshot.meta.sourceFiles.length}`);

  timelineMeta.textContent = lines.join(" • ");
}

function buildTooltipContent(instrument, version) {
  const dateFormat = d3.timeFormat("%Y-%m-%d");
  const dateTimeFormat = d3.timeFormat("%Y-%m-%d %H:%M");
  const rows = [
    `<strong>${instrument.displayName}</strong>`,
    `Version: v${version.versionNumber ?? "?"}`,
    `Valid from: ${formatMaybe(version.validFrom, dateFormat)}`,
    `Valid to: ${
      version.validTo ? formatMaybe(version.validTo, dateFormat) : "open ended"
    }`,
  ];
  if (version.operation) {
    rows.push(`Operation: ${version.operation}`);
  }
  if (version.status) {
    rows.push(`Status: ${version.status}`);
  }
  if (version.publicationId) {
    rows.push(`Publication ID: ${version.publicationId}`);
  }
  if (version.publicationDate) {
    rows.push(
      `Publication date: ${formatMaybe(version.publicationDate, dateFormat)}`,
    );
  }
  if (version.supplyTime) {
    rows.push(`Delivered: ${formatMaybe(version.supplyTime, dateTimeFormat)}`);
  }
  rows.push(`On timeline: ${version.onTimeline ? "yes" : "no"}`);
  return rows.join("<br/>");
}

function textForTag(node, tagName) {
  if (!node) {
    return null;
  }
  const element = node.getElementsByTagNameNS(NAMESPACE, tagName)[0];
  return element ? element.textContent?.trim() ?? null : null;
}

function numberForTag(node, tagName) {
  const raw = textForTag(node, tagName);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildInstrumentLabel(instrumentId, instrumentType) {
  const tail = instrumentId ? instrumentId.split("/").slice(-1)[0] : "onbekend";
  const labelType =
    instrumentType === "regeling"
      ? "Regulation"
      : instrumentType === "informatie-object"
        ? "Attachment"
        : instrumentType
        ? capitalize(instrumentType)
        : "Instrument";
  return `${labelType} • ${tail}`;
}

function capitalize(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatMaybe(date, formatter) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return formatter(date);
}
