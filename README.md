# Regulation Timeline Explorer

This prototype turns the consolidation timeline XML exports (``consolidatie-tijdlijn``) into a calendar-like visualization. It is built with D3 and runs entirely in the browser: select a scenario folder and the page will animate through each state’s full regulation and attachment timelines.

## Quick start

1. Run a static file server in the project folder (any option works, two examples below):
   - `python3 -m http.server 5173`
   - `npx serve .`
2. Open `http://localhost:5173` (or the port you chose) in a modern browser.
3. Choose a scenario from the dropdown (fed by `sample-data/scenarios/index.json`)—for example `Scenario 1`.
4. Optional: click **Load custom folder** to browse to an ad-hoc scenario directory if it is not listed in the manifest.
5. Use the **Play**, **Previous**, and **Next** buttons to step through the ordered states or let the animation run automatically.

> Tip: the page also works when opened directly from the file system (`index.html`), but serving it avoids stricter browser sandboxing and lets you add future assets easily.

## Demo data

Use the scenario bundles under `sample-data/scenarios/` to see the full workflow. Each scenario follows this pattern:

```
scenarios/<scenario-name>/
  state-1/
    r1/
      regeling.xml
      io1.xml
      ...
  state-2/
    r1/
      ...
```

Selecting `sample-data/scenarios/scen-1` (for example) loads every state sequentially so you can observe how the regulation and each attachment evolve over time.

The legacy `sample-data/demo-regulation/` folder is still available if you need a minimal, single-file snapshot for smoke testing.

## Scenario manifest

The dropdown reads from `sample-data/scenarios/index.json`. Each scenario entry defines the state order and the XML files to load per state, using paths relative to the scenario root. Keep the manifest in sync whenever you add or remove data; note that the browser cannot enumerate directories automatically.

Example excerpt:

```json
{
  "id": "scen-1",
  "label": "Scenario 1",
  "states": [
    {
      "id": "state-1",
      "files": [
        "state-1/r1/regeling.xml",
        "state-1/r1/io1.xml"
      ]
    }
  ]
}
```

## What the visualization shows

- Each regulation or attachment (`instrument-type`) becomes a column.
- Rectangles represent the validity window of each version. Open-ended validity (`9999-12-31`) extends to the end of the current snapshot.
- Regulation versions are shaded in blue, attachments in orange. Versions marked `op-tijdlijn = false` render with reduced opacity.
- Hover over any rectangle to see version metadata (operation, publication IDs, delivery time, etc.).
- The left Y-axis is a zoomed time scale covering the minimum and maximum dates present in the selected snapshot.

Animations interpolate sizes and positions between snapshots so additions, removals, and date changes are easy to spot.

## Data expectations & notes

- Scenarios must follow the directory convention `scenario/state/regulation/<xml files>`. States are sorted with locale-aware/numeric ordering (`state-1`, `state-2`, …) to drive playback.
- Keep `sample-data/scenarios/index.json` up to date so curated scenarios appear in the dropdown; falling back to the folder loader remains possible for ad-hoc data.
- XML namespaces are fixed to `http://koop.overheid.nl/apps/opera/`.
- Every `<instrument-toestanden>` block contributes an instrument column; attachments (`instrument-type = informatie-object`) render alongside their parent regulation.
- `juridisch-werkend-tot = 9999-12-31` is treated as open-ended. The chart extends six months past the latest known start date when no explicit end exists.
- Errors are surfaced in the status message area so malformed XML is easy to diagnose.

## Next steps ideas

1. Add zoom & pan on the time axis for very long timelines.
2. Display parallel tracks inside the regulation column for attachments to emphasize relationships.
3. Surface version-to-version diffs or link switches when attachments force a regulation update.
4. Package the logic into a React component once the surrounding UI is ready.

Feel free to reach out when you are ready to refine the behaviour, add filters, or plug the timeline into your React application.
