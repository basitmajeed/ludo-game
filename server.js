const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();
// Change this line near the top of server.js
const COLORS = ["Red", "Yellow", "Green", "Blue"];

const colorMap = {
  Red: { startIdx: 0 },
  Green: { startIdx: 13 },
  Yellow: { startIdx: 26 },
  Blue: { startIdx: 39 },
};

// Standard Ludo Safe spots (Starts and Stars)
const SAFE_SPOTS = [0, 8, 13, 21, 26, 34, 39, 47];

function createInitialGameState() {
  const pieces = {};
  COLORS.forEach((color) => {
    pieces[color] = [
      { id: 0, pos: -1, status: "home" },
      { id: 1, pos: -1, status: "home" },
      { id: 2, pos: -1, status: "home" },
      { id: 3, pos: -1, status: "home" },
    ];
  });
  return {
    started: false,
    turnIndex: 0,
    diceValue: null,
    hasRolled: false,
    consecutiveSixes: 0,
    pieces: pieces,
  };
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ username }) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const room = {
      id: roomId,
      players: [
        { id: socket.id, name: username, color: COLORS[0], isBot: false },
      ],
      gameState: createInitialGameState(),
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.emit("roomJoined", { roomId, player: room.players[0], room });
  });

  socket.on("joinRoom", ({ roomId, username }) => {
    const room = rooms.get(roomId?.toUpperCase());
    if (!room) return socket.emit("errorMsg", "Room not found");
    if (room.players.length >= 4)
      return socket.emit("errorMsg", "Room is full");
    if (room.gameState.started)
      return socket.emit("errorMsg", "Game already in progress");

    const color = COLORS[room.players.length];
    const newPlayer = { id: socket.id, name: username, color, isBot: false };
    room.players.push(newPlayer);
    socket.join(room.id);

    io.to(room.id).emit("roomUpdated", room);
    socket.emit("roomJoined", { roomId: room.id, player: newPlayer, room });
  });

  socket.on("addBot", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length >= 4 || room.gameState.started) return;
    const color = COLORS[room.players.length];
    room.players.push({
      id: `bot_${Date.now()}`,
      name: `Bot ${color}`,
      color,
      isBot: true,
    });
    io.to(room.id).emit("roomUpdated", room);
  });

  socket.on("startGame", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length < 2) return;

    const activeColors = room.players.map((p) => p.color);
    Object.keys(room.gameState.pieces).forEach((color) => {
      if (!activeColors.includes(color)) {
        delete room.gameState.pieces[color];
      }
    });

    room.gameState.started = true;
    io.to(roomId).emit("gameStarted", room);
    checkAndTriggerBotTurn(room);
  });

  socket.on("rollDice", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState.started) return;
    const currentPlayer = room.players[room.gameState.turnIndex];
    if (currentPlayer.id !== socket.id || room.gameState.hasRolled) return;
    handleDiceRoll(room);
  });

  socket.on("movePiece", ({ roomId, pieceId }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState.started) return;
    const currentPlayer = room.players[room.gameState.turnIndex];
    if (currentPlayer.id !== socket.id || !room.gameState.hasRolled) return;
    executeMove(room, currentPlayer.color, pieceId);
  });
});

function handleDiceRoll(room) {
  const dice = Math.floor(Math.random() * 6) + 1;
  room.gameState.diceValue = dice;
  room.gameState.hasRolled = true;

  // Track consecutive 6s
  if (dice === 6) {
    room.gameState.consecutiveSixes += 1;
  } else {
    room.gameState.consecutiveSixes = 0;
  }

  // Broadcast roll intent to everyone immediately
  io.to(room.id).emit("diceRolled", {
    dice,
    turnIndex: room.gameState.turnIndex,
  });

  const DELAY = 1200; // 500ms for animation + 700ms read time

  // RULE CHECK: 3 Sixes in a row cancels the turn completely!
  if (room.gameState.consecutiveSixes === 3) {
    setTimeout(() => {
      io.to(room.id).emit("errorMsg", "Three 6s in a row! Turn cancelled.");
      nextTurn(room);
    }, DELAY);
    return; // Stop right here, no moves allowed
  }

  const currentPlayer = room.players[room.gameState.turnIndex];
  const playerPieces = room.gameState.pieces[currentPlayer.color];
  const validPieces = playerPieces.filter((p) => isLegalMove(p, dice));
  const uniqueMoves = new Set(validPieces.map((p) => p.status + "_" + p.pos));

  if (validPieces.length === 0) {
    setTimeout(() => nextTurn(room), 600); // Quick skip
  } else if (currentPlayer.isBot) {
    setTimeout(() => makeBotMove(room), DELAY); // Bot plays
  } else if (uniqueMoves.size === 1) {
    setTimeout(() => {
      if (
        room.gameState.hasRolled &&
        room.players[room.gameState.turnIndex].id === currentPlayer.id
      ) {
        executeMove(room, currentPlayer.color, validPieces[0].id);
      }
    }, 600); // Quick auto-play
  }
}

function isLegalMove(piece, dice) {
  if (piece.status === "finished") return false;
  if (piece.status === "home") return dice === 6;
  return piece.pos + dice <= 56;
}

function executeMove(room, color, pieceId) {
  const pieces = room.gameState.pieces[color];
  const piece = pieces.find((p) => p.id === pieceId);
  const dice = room.gameState.diceValue;

  if (!piece || !isLegalMove(piece, dice)) return;

  let earnedExtraTurn = false;
  let killedSomeone = false;

  if (piece.status === "home" && dice === 6) {
    piece.status = "active";
    piece.pos = 0;
  } else if (piece.status === "active") {
    piece.pos += dice;

    // 1. FINISH LINE LOGIC
    if (piece.pos === 56) {
      piece.status = "finished";
      earnedExtraTurn = true;

      const hasWon = room.gameState.pieces[color].every(
        (p) => p.status === "finished",
      );
      if (hasWon) {
        room.gameState.hasRolled = false;
        io.to(room.id).emit("stateUpdated", room.gameState);
        io.to(room.id).emit("gameOver", {
          winnerName: room.players[room.gameState.turnIndex].name,
          winnerColor: color,
        });
        room.gameState.started = false;
        return;
      } else {
        // Broadcast point scored!
        io.to(room.id).emit("showToast", {
          msg: "🏁 Point Finished! Extra Turn!",
          colorKey: color,
        });
      }

      // 2. CAPTURE LOGIC
    } else if (piece.pos <= 50) {
      const globalPos = (colorMap[color].startIdx + piece.pos) % 52;

      if (!SAFE_SPOTS.includes(globalPos)) {
        Object.keys(room.gameState.pieces).forEach((c) => {
          if (c !== color) {
            room.gameState.pieces[c].forEach((p) => {
              if (p.status === "active" && p.pos <= 50) {
                const otherGlobal = (colorMap[c].startIdx + p.pos) % 52;
                if (otherGlobal === globalPos) {
                  // Captured! Send opponent to start
                  p.status = "home";
                  p.pos = -1;
                  earnedExtraTurn = true;
                  killedSomeone = true;
                }
              }
            });
          }
        });
      }
    }
  }

  // Finalize state
  room.gameState.hasRolled = false;
  io.to(room.id).emit("stateUpdated", room.gameState);

  if (killedSomeone) {
    io.to(room.id).emit("showToast", {
      msg: "⚔️ Target Captured! Extra Turn!",
      colorKey: color,
    });
  }

  // Determine whose turn is next
  if (dice === 6 || earnedExtraTurn) {
    checkAndTriggerBotTurn(room);
  } else {
    nextTurn(room);
  }
}

function nextTurn(room) {
  room.gameState.turnIndex =
    (room.gameState.turnIndex + 1) % room.players.length;
  room.gameState.hasRolled = false;
  room.gameState.consecutiveSixes = 0; // Reset counter for the next player

  io.to(room.id).emit("turnChanged", { turnIndex: room.gameState.turnIndex });

  checkAndTriggerBotTurn(room);
}

function checkAndTriggerBotTurn(room) {
  const currentPlayer = room.players[room.gameState.turnIndex];
  if (currentPlayer && currentPlayer.isBot) {
    setTimeout(() => handleDiceRoll(room), 1000);
  }
}

function makeBotMove(room) {
  const currentPlayer = room.players[room.gameState.turnIndex];
  const pieces = room.gameState.pieces[currentPlayer.color];
  const dice = room.gameState.diceValue;

  const validPieces = pieces.filter((p) => isLegalMove(p, dice));
  if (validPieces.length === 0) return;

  let bestPiece = validPieces[0];
  let bestScore = -1;

  // Evaluate every legal move and score it based on strategy
  validPieces.forEach((p) => {
    let score = 0;
    const targetPos = p.status === "active" ? p.pos + dice : 0;

    // 1. Instant Win Move (Massive Priority)
    if (p.status === "active" && targetPos === 56) {
      score += 1000;
    }

    // 2. Capture an Opponent (Huge Priority)
    if (
      p.status === "active" &&
      checksCapture(room, currentPlayer.color, p, dice)
    ) {
      score += 500;
    }

    // 3. Deploy from Base
    if (p.status === "home" && dice === 6) {
      score += 300;
    }

    // 4. Move to a Safe Spot / Star
    if (
      p.status === "active" &&
      movesToSafeSpot(currentPlayer.color, p, dice)
    ) {
      score += 150;
    }

    // 5. Push the furthest piece forward
    if (p.status === "active") {
      score += p.pos; // Adds 0 to 55 points depending on how far along the piece is
    }

    // Assign the best move
    if (score > bestScore) {
      bestScore = score;
      bestPiece = p;
    }
  });

  executeMove(room, currentPlayer.color, bestPiece.id);
}

// AI HELPER: Simulates if a move will land on an opponent
function checksCapture(room, color, piece, dice) {
  if (piece.status !== "active") return false;
  const targetPos = piece.pos + dice;

  if (targetPos > 50) return false; // Inside the home stretch, captures are impossible

  const globalPos = (colorMap[color].startIdx + targetPos) % 52;
  if (SAFE_SPOTS.includes(globalPos)) return false; // You can't capture on a star

  let willCapture = false;
  Object.keys(room.gameState.pieces).forEach((c) => {
    if (c !== color) {
      room.gameState.pieces[c].forEach((p) => {
        if (p.status === "active" && p.pos <= 50) {
          const otherGlobal = (colorMap[c].startIdx + p.pos) % 52;
          if (otherGlobal === globalPos) willCapture = true;
        }
      });
    }
  });
  return willCapture;
}

// AI HELPER: Simulates if a move lands on a Star/Base
function movesToSafeSpot(color, piece, dice) {
  if (piece.status !== "active") return false;
  const targetPos = piece.pos + dice;
  if (targetPos > 50) return true; // The entire home stretch is technically safe

  const globalPos = (colorMap[color].startIdx + targetPos) % 52;
  return SAFE_SPOTS.includes(globalPos);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
