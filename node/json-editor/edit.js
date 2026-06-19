// edit.js

//const DATA_FILE = '../../data/catalog.json'; // Path to your huge JSON file

const fs = require('fs');
const prompts = require('prompts');

async function startEditor() {
  const data = JSON.parse(fs.readFileSync('../../data/catalog.json', 'utf8'));

  // 1. Select the record
  const { index } = await prompts({
    type: 'autocomplete',
    name: 'index',
    message: 'Select a book to edit:',
    choices: data.map((item, i) => ({ title: item.filename, value: i }))
  });

  if (index === undefined) return; // Exit if user cancels

  const record = data[index];

  // 2. Edit fields
  console.log(`\nEditing: ${record.filename}`);
  console.log('(Press Enter to keep current value)\n');

  const updatedFields = await prompts(
    Object.keys(record).map(key => ({
      type: 'text',
      name: key,
      message: `${key}:`,
      initial: record[key] !== null ? String(record[key]) : ''
    }))
  );

  // 3. Save
  data[index] = { ...record, ...updatedFields };
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));

  console.log('\nRecord updated successfully!');
}

startEditor();