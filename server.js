const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
// Ensure data directory exists and initialize JSON DB (lowdb)
const fs = require('fs');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
const adapter = new FileSync(path.join(__dirname, 'data', 'db.json'));
const db = low(adapter);
// initialize DB defaults (users + reservations)
db.defaults({ users: [], reservations: [], lastId: 0 }).write();

// helper: create admin if not exists
const ensureAdmin = () => {
  const admin = db.get('users').find({ username: 'admin' }).value();
  if (!admin) {
    const hash = bcrypt.hashSync('adminpass', 8);
    db.get('users').push({ id: 1, username: 'admin', password: hash, role: 'admin' }).write();
  }
};
ensureAdmin();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'tle-secret', resave: false, saveUninitialized: true }));

// expose current session user to views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// expose events to views so templates can always access calendar data
app.use((req, res, next) => {
  try {
    // include all reservations (approved/pending/declined/cancelled) so users see their full history
    const events = db.get('reservations')
      .map(r => ({ id: r.id, venue: r.venue, date: r.date, time_from: r.time_from, time_to: r.time_to, purpose: r.purpose, equipment: r.equipment, person_name: r.person_name, status: r.status, created_by: r.created_by, created_at: r.created_at }))
      .value();
    res.locals.events = events;
  } catch (err) {
    res.locals.events = [];
  }
  next();
});

app.get('/', (req, res) => {
  // Always render the homepage; show login or reservation form based on session.
  // Also pass calendar events so the homepage can show the calendar to all visitors.
  // Use the enriched events set by middleware (res.locals.events) so templates have person_name and created_by
  const allEvents = (res.locals && res.locals.events) ? res.locals.events : db.get('reservations').value();
  const events = (allEvents || []).filter(r => r.status !== 'declined');
  // compute "mine" for logged-in user so template is simpler
  let mine = [];
  if (req.session && req.session.user) {
    const uname = (req.session.user.username || '').toString().trim().toLowerCase();
    mine = events.filter(e => {
      if (typeof e.created_by !== 'undefined' && e.created_by !== null) return e.created_by == req.session.user.id;
      const pname = (e.person_name || '').toString().trim().toLowerCase();
      if (!pname) return false;
      return pname === uname;
    });
  }
  // expose optional active tab from query (e.g. ?tab=myres)
  res.locals.activeTab = req.query.tab || null;
  res.render('index', { events, mine });
});

app.post('/reserve', requireLogin, (req, res) => {
  const { venue, date, time_from, time_to, purpose, equipment, person_name } = req.body;
  const nextId = db.get('lastId').value() + 1;
  db.set('lastId', nextId).write();
  const record = {
    id: nextId,
    venue,
    date,
    time_from,
    time_to,
    purpose,
    equipment,
    person_name,
    created_by: req.session && req.session.user ? req.session.user.id : null,
    person_signature: '',
    status: 'pending',
    created_at: new Date().toISOString()
  };
  // debug: log who is creating the reservation and the record
  try {
    console.log('POST /reserve by session.user =', req.session && req.session.user);
    console.log('New reservation record =', record);
  } catch (e) {
    // no-op
  }
  db.get('reservations').push(record).write();
  // after creating a reservation, redirect back to home with My Reservations tab active
  res.redirect('/?tab=myres');
});

// require login helper
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  // remember where we came from
  req.session.redirectTo = req.originalUrl;
  res.redirect('/login');
}

app.get('/reservation/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.get('reservations').find({ id }).value();
  if (!row) return res.status(404).send('Not found');
  res.render('reservation', { r: row });
});

app.get('/admin/login', (req, res) => {
  // Redirect to main login; admin users should sign in via /login and have role 'admin'
  res.redirect('/login');
});

// Sign-up & Sign-in routes for users
app.get('/signup', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
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
  if (req.session && req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const u = db.get('users').find({ username }).value();
  if (!u) return res.render('login', { error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, u.password)) return res.render('login', { error: 'Invalid credentials' });
  req.session.user = { id: u.id, username: u.username, role: u.role };
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Deprecated: admin/login handled via standard /login route; this POST kept for backward compatibility
app.post('/admin/login', (req, res) => {
  res.redirect('/login');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.redirect('/login');
}

app.get('/admin', requireAdmin, (req, res) => {
  const rows = db.get('reservations').value().slice().sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  res.render('admin', { reservations: rows });
});

// Admin: list users (passwords not shown) and allow reset
app.get('/admin/users', requireAdmin, (req, res) => {
  const users = db.get('users').map(u => ({ id: u.id, username: u.username, role: u.role })).value();
  res.render('admin_users', { users });
});

// Admin: reset a user's password
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

// Cancel reservation (user) - only owner or admin can cancel
app.post('/cancel/:id', (req, res) => {
  const id = Number(req.params.id);
  const r = db.get('reservations').find({ id }).value();
  if (!r) return res.status(404).send('Not found');
  const user = req.session && req.session.user;
  if (!user) return res.status(403).send('Not authorized');
  if (user.role !== 'admin' && r.created_by !== user.id) return res.status(403).send('Not authorized');
  db.get('reservations').find({ id }).assign({ status: 'cancelled' }).write();
  res.redirect('back');
});

// Delete reservation (admin)
app.post('/admin/delete/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.get('reservations').remove({ id }).write();
  res.redirect('/admin');
});

app.get('/calendar', (req, res) => {
  const rows = db.get('reservations').filter(r => r.status !== 'declined').map(r => ({ id: r.id, venue: r.venue, date: r.date, time_from: r.time_from, time_to: r.time_to, status: r.status })).value();
  res.render('calendar', { events: rows });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));
