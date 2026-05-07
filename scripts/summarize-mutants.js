const fs = require('fs');

const report = JSON.parse(fs.readFileSync('reports/mutation/mutation.json', 'utf8'));

const filesOfInterest = [
  'src/medusa/MedusaListener.js',
  'src/medusa/mcp-server.js',
  'src/medusa/medusa-server.js',
  'src/config/ConfigManager.js',
  'src/medusa/medusa-mcp-server.js'
];

filesOfInterest.forEach(fileName => {
  const fileData = report.files[fileName];
  if (!fileData) {
    console.log(`File not found in report: ${fileName}`);
    return;
  }

  const survived = fileData.mutants.filter(m => m.status === 'Survived');
  console.log(`\n--- ${fileName} (${survived.length} Survived) ---`);
  
  survived.slice(0, 20).forEach(m => {
    console.log(`ID: ${m.id} | Mutator: ${m.mutatorName} | Line: ${m.location.start.line} | Replacement: ${m.replacement}`);
  });
});
