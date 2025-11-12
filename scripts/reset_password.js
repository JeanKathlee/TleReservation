const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node reset_password.js <username> <newpassword>');
  process.exit(1);
}
const [username, newpass] = args;
const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const raw = fs.readFileSync(dbPath, 'utf8');
const db = JSON.parse(raw);
const user = db.users.find(u => u.username === username);
if (!user) {
  console.error('User not found:', username);
  process.exit(2);
}
user.password = bcrypt.hashSync(newpass, 8);
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log(`Password for user ${username} updated.`);
