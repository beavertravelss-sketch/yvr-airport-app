// server.js - Level 6: MongoDB Atlas Persistent Storage
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-dev-only',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/yvr-airport';
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// Flight Schema
const flightSchema = new mongoose.Schema({
    flight: { type: String, required: true, unique: true },
    dest: { type: String, required: true },
    time: { type: String, required: true },
    gate: { type: String, required: true },
    status: { type: String, default: 'On Time' }
});

const Flight = mongoose.model('Flight', flightSchema);

// Seed initial data if database is empty
async function seedInitialFlights() {
    const count = await Flight.countDocuments();
    if (count === 0) {
        const initialFlights = [
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
        await Flight.insertMany(initialFlights);
        console.log('🌱 Seeded initial flights to MongoDB');
    }
}
seedInitialFlights();

// Hardcoded staff credentials (in production, move to database)
const VALID_USERS = [
    { username: 'gateagent1', password: 'yvr123', role: 'agent' },
    { username: 'opsmanager', password: 'yvr456', role: 'manager' }
];

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Routes
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

// API: Get all flights (sorted by time)
app.get('/api/flights', async (req, res) => {
    try {
        const flights = await Flight.find().sort({ time: 1 });
        res.json(flights);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Get current user
app.get('/api/user', requireAuth, (req, res) => {
    res.json(req.session.user);
});

// API: Add new flight
app.post('/api/flights', requireAuth, async (req, res) => {
    const { flight, dest, time, gate } = req.body;
    
    if (!flight || !dest || !time || !gate) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
        const newFlight = new Flight({
            flight: flight.toUpperCase(),
            dest,
            time,
            gate,
            status: 'On Time'
        });
        await newFlight.save();
        
        // Notify all connected clients
        io.emit('flight-added', newFlight);
        res.status(201).json(newFlight);
    } catch (err) {
        if (err.code === 11000) {
            res.status(409).json({ error: 'Flight number already exists' });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// Socket.IO
io.on('connection', async (socket) => {
    console.log('Device connected:', socket.id);
    
    // Send current flights on connection
    try {
        const flights = await Flight.find().sort({ time: 1 });
        socket.emit('initial-data', flights);
    } catch (err) {
        console.error('Error sending initial flights:', err);
    }

    socket.on('staff-update', async (updatedFlight) => {
        console.log(`Staff updated flight ${updatedFlight.flight} to status: ${updatedFlight.status}`);
        
        try {
            // Update in database
            const flight = await Flight.findOneAndUpdate(
                { flight: updatedFlight.flight },
                { $set: { status: updatedFlight.status, gate: updatedFlight.gate } },
                { new: true }
            );
            
            if (flight) {
                // Broadcast to all other connected clients
                socket.broadcast.emit('flight-update', flight);
            }
        } catch (err) {
            console.error('Error updating flight:', err);
        }
    });

    socket.on('disconnect', () => {
        console.log('Device disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✈️ YVR Airport Server with MongoDB running on port ${PORT}`);
});