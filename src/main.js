import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const NAMESPACE = "http://koop.overheid.nl/apps/opera/";
const DATE_FAR_FUTURE = "9999-12-31";
const ANIMATION_INTERVAL_MS = 4000;
const TRANSITION_DURATION_MS = 700;

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

let snapshots = [];
let activeIndex = 0;
let animationHandle = null;
let isPlaying = false;

folderInput.addEventListener("change", handleFolderSelection);
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

function setControlsEnabled(enabled) {
  prevButton.disabled = !enabled;
  nextButton.disabled = !enabled;
  playPauseButton.disabled = !enabled;
  playPauseButton.textContent = "Play";
}

async function handleFolderSelection(event) {
  stopPlayback();
  statusMessage.textContent = "Reading XML timelines…";

  const files = Array.from(event.target.files || []).filter((file) =>
    file.name.toLowerCase().endsWith(".xml"),
  );

  if (!files.length) {
    snapshots = [];
    clearVisualization();
    statusMessage.textContent = "No XML files found in the selected folder.";
    setControlsEnabled(false);
    return;
  }

  files.sort((a, b) => a.name.localeCompare(b.name, "en"));

  const parsedSnapshots = [];
  for (const file of files) {
    try {
      const xmlText = await file.text();
      parsedSnapshots.push(parseTimelineXml(xmlText, file));
    } catch (error) {
      console.error(error);
      statusMessage.textContent = `Failed to parse ${file.name}: ${error.message}`;
      setControlsEnabled(false);
      return;
    }
  }

  const usableSnapshots = parsedSnapshots.filter(
    (snapshot) => snapshot.instruments.length > 0,
  );

  if (!usableSnapshots.length) {
    snapshots = [];
    clearVisualization();
    statusMessage.textContent =
      "No usable timeline entries were found in the selected XML files.";
    setControlsEnabled(false);
    return;
  }

  snapshots = usableSnapshots;
  activeIndex = 0;
  renderSnapshot(snapshots[activeIndex]);
  setControlsEnabled(true);

  const firstDate = snapshots[0].meta.publicationDate;
  const lastDate = snapshots[snapshots.length - 1].meta.publicationDate;
  const dateFormat = d3.timeFormat("%Y-%m-%d");
  const rangeDescription =
    firstDate && lastDate
      ? `${dateFormat(firstDate)} → ${dateFormat(lastDate)}`
      : "timeline snapshots";
  statusMessage.textContent = `Loaded ${snapshots.length} timeline snapshots (${rangeDescription}).`;
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
    sourceFile: file.name,
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
        versions: filteredVersions.sort((a, b) => {
          const order = (a.validFrom || 0) - (b.validFrom || 0);
          if (order !== 0) {
            return order;
          }
          return (a.versionNumber || 0) - (b.versionNumber || 0);
        }),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const typeWeight = (type) => (type === "regeling" ? 0 : type === "informatie-object" ? 1 : 2);
      const weightDiff = typeWeight(a.instrumentType) - typeWeight(b.instrumentType);
      if (weightDiff !== 0) {
        return weightDiff;
      }
      return a.displayName.localeCompare(b.displayName, "en");
    });

  return {
    meta,
    instruments,
  };
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
  const fallbackEnd = d3.timeMonth.offset(latestStart, 6);
  const domainEnd = latestExplicitEnd ?? fallbackEnd;

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
  if (isPlaying || !snapshots.length) {
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
  timelineTitle.textContent = `Timeline snapshot ${activeIndex + 1} of ${snapshots.length}`;
  const formatter = d3.timeFormat("%Y-%m-%d");
  const lines = [];
  if (snapshot.meta.publicationId) {
    lines.push(`Publication: ${snapshot.meta.publicationId}`);
  }
  if (snapshot.meta.publicationDate instanceof Date) {
    lines.push(`Bekendmaking: ${formatter(snapshot.meta.publicationDate)}`);
  }
  lines.push(`Source: ${snapshot.meta.sourceFile}`);
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
