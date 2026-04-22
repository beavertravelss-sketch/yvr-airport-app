// server.js - Level 5: Deploy to Render
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Session configuration
app.use(session({
    secret: 'yvr-airport-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, 'flights.json');

const VALID_USERS = [
    { username: 'gateagent1', password: 'yvr123', role: 'agent' },
    { username: 'opsmanager', password: 'yvr456', role: 'manager' }
];

function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}

function readFlightsFromFile() {
    try {
        const rawData = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(rawData);
    } catch (error) {
        console.error('Error reading flights file:', error);
        return [];
    }
}

function writeFlightsToFile(flights) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(flights, null, 2), 'utf8');
        console.log('Flights saved to file.');
    } catch (error) {
        console.error('Error writing flights file:', error);
    }
}

let flights = readFlightsFromFile();
if (flights.length === 0) {
    flights = [
        { time: "07:30", flight: "AC 202", dest: "Montreal (YUL)", gate: "C45", status: "On Time" },
        { time: "08:00", flight: "AC 101", dest: "Toronto (YYZ)", gate: "C42", status: "On Time" },
        { time: "08:45", flight: "WS 105", dest: "Edmonton (YEG)", gate: "B22", status: "Boarding" },
        { time: "09:15", flight: "WS 702", dest: "Calgary (YYC)", gate: "B21", status: "On Time" },
        { time: "10:00", flight: "DL 180", dest: "Seattle (SEA)", gate: "E71", status: "On Time" },
        { time: "10:30", flight: "UA 245", dest: "San Francisco (SFO)", gate: "E73", status: "Delayed" },
        { time: "11:15", flight: "LH 493", dest: "Frankfurt (FRA)", gate: "D52", status: "On Time" },
        { time: "11:45", flight: "BA 084", dest: "London (LHR)", gate: "D54", status: "Boarding" },
        { time: "12:30", flight: "JL 017", dest: "Tokyo (NRT)", gate: "D60", status: "On Time" },
        { time: "13:20", flight: "CX 889", dest: "Hong Kong (HKG)", gate: "D63", status: "On Time" }
    ];
    writeFlightsToFile(flights);
}

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = VALID_USERS.find(u => u.username === username && u.password === password);
    if (user) {
        req.session.user = { username: user.username, role: user.role };
        res.redirect('/staff');
    } else {
        res.redirect('/login?error=Invalid credentials');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/staff', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'staff-control.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public-display.html'));
});

app.get('/api/flights', (req, res) => {
    res.json(flights);
});

app.get('/api/user', requireAuth, (req, res) => {
    res.json(req.session.user);
});

app.post('/api/flights', requireAuth, (req, res) => {
    const { flight, dest, time, gate } = req.body;
    
    if (!flight || !dest || !time || !gate) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const existing = flights.find(f => f.flight === flight);
    if (existing) {
        return res.status(409).json({ error: 'Flight number already exists' });
    }
    
    const newFlight = {
        flight: flight.toUpperCase(),
        dest: dest,
        time: time,
        gate: gate,
        status: 'On Time'
    };
    
    flights.push(newFlight);
    writeFlightsToFile(flights);
    io.emit('flight-added', newFlight);
    res.status(201).json(newFlight);
});

io.on('connection', (socket) => {
    console.log('Device connected:', socket.id);
    socket.emit('initial-data', flights);

    socket.on('staff-update', (updatedFlight) => {
        console.log(`Staff updated flight ${updatedFlight.flight} to status: ${updatedFlight.status}`);
        
        const index = flights.findIndex(f => f.flight === updatedFlight.flight);
        if (index !== -1) {
            flights[index] = updatedFlight;
            writeFlightsToFile(flights);
            socket.broadcast.emit('flight-update', updatedFlight);
        }
    });

    socket.on('disconnect', () => {
        console.log('Device disconnected:', socket.id);
    });
});

// IMPORTANT CHANGE: Use process.env.PORT for Render compatibility
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✈️ YVR Airport Server running on port ${PORT}`);
});