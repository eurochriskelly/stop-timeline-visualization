const fs = require('fs');
const path = require('path');

const scenariosDir = './sample-data/scenarios';

function getScenarios() {
  const scenarios = [];
  const items = fs.readdirSync(scenariosDir).filter(item => item.startsWith('scen-'));
  for (const scenId of items) {
    const scenPath = path.join(scenariosDir, scenId);
    if (!fs.statSync(scenPath).isDirectory()) continue;
    const label = `Scenario ${scenId.split('-')[1]}`;
    const states = [];
    const stateItems = fs.readdirSync(scenPath).filter(item => item.startsWith('state-'));
    for (const stateId of stateItems) {
      const statePath = path.join(scenPath, stateId);
      if (!fs.statSync(statePath).isDirectory()) continue;
      const stateLabel = `State ${stateId.split('-')[1]}`;
      const files = [];
      function collectFiles(dir, relative) {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relPath = path.join(relative, item);
          if (fs.statSync(fullPath).isDirectory()) {
            collectFiles(fullPath, relPath);
          } else if (item.endsWith('.xml')) {
            files.push(relPath);
          }
        }
      }
      collectFiles(statePath, stateId);
      states.push({ id: stateId, label: stateLabel, files });
    }
    scenarios.push({ id: scenId, label, states });
  }
  return { basePath: scenariosDir, scenarios };
}

const index = getScenarios();
fs.writeFileSync(path.join(scenariosDir, 'index.json'), JSON.stringify(index, null, 2));
console.log('index.json rebuilt');