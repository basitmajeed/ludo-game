const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

const rooms = new Map();
const COLORS = ["Red", "Yellow", "Green", "Blue"]; // Diagonal matchmaking

const colorMap = {
  Red: { startIdx: 0 },
  Green: { startIdx: 13 },
  Yellow: { startIdx: 26 },
  Blue: { startIdx: 39 },
};

const SAFE_SPOTS = [0, 8, 13, 21, 26, 34, 39, 47];
const TURN_TIMEOUT_MS = 15000; // 15 seconds to play

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
    turnTimer: null, // Added server-side timer
  };
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ username, playerId }) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const room = {
      id: roomId,
      players: [
        {
          id: socket.id,
          playerId,
          name: username,
          color: COLORS[0],
          isBot: false,
        },
      ],
      gameState: createInitialGameState(),
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.emit("roomJoined", { roomId, player: room.players[0], room });
  });

  socket.on("joinRoom", ({ roomId, username, playerId }) => {
    const room = rooms.get(roomId?.toUpperCase());
    if (!room) return socket.emit("errorMsg", "Room not found");

    // REJOIN LOGIC: Check if this persistent player is already in the room
    const existingPlayer = room.players.find((p) => p.playerId === playerId);
    if (existingPlayer) {
      existingPlayer.id = socket.id; // Update to their new socket connection
      socket.join(room.id);
      socket.emit("roomJoined", {
        roomId: room.id,
        player: existingPlayer,
        room,
      });

      // If the game is already running, send them straight to the board!
      if (room.gameState.started) {
        socket.emit("gameStarted", room);
      }
      io.to(room.id).emit("roomUpdated", room);
      io.to(room.id).emit("showToast", {
        msg: `${existingPlayer.name} reconnected!`,
        colorKey: existingPlayer.color,
      });
      return;
    }

    if (room.players.length >= 4)
      return socket.emit("errorMsg", "Room is full");
    if (room.gameState.started)
      return socket.emit("errorMsg", "Game already in progress");

    const color = COLORS[room.players.length];
    const newPlayer = {
      id: socket.id,
      playerId,
      name: username,
      color,
      isBot: false,
    };
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
      playerId: `bot_${Date.now()}`,
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
      if (!activeColors.includes(color)) delete room.gameState.pieces[color];
    });

    // --- NEW: CLOCKWISE TURN ENFORCEMENT ---
    // The standard Ludo clockwise board order is Top-Left, Top-Right, Bottom-Right, Bottom-Left
    const CLOCKWISE_ORDER = ["Red", "Green", "Yellow", "Blue"];

    // Sort the players array so the turns always pass in a perfect circle
    room.players.sort(
      (a, b) =>
        CLOCKWISE_ORDER.indexOf(a.color) - CLOCKWISE_ORDER.indexOf(b.color),
    );

    // Reset turnIndex to 0 so it starts with the first clockwise player (usually Red)
    room.gameState.turnIndex = 0;
    // ----------------------------------------

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

// --- CORE GAME ENGINE ---

function startTurnTimer(room, isWaitingForMove = false) {
  clearTimeout(room.gameState.turnTimer);

  const currentPlayer = room.players[room.gameState.turnIndex];
  if (currentPlayer.isBot) return; // Bots don't need AFK timers

  io.to(room.id).emit("timerStarted", { duration: TURN_TIMEOUT_MS });

  room.gameState.turnTimer = setTimeout(() => {
    io.to(room.id).emit("showToast", {
      msg: "AFK Timeout! Auto-playing.",
      colorKey: currentPlayer.color,
    });

    if (!isWaitingForMove) {
      // Player forgot to roll, force a roll
      handleDiceRoll(room);
    } else {
      // Player rolled but forgot to move, force a move
      const pieces = room.gameState.pieces[currentPlayer.color];
      const validPieces = pieces.filter((p) =>
        isLegalMove(p, room.gameState.diceValue),
      );
      if (validPieces.length > 0) {
        const chosen =
          validPieces.find((p) => p.status === "home") ||
          validPieces[Math.floor(Math.random() * validPieces.length)];
        executeMove(room, currentPlayer.color, chosen.id);
      }
    }
  }, TURN_TIMEOUT_MS);
}

function handleDiceRoll(room) {
  clearTimeout(room.gameState.turnTimer);

  const dice = Math.floor(Math.random() * 6) + 1;
  room.gameState.diceValue = dice;
  room.gameState.hasRolled = true;

  if (dice === 6) room.gameState.consecutiveSixes += 1;
  else room.gameState.consecutiveSixes = 0;

  io.to(room.id).emit("diceRolled", {
    dice,
    turnIndex: room.gameState.turnIndex,
  });

  const DELAY = 1200;

  if (room.gameState.consecutiveSixes === 3) {
    setTimeout(() => {
      io.to(room.id).emit("errorMsg", "Three 6s! Turn cancelled.");
      nextTurn(room);
    }, DELAY);
    return;
  }

  const currentPlayer = room.players[room.gameState.turnIndex];
  const playerPieces = room.gameState.pieces[currentPlayer.color];
  const validPieces = playerPieces.filter((p) => isLegalMove(p, dice));
  const uniqueMoves = new Set(validPieces.map((p) => p.status + "_" + p.pos));

  if (validPieces.length === 0) {
    // NEW: Graceful notification for skipped turn
    setTimeout(() => {
      io.to(room.id).emit("showToast", {
        msg: "No valid moves! Skipping turn...",
        colorKey: currentPlayer.color,
      });
      setTimeout(() => nextTurn(room), 1500); // Give players time to read it
    }, DELAY);
  } else if (currentPlayer.isBot) {
    setTimeout(() => makeBotMove(room), DELAY);
  } else if (uniqueMoves.size === 1) {
    setTimeout(() => {
      if (room.gameState.hasRolled)
        executeMove(room, currentPlayer.color, validPieces[0].id);
    }, DELAY + 300); // Smoother auto-move transition
  } else {
    setTimeout(() => startTurnTimer(room, true), DELAY);
  }
}

function isLegalMove(piece, dice) {
  if (piece.status === "finished") return false;
  if (piece.status === "home") return dice === 6;
  return piece.pos + dice <= 56;
}

function executeMove(room, color, pieceId) {
  clearTimeout(room.gameState.turnTimer); // Stop the AFK move timer

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
    if (piece.pos === 56) {
      piece.status = "finished";
      earnedExtraTurn = true;
      const hasWon = room.gameState.pieces[color].every(
        (p) => p.status === "finished",
      );
      if (hasWon) {
        io.to(room.id).emit("stateUpdated", room.gameState);
        io.to(room.id).emit("gameOver", {
          winnerName: room.players[room.gameState.turnIndex].name,
          winnerColor: color,
        });
        room.gameState.started = false;
        return;
      } else {
        io.to(room.id).emit("showToast", {
          msg: "🏁 Point Finished! Extra Turn!",
          colorKey: color,
        });
      }
    } else if (piece.pos <= 50) {
      const globalPos = (colorMap[color].startIdx + piece.pos) % 52;
      if (!SAFE_SPOTS.includes(globalPos)) {
        Object.keys(room.gameState.pieces).forEach((c) => {
          if (c !== color) {
            room.gameState.pieces[c].forEach((p) => {
              if (p.status === "active" && p.pos <= 50) {
                const otherGlobal = (colorMap[c].startIdx + p.pos) % 52;
                if (otherGlobal === globalPos) {
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

  room.gameState.hasRolled = false;
  io.to(room.id).emit("stateUpdated", room.gameState);
  if (killedSomeone)
    io.to(room.id).emit("showToast", {
      msg: "⚔️ Target Captured! Extra Turn!",
      colorKey: color,
    });

  if (dice === 6 || earnedExtraTurn) checkAndTriggerBotTurn(room);
  else nextTurn(room);
}

function nextTurn(room) {
  room.gameState.turnIndex =
    (room.gameState.turnIndex + 1) % room.players.length;
  room.gameState.hasRolled = false;
  room.gameState.consecutiveSixes = 0;
  io.to(room.id).emit("turnChanged", { turnIndex: room.gameState.turnIndex });
  checkAndTriggerBotTurn(room);
}

function checkAndTriggerBotTurn(room) {
  clearTimeout(room.gameState.turnTimer);
  const currentPlayer = room.players[room.gameState.turnIndex];
  if (currentPlayer && currentPlayer.isBot) {
    setTimeout(() => handleDiceRoll(room), 1000);
  } else {
    // It's a human's turn, start their AFK roll timer
    startTurnTimer(room, false);
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

  validPieces.forEach((p) => {
    let score = 0;
    const targetPos = p.status === "active" ? p.pos + dice : 0;
    if (p.status === "active" && targetPos === 56) score += 1000;
    if (
      p.status === "active" &&
      checksCapture(room, currentPlayer.color, p, dice)
    )
      score += 500;
    if (p.status === "home" && dice === 6) score += 300;
    if (p.status === "active" && movesToSafeSpot(currentPlayer.color, p, dice))
      score += 150;
    if (p.status === "active") score += p.pos;

    if (score > bestScore) {
      bestScore = score;
      bestPiece = p;
    }
  });

  executeMove(room, currentPlayer.color, bestPiece.id);
}

function checksCapture(room, color, piece, dice) {
  if (piece.status !== "active") return false;
  const targetPos = piece.pos + dice;
  if (targetPos > 50) return false;
  const globalPos = (colorMap[color].startIdx + targetPos) % 52;
  if (SAFE_SPOTS.includes(globalPos)) return false;
  let willCapture = false;
  Object.keys(room.gameState.pieces).forEach((c) => {
    if (c !== color) {
      room.gameState.pieces[c].forEach((p) => {
        if (p.status === "active" && p.pos <= 50) {
          if ((colorMap[c].startIdx + p.pos) % 52 === globalPos)
            willCapture = true;
        }
      });
    }
  });
  return willCapture;
}

function movesToSafeSpot(color, piece, dice) {
  if (piece.status !== "active") return false;
  const targetPos = piece.pos + dice;
  if (targetPos > 50) return true;
  return SAFE_SPOTS.includes((colorMap[color].startIdx + targetPos) % 52);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
