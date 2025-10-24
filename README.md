# Regulation Timeline Explorer

This prototype turns the consolidation timeline XML exports (``consolidatie-tijdlijn``) into a calendar-like visualization. It is built with D3 and runs entirely in the browser so you can point it at a folder of XML snapshots without any build step.

## Quick start

1. Run a static file server in the project folder (any option works, two examples below):
   - `python3 -m http.server 5173`
   - `npx serve .`
2. Open `http://localhost:5173` (or the port you chose) in a modern browser.
3. Click **Select timeline folder** and choose a folder that contains one or more consolidation timeline XML files.
4. Use the **Play**, **Previous**, and **Next** buttons to animate through the snapshots.

> Tip: the page also works when opened directly from the file system (`index.html`), but serving it avoids stricter browser sandboxing and lets you add future assets easily.

## Demo data

The repository ships with three sample snapshots based on the regulation you provided:

- `sample-data/demo-regulation/2025-10-24-initial.xml`
- `sample-data/demo-regulation/2025-10-24-mutation-1.xml`
- `sample-data/demo-regulation/2025-10-24-mutation-2.xml`

Select the parent folder (`sample-data/demo-regulation`) and the visualization will animate from the initial publication through the two mutation decisions.

## What the visualization shows

- Each regulation or attachment (`instrument-type`) becomes a column.
- Rectangles represent the validity window of each version. Open-ended validity (`9999-12-31`) extends to the end of the current snapshot.
- Regulation versions are shaded in blue, attachments in orange. Versions marked `op-tijdlijn = false` render with reduced opacity.
- Hover over any rectangle to see version metadata (operation, publication IDs, delivery time, etc.).
- The left Y-axis is a zoomed time scale covering the minimum and maximum dates present in the selected snapshot.

Animations interpolate sizes and positions between snapshots so additions, removals, and date changes are easy to spot.

## Data expectations & notes

- XML namespaces are fixed to `http://koop.overheid.nl/apps/opera/`.
- The parser keeps every `<instrument-toestanden>` block it finds. Attachments (`instrument-type = informatie-object`) automatically join the chart.
- `juridisch-werkend-tot = 9999-12-31` is treated as open-ended. The chart extends six months past the latest known start date when no explicit end exists.
- Snapshots are sorted by filename; keep exports numbered or time-stamped to control playback order.
- Errors are surfaced in the status message area so malformed XML is easy to diagnose.

## Next steps ideas

1. Add zoom & pan on the time axis for very long timelines.
2. Display parallel tracks inside the regulation column for attachments to emphasize relationships.
3. Surface version-to-version diffs or link switches when attachments force a regulation update.
4. Package the logic into a React component once the surrounding UI is ready.

Feel free to reach out when you are ready to refine the behaviour, add filters, or plug the timeline into your React application.
