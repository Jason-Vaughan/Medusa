const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

function validate() {
  const schemaPath = path.join(__dirname, 'test-evidence.schema.json');
  const evidencePath = path.join(__dirname, '..', '.test-evidence.json');

  if (!fs.existsSync(evidencePath)) {
    console.error('❌ Missing .test-evidence.json. Run "npm run test:evidence" first.');
    process.exit(1);
  }

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

  const ajv = new Ajv({ allErrors: true, verbose: true });
  addFormats(ajv);

  const validator = ajv.compile(schema);
  const valid = validator(evidence);

  if (!valid) {
    console.error('❌ .test-evidence.json validation failed:');
    validator.errors.forEach(err => {
      console.error(`  - ${err.instancePath || 'root'} ${err.message}`);
      if (err.params) console.error(`    Params: ${JSON.stringify(err.params)}`);
    });
    process.exit(1);
  }

  console.log('✅ .test-evidence.json is valid against schema.');
}

validate();
