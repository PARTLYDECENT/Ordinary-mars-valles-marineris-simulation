import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CORE CONSTANTS & DEFINITIONS ---
const SOL_DURATION_SECONDS = 60;
const MISSION_TARGET_PANELS = 20;
const CANYON_DEPTH = -40;
const POWER_CONSUMPTION = {
    habitat_base: 50,
    electrolysis: 150,
    refinery_active: 200,
    arc_furnace_active: 350,
    fabricator_active: 100,
    rover_deploy: 50,
    life_support_upgrade: 25,
};
const STRUCTURE_DEFS = {
    habitat_module: { id: 1, pos: [0, 0], fallback: new THREE.CylinderGeometry(8, 10, 12, 16) },
    arc_furnace:    { id: 2, pos: [-25, 15], fallback: new THREE.BoxGeometry(8, 6, 6) },
    refinery:       { id: 3, pos: [20, 25], fallback: new THREE.CylinderGeometry(5, 6, 10, 12) },
    fabricator:     { id: 4, pos: [-15, -25], fallback: new THREE.BoxGeometry(6, 4, 8) },
    mining_rig:     { id: 5, pos: [30, -20], fallback: new THREE.CylinderGeometry(4, 5, 8, 8) },
    rover:          { id: 6, pos: [15, -10], fallback: new THREE.BoxGeometry(4, 2, 6) },
};

// --- ✨ NEW: GOOGLE DRIVE FILE IDS ---
const modelFileIds = {
    habitat_module: '14YJSWPnmx97XbHPdXFAfFBPnWSTon7LC',
    arc_furnace: '1i4RyEv_1Dln27T3h2ovJ9sJjq5XXziBd',
    refinery: '1kROuLwxscScXDXSB1E7yziO0kR-ZkmHd',
    fabricator: '1Yb4zChRUrbLKA0aF5dtCntkHVsSC_IIQ',
    mining_rig: '1Yw9ohLNwzuKsPiR3plQB29W88w-GgeSq',
    rover: '1ghDSscIbYmjqcoDYqRcxFoJK5DVZt336'
};


// --- SCENE & STATE ---
let scene, camera, renderer, controls, clock, loader;
let lightingSystem, solTimer = 0;
let objects = { structures: {}, terrain: null, dust: null };
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let gameState = {
    sol: 1,
    timeOfDay: 0.3,
    batteryCharge: 5000,
    batteryCapacity: 10000,
    solarPanelCount: 4,
    oxygen: 94,
    water: 78,
    regolith: 50,
    ironOre: 25,
    ironPlates: 10,
    electronics: 5,
    temp: -62,
    wind: 12,
    isStorm: false,
    roverDeployed: false,
    activeProcesses: {},
    upgrades: {
        improvedLifeSupport: false,
        batteryExpansion: false
    },
    // New state for rover animation
    roverMission: {
        active: false,
        startTime: 0,
        duration: 12000, // Mission takes 12 seconds
        path: [],
    }
};

// --- INITIALIZATION ---
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a1810);
    scene.fog = new THREE.Fog(0x502828, 80, 500);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(0, 15, 130);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    clock = new THREE.Clock();
    loader = new GLTFLoader();

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, CANYON_DEPTH, 0);
    controls.minDistance = 10;
    controls.maxDistance = 300;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;

    setupLighting();
    createTerrain();
    createInitialStructures();
    createAtmosphere();

    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('click', onMouseClick);
    window.addEventListener('resize', onWindowResize);

    log("Mars Colony Command Initialized.", "success");
    log(`Objective: Construct ${MISSION_TARGET_PANELS} Solar Panels.`, "warning");
    updateAllUI();
    animate();
}

function setupLighting() {
    scene.add(new THREE.AmbientLight(0x664433, 0.5));
    lightingSystem = new THREE.DirectionalLight(0xFFD4A3, 3.5);
    lightingSystem.position.set(150, 200, 100);
    lightingSystem.castShadow = true;
    lightingSystem.shadow.mapSize.set(2048, 2048);
    lightingSystem.shadow.camera.near = 10;
    lightingSystem.shadow.camera.far = 600;
    lightingSystem.shadow.camera.left = -300;
    lightingSystem.shadow.camera.right = 300;
    lightingSystem.shadow.camera.top = 300;
    lightingSystem.shadow.camera.bottom = -300;
    scene.add(lightingSystem);
}

function createTerrain() {
    const size = 800, segments = 250;
    const canyonFloorWidth = 100, canyonTopWidth = 250;
    const wallTransition = (canyonTopWidth - canyonFloorWidth) / 2;

    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    const vertices = geometry.attributes.position;
    const simpleNoise = (x, y, scale, mag) => mag * Math.sin(x / scale + y / (scale/2));

    for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i);
        const pz = vertices.getY(i);
        const distFromCenter = Math.abs(x);
        let height = 0;

        if (distFromCenter < canyonFloorWidth / 2) {
            height = CANYON_DEPTH;
        } else if (distFromCenter < canyonTopWidth / 2) {
            const progress = (distFromCenter - canyonFloorWidth / 2) / wallTransition;
            height = CANYON_DEPTH + (CANYON_DEPTH * -1) * Math.pow(progress, 1.8);
        }

        height += simpleNoise(x, pz, 30, 0.8) + simpleNoise(x, pz, 100, 1.5);
        vertices.setZ(i, height);
    }
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0x9A5833, roughness: 0.96 });
    objects.terrain = new THREE.Mesh(geometry, material);
    objects.terrain.rotation.x = -Math.PI / 2;
    objects.terrain.receiveShadow = true;
    objects.terrain.name = "terrain";
    scene.add(objects.terrain);
    objects.terrain.updateMatrixWorld(true);
}

function getSurfaceHeight(x, z) {
    raycaster.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
    const intersects = raycaster.intersectObject(objects.terrain);
    if (intersects.length > 0) {
        return intersects[0].point.y;
    }
    console.error(`Raycast failed for position (${x}, ${z}). Using fallback depth.`);
    return CANYON_DEPTH;
}

function setupModel(model, name, x, z, yOffset = 0) {
    const groundY = getSurfaceHeight(x, z);
    model.position.set(x, groundY + yOffset, z);
    model.traverse(child => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    model.name = name;
    objects.structures[name] = model;
    scene.add(model);
}

// --- ✨ UPDATED FUNCTION ---
function loadGLBModel(name, definition, material) {
    const [x, z] = definition.pos;
    const fileId = modelFileIds[name];

    const fallback = () => {
        log(`Fallback: creating procedural model for ${name}.`, 'warning');
        const fallbackMesh = new THREE.Mesh(definition.fallback, material);
        setupModel(fallbackMesh, name, x, z, definition.fallback.parameters.height / 2 || 0);
    };

    if (!fileId) {
        console.error(`No Google Drive File ID found for model: ${name}`);
        fallback();
        return;
    }

    const modelUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    loader.load(modelUrl,
        (gltf) => setupModel(gltf.scene, name, x, z),
        undefined,
        fallback
    );
}

function createInitialStructures() {
    const genericMaterial = new THREE.MeshStandardMaterial({ color: 0xCCCCCC, roughness: 0.3, metalness: 0.7 });
    for (const name in STRUCTURE_DEFS) {
        loadGLBModel(name, STRUCTURE_DEFS[name], genericMaterial.clone());
    }
    for (let i = 0; i < gameState.solarPanelCount; i++) createSolarPanel(i);
}

function createSolarPanel(index) {
    const panelName = `solar_panel_${index}`;
    const panelGeom = new THREE.BoxGeometry(12, 0.3, 8);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.1, metalness: 0.9 });
    const panel = new THREE.Mesh(panelGeom, panelMat);
    const angle = (index / 10) * Math.PI;
    const radius = 35 + Math.floor(index / 10) * 15;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    setupModel(panel, panelName, x, z, 0.15);
}

function createAtmosphere() {
    const dustGeometry = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(2500 * 3);
    for (let i = 0; i < 2500 * 3; i+=3) {
        dustPositions[i] = (Math.random() - 0.5) * 900;
        dustPositions[i + 1] = Math.random() * 180 + 15;
        dustPositions[i + 2] = (Math.random() - 0.5) * 900;
    }
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMaterial = new THREE.PointsMaterial({ color: 0xD2B48C, size: 1.0, transparent: true, opacity: 0.4, sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending });
    objects.dust = new THREE.Points(dustGeometry, dustMaterial);
    scene.add(objects.dust);
}

window.buildSolarPanel = function() {
    const cost = { ironPlates: 5, electronics: 3 };
    if (gameState.ironPlates >= cost.ironPlates && gameState.electronics >= cost.electronics) {
        gameState.ironPlates -= cost.ironPlates;
        gameState.electronics -= cost.electronics;
        createSolarPanel(gameState.solarPanelCount);
        gameState.solarPanelCount++;
        log(`Solar panel ${gameState.solarPanelCount} constructed.`, "success");
        updateAllUI();
        if (gameState.solarPanelCount >= MISSION_TARGET_PANELS) {
            log("MISSION COMPLETE: Power grid secured! VICTORY.", "success");
            // Make sure you have a win22.html file or change this redirect
            setTimeout(() => window.location.href = 'win22.html', 2000);
        }
    } else { log("Insufficient resources for solar panel.", "critical"); }
}

function startProcess(key, duration, power, inputs, outputs) {
    if (gameState.activeProcesses[key]?.active) { log(`${key.replace(/_/g, ' ')} is already running.`, "warning"); return; }
    for (const res in inputs) {
        if (gameState[res] < inputs[res]) { log(`Insufficient ${res} for ${key}. Need ${inputs[res]}.`, "critical"); return; }
    }
    if (gameState.batteryCharge < power * 0.1) { log(`Insufficient power to start ${key}.`, "critical"); return; }
    for (const res in inputs) gameState[res] -= inputs[res];

    gameState.activeProcesses[key] = { active: true, timeLeft: duration, power, outputs };
    log(`${key.replace(/_/g, ' ')} process initiated.`, "info");
    updateAllUI();
}

window.interactWithStructure = (name, action) => {
    const interactions = {
        'refinery': () => startProcess('refinery', 15, POWER_CONSUMPTION.refinery_active, {regolith: 20}, {ironOre: 4, electronics: 2}),
        'arc_furnace': () => startProcess('arc_furnace', 12, POWER_CONSUMPTION.arc_furnace_active, {ironOre: 8}, {ironPlates: 3}),
        'fabricator': () => startProcess('fabricator', 10, POWER_CONSUMPTION.fabricator_active, {ironPlates: 2, regolith: 2}, {electronics: 1}),
        'habitat_module': () => { if (action === 'electrolysis') startProcess('electrolysis', 18, POWER_CONSUMPTION.electrolysis, {water: 15}, {oxygen: 8}); },
    };
    if(interactions[name]) interactions[name]();
};

window.advanceTime = function() {
    gameState.sol++;
    gameState.timeOfDay = 0.3;
    const mod = gameState.upgrades.improvedLifeSupport ? 0.5 : 1;
    gameState.oxygen = Math.max(0, gameState.oxygen - (Math.random() * 3 + 1) * mod);
    gameState.water = Math.max(0, gameState.water - (Math.random() * 2 + 1) * mod);
    gameState.temp = -62 + (Math.random() - 0.5) * 20;
    gameState.wind = 12 + (Math.random() - 0.5) * 30;
    log(`Advancing to Sol ${gameState.sol}.`, "info");
    updateAllUI();
};

window.toggleStorm = () => {
    gameState.isStorm = !gameState.isStorm;
    log(gameState.isStorm ? "Dust storm incoming!" : "Weather clearing.", gameState.isStorm ? "warning" : "success");
};

// --- ROVER DEPLOYMENT & ANIMATION ---
window.deployRover = function() {
    if (gameState.roverDeployed) { log("Rover is already on a mission.", "warning"); return; }
    if (gameState.batteryCharge < POWER_CONSUMPTION.rover_deploy) { log("Insufficient power for rover deployment.", "critical"); return; }

    gameState.roverDeployed = true;
    gameState.batteryCharge -= POWER_CONSUMPTION.rover_deploy;
    log("Rover deployed for geological survey.", "info");

    const roverObject = objects.structures.rover;
    if (!roverObject) {
        log("CRITICAL ERROR: Rover object not found in scene!", "critical");
        gameState.roverDeployed = false; // Reset state
        return;
    }

    const startPosition = roverObject.position.clone();
    // Define a more interesting, multi-point path
    const p1 = new THREE.Vector3(startPosition.x + 60, getSurfaceHeight(startPosition.x + 60, startPosition.z + 40), startPosition.z + 40);
    const p2 = new THREE.Vector3(p1.x - 50, getSurfaceHeight(p1.x - 50, p1.z + 70), p1.z + 70);
    const p3 = new THREE.Vector3(p2.x - 80, getSurfaceHeight(p2.x - 80, p2.z - 30), p2.z - 30);

    gameState.roverMission.path = [startPosition, p1, p2, p3, p1, startPosition];
    gameState.roverMission.active = true;
    gameState.roverMission.startTime = clock.getElapsedTime();

    // Disable the button while the rover is out
    document.querySelector('button[onclick="deployRover()"]').disabled = true;
};

function updateRoverMission() {
    const mission = gameState.roverMission;
    const elapsedTime = (clock.getElapsedTime() - mission.startTime) * 1000;
    const missionProgress = Math.min(elapsedTime / mission.duration, 1);

    const roverObject = objects.structures.rover;
    if (!roverObject) return;

    const path = mission.path;
    const segmentCount = path.length - 1;
    const segmentProgress = missionProgress * segmentCount;
    const currentSegmentIndex = Math.floor(segmentProgress);
    const segmentLerp = segmentProgress - currentSegmentIndex;

    if (currentSegmentIndex < segmentCount) {
        const start = path[currentSegmentIndex];
        const end = path[currentSegmentIndex + 1];
        roverObject.position.lerpVectors(start, end, segmentLerp);

        // Make the rover look where it's going, preventing it from looking at its current position
        if (end.distanceTo(roverObject.position) > 0.1) {
             roverObject.lookAt(end);
        }
    }

    if (missionProgress >= 1) {
        mission.active = false;
        gameState.roverDeployed = false;

        const foundOre = Math.floor(Math.random() * 20) + 10;
        const foundRegolith = Math.floor(Math.random() * 30) + 15;
        gameState.ironOre += foundOre;
        gameState.regolith += foundRegolith;
        log(`Rover returned: found ${foundOre}kg Ore and ${foundRegolith}kg Regolith.`, "success");

        // Re-enable the button
        document.querySelector('button[onclick="deployRover()"]').disabled = false;
        updateAllUI();
    }
}


window.attemptUpgrade = function(type) {
    const costs = {
        improvedLifeSupport: { ironPlates: 10, electronics: 5 },
        batteryExpansion: { ironPlates: 20, electronics: 10 },
    };
    const cost = costs[type];
    const name = type.replace(/([A-Z])/g, ' $1').trim();
    if (gameState.upgrades[type]) { log(`${name} already installed.`, "info"); return; }
    if (gameState.ironPlates >= cost.ironPlates && gameState.electronics >= cost.electronics) {
        gameState.ironPlates -= cost.ironPlates;
        gameState.electronics -= cost.electronics;
        gameState.upgrades[type] = true;
        if (type === 'batteryExpansion') gameState.batteryCapacity += 10000;
        log(`Upgrade successful: ${name}.`, "success");
    } else { log(`Insufficient resources for ${name}.`, "critical"); }
    updateAllUI();
};

function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    gameState.timeOfDay = (gameState.timeOfDay + deltaTime / SOL_DURATION_SECONDS) % 1;

    updateLighting();
    updateProcesses(deltaTime);

    if (gameState.roverMission.active) {
        updateRoverMission();
    }

    if (solTimer > 1) {
        updatePower();
        solTimer = 0;
    }
    solTimer += deltaTime;
    objects.dust.material.opacity = gameState.isStorm ? 0.8 : 0.4;
    if(gameState.isStorm) objects.dust.rotation.y += deltaTime * 0.1;

    controls.update();
    renderer.render(scene, camera);
}

function updateLighting() {
    const sunAngle = gameState.timeOfDay * Math.PI * 2 - Math.PI / 1.5;
    const yPos = Math.sin(sunAngle) * 200 + 50;
    lightingSystem.position.x = Math.cos(sunAngle) * 250;
    lightingSystem.position.y = Math.max(20, yPos);
    lightingSystem.intensity = Math.max(0.1, yPos / 200) * 3.5 * (gameState.isStorm ? 0.3 : 1);
}

function updateProcesses(deltaTime) {
    let uiNeedsUpdate = false;
    for (const key in gameState.activeProcesses) {
        const p = gameState.activeProcesses[key];
        if (p.active) {
            p.timeLeft -= deltaTime;
            if (p.timeLeft <= 0) {
                for (const res in p.outputs) gameState[res] = (gameState[res] || 0) + p.outputs[res];
                log(`${key.replace(/_/g, ' ')} process complete.`, "success");
                p.active = false;
                uiNeedsUpdate = true;
            }
        }
    }
    if (uiNeedsUpdate) updateAllUI();
}

function updatePower() {
    let consumption = POWER_CONSUMPTION.habitat_base + (gameState.upgrades.improvedLifeSupport ? POWER_CONSUMPTION.life_support_upgrade : 0);
    for (const key in gameState.activeProcesses) if(gameState.activeProcesses[key].active) consumption += gameState.activeProcesses[key].power;
    const sunAngle = gameState.timeOfDay * Math.PI * 2 - Math.PI / 1.5;
    const solarEfficiency = Math.max(0, Math.sin(sunAngle) + 0.5) * (gameState.isStorm ? 0.2 : 1);
    const generation = (80 * gameState.solarPanelCount) * solarEfficiency;
    gameState.batteryCharge = Math.max(0, Math.min(gameState.batteryCapacity, gameState.batteryCharge + (generation - consumption) * (1/60)));
    updateAllUI();
}

function updateAllUI() {
    document.getElementById('sol').textContent = String(gameState.sol).padStart(3, '0');
    document.getElementById('temp').textContent = `${Math.round(gameState.temp)}°C`;
    document.getElementById('wind').textContent = `${Math.round(gameState.wind * (gameState.isStorm ? 3 : 1))} kph`;
    const weatherEl = document.getElementById('weather-status');
    weatherEl.textContent = gameState.isStorm ? 'STORM' : 'NOMINAL';
    weatherEl.className = `metric-value ${gameState.isStorm ? 'critical-text' : 'success-text'}`;
    document.getElementById('solar-output').textContent = `${Math.round(gameState.batteryCharge < 1 ? 0 : (80 * gameState.solarPanelCount) * Math.max(0, Math.sin(gameState.timeOfDay * Math.PI * 2 - Math.PI/1.5) + 0.5) * (gameState.isStorm ? 0.2 : 1) )} W`;
    document.getElementById('total-consumption').textContent = `${Math.round(POWER_CONSUMPTION.habitat_base + Object.values(gameState.activeProcesses).reduce((acc, p) => acc + (p.active ? p.power : 0), 0))} W`;
    const batteryPercent = (gameState.batteryCharge / gameState.batteryCapacity) * 100;
    const batteryBar = document.getElementById('battery-bar');
    batteryBar.style.width = `${batteryPercent}%`;
    batteryBar.className = `progress-bar ${batteryPercent < 20 ? 'critical' : batteryPercent < 40 ? 'warning' : ''}`;
    document.getElementById('battery-charge-value').textContent = `${Math.round(gameState.batteryCharge)}/${gameState.batteryCapacity} Wh`;
    const missionPercent = (gameState.solarPanelCount / MISSION_TARGET_PANELS) * 100;
    document.getElementById('mission-panels-progress').textContent = `${gameState.solarPanelCount}/${MISSION_TARGET_PANELS}`;
    document.getElementById('mission-panels-bar').style.width = `${missionPercent}%`;
    ['oxygen', 'water'].forEach(res => {
        const val = Math.round(gameState[res]);
        document.getElementById(res).textContent = `${val}%`;
        const bar = document.getElementById(`${res}-bar`);
        bar.style.width = `${val}%`;
        bar.className = `progress-bar ${val < 20 ? 'critical' : val < 40 ? 'warning' : ''}`;
    });
    document.getElementById('regolith').textContent = `${gameState.regolith} kg`;
    document.getElementById('iron-ore').textContent = `${gameState.ironOre} kg`;
    document.getElementById('iron-plates').textContent = `${gameState.ironPlates} u`;
    document.getElementById('electronics').textContent = `${gameState.electronics} u`;
    document.getElementById('build-panel-btn').disabled = gameState.ironPlates < 5 || gameState.electronics < 3;
    document.getElementById('upgrade-lifesupport-btn').disabled = gameState.upgrades.improvedLifeSupport;
    document.getElementById('upgrade-battery-btn').disabled = gameState.upgrades.batteryExpansion;
}

function log(message, type = "info") {
    const consoleEl = document.getElementById('console');
    consoleEl.innerHTML += `<div><span class="text-gray-500">[Sol ${String(gameState.sol).padStart(3, '0')}]</span> <span class="${type}-text">${message}</span></div>`;
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

window.openTab = function(tabName) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.getElementById(`${tabName}-pane`).classList.add('active');
    event.currentTarget.classList.add('active');
}
window.togglePanel = function() {
    document.getElementById('side-panel').classList.toggle('collapsed');
}
function onMouseMove(event) {
    const tooltipEl = document.getElementById('tooltip');
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(Object.values(objects.structures));
    if (intersects.length > 0 && objects.structures[intersects[0].object.name]) {
        tooltipEl.style.display = 'block';
        tooltipEl.style.left = `${event.clientX + 10}px`;
        tooltipEl.style.top = `${event.clientY - 30}px`;
        tooltipEl.textContent = intersects[0].object.name.replace(/_/g, ' ').toUpperCase();
    } else {
        tooltipEl.style.display = 'none';
    }
}
function onMouseClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    if (intersects.length > 0 && intersects[0].object.name) {
        const name = intersects[0].object.name;
        if(STRUCTURE_DEFS[name]) interactWithStructure(name);
    }
}
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();
