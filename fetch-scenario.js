const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const xml2js = require('xml2js');

const inst = process.argv[2];
if (!inst) {
  console.error('Usage: node fetch-scenario.js <INST>');
  process.exit(1);
}

const scenariosDir = 'sample-data/scenarios';

try {
  // Fetch XML from API
  const fetchCmd = `curl -s -u admin:admin "http://localhost:8040/v1/resources/projects-opera-opera-test?rs:action=haal-tijdlijnen-uris&rs:instrument-id=${inst}"`;
  const xml = execSync(fetchCmd, { encoding: 'utf8' });

  // Parse XML
  const parser = new xml2js.Parser();
  parser.parseString(xml, (err, result) => {
    if (err) throw new Error(`XML parse error: ${err.message}`);

    const output = result.result?.output?.[0];
    if (!output?.aanleveringen) throw new Error('Invalid XML structure: missing aanleveringen');

    const aanleveringen = output.aanleveringen[0]?.aanlevering || [];

    // Determine next scenario number
    const existingScens = fs.readdirSync(scenariosDir)
      .filter(f => f.startsWith('scen-'))
      .map(f => parseInt(f.split('-')[1]) || 0)
      .sort((a, b) => b - a);
    const nextNum = existingScens.length ? existingScens[0] + 1 : 1;
    const scenId = `scen-${nextNum}`;
    const scenPath = path.join(scenariosDir, scenId);
    fs.mkdirSync(scenPath, { recursive: true });

    // Process each aanlevering
    for (const aan of aanleveringen) {
      const idLevering = aan.$?.['id-levering'];
      if (!idLevering) continue;

      const statePath = path.join(scenPath, idLevering);
      fs.mkdirSync(statePath, { recursive: true });

      const instrumenten = aan.instrumenten?.[0];
      if (!instrumenten?.['instrument']) continue;

      const versies = Array.isArray(instrumenten['instrument'])
        ? instrumenten['instrument']
        : [instrumenten['instrument']];
      const regeling = versies.find(v => v.$?.type === 'regeling');
      const ios = versies.filter(v => v.$?.type === 'informatie-object').map((io, index) => ({ ...io, number: (index + 1).toString() }));

      let baseFolder = statePath;
      if (regeling) {
        const regId = (instrumenten.$?.id || '').replace(/\//g, '-');
        baseFolder = path.join(statePath, regId);
        fs.mkdirSync(baseFolder, { recursive: true });

        // Download regeling files
        const tijdlijnUri = regeling.tijdlijn?.[0]?.$?.uri;
        const patchUri = regeling.patch?.[0]?.$?.uri;
        if (tijdlijnUri) {
          execSync(`curl -s -u admin:admin -o "${path.join(baseFolder, 'regeling.xml')}" "http://localhost:8040/v1/documents?uri=${tijdlijnUri}"`);
        }
        if (patchUri) {
          execSync(`curl -s -u admin:admin -o "${path.join(baseFolder, 'regeling.patch.xml')}" "http://localhost:8040/v1/documents?uri=${patchUri}"`);
        }
      }

      // Handle informatie-object
      for (const io of ios) {
        const num = io.number;
        const tijdlijnUri = io.tijdlijn?.[0]?.$?.uri;
        const patchUri = io.patch?.[0]?.$?.uri;
        if (tijdlijnUri) {
          execSync(`curl -s -u admin:admin -o "${path.join(baseFolder, `io${num}.xml`)}" "http://localhost:8040/v1/documents?uri=${tijdlijnUri}"`);
        }
        if (patchUri) {
          execSync(`curl -s -u admin:admin -o "${path.join(baseFolder, `io${num}.patch.xml`)}" "http://localhost:8040/v1/documents?uri=${patchUri}"`);
        }
      }
    }

    console.log(`Scenario ${scenId} created successfully.`);
  });
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}