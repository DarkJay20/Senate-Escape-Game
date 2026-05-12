// ==========================================
// GAME CONFIGURATION & STATE
// ==========================================
const CONFIG = {
    laneWidth: 3,
    chunkLength: 30,
    baseSpeed: 0.5, 
    maxSpeed: 1.5,  
    speedAcceleration: 0.0002, 
    gravity: -0.02, 
    jumpForce: 0.32, 
    colors: {
        bg: 0x666666, 
        player: 0x00f3ff, 
        floor: 0xFFFDD0, 
        cement: 0x9e9e9e, 
        coin: 0x4CAF50 
    }
};

let state = {
    isPlaying: false,
    score: 0,
    coins: 0,
    speed: CONFIG.baseSpeed,
    currentFloorY: 0, 
    playerPos: new THREE.Vector3(0, 0, 0),
    currentAngle: 0, 
    targetAngle: 0,
    pathGen: { x: 0, z: 0, y: 0, angle: 0, lastY: 0, straightsSinceTurn: 0, nextTurnDir: 0, chunksGenerated: 0 },
    currentIntersection: null, 
    chunks: [], obstacles: [], coinsArr: [], history: [], particles: [] 
};

let bestScore = 0;
try {
    bestScore = parseInt(localStorage.getItem('senateEscapeBestScore')) || 0;
    if(bestScore > 0) {
        document.getElementById('start-best-score').style.display = 'block';
        document.getElementById('start-best-score').innerText = `BEST SCORE: ${bestScore.toLocaleString()}`;
    }
} catch(e) {}

// ==========================================
// THREE.JS SETUP (MOBILE OPTIMIZED)
// ==========================================
const container = document.getElementById('game-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.colors.bg);
scene.fog = new THREE.Fog(CONFIG.colors.bg, 20, 90);

// Disabled Antialias & capped pixel ratio for massive mobile performance boost
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 150);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); 
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xfff0dd, 0.7);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffeedd, 0.6);
dirLight.position.set(10, 20, 5);
scene.add(dirLight);

// ==========================================
// PRE-CACHED TEXTURES & MATERIALS (No runtime generation)
// ==========================================
function createTileTexture() {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFDD0'; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#E0E0E0'; ctx.lineWidth = 4; ctx.strokeRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(9, 30); return tex;
}

function createCementTexture() {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128; // Reduced size
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#9e9e9e'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 4000; i++) { // Reduced particle count for texture gen
        const x = Math.random() * 128, y = Math.random() * 128, size = Math.random() * 2 + 1;
        const shade = Math.floor(Math.random() * 60) - 30; 
        ctx.fillStyle = `rgba(${158 + shade}, ${158 + shade}, ${158 + shade}, 0.3)`; ctx.fillRect(x, y, size, size);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 10); return tex;
}

// Switched to MeshLambertMaterial for cheaper mobile lighting calculations
const mats = {
    floor: new THREE.MeshLambertMaterial({ map: createTileTexture() }),
    wood: new THREE.MeshLambertMaterial({ color: 0x5C4033 }),
    darkWood: new THREE.MeshLambertMaterial({ color: 0x3d2b1f }),
    wall: new THREE.MeshLambertMaterial({ map: createCementTexture() }),
    ceiling: new THREE.MeshLambertMaterial({ map: createCementTexture() }),
    paper: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    coin: new THREE.MeshLambertMaterial({ color: CONFIG.colors.coin }),
    silver: new THREE.MeshLambertMaterial({ color: 0xcccccc })
};

// Reduced geometry segments for mobile GPU
const geos = {
    coin: new THREE.BoxGeometry(0.6, 0.3, 0.4),
    floor: new THREE.PlaneGeometry(CONFIG.laneWidth * 3, CONFIG.chunkLength),
    particle: new THREE.BoxGeometry(0.15, 0.15, 0.15),
    head: new THREE.SphereGeometry(0.3, 8, 8),
    hair: new THREE.SphereGeometry(0.32, 8, 8),
    leg: new THREE.CylinderGeometry(0.12, 0.1, 0.6, 8).translate(0, -0.3, 0),
    arm: new THREE.CylinderGeometry(0.1, 0.08, 0.7, 8).translate(0, -0.35, 0)
};

// ==========================================
// PRE-CACHED SIGN TEXTURES (Fixes stutter on turns)
// ==========================================
function generateSignTexture(text) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffcc00'; ctx.font = 'bold 45px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 64);
    return new THREE.CanvasTexture(canvas);
}
const signMatLeft = new THREE.MeshBasicMaterial({map: generateSignTexture('⬅️ TURN'), transparent: true});
const signMatRight = new THREE.MeshBasicMaterial({map: generateSignTexture('TURN ➡️'), transparent: true});

function createNBITexture() {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#D4AF37'; ctx.font = 'bold 45px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('NBI', 64, 32);
    return new THREE.CanvasTexture(canvas);
}
const nbiBadgeMat = new THREE.MeshBasicMaterial({ map: createNBITexture(), transparent: true });

// ==========================================
// PARTICLES
// ==========================================
function spawnCoinParticles(position) {
    for(let i=0; i<6; i++) { // Reduced count for mobile
        const mat = new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0x4CAF50 : 0xD4AF37 });
        const p = new THREE.Mesh(geos.particle, mat); p.position.copy(position);
        p.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.4 + 0.1, (Math.random() - 0.5) * 0.4);
        p.userData.life = 1.0; scene.add(p); state.particles.push(p);
    }
}

function spawnCrashParticles(position) {
    for(let i=0; i<20; i++) { // Reduced count for mobile
        const mat = new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0xff0000 : 0x555555 });
        const p = new THREE.Mesh(geos.particle, mat); p.position.copy(position); p.position.y += 0.8; 
        p.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.6 + 0.2, (Math.random() - 0.5) * 0.8);
        p.userData.life = 1.0; scene.add(p); state.particles.push(p);
    }
}

// ==========================================
// OBSTACLES & SIGNS
// ==========================================
function createArrowSign(direction) {
    const group = new THREE.Group();
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), mats.wood); stand.position.y = 3; group.add(stand);
    const board = new THREE.Mesh(new THREE.BoxGeometry(4, 2.5, 0.2), new THREE.MeshLambertMaterial({color: 0x111111})); board.position.y = 5.5; group.add(board);
    const signPlane = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.3), direction === 1 ? signMatLeft : signMatRight);
    signPlane.position.set(0, 5.5, 0.11); group.add(signPlane); return group;
}

function createChair() {
    const group = new THREE.Group(), mat = mats.wood;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 1.0), mat); seat.position.y = 0.5;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.1), mat); back.position.set(0, 0.95, -0.45);
    const legGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
    const l1 = new THREE.Mesh(legGeo, mat); l1.position.set(-0.45, 0.25, -0.45);
    const l2 = new THREE.Mesh(legGeo, mat); l2.position.set(0.45, 0.25, -0.45);
    const l3 = new THREE.Mesh(legGeo, mat); l3.position.set(-0.45, 0.25, 0.45);
    const l4 = new THREE.Mesh(legGeo, mat); l4.position.set(0.45, 0.25, 0.45);
    group.add(seat, back, l1, l2, l3, l4); return group;
}

function createTable() {
    const group = new THREE.Group(), mat = mats.wood;
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 1.4), mat); top.position.y = 1.3; 
    const legGeo = new THREE.BoxGeometry(0.15, 1.3, 0.15);
    const l1 = new THREE.Mesh(legGeo, mat); l1.position.set(-1.2, 0.65, -0.6);
    const l2 = new THREE.Mesh(legGeo, mat); l2.position.set(1.2, 0.65, -0.6);
    const l3 = new THREE.Mesh(legGeo, mat); l3.position.set(-1.2, 0.65, 0.6);
    const l4 = new THREE.Mesh(legGeo, mat); l4.position.set(1.2, 0.65, 0.6);
    group.add(top, l1, l2, l3, l4); return group;
}

function createDesk() {
    const group = new THREE.Group(), mat = mats.wood;
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 1.4), mat); top.position.y = 1.3;
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 1.2), mat); sideL.position.set(-1.05, 0.65, 0);
    const sideR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 1.2), mat); sideR.position.set(1.05, 0.65, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.1), mat); back.position.set(0, 1.0, -0.6); 
    group.add(top, sideL, sideR, back); return group;
}

function createPaperStacks() {
    const group = new THREE.Group();
    for(let i=0; i<3; i++) { // Reduced stack size for mobile
        const height = 0.5 + Math.random() * 0.6;
        const stack = new THREE.Mesh(new THREE.BoxGeometry(0.6, height, 0.8), mats.paper);
        stack.position.set((Math.random() - 0.5) * 1.5, height / 2, (Math.random() - 0.5) * 0.5);
        stack.rotation.y = Math.random() * Math.PI; group.add(stack);
    }
    return group;
}

function createSecurityBarrier() {
    const group = new THREE.Group();
    const standMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const armMat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), standMat); stand.position.set(-1.3, 0.6, 0); 
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.15, 0.1), armMat); arm.position.set(0.1, 1.15, 0);
    group.add(stand, arm); return group;
}

function createCabinet() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.5, 1.4), mats.wood); body.position.y = 1.75; group.add(body);
    const split = new THREE.Mesh(new THREE.BoxGeometry(0.05, 3.3, 1.45), mats.darkWood); split.position.y = 1.75; group.add(split);
    const handle1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.15), mats.silver); handle1.position.set(-0.2, 1.5, 0.7);
    const handle2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.15), mats.silver); handle2.position.set(0.2, 1.5, 0.7);
    group.add(handle1, handle2); return group;
}

// ==========================================
// CHARACTERS (Bato & NBI Agents)
// ==========================================
function createBato() {
    const group = new THREE.Group(); group.rotation.order = 'YXZ'; 
    const skin = new THREE.MeshLambertMaterial({ color: 0xe0ac69 });
    const barong = new THREE.MeshLambertMaterial({ color: 0xffffee });
    const pants = new THREE.MeshLambertMaterial({ color: 0x222222 });

    const head = new THREE.Mesh(geos.head, skin); head.position.set(0, 1.6, 0);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.4), barong); body.position.set(0, 1.0, 0);
    const lLeg = new THREE.Mesh(geos.leg, pants); lLeg.position.set(-0.2, 0.6, 0);
    const rLeg = new THREE.Mesh(geos.leg, pants); rLeg.position.set(0.2, 0.6, 0);
    const lArm = new THREE.Mesh(geos.arm, barong); lArm.position.set(-0.45, 1.3, 0);
    const rArm = new THREE.Mesh(geos.arm, barong); rArm.position.set(0.45, 1.3, 0);

    group.add(head, body, lLeg, rLeg, lArm, rArm);
    group.userData.limbs = { lLeg, rLeg, lArm, rArm }; return group;
}

function createAgent() {
    const group = new THREE.Group(); group.rotation.order = 'YXZ'; 
    const skin = new THREE.MeshLambertMaterial({ color: 0xd29953 });
    const suit = new THREE.MeshLambertMaterial({ color: 0x001133 }); 
    const pants = new THREE.MeshLambertMaterial({ color: 0x00081a });
    const shades = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const hairMat = new THREE.MeshLambertMaterial({ color: 0x222222 });

    const head = new THREE.Mesh(geos.head, skin); head.position.set(0, 1.6, 0);
    const hair = new THREE.Mesh(geos.hair, hairMat); hair.scale.set(1, 0.7, 1); hair.position.set(0, 1.7, -0.04);
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.1), shades); glasses.position.set(0, 1.65, -0.26);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.85, 0.45), suit); body.position.set(0, 1.0, 0);
    const nbiPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), nbiBadgeMat); nbiPlane.position.set(0, 1.1, 0.226);
    const lLeg = new THREE.Mesh(geos.leg, pants); lLeg.position.set(-0.2, 0.6, 0);
    const rLeg = new THREE.Mesh(geos.leg, pants); rLeg.position.set(0.2, 0.6, 0);
    const lArm = new THREE.Mesh(geos.arm, suit); lArm.position.set(-0.48, 1.3, 0);
    const rArm = new THREE.Mesh(geos.arm, suit); rArm.position.set(0.48, 1.3, 0);

    group.add(head, hair, glasses, body, nbiPlane, lLeg, rLeg, lArm, rArm);
    group.userData.limbs = { lLeg, rLeg, lArm, rArm }; return group;
}

// ==========================================
// CONTROLLER & TURN OPTIMIZATION
// ==========================================
const playerGroup = createBato(); scene.add(playerGroup);
const chaserGroup1 = createAgent(); scene.add(chaserGroup1);
const chaserGroup2 = createAgent(); scene.add(chaserGroup2);

let playerCtrl = { lane: 0, targetX: 0, yVel: 0, isJumping: false, isSliding: false, slideTimer: 0, box: new THREE.Box3() };

function handleLeftRightInput(direction) {
    if (!state.isPlaying) return;

    if (state.currentIntersection && !state.currentIntersection.userData.turned) {
        state.targetAngle += direction * (Math.PI / 2);
        playerCtrl.lane = 0; playerCtrl.targetX = 0;
        playerGroup.userData.currentLaneX = 0; 
        state.playerPos.x = state.currentIntersection.userData.x;
        state.playerPos.z = state.currentIntersection.userData.z;
        state.currentIntersection.userData.turned = true;
        state.currentIntersection = null; 
    } else {
        playerCtrl.lane += direction; 
        playerCtrl.lane = Math.max(-1, Math.min(1, playerCtrl.lane));
        playerCtrl.targetX = playerCtrl.lane * -CONFIG.laneWidth; 
    }
}

function jump() { if (!state.isPlaying || playerCtrl.isJumping || playerCtrl.isSliding) return; playerCtrl.isJumping = true; playerCtrl.yVel = CONFIG.jumpForce; }
function slide() {
    if (!state.isPlaying || playerCtrl.isJumping || playerCtrl.isSliding) return;
    playerCtrl.isSliding = true; clearTimeout(playerCtrl.slideTimer);
    playerCtrl.slideTimer = setTimeout(() => { playerCtrl.isSliding = false; }, 800);
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') handleLeftRightInput(1); 
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') handleLeftRightInput(-1); 
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') jump();
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') slide();
});

let touchStartX = 0, touchStartY = 0;
document.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY; }, {passive: false});
document.addEventListener('touchmove', e => { if (state.isPlaying) e.preventDefault(); }, {passive: false});
document.addEventListener('touchend', e => {
    if (!state.isPlaying) return;
    let diffX = e.changedTouches[0].screenX - touchStartX, diffY = e.changedTouches[0].screenY - touchStartY;
    // Lowered threshold to 20 for more responsive mobile swiping
    if (Math.abs(diffX) > Math.abs(diffY)) { if (Math.abs(diffX) > 20) diffX > 0 ? handleLeftRightInput(-1) : handleLeftRightInput(1); } 
    else { if (Math.abs(diffY) > 20) diffY < 0 ? jump() : slide(); }
});

// ==========================================
// DYNAMIC 2D GRID WITH ELEVATION & SAFE ZONES
// ==========================================
function createChunk(type = 'straight') {
    state.pathGen.chunksGenerated++; 

    const chunkGroup = new THREE.Group(); 
    chunkGroup.position.set(state.pathGen.x, 0, state.pathGen.z); 
    chunkGroup.rotation.y = state.pathGen.angle;

    let startY = state.pathGen.lastY;
    let endY = startY;

    if (type === 'straight') {
        if (state.chunks.length > 3) {
            const r = Math.random();
            if (r > 0.7 && startY < 15) endY = startY + 6; 
            else if (r < 0.3 && startY > 0) endY = startY - 6; 
        }
    } else {
        endY = startY;
        state.pathGen.safeChunksRemaining = 2; 
    }
    
    state.pathGen.lastY = endY;
    
    chunkGroup.userData = { type: type, x: state.pathGen.x, z: state.pathGen.z, angle: state.pathGen.angle, startY: startY, endY: endY, turned: false };

    const deltaY = endY - startY;
    const hypLength = Math.sqrt(deltaY * deltaY + CONFIG.chunkLength * CONFIG.chunkLength);
    const angleX = Math.atan2(deltaY, CONFIG.chunkLength);
    const avgY = (startY + endY) / 2;

    if (type === 'straight') {
        let isSafe = false;
        if (state.pathGen.safeChunksRemaining > 0) { isSafe = true; state.pathGen.safeChunksRemaining--; }

        if (deltaY === 0) {
            const floor = new THREE.Mesh(geos.floor, mats.floor); 
            floor.rotation.x = -Math.PI / 2; floor.position.y = avgY; chunkGroup.add(floor);
        } else {
            const numSteps = 30; const stepLen = CONFIG.chunkLength / numSteps; const stepH = deltaY / numSteps;
            for (let i = 0; i < numSteps; i++) {
                const stepZ = (CONFIG.chunkLength / 2) - (i + 0.5) * stepLen;
                const stepGlobalY = startY + (i + 1) * stepH;
                const box = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.laneWidth * 3, 10, stepLen), mats.wall);
                box.position.set(0, stepGlobalY - 5, stepZ); chunkGroup.add(box);
            }
        }
        const wallGeo = new THREE.BoxGeometry(1, 25, hypLength);
        const lWall = new THREE.Mesh(wallGeo, mats.wall); lWall.position.set(-CONFIG.laneWidth * 1.5 - 0.5, avgY + 6, 0); lWall.rotation.x = angleX; chunkGroup.add(lWall);
        const rWall = new THREE.Mesh(wallGeo, mats.wall); rWall.position.set(CONFIG.laneWidth * 1.5 + 0.5, avgY + 6, 0); rWall.rotation.x = angleX; chunkGroup.add(rWall);
        const ceiling = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.laneWidth * 3 + 2, 1, hypLength), mats.ceiling); 
        ceiling.position.set(0, avgY + 14, 0); ceiling.rotation.x = angleX; chunkGroup.add(ceiling);
        
        spawnEntities(chunkGroup, startY, endY, isSafe);
        
        state.pathGen.x += -Math.sin(state.pathGen.angle) * CONFIG.chunkLength;
        state.pathGen.z += -Math.cos(state.pathGen.angle) * CONFIG.chunkLength;
    } 
    else if (type === 'intersection') {
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(CONFIG.chunkLength, CONFIG.chunkLength), mats.floor);
        floor.rotation.x = -Math.PI / 2; floor.position.y = avgY; chunkGroup.add(floor);
        
        const sign = createArrowSign(state.pathGen.nextTurnDir);
        sign.position.set(0, avgY, -CONFIG.chunkLength/2 + 2); chunkGroup.add(sign);

        state.pathGen.angle += state.pathGen.nextTurnDir * (Math.PI / 2);
        state.pathGen.x += -Math.sin(state.pathGen.angle) * CONFIG.chunkLength;
        state.pathGen.z += -Math.cos(state.pathGen.angle) * CONFIG.chunkLength;
    }
    scene.add(chunkGroup); state.chunks.push(chunkGroup);
}

function spawnEntities(chunkGroup, startY, endY, isSafe) {
    const isStairs = (startY !== endY);
    const zPos = (Math.random() - 0.5) * (CONFIG.chunkLength - 5); 
    const progress = (CONFIG.chunkLength / 2 - zPos) / CONFIG.chunkLength;
    const globalY = startY + progress * (endY - startY);
    const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5);
    
    if (!isStairs && !isSafe) {
        if (Math.random() > 0.15) { 
            const blockTwoLanes = Math.random() > 0.3; 
            const numObs = blockTwoLanes ? 2 : 1;
            
            for(let i=0; i<numObs; i++) {
                let obsMesh, obsType;
                const rType = Math.random();
                
                if (rType > 0.7) { obsMesh = Math.random() > 0.5 ? createChair() : createPaperStacks(); obsType = 'jump'; } 
                else if (rType > 0.4) { 
                    const r = Math.random(); 
                    if (r > 0.66) obsMesh = createTable(); else if (r > 0.33) obsMesh = createDesk(); else obsMesh = createSecurityBarrier(); 
                    obsType = 'slide'; 
                } 
                else { obsMesh = createCabinet(); obsType = 'solid'; }
                
                const offsetZ = i === 1 ? (Math.random() * 2 - 1) : 0; 
                obsMesh.position.set(lanes[i] * -CONFIG.laneWidth, globalY, zPos + offsetZ); 
                chunkGroup.add(obsMesh);
                state.obstacles.push({ mesh: obsMesh, chunkGroup: chunkGroup, type: obsType, box: new THREE.Box3() });
            }
        }
    }

    const coinLane = lanes[isStairs ? 0 : 1];
    for(let i=-2; i<=2; i+=2) {
        if (Math.random() > 0.2) {
            const cProg = Math.max(0, Math.min(1, (CONFIG.chunkLength / 2 - i * 4) / CONFIG.chunkLength));
            let cY = startY;
            if (isStairs) {
                const stepIndex = Math.min(29, Math.floor(cProg * 30));
                cY = startY + (stepIndex + 1) * ((endY - startY) / 30);
            }
            const coin = new THREE.Mesh(geos.coin, mats.coin);
            coin.position.set(coinLane * -CONFIG.laneWidth, cY + 0.5, i * 4); 
            chunkGroup.add(coin);
            state.coinsArr.push({ mesh: coin, chunkGroup: chunkGroup, box: new THREE.Box3(), collected: false });
        }
    }
}

function updateWorld() {
    const lastChunk = state.chunks[state.chunks.length - 1];
    const distToLast = Math.hypot(lastChunk.userData.x - state.playerPos.x, lastChunk.userData.z - state.playerPos.z);
    
    if (distToLast < 120) { 
        state.pathGen.straightsSinceTurn++;
        if (state.pathGen.straightsSinceTurn > 4 && Math.random() > 0.5) {
            state.pathGen.nextTurnDir = Math.random() > 0.5 ? 1 : -1; 
            createChunk('intersection'); state.pathGen.straightsSinceTurn = 0;
        } else { createChunk('straight'); }
    }

    state.currentIntersection = null;
    for (let chunk of state.chunks) {
        if (chunk.userData.type === 'intersection' && !chunk.userData.turned) {
            const dist = Math.hypot(chunk.userData.x - state.playerPos.x, chunk.userData.z - state.playerPos.z);
            if (dist < CONFIG.laneWidth * 2.5) { state.currentIntersection = chunk; }
        }
    }

    if (state.chunks.length > 15) {
        const old = state.chunks.shift(); scene.remove(old);
        state.obstacles = state.obstacles.filter(obs => obs.chunkGroup !== old);
        state.coinsArr = state.coinsArr.filter(c => c.chunkGroup !== old);
    }
}

// ==========================================
// GAME LOOP & LOGIC
// ==========================================
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const hud = document.getElementById('hud');
const coinValDisplay = document.getElementById('coin-display');

function startGame() { startScreen.style.display = 'none'; hud.style.display = 'flex'; resetGame(); }

function resetGame() {
    gameOverScreen.style.display = 'none'; hud.style.display = 'flex'; document.getElementById('new-record-alert').style.display = 'none';
    state.isPlaying = true; state.score = 0; state.coins = 0; state.speed = CONFIG.baseSpeed;
    
    state.pathGen = { x: 0, z: 0, y: 0, lastY: 0, angle: 0, straightsSinceTurn: 0, nextTurnDir: 0, safeChunksRemaining: 3 };
    state.playerPos.set(0, 0, 0); state.currentAngle = 0; state.targetAngle = 0;
    playerCtrl.lane = 0; playerCtrl.targetX = 0; playerCtrl.isJumping = false; playerCtrl.isSliding = false; playerCtrl.yVel = 0;
    
    playerGroup.position.set(0, 0, 0); playerGroup.userData.currentLaneX = 0; playerGroup.visible = true; 
    chaserGroup1.position.set(0, 0, 3); chaserGroup2.position.set(0, 0, 6); 
    state.history = []; 

    state.chunks.forEach(c => scene.remove(c)); state.chunks = []; state.obstacles = []; state.coinsArr = [];
    state.particles.forEach(p => scene.remove(p)); state.particles = [];
    
    for(let i=0; i<6; i++) createChunk('straight'); updateUI();
}

function updateUI() {
    document.getElementById('dist-display').innerText = `${Math.floor(state.score)}m`;
    document.getElementById('score-display').innerText = (Math.floor(state.score) * 10 + (state.coins * 100)).toLocaleString();
    coinValDisplay.innerText = `₱${state.coins.toLocaleString()}`;
}

function triggerGameOver(reason = "You have been caught") {
    state.isPlaying = false; hud.style.display = 'none'; 
    document.getElementById('wrapper').classList.remove('shake-screen'); void document.getElementById('wrapper').offsetWidth; document.getElementById('wrapper').classList.add('shake-screen');

    gameOverScreen.style.display = 'flex'; document.querySelector('#game-over-screen h1').innerText = reason;
    const finalScore = Math.floor(state.score) * 10 + (state.coins * 100);
    document.getElementById('final-dist').innerText = `${Math.floor(state.score)}m`;
    document.getElementById('final-coins').innerText = `₱${state.coins.toLocaleString()}`;
    document.getElementById('final-score').innerText = finalScore.toLocaleString();

    document.getElementById('end-best-score').innerText = `BEST: ${Math.max(finalScore, bestScore).toLocaleString()}`;
    if (finalScore > bestScore && finalScore > 0) {
        bestScore = finalScore; document.getElementById('new-record-alert').style.display = 'block';
        try { localStorage.setItem('senateEscapeBestScore', bestScore); } catch(e) {}
    }
}

function checkCollisions() {
    playerCtrl.box.setFromObject(playerGroup);
    if (playerCtrl.isSliding) playerCtrl.box.max.y = state.currentFloorY + 0.5; 
    playerCtrl.box.expandByScalar(-0.1); 

    for (let obs of state.obstacles) {
        obs.box.setFromObject(obs.mesh);
        if (obs.type === 'slide') obs.box.min.y = state.currentFloorY + 0.8; 
        
        if (playerCtrl.box.intersectsBox(obs.box)) { 
            spawnCrashParticles(playerGroup.position);
            playerGroup.visible = false; 
            triggerGameOver("You hit an obstacle!"); return; 
        }
    }

    for (let c of state.coinsArr) {
        if (!c.collected) {
            c.box.setFromObject(c.mesh);
            if (playerCtrl.box.intersectsBox(c.box)) {
                c.collected = true; c.mesh.visible = false; state.coins++;
                coinValDisplay.classList.remove('pop-anim'); void coinValDisplay.offsetWidth; coinValDisplay.classList.add('pop-anim');
                spawnCoinParticles(c.mesh.getWorldPosition(new THREE.Vector3()));
            }
        }
    }
}

let currentCamY = 4;

function animate() {
    requestAnimationFrame(animate);

    if (state.isPlaying) {
        const time = Date.now() * 0.0035 * (state.speed / CONFIG.baseSpeed); 
        if (state.speed < CONFIG.maxSpeed) state.speed += CONFIG.speedAcceleration;

        state.history.push({
            x: playerGroup.position.x, y: playerGroup.position.y, z: playerGroup.position.z,
            angle: playerGroup.rotation.y, rotX: playerGroup.rotation.x,
            isJumping: playerCtrl.isJumping, isSliding: playerCtrl.isSliding
        });
        if (state.history.length > 40) state.history.shift();

        state.currentAngle += (state.targetAngle - state.currentAngle) * 0.15;
        playerGroup.rotation.y = state.currentAngle;
        state.playerPos.x += -Math.sin(state.targetAngle) * state.speed;
        state.playerPos.z += -Math.cos(state.targetAngle) * state.speed;
        state.score += state.speed * 0.5;

        if(playerGroup.userData.currentLaneX === undefined) playerGroup.userData.currentLaneX = 0;
        playerGroup.userData.currentLaneX += (playerCtrl.targetX - playerGroup.userData.currentLaneX) * 0.15;
        const laneOffsetX = Math.cos(state.targetAngle) * playerGroup.userData.currentLaneX;
        const laneOffsetZ = -Math.sin(state.targetAngle) * playerGroup.userData.currentLaneX;
        playerGroup.position.x = state.playerPos.x + laneOffsetX;
        playerGroup.position.z = state.playerPos.z + laneOffsetZ;

        let activeY = state.currentFloorY;
        let onGrid = false;
        for (let chunk of state.chunks) {
            const dist = Math.hypot(chunk.userData.x - playerGroup.position.x, chunk.userData.z - playerGroup.position.z);
            if (dist <= CONFIG.chunkLength * 0.8) { 
                onGrid = true;
                if (chunk.userData.type === 'intersection') { activeY = chunk.userData.startY; break; }
                const pLocal = chunk.worldToLocal(playerGroup.position.clone());
                const progress = (CONFIG.chunkLength / 2 - pLocal.z) / CONFIG.chunkLength;
                const clampedProg = Math.max(0, Math.min(1, progress));
                if (chunk.userData.startY !== chunk.userData.endY) {
                    const stepIndex = Math.min(29, Math.floor(clampedProg * 30));
                    activeY = chunk.userData.startY + (stepIndex + 1) * ((chunk.userData.endY - chunk.userData.startY) / 30);
                } else { activeY = chunk.userData.startY; }
                break;
            }
        }
        
        if (!onGrid && state.chunks.length > 0) {
            spawnCrashParticles(playerGroup.position);
            playerGroup.visible = false;
            triggerGameOver("You crashed into the wall!");
        } else { state.currentFloorY = activeY; }

        if (playerCtrl.isJumping) {
            playerGroup.position.y += playerCtrl.yVel; playerCtrl.yVel += CONFIG.gravity;
            if (playerGroup.position.y <= state.currentFloorY) { playerGroup.position.y = state.currentFloorY; playerCtrl.isJumping = false; playerCtrl.yVel = 0; }
        } else if (playerCtrl.isSliding) {
            playerGroup.position.y += ((state.currentFloorY + 0.3) - playerGroup.position.y) * 0.15;
        } else {
            if (playerGroup.position.y > state.currentFloorY + 0.5) { playerCtrl.isJumping = true; playerCtrl.yVel = 0; } 
            else { playerGroup.position.y += (((state.currentFloorY + ((Math.cos(time * 2) + 1) / 2) * 0.12)) - playerGroup.position.y) * 0.25; }
        }
        playerGroup.rotation.x += ((playerCtrl.isSliding ? Math.PI / 2.2 : 0.15) - playerGroup.rotation.x) * 0.15;

        updateWorld(); checkCollisions(); if(Math.floor(state.score) % 5 === 0) updateUI(); 

        let targetState1 = state.history.length >= 15 ? state.history[state.history.length - 15] : null;
        if (targetState1) { chaserGroup1.position.set(targetState1.x, targetState1.y, targetState1.z); chaserGroup1.rotation.set(targetState1.rotX, targetState1.angle, 0); }
        let targetState2 = state.history.length >= 30 ? state.history[state.history.length - 30] : null;
        if (targetState2) { chaserGroup2.position.set(targetState2.x, targetState2.y, targetState2.z); chaserGroup2.rotation.set(targetState2.rotX, targetState2.angle, 0); }

        const animateCharacter = (limbs, isJumping, isSliding) => {
            let tLL, tRL, tLA, tRA;
            if (isJumping) { tLL = -0.8; tRL = 0.2; tLA = Math.PI * 0.8; tRA = Math.PI * 0.8; }
            else if (isSliding) { tLL = -0.1; tRL = -0.1; tLA = 0; tRA = 0; } 
            else { 
                const sprintSpeed = time * 1.2; 
                tLL = Math.sin(sprintSpeed) * 0.9; tRL = Math.sin(sprintSpeed + Math.PI) * 0.9; 
                tLA = Math.sin(sprintSpeed + Math.PI) * 0.6; tRA = Math.sin(sprintSpeed) * 0.6; 
            }
            limbs.lLeg.rotation.x += (tLL - limbs.lLeg.rotation.x) * 0.25; limbs.rLeg.rotation.x += (tRL - limbs.rLeg.rotation.x) * 0.25;
            limbs.lArm.rotation.x += (tLA - limbs.lArm.rotation.x) * 0.25; limbs.rArm.rotation.x += (tRA - limbs.rArm.rotation.x) * 0.25;
        };
        
        animateCharacter(playerGroup.userData.limbs, playerCtrl.isJumping, playerCtrl.isSliding);
        if (targetState1) animateCharacter(chaserGroup1.userData.limbs, targetState1.isJumping, targetState1.isSliding); 
        if (targetState2) animateCharacter(chaserGroup2.userData.limbs, targetState2.isJumping, targetState2.isSliding); 

        const camDistance = 10;
        const targetCamX = playerGroup.position.x + Math.sin(state.currentAngle) * camDistance;
        const targetCamZ = playerGroup.position.z + Math.cos(state.currentAngle) * camDistance;
        currentCamY += ((state.currentFloorY + 4) - currentCamY) * 0.08; 
        camera.position.x += (targetCamX - camera.position.x) * 0.1;
        camera.position.z += (targetCamZ - camera.position.z) * 0.1;
        camera.position.y = currentCamY;
        camera.lookAt(playerGroup.position.x, playerGroup.position.y + 1, playerGroup.position.z);
    
    } else {
        const orbitTime = Date.now() * 0.0005;
        camera.position.x = playerGroup.position.x + Math.sin(orbitTime) * 6;
        camera.position.z = playerGroup.position.z + Math.cos(orbitTime) * 8;
        camera.position.y = 3 + Math.sin(orbitTime * 2) * 1; 
        camera.lookAt(playerGroup.position.x, playerGroup.position.y + 1, playerGroup.position.z);
    }

    for(let i=state.particles.length-1; i>=0; i--) {
        let p = state.particles[i]; p.position.add(p.userData.velocity); p.userData.velocity.y += CONFIG.gravity * 0.5; 
        p.rotation.x += 0.1; p.rotation.y += 0.1; p.userData.life -= 0.02; p.scale.setScalar(Math.max(0, p.userData.life));
        if(p.userData.life <= 0) { scene.remove(p); state.particles.splice(i, 1); }
    }

    state.coinsArr.forEach(c => { if (!c.collected) c.mesh.rotation.y += 0.05; });
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
window.onload = () => { for(let i=0; i<6; i++) createChunk('straight'); animate(); };
