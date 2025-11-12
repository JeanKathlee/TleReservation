const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const raw = fs.readFileSync(dbPath, 'utf8');
const db = JSON.parse(raw);

const candidates = ['adminpass','admin','password','1234','fghf','secret','password123','admin123'];

console.log('Loaded users:');
db.users.forEach(u => console.log(`- ${u.id}: ${u.username}`));

for (const u of db.users) {
  console.log(`\nTesting user: ${u.username} (id=${u.id})`);
  let found = false;
  for (const p of candidates) {
    if (bcrypt.compareSync(p, u.password)) {
      console.log(`  MATCH -> plaintext password: "${p}"`);
      found = true;
      break;
    } else {
      console.log(`  no match for: "${p}"`);
    }
  }
  if (!found) console.log('  No candidate matched.');
}
