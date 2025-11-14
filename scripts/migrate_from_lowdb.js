const fs = require('fs');
const path = require('path');
const knex = require('../db/knex');

function parseEquipmentField(equipment) {
  const items = [];
  if (!equipment) return items;
  if (Array.isArray(equipment)) {
    for (const name of equipment) items.push({ name: String(name).trim(), quantity: 1 });
    return items;
  }
  if (typeof equipment === 'string') {
    const parts = equipment.split(',').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      let m = part.match(/^(.*)\s*\(x(\d+)\)\s*$/i);
      if (m) {
        items.push({ name: m[1].trim(), quantity: Number(m[2]) });
        continue;
      }
      let m2 = part.match(/^(.*)\s+x(\d+)$/i);
      if (m2) {
        items.push({ name: m2[1].trim(), quantity: Number(m2[2]) });
        continue;
      }
      items.push({ name: part, quantity: 1 });
    }
  }
  return items;
}

async function tableExists(name) {
  return knex.schema.hasTable(name);
}

async function main() {
  try {
    const need = ['users', 'reservations', 'reservation_items'];
    for (const t of need) {
      const ok = await tableExists(t);
      if (!ok) {
        console.error(`Table '${t}' not found. Run migrations first: npx knex migrate:latest`);
        process.exit(1);
      }
    }

    const dbPath = path.join(__dirname, '..', 'data', 'db.json');
    if (!fs.existsSync(dbPath)) {
      console.error('data/db.json not found in project. Aborting.');
      process.exit(1);
    }

    const raw = fs.readFileSync(dbPath, 'utf8');
    const data = JSON.parse(raw);

    // Insert users (preserve ids when possible)
    const existingUsers = await knex('users').select('id', 'username');
    const existingByUsername = {};
    existingUsers.forEach(u => (existingByUsername[u.username] = u.id));

    const idMap = {}; // oldId -> newId

    if (Array.isArray(data.users)) {
      for (const u of data.users) {
        if (existingByUsername[u.username]) {
          idMap[u.id] = existingByUsername[u.username];
          continue;
        }
        try {
          // try inserting with explicit id to preserve mapping
          await knex('users').insert({ id: u.id, username: u.username, password: u.password, role: u.role || 'user' });
          idMap[u.id] = u.id;
        } catch (err) {
          // fallback: insert without id and retrieve generated id
          const [newId] = await knex('users').insert({ username: u.username, password: u.password, role: u.role || 'user' });
          idMap[u.id] = newId;
        }
      }
    }

    // Insert reservations and reservation_items
    if (Array.isArray(data.reservations)) {
      for (const r of data.reservations) {
        // skip if reservation already exists by id
        const exists = await knex('reservations').where('id', r.id).first();
        if (exists) continue;

        const insertRes = {
          id: r.id,
          venue: r.venue || 'Unknown',
          date: r.date || null,
          time_from: r.time_from || null,
          time_to: r.time_to || null,
          purpose: r.purpose || null,
          equipment: Array.isArray(r.equipment) ? r.equipment.join(', ') : (typeof r.equipment === 'string' ? r.equipment : null),
          person_name: r.person_name || null,
          person_signature: r.person_signature || null,
          created_by: idMap[r.created_by] || null,
          status: r.status || 'pending',
          created_at: r.created_at ? new Date(r.created_at) : new Date()
        };

        await knex('reservations').insert(insertRes);

        const items = parseEquipmentField(r.equipment);
        for (const it of items) {
          await knex('reservation_items').insert({ reservation_id: r.id, name: it.name, quantity: it.quantity });
        }
      }
    }

    console.log('Done: lowdb -> MySQL migration completed.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

main();
