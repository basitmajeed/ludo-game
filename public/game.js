const socket = io();
let currentRoom = null;
let myPlayer = null;
let gameState = null;
let clientPieces = null;
let animationFrameId = null;
let rollingInterval = null;
let countdownInterval = null;
let wasMyTurn = false;

// PERSISTENT SESSION ID (Allows Rejoining)
let myPlayerId = localStorage.getItem("ludo_playerId");
if (!myPlayerId) {
  myPlayerId = "p_" + Math.random().toString(36).substr(2, 9);
  localStorage.setItem("ludo_playerId", myPlayerId);
}

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const GRID_SIZE = 15;
const CELL_SIZE = 750 / GRID_SIZE;

// Must match STEP_MS / SPAWN_MS in server.js
const STEP_MS = 250;
const SPAWN_MS = 300;

const colorMap = {
  Red: { main: "#ff3333", dark: "#cc0000", light: "#ff9999", startIdx: 0 },
  Green: { main: "#00cc44", dark: "#008800", light: "#88ff88", startIdx: 13 },
  Yellow: { main: "#ffcc00", dark: "#cc9900", light: "#ffff88", startIdx: 26 },
  Blue: { main: "#3388ff", dark: "#0044cc", light: "#99ccff", startIdx: 39 },
};

const PATH = [
  { x: 1, y: 6 },
  { x: 2, y: 6 },
  { x: 3, y: 6 },
  { x: 4, y: 6 },
  { x: 5, y: 6 },
  { x: 6, y: 5 },
  { x: 6, y: 4 },
  { x: 6, y: 3 },
  { x: 6, y: 2 },
  { x: 6, y: 1 },
  { x: 6, y: 0 },
  { x: 7, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 1 },
  { x: 8, y: 2 },
  { x: 8, y: 3 },
  { x: 8, y: 4 },
  { x: 8, y: 5 },
  { x: 9, y: 6 },
  { x: 10, y: 6 },
  { x: 11, y: 6 },
  { x: 12, y: 6 },
  { x: 13, y: 6 },
  { x: 14, y: 6 },
  { x: 14, y: 7 },
  { x: 14, y: 8 },
  { x: 13, y: 8 },
  { x: 12, y: 8 },
  { x: 11, y: 8 },
  { x: 10, y: 8 },
  { x: 9, y: 8 },
  { x: 8, y: 9 },
  { x: 8, y: 10 },
  { x: 8, y: 11 },
  { x: 8, y: 12 },
  { x: 8, y: 13 },
  { x: 8, y: 14 },
  { x: 7, y: 14 },
  { x: 6, y: 14 },
  { x: 6, y: 13 },
  { x: 6, y: 12 },
  { x: 6, y: 11 },
  { x: 6, y: 10 },
  { x: 6, y: 9 },
  { x: 5, y: 8 },
  { x: 4, y: 8 },
  { x: 3, y: 8 },
  { x: 2, y: 8 },
  { x: 1, y: 8 },
  { x: 0, y: 8 },
  { x: 0, y: 7 },
  { x: 0, y: 6 },
];

// --- SOUND & HAPTIC CUES ---
let soundEnabled = localStorage.getItem("ludo_sound") !== "off";
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      audioCtx = null;
    }
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function beep({
  freq = 440,
  duration = 0.12,
  type = "sine",
  volume = 0.15,
  delay = 0,
  glideTo = null,
}) {
  if (!soundEnabled) return;
  const ctx2 = ensureAudio();
  if (!ctx2) return;
  const t0 = ctx2.currentTime + delay;
  const osc = ctx2.createOscillator();
  const gain = ctx2.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo)
    osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(ctx2.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

const SFX = {
  diceRoll: () =>
    beep({ freq: 220, duration: 0.08, type: "square", volume: 0.08 }),
  six: () => {
    beep({ freq: 660, duration: 0.1, volume: 0.12 });
    beep({ freq: 880, duration: 0.15, volume: 0.12, delay: 0.1 });
  },
  capture: () =>
    beep({
      freq: 440,
      duration: 0.25,
      type: "sawtooth",
      volume: 0.16,
      glideTo: 100,
    }),
  finish: () => {
    beep({ freq: 523, duration: 0.12, volume: 0.12 });
    beep({ freq: 659, duration: 0.12, volume: 0.12, delay: 0.12 });
    beep({ freq: 784, duration: 0.2, volume: 0.14, delay: 0.24 });
  },
  yourTurn: () => beep({ freq: 784, duration: 0.15, volume: 0.12 }),
  win: () =>
    [523, 659, 784, 1046].forEach((f, i) =>
      beep({ freq: f, duration: 0.2, volume: 0.15, delay: i * 0.15 }),
    ),
};

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem("ludo_sound", soundEnabled ? "on" : "off");
  const btn = document.getElementById("muteBtn");
  if (btn) btn.innerText = soundEnabled ? "🔊" : "🔇";
  if (soundEnabled) ensureAudio();
}

// --- UI & BUTTON LOGIC ---
function createRoom() {
  socket.emit("createRoom", {
    username: document.getElementById("username").value.trim() || "Player 1",
    playerId: myPlayerId,
  });
}

function joinRoom() {
  socket.emit("joinRoom", {
    roomId: document.getElementById("roomIdInput").value.trim(),
    username: document.getElementById("username").value.trim() || "Player",
    playerId: myPlayerId,
  });
}

function addBot() {
  if (currentRoom) socket.emit("addBot", { roomId: currentRoom.id });
}

function startGame() {
  if (currentRoom) socket.emit("startGame", { roomId: currentRoom.id });
}

function requestRoll() {
  if (!currentRoom || !gameState || gameState.locked) return;
  const activePlayer = currentRoom.players[gameState.turnIndex];

  if (activePlayer.id !== socket.id || gameState.hasRolled) return;

  ensureAudio();
  document.getElementById("dice").style.pointerEvents = "none";
  socket.emit("rollDice", { roomId: currentRoom.id });
}

socket.on("diceRolled", ({ dice, turnIndex }) => {
  SFX.diceRoll();
  const diceEl = document.getElementById("dice");
  diceEl.classList.add("rolling");

  // Rapidly cycles the numbers on the dice face while remaining static
  if (rollingInterval) clearInterval(rollingInterval);
  rollingInterval = setInterval(() => {
    document.getElementById("diceFace").innerHTML = getDiceHTML(
      Math.floor(Math.random() * 6) + 1,
    );
  }, 75);

  setTimeout(() => {
    clearInterval(rollingInterval);
    diceEl.classList.remove("rolling");
    document.getElementById("diceFace").innerHTML = getDiceHTML(dice);

    if (gameState) {
      gameState.diceValue = dice;
      gameState.hasRolled = true;
    }
    if (dice === 6) {
      SFX.six();
      vibrate(120);
    }
    updateTurnUI();
    triggerRender();
  }, 500);
});

socket.on("roomJoined", ({ roomId, player, room }) => {
  myPlayer = player;
  currentRoom = room;
  document.getElementById("lobby").classList.add("hidden");
  document.getElementById("room").classList.remove("hidden");
  document.getElementById("displayRoomCode").innerText = roomId;
  updatePlayerList(room.players);
});

socket.on("roomUpdated", (room) => {
  currentRoom = room;
  updatePlayerList(room.players);
});

socket.on("gameStarted", (room) => {
  currentRoom = room;
  gameState = room.gameState;
  clientPieces = JSON.parse(JSON.stringify(gameState.pieces));
  animMeta = {};
  poofs = [];
  wasMyTurn = false;

  document.getElementById("room").classList.add("hidden");
  document.getElementById("gameScreen").classList.remove("hidden");

  currentRoom.players.forEach((p) => {
    document.getElementById(`hud-${p.color}`).classList.remove("hidden");
    document.getElementById(`name-${p.color}`).innerText =
      p.name + (p.isBot ? " 🤖" : "");
  });
  document.getElementById("diceFace").innerHTML = getDiceHTML(6);
  triggerRender();
  updateTurnUI();
});

socket.on("stateUpdated", (newGameState) => {
  gameState = newGameState;
  updateTurnUI();
  triggerRender();
});

socket.on("turnChanged", ({ turnIndex }) => {
  if (gameState) {
    gameState.turnIndex = turnIndex;
    gameState.hasRolled = false;
  }
  updateTurnUI();
  triggerRender();
});

socket.on("timerStarted", ({ duration }) => {
  let timeLeft = Math.floor(duration / 1000);
  const timerEl = document.getElementById("timerDisplay");

  timerEl.classList.remove("hidden", "timer-warning");
  timerEl.innerText = `⏱ ${timeLeft}s`;

  if (countdownInterval) clearInterval(countdownInterval);

  countdownInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      timerEl.classList.add("hidden");
    } else {
      timerEl.innerText = `⏱ ${timeLeft}s`;
      if (timeLeft <= 5) timerEl.classList.add("timer-warning");
    }
  }, 1000);
});

socket.on("showToast", ({ msg, colorKey }) => {
  if (msg.includes("Captured")) {
    SFX.capture();
    vibrate([80, 40, 80]);
  } else if (msg.includes("Finished")) {
    SFX.finish();
  }

  const toast = document.createElement("div");
  toast.innerText = msg;
  const bgColor = colorMap[colorKey] ? colorMap[colorKey].main : "#334155";

  // Sleek, small, unintrusive toast styling
  toast.style = `
    position: fixed;
    top: 15px;
    left: 50%;
    transform: translateX(-50%);
    background: ${bgColor};
    color: #fff;
    padding: 8px 20px;
    border-radius: 30px;
    font-size: 0.95rem;
    font-weight: 700;
    z-index: 9999;
    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
    border: 2px solid rgba(255,255,255,0.3);
    transition: all 0.3s;
    text-align: center;
    width: max-content;
    text-transform: uppercase;
    pointer-events: none;
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transform = "translateX(-50%) translateY(-20px)";
    toast.style.opacity = "0";
  }, 2500);
  setTimeout(() => toast.remove(), 3000);
});

socket.on("gameOver", ({ winnerName, winnerColor }) => {
  SFX.win();
  if (navigator.vibrate) navigator.vibrate([100, 60, 100, 60, 200]);
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  const overlay = document.createElement("div");
  overlay.style = `position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;justify-content:center;align-items:center;z-index:9999;color:#fff;`;
  overlay.innerHTML = `<h1 style="font-size:3rem;color:${colorMap[winnerColor].light};text-shadow:0 0 20px ${colorMap[winnerColor].main};">🎉 VICTORY 🎉</h1><h2 style="font-size:2rem;margin-bottom:30px;">${winnerName} wins!</h2><button onclick="location.reload()" style="padding:10px 20px;font-size:1rem;background:#ffeb3b;color:#111;border:none;border-radius:10px;cursor:pointer;font-weight:bold;">Play Again</button>`;
  document.body.appendChild(overlay);
});

socket.on("errorMsg", (msg) => {
  const toast = document.createElement("div");
  toast.innerText = msg;
  toast.style =
    "position:fixed;top:30px;left:50%;transform:translateX(-50%);background:#ff3333;color:#fff;padding:15px 30px;border-radius:12px;font-size:1.2rem;font-weight:bold;z-index:9999;box-shadow:0 10px 25px rgba(0,0,0,0.7);transition:opacity 0.5s;";
  document.body.appendChild(toast);
  setTimeout(() => (toast.style.opacity = "0"), 2500);
  setTimeout(() => toast.remove(), 3000);
});

function getDiceHTML(val) {
  const c = val === 6 ? "dot red" : "dot";
  const dots = {
    1: `<div class="${c} center"></div>`,
    2: `<div class="${c} top-left"></div><div class="${c} bottom-right"></div>`,
    3: `<div class="${c} top-left"></div><div class="${c} center"></div><div class="${c} bottom-right"></div>`,
    4: `<div class="${c} top-left"></div><div class="${c} top-right"></div><div class="${c} bottom-left"></div><div class="${c} bottom-right"></div>`,
    5: `<div class="${c} top-left"></div><div class="${c} top-right"></div><div class="${c} center"></div><div class="${c} bottom-left"></div><div class="${c} bottom-right"></div>`,
    6: `<div class="${c} top-left"></div><div class="${c} top-right"></div><div class="${c} mid-left"></div><div class="${c} mid-right"></div><div class="${c} bottom-left"></div><div class="${c} bottom-right"></div>`,
  };
  return dots[val] || dots[6];
}

function updatePlayerList(players) {
  document.getElementById("playerList").innerHTML = players
    .map(
      (p) =>
        `<li><span>${p.name} ${p.isBot ? "🤖" : ""}</span><span style="color: ${colorMap[p.color].light};">${p.color}</span></li>`,
    )
    .join("");
}

function updateTurnUI() {
  if (!currentRoom || !gameState) return;
  const activePlayer = currentRoom.players[gameState.turnIndex];
  const isMyTurn = activePlayer.id === socket.id;
  const locked = !!gameState.locked;

  document
    .querySelectorAll(".player-hud")
    .forEach((el) => el.classList.remove("active"));
  const activeHud = document.getElementById(`hud-${activePlayer.color}`);
  if (activeHud) activeHud.classList.add("active");

  const controls = document.getElementById("commonControls");
  controls.style.borderColor = colorMap[activePlayer.color].main;
  controls.style.boxShadow = `0 10px 25px ${colorMap[activePlayer.color].dark}88`;

  const msgBox = document.getElementById("messageBox");
  msgBox.style.color = colorMap[activePlayer.color].light;
  msgBox.classList.remove("your-turn-pulse");

  const diceElement = document.getElementById("dice");
  const canRoll = isMyTurn && !gameState.hasRolled && !locked;
  diceElement.style.pointerEvents = canRoll ? "auto" : "none";
  diceElement.style.opacity = canRoll ? "1" : "0.6";

  if (locked) {
    msgBox.innerText = "Moving…";
  } else if (isMyTurn) {
    msgBox.innerText = gameState.hasRolled
      ? "Tap a piece to move!"
      : "Your turn! Tap the dice.";
    msgBox.classList.add("your-turn-pulse");
  } else {
    msgBox.innerText = `Waiting for ${activePlayer.name}...`;
  }

  // Prevents the sound from repeating if the state updates for other reasons
  if (isMyTurn && !wasMyTurn && !locked) {
    SFX.yourTurn();
    vibrate(150);
  }
  wasMyTurn = isMyTurn;

  const oldBar = document.getElementById("turnTimerBar");
  if (oldBar && (!isMyTurn || gameState.hasRolled || locked)) oldBar.remove();

  const timerEl = document.getElementById("timerDisplay");
  if (timerEl && (!isMyTurn || gameState.hasRolled || locked)) {
    if (countdownInterval) clearInterval(countdownInterval);
    timerEl.classList.add("hidden");
  }
}

canvas.addEventListener("click", (e) => {
  if (!gameState || !myPlayer || gameState.locked) return;
  const activePlayer = currentRoom.players[gameState.turnIndex];
  if (activePlayer.id !== myPlayer.id || !gameState.hasRolled) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width,
    scaleY = canvas.height / rect.height;
  const clickX = (e.clientX - rect.left) * scaleX,
    clickY = (e.clientY - rect.top) * scaleY;

  for (let piece of gameState.pieces[myPlayer.color]) {
    const coords = getVisualCoordinates(myPlayer.color, piece, 0, 1);
    if (Math.sqrt((clickX - coords.x) ** 2 + (clickY - coords.y) ** 2) < 35) {
      if (
        (piece.status === "home" && gameState.diceValue === 6) ||
        (piece.status === "active" && piece.pos + gameState.diceValue <= 56)
      ) {
        socket.emit("movePiece", { roomId: currentRoom.id, pieceId: piece.id });
        break;
      }
    }
  }
});

function triggerRender() {
  if (!animationFrameId) renderBoard();
}

// --- ANIMATION STATE ---
let animMeta = {};
let poofs = [];

function spawnPoof(x, y, color) {
  poofs.push({ x, y, color, start: performance.now() });
}

function drawPoofs() {
  const now = performance.now();
  const DUR = 420;
  poofs = poofs.filter((p) => now - p.start < DUR);
  poofs.forEach((p) => {
    const t = (now - p.start) / DUR;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10 + t * 34, 0, Math.PI * 2);
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function syncClientAnimations() {
  let animating = false;
  const now = performance.now();

  Object.keys(gameState.pieces).forEach((color) => {
    gameState.pieces[color].forEach((serverP, i) => {
      const clientP = clientPieces[color][i];
      const key = color + "_" + i;

      if (clientP.status !== serverP.status) {
        if (serverP.status === "active" && clientP.status === "home") {
          clientP.status = "active";
          clientP.pos = -0.5;
          animMeta[key] = { from: -0.5, to: 0, start: now, duration: SPAWN_MS };
        } else if (serverP.status === "home" && clientP.status !== "home") {
          const coords = getVisualCoordinates(color, clientP, 0, 1);
          spawnPoof(coords.x, coords.y, colorMap[color].main);
          clientP.status = "home";
          clientP.pos = -1;
          delete animMeta[key];
        } else if (
          serverP.status === "finished" &&
          clientP.status === "active"
        ) {
          // FIX: Only set up the finish animation if we haven't already started it!
          if (!animMeta[key] || animMeta[key].to !== 56) {
            const remaining = Math.max(1, 56 - clientP.pos);
            animMeta[key] = {
              from: clientP.pos,
              to: 56,
              start: now,
              duration: remaining * STEP_MS,
            };
          }
        } else {
          clientP.status = serverP.status;
          clientP.pos = serverP.status === "finished" ? 56 : serverP.pos;
          delete animMeta[key];
        }
      } else if (
        clientP.status === "active" &&
        clientP.pos !== serverP.pos &&
        !(animMeta[key] && animMeta[key].to === serverP.pos)
      ) {
        const dist = Math.max(1, Math.round(serverP.pos - clientP.pos));
        animMeta[key] = {
          from: clientP.pos,
          to: serverP.pos,
          start: now,
          duration: dist * STEP_MS,
        };
      }

      const meta = animMeta[key];
      if (meta && clientP.status === "active") {
        const t = Math.min(1, (now - meta.start) / meta.duration);
        clientP.pos = meta.from + (meta.to - meta.from) * t;

        if (t < 1) {
          animating = true;
        } else {
          delete animMeta[key];
          // Once it physically reaches 56, snap its status to finished so it moves to the center triangle
          if (gameState.pieces[color][i].status === "finished") {
            clientP.status = "finished";
            clientP.pos = 56;
          } else {
            clientP.pos = meta.to;
          }
        }
      }
    });
  });
  return animating;
}

function renderBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBoardSquares();
  drawBase(0, 0, colorMap.Red);
  drawBase(9 * CELL_SIZE, 0, colorMap.Green);
  drawBase(9 * CELL_SIZE, 9 * CELL_SIZE, colorMap.Yellow);
  drawBase(0, 9 * CELL_SIZE, colorMap.Blue);
  drawCenterHome();

  if (!gameState || !clientPieces) return;
  const isAnimating = syncClientAnimations();
  const activePlayer = currentRoom.players[gameState.turnIndex];
  const isMyTurn = activePlayer && myPlayer && activePlayer.id === myPlayer.id;
  const locked = !!gameState.locked;
  const cellGroups = {};

  Object.keys(clientPieces).forEach((color) => {
    clientPieces[color].forEach((p) => {
      if (p.status === "active" && Number.isInteger(p.pos)) {
        const cellId =
          p.pos <= 50
            ? (colorMap[color].startIdx + p.pos) % 52
            : p.pos + 100 * colorMap[color].startIdx;
        if (!cellGroups[cellId]) cellGroups[cellId] = [];
        cellGroups[cellId].push({ color, id: p.id });
      }
    });
  });

  Object.keys(clientPieces).forEach((color) => {
    clientPieces[color].forEach((clientPiece, i) => {
      const serverPiece = gameState.pieces[color][i];
      let isMovable = false;
      if (
        isMyTurn &&
        color === myPlayer.color &&
        gameState.hasRolled &&
        !isAnimating &&
        !locked
      ) {
        if (serverPiece.status === "home" && gameState.diceValue === 6)
          isMovable = true;
        if (
          serverPiece.status === "active" &&
          serverPiece.pos + gameState.diceValue <= 56
        )
          isMovable = true;
      }
      let cIdx = 0,
        cTotal = 1;
      if (
        clientPiece.status === "active" &&
        Number.isInteger(clientPiece.pos)
      ) {
        const cellId =
          clientPiece.pos <= 50
            ? (colorMap[color].startIdx + clientPiece.pos) % 52
            : clientPiece.pos + 100 * colorMap[color].startIdx;
        const group = cellGroups[cellId];
        if (group && group.length > 1) {
          cTotal = group.length;
          cIdx = group.findIndex(
            (g) => g.color === color && g.id === clientPiece.id,
          );
        }
      }
      const coords = getVisualCoordinates(color, clientPiece, cIdx, cTotal);
      drawPiece(
        coords.x,
        coords.y,
        colorMap[color],
        isMovable,
        cTotal > 1 ? 12 : 18,
      );
    });
  });

  drawPoofs();

  if (isAnimating || isMyTurn || poofs.length > 0) {
    animationFrameId = requestAnimationFrame(renderBoard);
  } else {
    animationFrameId = null;
  }
}

function getVisualCoordinates(color, piece, clusterIdx, clusterTotal) {
  if (piece.status === "home") {
    const baseOffsets = {
      Red: { x: 0, y: 0 },
      Green: { x: 9, y: 0 },
      Yellow: { x: 9, y: 9 },
      Blue: { x: 0, y: 9 },
    };
    const offset = baseOffsets[color];
    const internalX = piece.id % 2 === 0 ? 1.8 : 4.2,
      internalY = piece.id < 2 ? 1.8 : 4.2;
    return {
      x: (offset.x + internalX) * CELL_SIZE,
      y: (offset.y + internalY) * CELL_SIZE,
    };
  }
  if (piece.status === "finished") {
    const cx = 7.5 * CELL_SIZE,
      cy = 7.5 * CELL_SIZE,
      off = 1.1 * CELL_SIZE,
      spread = 12;
    const dx = (piece.id % 2 === 0 ? -1 : 1) * spread,
      dy = (piece.id < 2 ? -1 : 1) * spread;
    if (color === "Red") return { x: cx - off + dx, y: cy + dy };
    if (color === "Green") return { x: cx + dx, y: cy - off + dy };
    if (color === "Yellow") return { x: cx + off + dx, y: cy + dy };
    if (color === "Blue") return { x: cx + dx, y: cy + off + dy };
  }
  if (piece.pos < 0) {
    const baseOffsets = {
      Red: { x: 0, y: 0 },
      Green: { x: 9, y: 0 },
      Yellow: { x: 9, y: 9 },
      Blue: { x: 0, y: 9 },
    };
    const offset = baseOffsets[color];
    const startX = (offset.x + 3.0) * CELL_SIZE,
      startY = (offset.y + 3.0) * CELL_SIZE;
    const targetCoord = getExactPathCoord(color, 0);
    const t = piece.pos + 0.5;
    const x = startX + (targetCoord.x - startX) * t;
    const y =
      startY + (targetCoord.y - startY) * t - Math.sin(t * Math.PI) * 40;
    return { x, y };
  }
  const idx1 = Math.floor(piece.pos),
    idx2 = Math.ceil(piece.pos);
  const t = piece.pos - idx1;
  const p1 = getExactPathCoord(color, idx1),
    p2 = getExactPathCoord(color, idx2);
  let x = p1.x + (p2.x - p1.x) * t,
    y = p1.y + (p2.y - p1.y) * t;
  if (clusterTotal > 1) {
    const offsets = [
      [-8, -8],
      [8, -8],
      [-8, 8],
      [8, 8],
    ];
    x += offsets[clusterIdx % 4][0];
    y += offsets[clusterIdx % 4][1];
  }
  return { x, y };
}

function getExactPathCoord(color, pos) {
  if (pos <= 50) {
    const cell = PATH[(colorMap[color].startIdx + pos) % 52];
    return {
      x: cell.x * CELL_SIZE + CELL_SIZE / 2,
      y: cell.y * CELL_SIZE + CELL_SIZE / 2,
    };
  }
  const stretchIdx = pos - 50;
  let hx, hy;
  if (color === "Red") {
    hx = stretchIdx;
    hy = 7;
  } else if (color === "Green") {
    hx = 7;
    hy = stretchIdx;
  } else if (color === "Yellow") {
    hx = 14 - stretchIdx;
    hy = 7;
  } else if (color === "Blue") {
    hx = 7;
    hy = 14 - stretchIdx;
  }
  return {
    x: hx * CELL_SIZE + CELL_SIZE / 2,
    y: hy * CELL_SIZE + CELL_SIZE / 2,
  };
}

function drawBoardSquares() {
  ctx.fillStyle = "#fdf6e3";
  ctx.fillRect(0, 0, 750, 750);
  ctx.strokeStyle = "#c0c0c0";
  ctx.lineWidth = 2;
  for (let i = 0; i <= GRID_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL_SIZE, 0);
    ctx.lineTo(i * CELL_SIZE, 750);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * CELL_SIZE);
    ctx.lineTo(750, i * CELL_SIZE);
    ctx.stroke();
  }

  function fillRectAt(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 3;
    ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  }

  for (let i = 1; i <= 5; i++) {
    fillRectAt(i, 7, colorMap.Red.main);
    fillRectAt(7, i, colorMap.Green.main);
    fillRectAt(14 - i, 7, colorMap.Yellow.main);
    fillRectAt(7, 14 - i, colorMap.Blue.main);
  }
  fillRectAt(1, 6, colorMap.Red.main);
  fillRectAt(8, 1, colorMap.Green.main);
  fillRectAt(13, 8, colorMap.Yellow.main);
  fillRectAt(6, 13, colorMap.Blue.main);
  [
    { x: 6, y: 2 },
    { x: 12, y: 6 },
    { x: 8, y: 12 },
    { x: 2, y: 8 },
  ].forEach((sq) => fillRectAt(sq.x, sq.y, "#c8d6e5"));
  [
    { x: 1, y: 6 },
    { x: 8, y: 1 },
    { x: 13, y: 8 },
    { x: 6, y: 13 },
    { x: 6, y: 2 },
    { x: 12, y: 6 },
    { x: 8, y: 12 },
    { x: 2, y: 8 },
  ].forEach((sq) =>
    drawStar((sq.x + 0.5) * CELL_SIZE, (sq.y + 0.5) * CELL_SIZE, 5, 14, 6),
  );
}

function drawStar(cx, cy, spikes, outerRadius, innerRadius) {
  let rot = (Math.PI / 2) * 3,
    x = cx,
    y = cy,
    step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;
    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

function drawBase(x, y, colorObj) {
  ctx.fillStyle = colorObj.main;
  ctx.fillRect(x, y, 6 * CELL_SIZE, 6 * CELL_SIZE);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(
    x + 0.6 * CELL_SIZE,
    y + 0.6 * CELL_SIZE,
    4.8 * CELL_SIZE,
    4.8 * CELL_SIZE,
  );

  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 4;
  ctx.strokeRect(
    x + 0.6 * CELL_SIZE,
    y + 0.6 * CELL_SIZE,
    4.8 * CELL_SIZE,
    4.8 * CELL_SIZE,
  );

  [
    [1.8, 1.8],
    [4.2, 1.8],
    [1.8, 4.2],
    [4.2, 4.2],
  ].forEach((off) => {
    ctx.beginPath();
    ctx.arc(x + off[0] * CELL_SIZE, y + off[1] * CELL_SIZE, 22, 0, Math.PI * 2);
    ctx.fillStyle = colorObj.main;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + off[0] * CELL_SIZE, y + off[1] * CELL_SIZE, 16, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fill();
  });
}

function drawCenterHome() {
  const cx = 7.5 * CELL_SIZE,
    cy = 7.5 * CELL_SIZE;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.moveTo(6 * CELL_SIZE, 6 * CELL_SIZE);
  ctx.lineTo(9 * CELL_SIZE, 6 * CELL_SIZE);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = colorMap.Green.main;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(9 * CELL_SIZE, 6 * CELL_SIZE);
  ctx.lineTo(9 * CELL_SIZE, 9 * CELL_SIZE);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = colorMap.Yellow.main;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(9 * CELL_SIZE, 9 * CELL_SIZE);
  ctx.lineTo(6 * CELL_SIZE, 9 * CELL_SIZE);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = colorMap.Blue.main;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(6 * CELL_SIZE, 9 * CELL_SIZE);
  ctx.lineTo(6 * CELL_SIZE, 6 * CELL_SIZE);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = colorMap.Red.main;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
}

function drawPiece(x, y, colorObj, isHighlight, radius = 18) {
  if (isHighlight) {
    const time = Date.now() / 120;
    const pulseBoost = Math.sin(time) * 6;
    ctx.beginPath();
    ctx.arc(x, y, radius + 12 + pulseBoost, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 235, 59, 0.8)";
    ctx.shadowColor = "#ffeb3b";
    ctx.shadowBlur = 15;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.beginPath();
  ctx.arc(x + 3, y + 4, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fill();
  const grad = ctx.createRadialGradient(
    x - radius / 3,
    y - radius / 3,
    radius / 10,
    x,
    y,
    radius,
  );
  grad.addColorStop(0, colorObj.light);
  grad.addColorStop(1, colorObj.dark);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, radius - 4, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(
    x - radius / 3,
    y - radius / 2,
    radius / 2.5,
    radius / 5,
    Math.PI / 6,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fill();
}

document.getElementById("diceFace").innerHTML = getDiceHTML(6);
const muteBtnInit = document.getElementById("muteBtn");
if (muteBtnInit) muteBtnInit.innerText = soundEnabled ? "🔊" : "🔇";
