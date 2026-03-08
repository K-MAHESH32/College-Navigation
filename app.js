/**
 * Smart Campus Navigation System
 * App.js - Core Logic
 */

/* =========================================
   Configuration & State
   ========================================= */
const CONFIG = {
    campusCenter: [16.8586, 81.4950], // Rough center of new data
    defaultZoom: 18,
    // [lat, lng]
    mainGateCoords: [16.8593445, 81.4941352], // Main gate coordinate mapping to an actual road node in data (e.g. start of R11)
    colors: {
        academic: { fill: '#b74947ff', border: '#b74545ff' },   // Solid Sky Blue
        admin: { fill: '#F59E0B', border: '#F59E0B' },      // Solid Amber
        hostel: { fill: '#6366F1', border: '#6366F1' },     // Solid Indigo
        canteen: { fill: '#10B981', border: '#10B981' },    // Solid Emerald Green
        gym: { fill: '#EC4899', border: '#EC4899' },        // Solid Pink
        ground: { fill: '#22C55E', border: '#22C55E' },     // Solid Green
        boundary: '#0f172a',
        road: '#475569',
        roadOutline: '#0f172a',
        route: '#0EA5E9'       /* Light Sky Blue for Route */
    }
};

const state = {
    geoData: null,
    buildings: [],
    roads: [],
    graph: null, // Routing graph
    userMarker: null,
    userLocation: null, // User's precise lat/lng
    watchId: null,      // Geolocation watch ID
    routingLayer: null, // Layer group for the active route
    isNavigating: false,
    destinationNode: null,
    voiceEnabled: true, // Speaker automatically ON
    lastSpokenInstruction: "",
    lastBearing: 0,
    femaleVoice: null, // Cache for selected female voice
    targetPath: null,
    spokenNodes: new Set(), // Track nodes we've already announced a turn for
    firstStepSpoken: false
};

/* =========================================
   Map Initialization
   ========================================= */
const map = L.map('map', {
    zoomControl: false,
    attributionControl: false, // Remove attribution globally
    maxZoom: 22 // High zoom for campus scale
}).setView(CONFIG.campusCenter, CONFIG.defaultZoom);

// Add custom position zoom control
L.control.zoom({ position: 'topleft' }).addTo(map);

// Base Tile Layer (Stadia Alidade Smooth for a cleaner, modern look, or OSM for standard)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
    maxNativeZoom: 19,
    className: 'colorful-map-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Sri Vasavi Engineering College'
}).addTo(map);

// Create Layer Groups to manage toggling if needed
const layers = {
    boundary: L.layerGroup().addTo(map),
    buildings: L.layerGroup().addTo(map),
    roads: L.layerGroup().addTo(map),
    labels: L.layerGroup().addTo(map)
};

/* =========================================
   Data Fetching & Parsing
   ========================================= */
async function loadCampusData() {
    try {
        if (typeof window.campusData !== 'undefined') {
            state.geoData = window.campusData;
            processGeoJSON(state.geoData);
            populateDestinations();
            buildGraph();
            return;
        }

        const response = await fetch('data/campus.geojson');
        if (!response.ok) throw new Error("Failed to load GeoJSON");

        state.geoData = await response.json();
        processGeoJSON(state.geoData);

        populateDestinations();
        buildGraph();

    } catch (error) {
        console.error("Error loading campus data.", error);
    }
}

function processGeoJSON(geoJson) {
    geoJson.features.forEach(feature => {
        const props = feature.properties;
        const geom = feature.geometry;

        if (geom.type === 'LineString' && props.type === 'road') {
            state.roads.push(feature);
            renderRoad(feature);
        }
        else if (geom.type === 'Polygon') {
            if (props.type === 'boundary') {
                renderBoundary(feature);
            } else {
                state.buildings.push(feature);
                renderBuilding(feature);
            }
        }
    });
}

/* =========================================
   Rendering Functions
   ========================================= */
function renderBoundary(feature) {
    L.geoJSON(feature, {
        style: {
            color: CONFIG.colors.boundary,
            weight: 3,
            opacity: 0.8,
            fillColor: CONFIG.colors.boundary,
            fillOpacity: 0.05,
            dashArray: '10, 10'
        }
    }).addTo(layers.boundary);
}

function renderRoad(feature) {
    L.geoJSON(feature, {
        style: {
            color: CONFIG.colors.roadOutline,
            weight: 12,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round'
        }
    }).addTo(layers.roads);

    L.geoJSON(feature, {
        style: {
            color: CONFIG.colors.road,
            weight: 8,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round'
        }
    }).addTo(layers.roads);
}

function renderBuilding(feature) {
    const props = feature.properties;
    const type = props.type || 'academic';
    const buildingStyle = CONFIG.colors[type] || CONFIG.colors.academic;

    const layer = L.geoJSON(feature, {
        style: {
            color: buildingStyle.border || buildingStyle,
            weight: 2,
            opacity: 1,
            fillColor: buildingStyle.fill || buildingStyle,
            fillOpacity: 1,
            className: 'building-polygon'
        }
    }).addTo(layers.buildings);

    if (props.name) {
        const popupContent = `
            <div class="building-popup">
                ${props.image ? `<img src="${props.image}" class="popup-img" alt="${props.name}">` : ''}
                <div class="popup-info">
                    <div class="popup-title">${props.name}</div>
                    ${props.description ? `<div class="popup-desc">${props.description.replace(/\n/g, '<br>')}</div>` : ''}
                </div>
            </div>
        `;
        layer.bindPopup(popupContent, { maxWidth: 300, className: 'custom-popup-wrapper' });

        // Centered Labels using Turf
        const centroid = turf.centroid(feature);
        const center = [centroid.geometry.coordinates[1], centroid.geometry.coordinates[0]];

        const myIcon = L.divIcon({
            className: 'building-label',
            html: `<div>${props.name}</div>`,
            iconSize: [100, 20], // Give it space to center horizontally
            iconAnchor: [50, 10] // Mathematical center of the iconSize
        });

        L.marker(center, { icon: myIcon, interactive: false }).addTo(layers.labels);
    }
}

/* =========================================
   UI and DOM Interactions
   ========================================= */
const elements = {
    destSearch: document.getElementById('destination-search'),
    destList: document.getElementById('dest-list'),
    startBtn: document.getElementById('start-nav-btn'),
    stopBtn: document.getElementById('stop-nav-btn'),
    voiceToggleBtn: document.getElementById('voice-toggle-btn'),
    voiceIcon: document.getElementById('voice-icon'),
    recenterBtn: document.getElementById('recenter-btn'),
    routeInfoPanel: document.getElementById('route-info-panel'),
    statDistance: document.getElementById('stat-distance'),
    statTime: document.getElementById('stat-time'),
    instructionsList: document.getElementById('instructions-list'),
    mobileRouteToggle: document.getElementById('mobile-route-toggle'),
    mobileBackBtn: document.getElementById('mobile-back-btn'),
    stopBtnMobile: document.getElementById('stop-nav-btn-mobile'),
    hudPanel: document.getElementById('mobile-nav-hud'),
    hudDistance: document.getElementById('hud-distance'),
    hudTime: document.getElementById('hud-time')
};

state.buildingMap = {};

function populateDestinations() {
    const sortedBuildings = [...state.buildings].sort((a, b) =>
        (a.properties.name || "").localeCompare(b.properties.name || "")
    );

    elements.destList.innerHTML = '';
    sortedBuildings.forEach(building => {
        const props = building.properties;
        if (!props.name || !props.entry_node) return;
        state.buildingMap[props.name.toLowerCase()] = props.entry_node;
        const option = document.createElement('option');
        option.value = props.name;
        elements.destList.appendChild(option);
    });

    elements.destSearch.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        if (state.buildingMap[val]) {
            elements.startBtn.classList.remove('disabled');
            elements.startBtn.disabled = false;
        } else {
            elements.startBtn.classList.add('disabled');
            elements.startBtn.disabled = true;
        }
    });

    // Initialize Voice UI state (Default ON)
    elements.voiceIcon.classList.replace('ph-speaker-slash', 'ph-speaker-high');
    elements.voiceToggleBtn.classList.add('active');

    elements.voiceToggleBtn.addEventListener('click', () => {
        state.voiceEnabled = !state.voiceEnabled;
        if (state.voiceEnabled) {
            elements.voiceIcon.classList.replace('ph-speaker-slash', 'ph-speaker-high');
            elements.voiceToggleBtn.classList.add('active');
            speakInstruction("Voice navigation enabled.");
        } else {
            elements.voiceIcon.classList.replace('ph-speaker-high', 'ph-speaker-slash');
            elements.voiceToggleBtn.classList.remove('active');
            window.speechSynthesis.cancel();
        }
    });

    // Pre-load voices to find a female voice
    window.speechSynthesis.onvoiceschanged = () => {
        const voices = window.speechSynthesis.getVoices();
        // Priority: Google Female, Microsoft Female, any voice with "female" or "woman" in name
        state.femaleVoice = voices.find(v => v.name.includes('Google') && v.name.includes('Female')) ||
            voices.find(v => v.name.toLowerCase().includes('female')) ||
            voices.find(v => v.name.toLowerCase().includes('woman')) ||
            voices.find(v => v.lang.startsWith('en') && v.name.includes('Zira')) || // Microsoft Zira (Female)
            voices[0];
    };
}

function initVoiceSearch() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = document.getElementById('mic-search-btn');

    if (!micBtn) return;

    if (!SpeechRecognition) {
        console.warn("Speech Recognition not supported by this browser.");
        micBtn.style.opacity = '0.3';
        micBtn.style.cursor = 'not-allowed';
        micBtn.title = "Voice search is not supported by your browser (Use Chrome or Edge).";
        micBtn.addEventListener('click', () => {
            speakInstruction("Your browser does not support voice search. Please try Chrome.");
        });
        return;
    }

    // Inform user about HTTPS requirement if not secure, but don't block
    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const isSecure = location.protocol === 'https:' || isLocalhost;
    if (!isSecure) {
        console.warn("Speech Recognition might fail on non-secure (non-HTTPS) connections.");
        micBtn.title = "Warning: Voice search usually requires HTTPS to work.";
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    micBtn.addEventListener('click', () => {
        if (micBtn.classList.contains('listening')) {
            try { recognition.stop(); } catch (e) { }
            return;
        }

        try {
            recognition.start();
        } catch (e) {
            console.error("Recognition Start Error:", e);
            micBtn.classList.remove('listening');
            speakInstruction("Voice search is currently busy. Try again.");
        }
    });

    recognition.onstart = () => {
        micBtn.classList.add('listening');
        speakInstruction("Listening...");
        console.log("Voice recognition started.");
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase().trim();
        console.log("Speech Result:", transcript);

        elements.destSearch.value = transcript;
        elements.destSearch.dispatchEvent(new Event('input'));

        micBtn.classList.remove('listening');
        speakInstruction("Searching for " + transcript);
    };

    recognition.onerror = (event) => {
        console.error("Voice Search Error:", event.error);
        micBtn.classList.remove('listening');

        if (event.error === 'not-allowed') {
            const msg = "Mic access blocked. NOTE: Voice search strictly requires an HTTPS connection on browsers like Chrome. Use HTTPS or localhost to fix this.";
            speakInstruction(msg);
            alert(msg);
        } else if (event.error === 'no-speech') {
            speakInstruction("I didn't hear anything. Please try again.");
        } else if (event.error === 'network') {
            speakInstruction("Network error. Voice search requires an internet connection.");
        } else if (event.error !== 'aborted') {
            speakInstruction("Voice search error: " + event.error);
        }
    };

    recognition.onend = () => {
        micBtn.classList.remove('listening');
        console.log("Voice recognition ended.");
    };
}

/* =========================================
   Navigation & Geolocation
   ========================================= */

function isInsideCampus(latlng) {
    if (state.buildings.length === 0 && state.roads.length === 0) return false;
    let bounds = L.latLngBounds([[16.8570, 81.4930], [16.8615, 81.4980]]);
    try {
        if (layers.boundary && layers.boundary.getBounds().isValid()) bounds = layers.boundary.getBounds();
        else if (layers.buildings && layers.buildings.getBounds().isValid()) bounds = layers.buildings.getBounds();
    } catch (e) { }
    return bounds.contains(latlng);
}

function startNavigation() {
    const val = elements.destSearch.value.toLowerCase();
    const destNode = state.buildingMap[val];
    if (!destNode) return;

    state.destinationNode = destNode;
    state.isNavigating = true;
    state.lastSpokenInstruction = "";

    elements.routeInfoPanel.classList.remove('hidden');

    // Mobile specific: prepare side panel
    if (window.innerWidth <= 768) {
        elements.routeInfoPanel.classList.add('mobile-side-panel');
        elements.mobileRouteToggle.classList.remove('hidden');
        elements.stopBtnMobile.classList.remove('hidden'); // Show mobile exit button
        elements.hudPanel.classList.remove('hidden'); // Show mobile HUD
    }

    elements.destSearch.disabled = true;
    elements.startBtn.classList.add('disabled');
    elements.startBtn.disabled = true;

    setTimeout(() => { map.invalidateSize(); }, 100);

    if (state.userLocation) calculateAndSetRoute(state.userLocation);

    if (navigator.geolocation) {
        state.watchId = navigator.geolocation.watchPosition(handleLocationUpdate, handleLocationError, { enableHighAccuracy: true });
    }
}

function stopNavigation() {
    state.isNavigating = false;
    state.destinationNode = null;
    if (state.watchId !== null) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
    if (state.routingLayer) { map.removeLayer(state.routingLayer); state.routingLayer = null; }
    elements.routeInfoPanel.classList.add('hidden');
    elements.routeInfoPanel.classList.remove('mobile-side-panel', 'active');
    elements.mobileRouteToggle.classList.add('hidden');
    elements.stopBtnMobile.classList.add('hidden'); // Hide mobile exit button
    elements.hudPanel.classList.add('hidden'); // Hide mobile HUD
    state.spokenNodes.clear();
    state.firstStepSpoken = false;

    elements.destSearch.disabled = false;
    elements.destSearch.value = "";
    elements.startBtn.classList.add('disabled');
    elements.startBtn.disabled = true;
    window.speechSynthesis.cancel();
}

function handleLocationUpdate(position) {
    let coords = [position.coords.longitude, position.coords.latitude];
    if (!isInsideCampus([coords[1], coords[0]])) coords = [CONFIG.mainGateCoords[1], CONFIG.mainGateCoords[0]];
    state.userLocation = coords;
    updateUserMarker(coords);
    if (state.isNavigating && state.destinationNode) calculateAndSetRoute(coords);
}

function handleLocationError(err) {
    if (!state.userLocation && state.isNavigating) {
        handleLocationUpdate({ coords: { longitude: CONFIG.mainGateCoords[1], latitude: CONFIG.mainGateCoords[0] } });
    }
}

function updateUserMarker(coords) {
    const latlng = [coords[1], coords[0]];
    const bearing = state.lastBearing || 0;

    if (!state.userMarker) {
        const navIcon = L.divIcon({
            className: 'nav-marker-custom',
            html: `<div class="nav-marker-container"><div class="nav-marker-pulse"></div><div class="nav-marker-circle"></div></div>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
        state.userMarker = L.marker(latlng, { icon: navIcon, zIndexOffset: 1000 }).addTo(map);
        map.setView(latlng, 19, { animate: true });
    } else {
        state.userMarker.setLatLng(latlng);
        if (state.isNavigating) map.panTo(latlng, { animate: true });
    }
}

function calculateAndSetRoute(userCoords) {
    let startNode = isInsideCampus([userCoords[1], userCoords[0]]) ? findNearestNode(userCoords) : [CONFIG.mainGateCoords[1], CONFIG.mainGateCoords[0]];
    startNode = findNearestNode(startNode) || startNode;
    if (!startNode) return;
    const routeInfo = dijkstra(startNode, state.destinationNode);
    if (!routeInfo) return;

    drawRoute(routeInfo.path, userCoords, startNode);
    elements.statDistance.textContent = `${Math.round(routeInfo.distance)} m`;
    elements.statTime.textContent = `${Math.max(1, Math.round((routeInfo.distance / 1.4) / 60))} min`;

    // Sync Mobile HUD
    elements.hudDistance.textContent = `${Math.round(routeInfo.distance)} m`;
    elements.hudTime.textContent = `${Math.max(1, Math.round((routeInfo.distance / 1.4) / 60))} min`;
    generateInstructions(routeInfo.path, state.destinationNode);

    // Proactive Voice Logic: Speak next turn if close
    checkProactiveVoice(routeInfo.path, userCoords);
}

function checkProactiveVoice(path, userCoords) {
    if (!state.isNavigating || path.length < 2) return;

    const destNode = path[path.length - 1];
    const distToDest = calculateDistance(userCoords, destNode);

    // 1. Arrival Logic (within 5 meters)
    if (distToDest < 5 && !state.spokenNodes.has('arrived')) {
        speakInstruction("You have reached your destination.");
        state.spokenNodes.add('arrived');
        return;
    }

    // 2. Proximity Alert (within 15 meters of destination)
    if (distToDest < 17 && distToDest > 8 && !state.spokenNodes.has('approaching')) {
        speakInstruction("You are 15 meters away from your destination.");
        state.spokenNodes.add('approaching');
    }

    // 3. Turn Logic (Intersections)
    if (path.length < 3) return;

    // Look ahead at the next few nodes for a turn
    for (let i = 1; i < Math.min(path.length - 1, 4); i++) {
        const node = path[i];
        const dist = calculateDistance(userCoords, node);
        const nodeKey = JSON.stringify(node);

        if (dist < 15 && !state.spokenNodes.has(nodeKey)) {
            const b1 = turf.bearing(turf.point(path[i - 1]), turf.point(path[i]));
            const b2 = turf.bearing(turf.point(path[i]), turf.point(path[i + 1]));
            const diff = (b2 - b1 + 540) % 360 - 180;

            let turnText = "";
            if (diff > 30 && diff < 150) turnText = "Turn right";
            else if (diff < -30 && diff > -180) turnText = "Turn left";
            else if (Math.abs(diff) >= 150) turnText = "Turn around";

            if (turnText) {
                speakInstruction(`${turnText} in ${Math.round(dist)} meters`);
                state.spokenNodes.add(nodeKey);
                break; // Only one turn announcement at a time
            }
        }
    }
}

function drawRoute(pathCoords, userCoords, startNode) {
    if (state.routingLayer) map.removeLayer(state.routingLayer);
    state.routingLayer = L.layerGroup().addTo(map);
    const latlngs = pathCoords.map(c => [c[1], c[0]]);
    latlngs.unshift([userCoords[1], userCoords[0]]);

    // Sky Blue Glow Layer
    L.polyline(latlngs, {
        color: CONFIG.colors.route,
        weight: 16,
        opacity: 0.4,
        className: 'route-path-glow'
    }).addTo(state.routingLayer);

    // Main Route Line
    L.polyline(latlngs, {
        color: CONFIG.colors.route,
        weight: 8,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
        className: 'route-path-main'
    }).addTo(state.routingLayer);

    // White Dotted Center Layer (Thicker Dots)
    L.polyline(latlngs, {
        color: '#FFFFFF',
        weight: 6,
        opacity: 0.8,
        dashArray: '1, 12',
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(state.routingLayer);
}

function generateInstructions(pathCoords, destNode) {
    elements.instructionsList.innerHTML = '';
    const addAndSpeak = (text, icon) => {
        addInstruction(text, icon);
        if (isFirst && !state.firstStepSpoken) {
            speakInstruction(text);
            isFirst = false;
            state.firstStepSpoken = true;
        }
    };

    if (pathCoords.length < 2) {
        addAndSpeak("You have arrived at your destination.", "ph-flag-checkered");
        state.lastBearing = 0;
        return;
    }

    let currentBearing = turf.bearing(turf.point(pathCoords[0]), turf.point(pathCoords[1]));
    state.lastBearing = currentBearing;
    addAndSpeak(`Head along the path for ${Math.round(calculateDistance(pathCoords[0], pathCoords[1]))} meters`, "ph-arrow-up");

    for (let i = 1; i < pathCoords.length - 1; i++) {
        const nextBearing = turf.bearing(turf.point(pathCoords[i]), turf.point(pathCoords[i + 1]));
        const normalizedDiff = (nextBearing - currentBearing + 540) % 360 - 180;
        const dist = Math.round(calculateDistance(pathCoords[i], pathCoords[i + 1]));

        if (normalizedDiff > 30 && normalizedDiff < 150) addInstruction(`Turn right and walk ${dist} meters`, "ph-arrow-bend-down-right");
        else if (normalizedDiff < -30 && normalizedDiff > -150) addInstruction(`Turn left and walk ${dist} meters`, "ph-arrow-bend-down-left");
        else if (Math.abs(normalizedDiff) >= 150) addInstruction(`Turn around and walk ${dist} meters`, "ph-arrows-left-right");
        else addInstruction(`Continue straight for ${dist} meters`, "ph-arrow-up");

        currentBearing = nextBearing;
    }
    addInstruction("Arrive at Destination", "ph-flag-checkered");
}

function addInstruction(text, iconClass) {
    const li = document.createElement('li');
    li.className = 'instruction-step';
    li.innerHTML = `<i class="ph ${iconClass} instruction-icon"></i><span class="instruction-text">${text}</span>`;
    elements.instructionsList.appendChild(li);
}

function findNearestNode(coords) {
    let nearest = null;
    let minDist = Infinity;
    const allNodes = Object.keys(state.graph);
    allNodes.forEach(nodeStr => {
        const node = JSON.parse(nodeStr);
        const dist = calculateDistance(coords, node);
        if (dist < minDist) { minDist = dist; nearest = node; }
    });
    return nearest;
}

function calculateDistance(coord1, coord2) {
    return turf.distance(turf.point(coord1), turf.point(coord2), { units: 'meters' });
}

function speakInstruction(text) {
    if (!state.voiceEnabled) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.1; // Slightly higher pitch for a clearer female tone

    if (state.femaleVoice) {
        utterance.voice = state.femaleVoice;
    } else {
        // Fallback: try picking a voice again if not pre-loaded
        const voices = window.speechSynthesis.getVoices();
        const female = voices.find(v => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('woman'));
        if (female) utterance.voice = female;
    }

    window.speechSynthesis.speak(utterance);
}

function buildGraph() {
    state.graph = {};
    state.roads.forEach(road => {
        const coords = road.geometry.coordinates;
        for (let i = 0; i < coords.length - 1; i++) {
            const u = JSON.stringify(coords[i]);
            const v = JSON.stringify(coords[i + 1]);
            const dist = calculateDistance(coords[i], coords[i + 1]);
            if (!state.graph[u]) state.graph[u] = {};
            if (!state.graph[v]) state.graph[v] = {};
            state.graph[u][v] = dist;
            state.graph[v][u] = dist;
        }
    });
    console.log(`Graph built with ${Object.keys(state.graph).length} nodes.`);
}

function dijkstra(start, end) {
    const startStr = JSON.stringify(start);
    const endStr = JSON.stringify(end);
    if (!state.graph[startStr] || !state.graph[endStr]) return null;
    const distances = {}, previous = {}, unvisited = new Set();
    Object.keys(state.graph).forEach(node => { distances[node] = Infinity; previous[node] = null; unvisited.add(node); });
    distances[startStr] = 0;
    while (unvisited.size > 0) {
        let current = null, minDest = Infinity;
        unvisited.forEach(node => { if (distances[node] < minDest) { minDest = distances[node]; current = node; } });
        if (current === null || current === endStr) break;
        unvisited.delete(current);
        for (let neighbor in state.graph[current]) {
            if (unvisited.has(neighbor)) {
                const alt = distances[current] + state.graph[current][neighbor];
                if (alt < distances[neighbor]) { distances[neighbor] = alt; previous[neighbor] = current; }
            }
        }
    }
    if (distances[endStr] === Infinity) return null;
    const path = [];
    let curr = endStr;
    while (curr !== null) { path.unshift(JSON.parse(curr)); curr = previous[curr]; }
    return { path: path, distance: distances[endStr] };
}

document.addEventListener('DOMContentLoaded', () => {
    loadCampusData();
    initVoiceSearch();
    setTimeout(() => {
        map.invalidateSize();
        // Initial zoom check
        if (map.getZoom() >= 18) document.getElementById('map').classList.add('map-show-labels');
    }, 500);

    map.on('zoomend', () => {
        const mapEl = document.getElementById('map');
        if (map.getZoom() >= 18) {
            mapEl.classList.add('map-show-labels');
        } else {
            mapEl.classList.remove('map-show-labels');
        }
    });
    elements.startBtn.addEventListener('click', startNavigation);
    elements.stopBtn.addEventListener('click', stopNavigation);
    elements.recenterBtn.addEventListener('click', () => {
        if (state.userMarker) map.setView(state.userMarker.getLatLng(), 19, { animate: true });
        else if (navigator.geolocation) navigator.geolocation.getCurrentPosition(handleLocationUpdate, handleLocationError, { enableHighAccuracy: true });
    });

    elements.mobileRouteToggle.addEventListener('click', () => {
        elements.routeInfoPanel.classList.toggle('active');
    });

    elements.mobileBackBtn.addEventListener('click', () => {
        elements.routeInfoPanel.classList.remove('active');
    });

    elements.stopBtnMobile.addEventListener('click', stopNavigation);
});

