const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const raw = fs.readFileSync(dbPath, 'utf8');
const db = JSON.parse(raw);

let changed = 0;
for (const r of db.reservations) {
  if (typeof r.created_by === 'undefined' || r.created_by === null) {
    const uname = (r.person_name || '').toString();
    if (!uname) continue;
    const user = db.users.find(u => u.username && u.username.toString() === uname);
    if (user) {
      r.created_by = user.id;
      changed++;
      console.log(`Backfilled reservation ${r.id} -> created_by=${user.id} (${user.username})`);
    }
  }
}

if (changed > 0) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  console.log(`Updated ${changed} reservations.`);
} else {
  console.log('No reservations needed backfilling.');
}
