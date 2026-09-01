const socket = io();
let currentRoom = null;
let myPlayer = null;
let gameState = null;
let clientPieces = null;
let animationFrameId = null;
let rollingInterval = null;
let countdownInterval = null;
let lastTurnNotified = false;

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

const colorMap = {
  Red: { main: "#ff3333", dark: "#cc0000", light: "#ff9999", startIdx: 0 },
  Green: { main: "#00cc44", dark: "#008800", light: "#88ff88", startIdx: 13 },
  Yellow: { main: "#ffcc00", dark: "#cc9900", light: "#ffff88", startIdx: 26 },
  Blue: { main: "#3388ff", dark: "#0044cc", light: "#99ccff", startIdx: 39 },
};

// ... keep PATH array ...
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

// --- AUDIO SYSTEM ---
const sounds = {
  roll: new Audio("sounds/roll.mp3"),
  turn: new Audio("sounds/turn-nudge.mp3"),
  capture: new Audio("sounds/capture.mp3"),
  point: new Audio("sounds/point-complete.mp3"),
  win: new Audio("sounds/win.mp3"),
};

// Quick helper to play sound from the start (allows overlapping sounds)
function playSound(audioKey) {
  if (sounds[audioKey]) {
    sounds[audioKey].currentTime = 0;
    sounds[audioKey]
      .play()
      .catch((e) => console.log("Audio play blocked by browser:", e));
  }
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
  if (!currentRoom || !gameState) return;
  const activePlayer = currentRoom.players[gameState.turnIndex];

  // Only allow click if it's your turn and you haven't rolled yet
  if (activePlayer.id !== socket.id || gameState.hasRolled) return;

  document.getElementById("dice").style.pointerEvents = "none";
  socket.emit("rollDice", { roomId: currentRoom.id });
}

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

socket.on("diceRolled", ({ dice, turnIndex }) => {
  playSound("roll");
  const diceEl = document.getElementById("dice");
  diceEl.classList.add("rolling");

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

socket.on("roomUpdated", (room) => updatePlayerList(room.players));

socket.on("gameStarted", (room) => {
  currentRoom = room;
  gameState = room.gameState;
  clientPieces = JSON.parse(JSON.stringify(gameState.pieces));

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

  // ONLY play the turn sound if you are the first player
  const activePlayer = currentRoom.players[gameState.turnIndex];
  if (activePlayer && activePlayer.id === socket.id) {
    playSound("turn");
  }
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

  // ONLY play the turn sound if the new turn belongs to you
  const activePlayer = currentRoom.players[turnIndex];
  if (activePlayer && activePlayer.id === socket.id) {
    playSound("turn"); // (or however you named your turn audio variable)
  }
});

// Numeric Countdown Timer
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
      if (timeLeft <= 5) timerEl.classList.add("timer-warning"); // Flashes red at 5s
    }
  }, 1000);
});

socket.on("showToast", ({ msg, colorKey }) => {
  if (msg.includes("Target Captured")) playSound("capture");
  if (msg.includes("Point Finished")) playSound("point");
  const toast = document.createElement("div");
  toast.innerText = msg;
  const bgColor = colorMap[colorKey] ? colorMap[colorKey].main : "#334155";
  toast.style = `position:fixed;top:40px;left:50%;transform:translateX(-50%);background:${bgColor};color:#fff;padding:15px 35px;border-radius:50px;font-size:1.3rem;font-weight:800;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,0.6);border:3px solid rgba(255,255,255,0.4);transition:all 0.4s;text-align:center;width:max-content;text-transform:uppercase;`;
  document.body.appendChild(toast);

  // NEW: Screen shake on capture
  if (msg.includes("Target Captured")) {
    const board = document.querySelector(".board-container");
    board.classList.add("shake-animation");
    setTimeout(() => board.classList.remove("shake-animation"), 500);
  }

  setTimeout(() => {
    toast.style.transform = "translateX(-50%) translateY(-20px)";
    toast.style.opacity = "0";
  }, 2500);
  setTimeout(() => toast.remove(), 3000);
});

socket.on("gameOver", ({ winnerName, winnerColor }) => {
  playSound("win");
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

  // Use myPlayer.id to perfectly match your session
  const isMyTurn = activePlayer.id === myPlayer.id;

  // --- NEW FOOLPROOF AUDIO LOGIC ---
  if (isMyTurn && !gameState.hasRolled && !lastTurnNotified) {
    // Play your sound (adjust this line to match how you trigger your audio)
    let turnSound = new Audio("sounds/turn.mp3");
    turnSound.play().catch((e) => console.log(e));

    lastTurnNotified = true; // Lock it so it doesn't play again this turn
  } else if (!isMyTurn) {
    lastTurnNotified = false; // Reset the lock when someone else is playing
  }
  // ---------------------------------

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

  const diceElement = document.getElementById("dice");
  diceElement.style.pointerEvents =
    isMyTurn && !gameState.hasRolled ? "auto" : "none";
  diceElement.style.opacity = isMyTurn && !gameState.hasRolled ? "1" : "0.7";
  msgBox.innerText = isMyTurn
    ? gameState.hasRolled
      ? "Tap a piece to move!"
      : "Your turn! Tap dice."
    : `Waiting for ${activePlayer.name}...`;

  const oldBar = document.getElementById("turnTimerBar");
  if (oldBar && (!isMyTurn || gameState.hasRolled)) oldBar.remove();

  const timerEl = document.getElementById("timerDisplay");
  if (timerEl && (!isMyTurn || gameState.hasRolled)) {
    if (countdownInterval) clearInterval(countdownInterval);
    timerEl.classList.add("hidden");
  }
}

canvas.addEventListener("click", (e) => {
  if (!gameState || !myPlayer) return;
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
  if (!animationFrameId) {
    animationFrameId = requestAnimationFrame(renderBoard);
  }
}

function syncClientAnimations() {
  let animating = false;
  Object.keys(gameState.pieces).forEach((color) => {
    gameState.pieces[color].forEach((serverP, i) => {
      let clientP = clientPieces[color][i];
      if (clientP.status !== serverP.status) {
        if (serverP.status === "active" && clientP.status === "home") {
          clientP.status = "active";
          clientP.pos = -0.5;
        } else if (serverP.status === "home") {
          clientP.status = "home";
          clientP.pos = -1;
        } else if (serverP.status === "finished") {
          clientP.status = "finished";
          clientP.pos = 56;
        }
      }
      if (clientP.status === "active" && clientP.pos !== serverP.pos) {
        animating = true;
        const diff = serverP.pos - clientP.pos;
        clientP.pos += Math.sign(diff) * Math.min(Math.abs(diff), 0.15);
        if (Math.abs(serverP.pos - clientP.pos) < 0.02)
          clientP.pos = serverP.pos;
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

  if (!gameState || !clientPieces) {
    animationFrameId = null;
    return;
  }

  const isAnimating = syncClientAnimations();
  const activePlayer = currentRoom.players[gameState.turnIndex];
  const isMyTurn = activePlayer && activePlayer.id === myPlayer.id;
  const cellGroups = {};

  // Group pieces sharing the same cell
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

      // Determine if piece can be moved for visual cues
      if (
        isMyTurn &&
        color === myPlayer.color &&
        gameState.hasRolled &&
        !isAnimating
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

  // Only loop if pieces are physically moving OR it is the player's turn (to pulse movable pieces)
  // We throttle the pulse check to save processing power.
  if (isAnimating || (isMyTurn && gameState.hasRolled)) {
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

// REDRAWING THE BASES: We make the white inner box massive to "shrink" the base walls visually!
function drawBoardSquares() {
  ctx.fillStyle = "#fdf6e3";
  ctx.fillRect(0, 0, 750, 750);
  ctx.strokeStyle = "#c0c0c0";
  ctx.lineWidth = 2; // Thicker grid lines
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
    ctx.lineWidth = 3; // Make path squares POP
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

// REDRAWING THE BASES: Walls are super thin now, making the board feel much larger!
function drawBase(x, y, colorObj) {
  ctx.fillStyle = colorObj.main;
  ctx.fillRect(x, y, 6 * CELL_SIZE, 6 * CELL_SIZE);

  // Massive white box to hollow out the base
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(
    x + 0.6 * CELL_SIZE,
    y + 0.6 * CELL_SIZE,
    4.8 * CELL_SIZE,
    4.8 * CELL_SIZE,
  );

  // Inner shadow to give it depth
  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 4;
  ctx.strokeRect(
    x + 0.6 * CELL_SIZE,
    y + 0.6 * CELL_SIZE,
    4.8 * CELL_SIZE,
    4.8 * CELL_SIZE,
  );

  // Updated positioning for the resting circles
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
