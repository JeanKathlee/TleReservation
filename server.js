const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const app = express();

// Ensure data directory exists and initialize JSON DB
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
const adapter = new FileSync(path.join(__dirname, 'data', 'db.json'));
const db = low(adapter);
db.defaults({ users: [], reservations: [], lastId: 0 }).write();

// Create admin user if not exists
const ensureAdmin = () => {
  const admin = db.get('users').find({ username: 'admin' }).value();
  if (!admin) {
    const hash = bcrypt.hashSync('adminpass', 8);
    db.get('users').push({ id: 1, username: 'admin', password: hash, role: 'admin' }).write();
  }
};
ensureAdmin();

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

// Make reservations available to all templates
app.use((req, res, next) => {
  try {
    const events = db.get('reservations').value();
    res.locals.events = events;
  } catch (e) {
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
app.post('/reserve', requireLogin, (req, res) => {
  const { venue, date, time_from, time_to, purpose, equipment, person_name } = req.body;
  const nextId = db.get('lastId').value() + 1;
  db.set('lastId', nextId).write();
  db.get('reservations').push({
    id: nextId,
    venue,
    date,
    time_from,
    time_to,
    purpose,
    equipment,
    person_name,
    created_by: req.session.user.id,
    status: 'pending',
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/?tab=reservations');
});

// Equipment reservation
app.post('/reserve-equipment', requireLogin, (req, res) => {
  const { date, time_from, time_to, purpose, person_name } = req.body;
  let equipment_name = req.body.equipment_name;
  let equipment_qty = req.body.equipment_qty;
  
  // Handle single or multiple equipment items
  if (!Array.isArray(equipment_name)) {
    equipment_name = [equipment_name];
    equipment_qty = [equipment_qty];
  }
  
  // Format equipment list with quantities
  const equipmentList = equipment_name.map((name, idx) => {
    const qty = equipment_qty[idx] || 1;
    return `${name} (x${qty})`;
  }).join(', ');
  
  const nextId = db.get('lastId').value() + 1;
  db.set('lastId', nextId).write();
  db.get('reservations').push({
    id: nextId,
    venue: 'Equipment Reservation',
    date,
    time_from,
    time_to,
    purpose,
    equipment: equipmentList,
    person_name,
    created_by: req.session.user.id,
    status: 'pending',
    created_at: new Date().toISOString()
  }).write();
  res.redirect('/equipment-reservations');
});



// Reservation details
app.get('/reservation/:id', (req, res) => {
  const id = Number(req.params.id);
  const r = db.get('reservations').find({ id }).value();
  if (!r) return res.status(404).send('Not found');
  res.render('reservation', { r });
});

// User authentication
app.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('signup', { error: null });
});
app.post('/signup', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render('signup', { error: 'Missing fields' });
  if (db.get('users').find({ username }).value()) return res.render('signup', { error: 'User exists' });
  const id = db.get('users').size().value() + 1;
  const hash = bcrypt.hashSync(password, 8);
  db.get('users').push({ id, username, password: hash, role: 'user' }).write();
  req.session.user = { id, username, role: 'user' };
  res.redirect('/');
});
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const u = db.get('users').find({ username }).value();
  if (!u || !bcrypt.compareSync(password, u.password)) return res.render('login', { error: 'Invalid credentials' });
  req.session.user = { id: u.id, username: u.username, role: u.role };
  res.redirect('/');
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/') ));

// Admin routes
app.get('/admin', requireAdmin, (req, res) => {
  const rows = db.get('reservations').value().sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  res.render('admin', { reservations: rows });
});
app.get('/admin/users', requireAdmin, (req, res) => {
  const users = db.get('users').map(u => ({ id: u.id, username: u.username, role: u.role })).value();
  res.render('admin_users', { users });
});
app.post('/admin/reset-password/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { newpassword } = req.body;
  if (!newpassword || newpassword.length < 4) return res.status(400).send('Password too short');
  const hash = bcrypt.hashSync(newpassword, 8);
  db.get('users').find({ id }).assign({ password: hash }).write();
  res.redirect('/admin/users');
});
app.post('/admin/decision/:id', requireAdmin, (req, res) => {
  const { decision } = req.body;
  const id = Number(req.params.id);
  db.get('reservations').find({ id }).assign({ status: decision }).write();
  res.redirect('/admin');
});
app.post('/admin/delete/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.get('reservations').remove({ id }).write();
  res.redirect('/admin');
});

// Cancel reservation (user/admin)
app.post('/cancel/:id', (req, res) => {
  const id = Number(req.params.id);
  const r = db.get('reservations').find({ id }).value();
  if (!r) return res.status(404).send('Not found');
  const user = req.session.user;
  if (!user || (user.role !== 'admin' && r.created_by !== user.id)) return res.status(403).send('Not authorized');
  db.get('reservations').find({ id }).assign({ status: 'cancelled' }).write();
  res.redirect('back');
});

// Calendar view
app.get('/calendar', (req, res) => {
  const rows = db.get('reservations').filter(r => r.status !== 'declined').map(r => ({
    id: r.id, venue: r.venue, date: r.date, time_from: r.time_from, time_to: r.time_to, status: r.status
  })).value();
  res.render('calendar', { events: rows });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
