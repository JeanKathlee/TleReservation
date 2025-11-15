const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const knex = require('./db/knex');
const session = require('express-session');
const bcrypt = require('bcryptjs');
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (err) {
  // Puppeteer is optional at runtime. If not installed, PDF download route will return a helpful message.
  puppeteer = null;
  console.warn('Puppeteer is not installed. Server-side PDF route will be disabled until you run `npm install puppeteer`.');
}
// const fs removed; not needed when using MySQL via Knex

const app = express();

// Using Knex/MySQL for persistence. Ensure tables exist via migrations.
// There is no local JSON DB initialization here; migration already created tables and data.

// Express setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'tle-secret', resave: false, saveUninitialized: true }));

// Make current session user available to all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Formatting helpers available in EJS templates
app.locals.formatDate = function(dateVal) {
  if (!dateVal) return '';
  try {
    const d = new Date(dateVal);
    return d.toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', timeZone: 'Asia/Manila' });
  } catch (e) {
    return String(dateVal);
  }
};

app.locals.formatTime = function(timeVal) {
  if (!timeVal) return '';
  try {
    // If it's a full datetime or contains timezone info, parse as Date
    if (typeof timeVal === 'string' && (timeVal.includes('T') || timeVal.includes('GMT') || timeVal.includes('Z'))) {
      const d = new Date(timeVal);
      return d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
    }
    // If it's a simple time like HH:MM or HH:MM:SS, parse and format in Asia/Manila
    if (typeof timeVal === 'string' && /^\d{1,2}:\d{2}/.test(timeVal)) {
      // Format simple HH:MM strings without applying timezone conversions so
      // the hour/minute entered by the user remain the same (avoid server TZ shifts).
      const parts = timeVal.split(':');
      let hh = parseInt(parts[0], 10) || 0;
      const mm = (parts[1] || '00').slice(0,2);
      const ampm = hh >= 12 ? 'PM' : 'AM';
      hh = hh % 12;
      if (hh === 0) hh = 12;
      return `${hh}:${mm} ${ampm}`;
    }
    // Fallback
    return String(timeVal);
  } catch (e) {
    return String(timeVal);
  }
};

app.locals.formatTimeRange = function(from, to) {
  const f = app.locals.formatTime(from);
  const t = app.locals.formatTime(to);
  return f && t ? `${f} - ${t}` : (f || t || '');
};

// Make reservations available to all templates
app.use(async (req, res, next) => {
  try {
    const events = await knex('reservations').select('*');
    res.locals.events = events || [];
  } catch (e) {
    console.error('Failed to load reservations for templates:', e);
    res.locals.events = [];
  }
  next();
});

// Helper: require login
function requireLogin(req, res, next) {
  if (req.session.user) return next();
  req.session.redirectTo = req.originalUrl;
  res.redirect('/login');
}

// Helper: require admin
function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  res.redirect('/login');
}

// Home page - dashboard
app.get('/', (req, res) => {
  const allEvents = res.locals.events || [];
  let mine = [];
  if (req.session.user) {
    const uname = req.session.user.username.toLowerCase().trim();
    mine = allEvents.filter(e => {
      if (e.created_by) return e.created_by === req.session.user.id;
      return (e.person_name || '').toLowerCase().trim() === uname;
    });
  }
  // For admin, pass all reservations for the dashboard
  const reservations = req.session.user && req.session.user.role === 'admin' ? allEvents : [];
  res.render('index', { mine, reservations, currentPage: 'home' });
});

// Lab reservations page
app.get('/lab-reservations', requireLogin, (req, res) => {
  const allEvents = res.locals.events || [];
  let mine = [];
  if (req.session.user) {
    const uname = req.session.user.username.toLowerCase().trim();
    mine = allEvents.filter(e => {
      if (e.created_by) return e.created_by === req.session.user.id;
      return (e.person_name || '').toLowerCase().trim() === uname;
    });
  }
  const labReservations = mine.filter(r => r.venue !== 'Equipment Reservation');
  res.render('lab_reservations', { reservations: labReservations, currentPage: 'lab-reservations' });
});

// Equipment reservations page
app.get('/equipment-reservations', requireLogin, (req, res) => {
  const allEvents = res.locals.events || [];
  let mine = [];
  if (req.session.user) {
    const uname = req.session.user.username.toLowerCase().trim();
    mine = allEvents.filter(e => {
      if (e.created_by) return e.created_by === req.session.user.id;
      return (e.person_name || '').toLowerCase().trim() === uname;
    });
  }
  const equipmentReservations = mine.filter(r => r.venue === 'Equipment Reservation');
  res.render('equipment_reservations', { reservations: equipmentReservations, currentPage: 'equipment-reservations' });
});

// Statistics page
app.get('/statistics', requireLogin, (req, res) => {
  const allEvents = res.locals.events || [];
  let mine = [];
  if (req.session.user) {
    const uname = req.session.user.username.toLowerCase().trim();
    mine = allEvents.filter(e => {
      if (e.created_by) return e.created_by === req.session.user.id;
      return (e.person_name || '').toLowerCase().trim() === uname;
    });
  }
  res.render('statistics', { mine, currentPage: 'statistics' });
});

// Lab reservation
app.post('/reserve', requireLogin, async (req, res) => {
  try {
    const { venue, date, time_from, time_to, purpose, equipment, person_name } = req.body;
    const insertRes = {
      venue,
      date,
      time_from,
      time_to,
      purpose,
      equipment,
      person_name,
      created_by: req.session.user.id,
      status: 'pending',
      created_at: new Date()
    };
    const [newId] = await knex('reservations').insert(insertRes);
    // After creating, redirect user to the reservation detail page so they can print/save
    res.redirect(`/reservation/${newId}`);
  } catch (err) {
    console.error('Failed to create reservation:', err);
    res.status(500).send('Failed to create reservation');
  }
});

// Equipment reservation
app.post('/reserve-equipment', requireLogin, async (req, res) => {
  try {
    const { date, time_from, time_to, purpose, person_name } = req.body;
    let equipment_name = req.body.equipment_name;
    let equipment_qty = req.body.equipment_qty;
    if (!Array.isArray(equipment_name)) {
      equipment_name = [equipment_name];
      equipment_qty = [equipment_qty];
    }

    const equipmentList = equipment_name.map((name, idx) => {
      const qty = equipment_qty[idx] || 1;
      return `${name} (x${qty})`;
    }).join(', ');

    // Transaction: insert reservation, then items
    await knex.transaction(async trx => {
      const [resId] = await trx('reservations').insert({
        venue: 'Equipment Reservation',
        date,
        time_from,
        time_to,
        purpose,
        equipment: equipmentList,
        person_name,
        created_by: req.session.user.id,
        status: 'pending',
        created_at: new Date()
      });

      const items = [];
      for (let i = 0; i < equipment_name.length; i++) {
        const name = equipment_name[i];
        const qty = Number(equipment_qty[i]) || 1;
        items.push({ reservation_id: resId, name, quantity: qty });
      }
      if (items.length) await trx('reservation_items').insert(items);
    });

    // Redirect to the reservation detail page so user can print/save
    // resId is defined in the transaction scope; to be safe fetch the most recent reservation by created_by+timestamp
    const [latest] = await knex('reservations').where({ created_by: req.session.user.id }).orderBy('created_at', 'desc').limit(1).select('id');
    const redirectId = latest ? latest.id : null;
    if (redirectId) {
      res.redirect(`/reservation/${redirectId}`);
    } else {
      res.redirect('/equipment-reservations');
    }
  } catch (err) {
    console.error('Failed to create equipment reservation:', err);
    res.status(500).send('Failed to create equipment reservation');
  }
});



// Reservation details
app.get('/reservation/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await knex('reservations').where({ id }).first();
    if (!r) return res.status(404).send('Not found');
    const items = await knex('reservation_items').where({ reservation_id: id }).select('*');
    r.items = items;
    res.render('reservation', { r });
  } catch (err) {
    console.error('Failed to fetch reservation:', err);
    res.status(500).send('Server error');
  }
});

// Server-side PDF generation for a reservation
app.get('/reservation/:id/pdf', async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (!puppeteer) {
      return res.status(500).send('Server-side PDF generation is not available because Puppeteer is not installed. Run `npm install puppeteer` and restart the server.');
    }
    const r = await knex('reservations').where({ id }).first();
    if (!r) return res.status(404).send('Not found');

    // Render reservation page to HTML string (use pdf flag)
    const html = await new Promise((resolve, reject) => {
      res.render('reservation', { r, pdf: true }, (err, rendered) => {
        if (err) return reject(err);
        resolve(rendered);
      });
    });

    // Launch Puppeteer and render PDF (headless Chromium). This will download Chromium on install.
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'legal', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=reservation-${id}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Failed to generate PDF:', err);
    res.status(500).send('Failed to generate PDF');
  }
});

// User authentication
app.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('signup', { error: null });
});
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render('signup', { error: 'Missing fields' });
  try {
    const existing = await knex('users').where({ username }).first();
    if (existing) return res.render('signup', { error: 'User exists' });
    const hash = bcrypt.hashSync(password, 8);
    const [id] = await knex('users').insert({ username, password: hash, role: 'user' });
    req.session.user = { id, username, role: 'user' };
    res.redirect('/');
  } catch (err) {
    console.error('Signup failed:', err);
    res.status(500).send('Signup failed');
  }
});
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, adminLogin: false });
});
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const u = await knex('users').where({ username }).first();
    if (!u || !bcrypt.compareSync(password, u.password)) return res.render('login', { error: 'Invalid credentials', adminLogin: false });
    // Prevent admin users from logging in on the regular sign-in page
    if (u.role === 'admin') return res.render('login', { error: 'Please use the Admin sign-in page', adminLogin: false });
    req.session.user = { id: u.id, username: u.username, role: u.role };
    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Login failed');
  }
});

// Admin sign-in page and handler
app.get('/admin/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, adminLogin: true });
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const u = await knex('users').where({ username }).first();
    if (!u || !bcrypt.compareSync(password, u.password)) return res.render('login', { error: 'Invalid credentials', adminLogin: true });
    // Only allow admins here
    if (u.role !== 'admin') return res.render('login', { error: 'Not an admin account', adminLogin: true });
    req.session.user = { id: u.id, username: u.username, role: u.role };
    // Redirect admins to the main dashboard so they see the admin home layout
    res.redirect('/');
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).send('Login failed');
  }
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/') ));

// Admin routes
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const rows = await knex('reservations').orderBy('created_at', 'desc').select('*');
    // Pass any admin warning from session (show once) and then clear it
    const warning = req.session.adminWarning || null;
    delete req.session.adminWarning;
    res.render('admin', { reservations: rows, currentPage: 'admin', adminWarning: warning });
  } catch (err) {
    console.error('Failed to load admin reservations', err);
    res.status(500).send('Server error');
  }
});

app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await knex('users').select('id', 'username', 'role');
    res.render('admin_users', { users, currentPage: 'admin-users' });
  } catch (err) {
    console.error('Failed to load users', err);
    res.status(500).send('Server error');
  }
});

app.post('/admin/reset-password/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { newpassword } = req.body;
  if (!newpassword || newpassword.length < 4) return res.status(400).send('Password too short');
  try {
    const hash = bcrypt.hashSync(newpassword, 8);
    await knex('users').where({ id }).update({ password: hash });
    res.redirect('/admin/users');
  } catch (err) {
    console.error('Failed to reset password', err);
    res.status(500).send('Server error');
  }
});

app.post('/admin/decision/:id', requireAdmin, async (req, res) => {
  const { decision } = req.body;
  const id = Number(req.params.id);
  try {
    await knex('reservations').where({ id }).update({ status: decision });

    // If approving, check for time collisions with other approved reservations
    if (decision === 'approved') {
      const r = await knex('reservations').where({ id }).first();
      if (r) {
        // find other approved reservations with same venue and date that overlap in time
        const conflicts = await knex('reservations')
          .where('venue', r.venue)
          .andWhere('date', r.date)
          .andWhere('status', 'approved')
          .andWhereNot('id', id)
          .andWhere('time_from', '<', r.time_to)
          .andWhere('time_to', '>', r.time_from)
          .select('id', 'time_from', 'time_to');

        if (conflicts && conflicts.length) {
          // Use the requested phrasing for the warning message
          req.session.adminWarning = 'The laboratory has the same date and time to previous approved reservation. Are u sure u want to apptoved?';
        }
      }
    }

    res.redirect('/admin');
  } catch (err) {
    console.error('Failed to update decision', err);
    res.status(500).send('Server error');
  }
});

app.post('/admin/delete/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    await knex.transaction(async trx => {
      await trx('reservation_items').where({ reservation_id: id }).del();
      await trx('reservations').where({ id }).del();
    });
    res.redirect('/admin');
  } catch (err) {
    console.error('Failed to delete reservation', err);
    res.status(500).send('Server error');
  }
});

// Cancel reservation (user/admin)
app.post('/cancel/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await knex('reservations').where({ id }).first();
    if (!r) return res.status(404).send('Not found');
    const user = req.session.user;
    if (!user || (user.role !== 'admin' && r.created_by !== user.id)) return res.status(403).send('Not authorized');
    await knex('reservations').where({ id }).update({ status: 'cancelled' });
    res.redirect('back');
  } catch (err) {
    console.error('Failed to cancel reservation', err);
    res.status(500).send('Server error');
  }
});

// Calendar view
app.get('/calendar', async (req, res) => {
  try {
    // Only pull approved reservations for the calendar
    const rows = await knex('reservations').where({ status: 'approved' }).select('id', 'venue', 'date', 'time_from', 'time_to', 'status').orderBy('date', 'asc');

    // compute admin stats: previous (past) and upcoming (future)
    const todayStr = new Date().toISOString().slice(0, 10);
    let past = 0;
    let future = 0;
    for (const r of rows) {
      if ((r.date || '') < todayStr) past++; else future++;
    }

    const adminStats = { past, future };
    res.render('calendar', { events: rows, adminStats, currentPage: 'calendar' });
  } catch (err) {
    console.error('Failed to load calendar events', err);
    res.status(500).send('Server error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
