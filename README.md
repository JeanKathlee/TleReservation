# TLE Laboratory Reservation (minimal)

This is a minimal Express + SQLite app that provides:
- User-facing reservation form
- Printable reservation (two copies on one bondpaper-like page)
- Admin (teacher) login to approve/decline requests
- Simple calendar listing

Requirements
- Node 18+ installed (optional if you use Docker)

Setup (PowerShell)
```powershell
cd C:\TleReservation
# If you have node & npm on your machine
npm install
npm start
```

Run with Docker (if npm isn't available):
```powershell
cd C:\TleReservation
docker build -t tle-reservation .
docker run -p 3000:3000 -v C:\TleReservation\data:/app/data tle-reservation
```

Admin credentials (demo)
- username: teacher
- password: password

Notes
- This is a small demo. For production, secure the admin, add validations, and improve calendar UI.
